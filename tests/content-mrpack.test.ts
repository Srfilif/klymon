import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
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

interface CapturedTask {
  url: string;
  destination: string;
  sha1?: string;
  size?: number;
}

function mrpackBuffer(index: unknown, overrides: Record<string, string> = {}): Buffer {
  const entries: Record<string, Uint8Array> = {
    'modrinth.index.json': new TextEncoder().encode(JSON.stringify(index)),
  };
  for (const [name, text] of Object.entries(overrides)) {
    entries[name] = new TextEncoder().encode(text);
  }
  return Buffer.from(zipSync(entries, { level: 6 }));
}

async function harness(pack: Buffer) {
  const root = mkdtempSync(join(tmpdir(), 'klymon-mrpack-'));
  handle = await openDatabase(join(root, 'launcher.db'));
  const db = handle.db;
  const logger = new LauncherLogger({ level: 'silent' });
  const content = new ContentRepository(db);
  const tasks: CapturedTask[] = [];
  const downloads = {
    downloadBatch: async (_batchId: string, batch: CapturedTask[]) => {
      for (const task of batch) {
        tasks.push(task);
        await mkdir(dirname(task.destination), { recursive: true });
        await writeFile(task.destination, task.destination.endsWith('.mrpack') ? pack : `dummy:${task.url}`);
      }
      return { files: batch.length, bytes: 0, skipped: 0 };
    },
  } as unknown as DownloadManager;
  const gameDir = join(root, 'game');
  const provisioned: Array<{ name: string; mcVersion: string; loaderType: string; loaderVersion: string | null }> = [];
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
    provisionInstance: async (input) => {
      provisioned.push(input);
      return { instanceId: 'inst-1', gameDir };
    },
    curseforgeApiKey: () => null,
    clients: {
      modrinth: {
        version: async (id: string): Promise<ContentVersion> => ({
          id,
          projectId: 'pack-proj',
          name: 'Pack',
          versionNumber: '1.0.0',
          gameVersions: ['1.21.1'],
          loaders: ['fabric'],
          downloadUrl: 'https://cdn.example.com/pack.mrpack',
          fileName: 'pack.mrpack',
          fileSize: pack.length,
          hashes: {},
          dependencies: [],
          releaseType: 'release',
          publishedAt: '2026-01-01T00:00:00Z',
          projectUrl: 'https://modrinth.com/modpack/pack',
          iconUrl: null,
        }),
      } as never,
    },
  });
  return { manager, content, tasks, provisioned, gameDir, root };
}

const PACK_INDEX = {
  formatVersion: 1,
  game: 'minecraft',
  versionId: '9.9.9',
  name: 'Pack',
  summary: '',
  dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.20.1' },
  files: [
    { path: 'mods/a.jar', downloads: ['https://cdn.example.com/a.jar'], hashes: { sha1: 'abc123' }, fileSize: 10, env: { client: 'required' } },
    { path: 'mods/b.jar', downloads: ['https://cdn.example.com/b.jar'], hashes: {}, env: { client: 'unsupported' } },
    { path: 'mods/c.jar', downloads: [], hashes: {} },
  ],
};

