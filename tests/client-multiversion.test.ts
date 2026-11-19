import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LauncherLogger } from '@klymon/core';
import type { InstanceManager } from '@klymon/instance-manager';
import type { ContentManager } from '@klymon/mod-manager';
import type { Instance } from '@klymon/shared-types';
import { ClientService } from '../apps/desktop/src/main/services/client';
import type { GameService } from '../apps/desktop/src/main/services/game';
import type { ProgressionService } from '../apps/desktop/src/main/services/progression';
import type { SettingsService } from '../apps/desktop/src/main/services/settings';

interface Fixture {
  service: ClientService;
  instances: Map<string, Instance>;
  content: Array<{ id: string; projectId: string }>;
  removed: string[];
  installedSlugs: string[];
  gameInstalls: string[];
  settingsPatch: Record<string, unknown>;
  clientModDir: string;
  gameDir: string;
}

function createService(options: { existing?: Partial<Instance>; clientModDir?: string | null } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'klymon-client-mv-'));
  const gameDir = join(root, 'game');
  const instances = new Map<string, Instance>();
  if (options.existing) {
    instances.set('inst-1', {
      id: 'inst-1',
      name: 'Klymon Client',
      description: '',
      mcVersion: '1.21.1',
      loaderType: 'fabric',
      loaderVersion: null,
      launchVersionId: '1.21.1',
      directory: 'dir',
      gameDir,
      javaPath: null,
      minMemoryMb: 1024,
      maxMemoryMb: 4096,
      jvmArgs: [],
      gameArgs: [],
      accountId: null,
      iconPath: null,
      createdAt: '',
      updatedAt: '',
      lastPlayedAt: null,
      playTimeSeconds: 0,
      installed: true,
      ...options.existing,
    } as Instance);
  }
  const content: Fixture['content'] = [];
  const removed: string[] = [];
  const installedSlugs: string[] = [];
  const gameInstalls: string[] = [];
  const settingsPatch: Record<string, unknown> = {};
  const settings = {
    get: () => ({ clientInstanceId: instances.has('inst-1') ? 'inst-1' : null }),
    update: async (patch: Record<string, unknown>) => {
      Object.assign(settingsPatch, patch);
      return patch;
    },
  } as unknown as SettingsService;
  const instancesApi = {
    get: (id: string) => {
      const found = instances.get(id);
      if (!found) throw new Error('missing');
      return found;
    },
    list: () => [...instances.values()],
    create: async (input: Record<string, unknown>) => {
      const record = { id: 'inst-1', gameDir, installed: false, ...input } as unknown as Instance;
      instances.set('inst-1', record);
      return record;
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      const current = instances.get(id);
      if (!current) throw new Error('missing');
      // Mirror the real manager: version/loader changes reset the install flag.
      const reset = patch.mcVersion !== undefined && patch.mcVersion !== current.mcVersion;
      const next = { ...current, ...patch, installed: reset ? false : current.installed } as Instance;
      instances.set(id, next);
      return next;
    },
  } as unknown as InstanceManager;
  const contentApi = {
    installed: () => [...content],
    install: async (input: { projectId: string }) => {
      installedSlugs.push(input.projectId);
      content.push({ id: `entry-${content.length}`, projectId: input.projectId });
    },
    remove: async (id: string) => {
      removed.push(id);
      const index = content.findIndex((entry) => entry.id === id);
      if (index >= 0) content.splice(index, 1);
    },
  } as unknown as ContentManager;
  const game = {
    installInstance: async (id: string) => {
      gameInstalls.push(id);
      const current = instances.get(id);
      if (current) instances.set(id, { ...current, installed: true });
    },
    launch: async () => ({ pid: 4242 }),
  } as unknown as GameService;
  const service = new ClientService({
    settings,
    instances: instancesApi,
    content: contentApi,
    game,
    modrinth: { project: async (slug: string) => ({ id: `project-${slug}` }) as never },
    logger: new LauncherLogger({ level: 'silent' }),
    clientModDir: options.clientModDir === undefined ? mkdtempSync(join(tmpdir(), 'klymon-mods-')) : options.clientModDir,
    progression: { exportBridge: async () => null } as unknown as ProgressionService,
    emit: () => undefined,
  });
  return { service, instances, content, removed, installedSlugs, gameInstalls, settingsPatch, clientModDir: '', gameDir };
}

