import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openDatabase,
  AccountRepository,
  InstanceRepository,
  ContentRepository,
  SettingsRepository,
  BackupRepository,
  type DatabaseHandle,
} from '@klymon/database';

let handle: DatabaseHandle | null = null;

afterEach(() => {
  handle?.close();
  handle = null;
});

async function createDatabase(): Promise<DatabaseHandle> {
  const directory = mkdtempSync(join(tmpdir(), 'klymon-db-'));
  return openDatabase(join(directory, 'launcher.db'));
}

describe('SQLite persistence', () => {
  it('applies migrations and is idempotent across reopens', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'klymon-db-'));
    const file = join(directory, 'launcher.db');
    const first = await openDatabase(file);
    first.close();
    const second = await openDatabase(file);
    const tables = second.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toContain('instances');
    expect(tables).toContain('accounts');
    expect(tables).toContain('installed_content');
    expect(tables).toContain('_migrations');
    second.close();
  });

  it('round-trips accounts with a single active session', async () => {
    handle = await createDatabase();
    const accounts = new AccountRepository(handle.db);
    const now = new Date().toISOString();
    accounts.insert({
      id: randomUUID(),
      type: 'offline',
      name: 'Alpha',
      uuid: '11111111-2222-3333-8444-555555555555',
      skinUrl: null,
      capeUrl: null,
      localSkinPath: null,
      secretBlob: null,
      createdAt: now,
      lastUsedAt: null,
      active: true,
      sessionValid: true,
    });
    const second = accounts.insert({
      id: randomUUID(),
      type: 'offline',
      name: 'Bravo',
      uuid: '11111111-2222-3333-8444-666666666666',
      skinUrl: null,
      capeUrl: null,
      localSkinPath: null,
      secretBlob: null,
      createdAt: now,
      lastUsedAt: null,
      active: false,
      sessionValid: true,
    });
    accounts.setActive(second.id);
    expect(accounts.findActive()?.name).toBe('Bravo');
    expect(accounts.list().filter((account) => account.active)).toHaveLength(1);
  });

  it('stores instances and isolates content per instance', async () => {
    handle = await createDatabase();
    const instances = new InstanceRepository(handle.db);
    const content = new ContentRepository(handle.db);
    const now = new Date().toISOString();
    const first = {
      id: randomUUID(),
      name: 'Vanilla',
      description: '',
      mcVersion: '1.21.1',
      loaderType: 'vanilla',
      loaderVersion: null,
      launchVersionId: '1.21.1',
      directory: 'vanilla-abc123',
      javaPath: null,
      minMemoryMb: 1024,
      maxMemoryMb: 4096,
      jvmArgs: '[]',
      gameArgs: '[]',
      accountId: null,
      iconPath: null,
      createdAt: now,
      updatedAt: now,
      lastPlayedAt: null,
      playTimeSeconds: 0,
      installed: false,
    };
    const second = { ...first, id: randomUUID(), name: 'Fabric', directory: 'fabric-def456', loaderType: 'fabric' };
    instances.insert(first);
    instances.insert(second);

    content.insert({
      id: randomUUID(),
      instanceId: first.id,
      kind: 'mod',
      fileName: 'sodium.jar',
      path: 'C:/instances/vanilla/mods/sodium.jar',
      projectId: 'AANobbMI',
      versionId: 'abc',
      title: 'Sodium',
      versionNumber: '0.8.13',
      iconUrl: null,
      enabled: true,
      sizeBytes: 1024,
      installedAt: now,
      sha1: 'deadbeef',
      sourceUrl: 'https://cdn.modrinth.com/data/abc/sodium.jar',
      pinned: false,
    });

    expect(instances.list()).toHaveLength(2);
    expect(content.list(first.id, 'mod')).toHaveLength(1);
    expect(content.list(second.id, 'mod')).toHaveLength(0);

    instances.update(first.id, { installed: true, maxMemoryMb: 8192 });
    expect(instances.findById(first.id)).toMatchObject({ installed: true, maxMemoryMb: 8192 });

    content.removeByInstance(first.id);
    instances.remove(first.id);
    expect(content.list(first.id)).toHaveLength(0);
    expect(instances.findById(first.id)).toBeNull();
  });

  it('persists settings and backups', async () => {
    handle = await createDatabase();
    const settings = new SettingsRepository(handle.db);
    settings.write({ language: JSON.stringify('en'), theme: JSON.stringify('dark') });
    expect(settings.readAll()).toMatchObject({ language: '"en"', theme: '"dark"' });
    settings.write({ language: JSON.stringify('es') });
    expect(settings.readAll().language).toBe('"es"');

    const backups = new BackupRepository(handle.db);
    const record = {
      id: randomUUID(),
      instanceId: 'instance-1',
      label: 'Before update',
      path: 'C:/backups/a.zip',
      sizeBytes: 100,
      createdAt: new Date().toISOString(),
    };
    backups.add(record);
    expect(backups.list('instance-1')[0]?.label).toBe('Before update');
    expect(backups.findById(record.id)?.sizeBytes).toBe(100);
  });
});