describe('mrpack install', () => {
  it('installs files, writes overrides and counts skips', async () => {
    const pack = mrpackBuffer(PACK_INDEX, { 'overrides/config/x.txt': 'x=1', 'client-overrides/options.txt': 'fov:90' });
    const { manager, tasks, provisioned, gameDir } = await harness(pack);
    const result = await manager.installModpack({ source: 'modrinth', projectId: 'pack-proj', versionId: 'v1' });
    expect(result).toEqual({ instanceId: 'inst-1', name: 'Pack', files: 1, skipped: 2 });
    expect(provisioned).toEqual([{ name: 'Pack', mcVersion: '1.21.1', loaderType: 'fabric', loaderVersion: '0.20.1' }]);
    const fileTasks = tasks.filter((task) => !task.destination.endsWith('.mrpack'));
    expect(fileTasks).toHaveLength(1);
    expect(fileTasks[0]?.url).toBe('https://cdn.example.com/a.jar');
    expect(fileTasks[0]?.sha1).toBe('abc123');
    expect(fileTasks[0]?.size).toBe(10);
    expect(fileTasks[0]?.destination).toBe(join(gameDir, 'mods', 'a.jar'));
    expect(await readFile(join(gameDir, 'config', 'x.txt'), 'utf8')).toBe('x=1');
    expect(await readFile(join(gameDir, 'options.txt'), 'utf8')).toBe('fov:90');
  });

  it('rejects non-mrpack archives with a clear error', async () => {
    const pack = Buffer.from(zipSync({ 'readme.txt': new TextEncoder().encode('nope') }));
    const { manager } = await harness(pack);
    await expect(manager.installModpack({ source: 'modrinth', projectId: 'p', versionId: 'v' })).rejects.toThrowError(/not a Modrinth modpack/i);
  });

  it('rejects packs without a minecraft version', async () => {
    const pack = mrpackBuffer({ ...PACK_INDEX, dependencies: {} });
    const { manager } = await harness(pack);
    await expect(manager.installModpack({ source: 'modrinth', projectId: 'p', versionId: 'v' })).rejects.toThrowError(/minecraft version/i);
  });
});

describe('mrpack export', () => {
  it('exports enabled registry mods with original urls and hashes', async () => {
    const { manager, content, root } = await harness(Buffer.alloc(0));
    const stamp = new Date().toISOString();
    content.insert({
      id: 'm1', instanceId: 'i1', kind: 'mod', fileName: 'a.jar', path: join(root, 'a.jar'),
      projectId: 'proj-a', versionId: 'va', title: 'A', versionNumber: '1.0', iconUrl: null,
      enabled: true, sizeBytes: 10, installedAt: stamp, sha1: 'abc123', sourceUrl: 'https://cdn.example.com/a.jar',
      pinned: false,
    });
    content.insert({
      id: 'm2', instanceId: 'i1', kind: 'mod', fileName: 'b.jar', path: join(root, 'b.jar'),
      projectId: null, versionId: null, title: 'B', versionNumber: null, iconUrl: null,
      enabled: false, sizeBytes: 20, installedAt: stamp, sha1: null, sourceUrl: null,
      pinned: false,
    });
    const outPath = await manager.exportMrpack({ instanceId: 'i1', name: 'My Pack' });
    expect(outPath.endsWith('.mrpack')).toBe(true);
    const entries = unzipSync(await readFile(outPath));
    const index = JSON.parse(new TextDecoder().decode(entries['modrinth.index.json'])) as {
      dependencies: Record<string, string>;
      files: Array<{ path: string; downloads: string[]; hashes: Record<string, string> }>;
    };
    expect(index.dependencies).toMatchObject({ minecraft: '1.21.1', 'fabric-loader': '0.20.1' });
    expect(index.files).toHaveLength(1);
    expect(index.files[0]).toMatchObject({ path: 'mods/a.jar', downloads: ['https://cdn.example.com/a.jar'], hashes: { sha1: 'abc123' } });
  });
});

describe('manual import', () => {
  it('copies the file into the instance and registers it with a hash', async () => {
    const { manager, content, root, gameDir } = await harness(Buffer.alloc(0));
    const source = join(root, 'cool-mod.jar');
    await writeFile(source, 'jar-bytes');
    const record = await manager.importFile({ instanceId: 'i1', kind: 'mod', filePath: source });
    expect(record.fileName).toBe('cool-mod.jar');
    expect(await readFile(join(gameDir, 'mods', 'cool-mod.jar'), 'utf8')).toBe('jar-bytes');
    expect(record.sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(content.list('i1', 'mod')).toHaveLength(1);
  });
});
