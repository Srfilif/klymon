import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openDatabase, ContentRepository, type DatabaseHandle } from '@klymon/database';
import { LauncherLogger, type LauncherPaths } from '@klymon/core';
import type { DownloadManager } from '@klymon/download-manager';
import type { ContentVersion } from '@klymon/shared-types';
import { ContentManager } from '@klymon/mod-manager';

let handle: DatabaseHandle | null = null;

afterEach(() => {
  handle?.close();
  handle = null;
});

function version(id: string): ContentVersion {
  return {
    id,
    projectId: 'proj-p',
    name: `P ${id}`,
    versionNumber: id,
    gameVersions: ['1.21.1'],
    loaders: ['fabric'],
    downloadUrl: `https://cdn.example.com/${id}.jar`,
    fileName: `${id}.jar`,
    fileSize: 10,
    hashes: {},
    dependencies: [],
    releaseType: 'release',
    publishedAt: '2026-01-01T00:00:00Z',
    projectUrl: 'https://modrinth.com/mod/p',
    iconUrl: null,
  };
}

async function harness() {
  const root = mkdtempSync(join(tmpdir(), 'klymon-pins-'));
  handle = await openDatabase(join(root, 'launcher.db'));
  const db = handle.db;
  const logger = new LauncherLogger({ level: 'silent' });
  const content = new ContentRepository(db);
  const gameDir = join(root, 'game');
  const downloads = {
    downloadBatch: async (_batchId: string, batch: Array<{ url: string; destination: string }>) => {
      for (const task of batch) {
        await mkdir(dirname(task.destination), { recursive: true });
        await writeFile(task.destination, `dummy:${task.url}`);
      }
      return { files: batch.length, bytes: 0, skipped: 0 };
    },
  } as unknown as DownloadManager;
  const manager = new ContentManager({
    paths: { tempDir: join(root, 'temp'), backupsDir: join(root, 'backups') } as LauncherPaths,
    downloads,
    content,
    logger,
    resolveInstance: async (instanceId: string) => ({
      instanceId,
      gameDir,
      mcVersion: '1.21.1',
      loaderType: 'fabric',
      loaderVersion: '0.20.1',
    }),
    provisionInstance: async () => ({ instanceId: 'x', gameDir }),
    curseforgeApiKey: () => null,
    clients: {
      modrinth: {
        versions: async () => [version('W'), version('V')],
        version: async (id: string) => version(id),
      } as never,
    },
  });
  return { manager, content, gameDir };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    instanceId: 'i1',
    kind: 'mod',
    fileName: 'V.jar',
    path: '/tmp/V.jar',
    projectId: 'proj-p',
    versionId: 'V',
    title: 'P',
    versionNumber: 'V',
    iconUrl: null,
    enabled: true,
    sizeBytes: 10,
    installedAt: new Date().toISOString(),
    sha1: null,
    sourceUrl: null,
    ...overrides,
  } as Parameters<ContentRepository['insert']>[0];
}

describe('content version pins', () => {
  it('defaults pinned to false on fresh rows', async () => {
    const { content } = await harness();
    content.insert(row({ id: 'a' }));
    expect(content.list('i1', 'mod')[0]?.pinned).toBe(false);
  });

  it('persists pin toggles', async () => {
    const { manager, content } = await harness();
    content.insert(row({ id: 'b' }));
    const pinned = await manager.setPinned('b', true);
    expect(pinned.pinned).toBe(true);
    expect(content.list('i1', 'mod')[0]?.pinned).toBe(true);
    const unpinned = await manager.setPinned('b', false);
    expect(unpinned.pinned).toBe(false);
  });

  it('keeps the pinned version on reinstall without an explicit version', async () => {
    const { manager, content } = await harness();
    content.insert(row({ id: 'c', pinned: true }));
    await manager.install({ instanceId: 'i1', source: 'modrinth', projectId: 'proj-p', versionId: null, kind: 'mod' });
    expect(content.list('i1', 'mod')[0]?.versionId).toBe('V');
  });

  it('installs the latest version when the row is not pinned', async () => {
    const { manager, content } = await harness();
    content.insert(row({ id: 'd', pinned: false }));
    await manager.install({ instanceId: 'i1', source: 'modrinth', projectId: 'proj-p', versionId: null, kind: 'mod' });
    expect(content.list('i1', 'mod')[0]?.versionId).toBe('W');
  });

  it('an explicit version always wins over the pin', async () => {
    const { manager, content } = await harness();
    content.insert(row({ id: 'e', pinned: true }));
    await manager.install({ instanceId: 'i1', source: 'modrinth', projectId: 'proj-p', versionId: 'W', kind: 'mod' });
    expect(content.list('i1', 'mod')[0]?.versionId).toBe('W');
  });

  it('migrates pre-0003 databases preserving rows (pinned defaults false)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'klymon-pins-mig-'));
    const file = join(root, 'launcher.db');
    const old = new Database(file);
    old.exec(`CREATE TABLE installed_content (
        id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, kind TEXT NOT NULL, file_name TEXT NOT NULL,
        path TEXT NOT NULL, project_id TEXT, version_id TEXT, title TEXT NOT NULL, version_number TEXT,
        icon_url TEXT, enabled INTEGER NOT NULL DEFAULT 1, size_bytes INTEGER NOT NULL DEFAULT 0,
        installed_at TEXT NOT NULL, sha1 TEXT, source_url TEXT
      );
      CREATE TABLE _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO _migrations (id, applied_at) VALUES ('0001_initial', '2026-01-01'), ('0002_progression', '2026-01-02');
      INSERT INTO installed_content (id, instance_id, kind, file_name, path, title, installed_at)
        VALUES ('old-1', 'i1', 'mod', 'x.jar', '/x.jar', 'X', '2026-01-01');`);
    old.close();
    handle = await openDatabase(file);
    const rows = new ContentRepository(handle.db).list('i1', 'mod');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('X');
    expect(rows[0]?.pinned).toBe(false);
  });
});