describe('ClientService multiversion', () => {
  it('installs the default 1.21.1 profile on a fresh setup', async () => {
    const fixture = createService();
    const status = await fixture.service.install();
    expect(status.mcVersion).toBe('1.21.1');
    expect(status.phase).toBe('ready');
    expect(status.modsExpected).toBe(16);
    expect(fixture.installedSlugs).toHaveLength(16);
    expect(fixture.installedSlugs[0]).toBe('project-sodium');
    expect(fixture.gameInstalls).toEqual(['inst-1']);
    expect(fixture.settingsPatch).toMatchObject({ clientInstanceId: 'inst-1' });
    const instance = fixture.instances.get('inst-1');
    expect(instance).toMatchObject({ mcVersion: '1.21.1', loaderType: 'fabric', minMemoryMb: 1024, maxMemoryMb: 4096 });
  });

  it('installs 1.21 explicitly and rejects unknown versions', async () => {
    const fixture = createService();
    const status = await fixture.service.install('1.21');
    expect(status.mcVersion).toBe('1.21');
    expect(fixture.instances.get('inst-1')).toMatchObject({ mcVersion: '1.21' });
    await expect(fixture.service.install('1.20.1')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('wipes mods and reinstalls the game when switching versions', async () => {
    const fixture = createService({ existing: { mcVersion: '1.21.1' } });
    fixture.content.push({ id: 'old-1', projectId: 'project-sodium' }, { id: 'old-2', projectId: 'project-lithium' });
    const status = await fixture.service.install('1.21');
    expect(status.mcVersion).toBe('1.21');
    expect(fixture.removed).toEqual(['old-1', 'old-2']);
    expect(fixture.gameInstalls).toEqual(['inst-1']);
    expect(fixture.installedSlugs).toHaveLength(16);
  });

  it('prunes retired slugs on same-version repairs without wiping', async () => {
    const fixture = createService({ existing: { mcVersion: '1.21.1' } });
    fixture.content.push({ id: 'keep-1', projectId: 'project-sodium' }, { id: 'ret-1', projectId: 'project-cull-less-leaves' });
    await fixture.service.install('1.21.1');
    expect(fixture.removed).toEqual(['ret-1']);
    expect(fixture.gameInstalls).toHaveLength(0);
  });

  it('copies the version-matched menu mod', async () => {
    const modDir = mkdtempSync(join(tmpdir(), 'klymon-menus-'));
    writeFileSync(join(modDir, 'klymon-menu-1.21.jar'), 'fake-121-jar');
    const fixture = createService({ clientModDir: modDir });
    const status = await fixture.service.install('1.21');
    expect(status.clientMenu).toBe(true);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(fixture.gameDir, 'mods', 'klymon-menu.jar'), 'utf8')).toBe('fake-121-jar');
  });

  it('reports unknown instance versions as not installed', async () => {
    const fixture = createService({ existing: { mcVersion: '1.20.4' } });
    const status = fixture.service.status();
    expect(status.mcVersion).toBe('1.20.4');
    expect(status.modsExpected).toBe(0);
    expect(status.installed).toBe(false);
  });

  it('gates launch on a complete installation', async () => {
    const missing = createService();
    await expect(missing.service.launch()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const partial = createService({ existing: { mcVersion: '1.21.1', installed: false } });
    await expect(partial.service.launch()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('launches a ready instance', async () => {
    const fixture = createService({ existing: { mcVersion: '1.21.1' } });
    for (let i = 0; i < 16; i++) fixture.content.push({ id: `m-${i}`, projectId: `project-mod-${i}` });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(fixture.gameDir, 'mods'), { recursive: true });
    writeFileSync(join(fixture.gameDir, 'mods', 'klymon-menu.jar'), 'menu');
    await expect(fixture.service.launch()).resolves.toEqual({ pid: 4242 });
    expect(fixture.service.status().installed).toBe(true);
  });

  it('runs one install at a time', async () => {
    const fixture = createService();
    const first = fixture.service.install();
    const second = fixture.service.install('1.21');
    const [a, b] = await Promise.all([first, second]);
    expect(a.mcVersion).toBe(b.mcVersion);
    expect(fixture.gameInstalls).toHaveLength(1);
  });
});
