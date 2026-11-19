import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, ActivityRepository, InstanceRepository, type DatabaseHandle } from '@klymon/database';
import { LauncherLogger, type LauncherPaths } from '@klymon/core';
import type { JavaManager } from '@klymon/java-manager';
import type { ModloaderManager } from '@klymon/modloader-manager';
import type { VersionInstaller, VersionManifestService } from '@klymon/version-manager';
import type { SettingsService } from '../apps/desktop/src/main/services/settings';
import { GameService } from '../apps/desktop/src/main/services/game';

let handle: DatabaseHandle | null = null;

afterEach(() => {
  handle?.close();
  handle = null;
});

async function createService(options: { managed: boolean; autoJava: boolean }): Promise<{ service: GameService; activity: ActivityRepository }> {
  const directory = mkdtempSync(join(tmpdir(), 'klymon-game-java-'));
  handle = await openDatabase(join(directory, 'launcher.db'));
  const db = handle.db;
  const logger = new LauncherLogger({ level: 'silent' });
  const activity = new ActivityRepository(db);
  const runtime = { path: '/managed/java-21', major: 21, vendor: 'test', version: '21', arch: 'x64', source: 'mojang' };
  const java = {
    managedRuntime: async () => (options.managed ? runtime : null),
    ensureRuntime: async () => runtime,
  } as unknown as JavaManager;
  const service = new GameService({
    paths: { root: directory } as LauncherPaths,
    logger,
    manifests: { resolve: async () => ({ javaVersion: { component: 'java-runtime-delta', majorVersion: 21 } }) } as unknown as VersionManifestService,
    installer: {
      install: async () => ({ versionId: '1.21.1', mcVersion: '1.21.1', totalBytes: 1, files: 1, durationMs: 1, versionJsonPath: 'x.json' }),
    } as unknown as VersionInstaller,
    java,
    modloaders: {
      install: async () => ({ versionId: 'fabric-1.21.1', loaderType: 'fabric', loaderVersion: '0.20.1', mcVersion: '1.21.1' }),
    } as unknown as ModloaderManager,
    instances: {} as never,
    instanceRepo: new InstanceRepository(db),
    activity,
    accounts: {} as never,
    settings: { get: () => ({ autoUpdateJava: options.autoJava }) } as unknown as SettingsService,
    crash: {} as never,
    progression: null,
    platform: null,
    launcherVersion: '0.1.0-test',
    emit: () => undefined,
  });
  return { service, activity };
}

describe('java auto-provision evidence', () => {
  it('records an activity entry when a runtime is provisioned', async () => {
    const { service, activity } = await createService({ managed: false, autoJava: true });
    const result = await service.installVersion({ mcVersion: '1.21.1', loaderType: 'fabric' });
    expect(result.versionId).toBe('fabric-1.21.1');
    const entries = activity.list(10);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('java');
    expect(entries[0]?.message).toContain('21');
    expect(entries[0]?.message).toContain('java-runtime-delta');
    expect(entries[0]?.detail).toBe('/managed/java-21');
  });

  it('stays silent when a managed runtime already exists', async () => {
    const { service, activity } = await createService({ managed: true, autoJava: true });
    await service.installVersion({ mcVersion: '1.21.1', loaderType: 'fabric' });
    expect(activity.list(10)).toHaveLength(0);
  });
});
