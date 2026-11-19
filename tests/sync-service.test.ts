import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, ProgressionRepository, SyncRepository, type DatabaseHandle } from '@klymon/database';
import { KlymonClient } from '@klymon/api-client';
import { LauncherLogger } from '@klymon/core';
import type { SettingsService } from '../apps/desktop/src/main/services/settings';
import type { PlatformAuthService } from '../apps/desktop/src/main/services/platform';
import { SyncService, mergeKeybindings, parseKeybindings } from '../apps/desktop/src/main/services/sync';

let handle: DatabaseHandle | null = null;

afterEach(() => {
  handle?.close();
  handle = null;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface Fixture {
  service: SyncService;
  settingsState: Record<string, unknown>;
  pushes: Array<{ namespace: string; base: number | null; content: Record<string, unknown>; force: boolean }>;
  serverDocs: Array<{ namespace: string; version: number; content: Record<string, unknown> }>;
  gameDir: string;
}

async function createService(options: { signedIn?: boolean; online?: boolean; gameDir?: string | null; syncProfileId?: string | null } = {}): Promise<Fixture> {
  const directory = mkdtempSync(join(tmpdir(), 'klymon-sync-svc-'));
  handle = await openDatabase(join(directory, 'launcher.db'));
  const settingsState: Record<string, unknown> = {
    theme: 'dark',
    language: 'es',
    curseforgeApiKey: 'local-secret',
    dataDirectory: directory,
    defaultGameDirectory: null,
    clientInstanceId: null,
    platformApiUrl: 'http://api.test',
    syncProfileId: options.syncProfileId === undefined ? 'p1' : options.syncProfileId,
  };
  const settings = {
    get: () => ({ ...settingsState }),
    update: async (patch: Record<string, unknown>) => {
      Object.assign(settingsState, patch);
      return { ...settingsState };
    },
  } as unknown as SettingsService;
  const pushes: Fixture['pushes'] = [];
  const serverDocs: Fixture['serverDocs'] = [];
  const online = options.online ?? true;
  const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
    if (!online) throw new Error('unreachable');
    const path = String(url).split('?')[0] ?? String(url);
    if (path.endsWith('/sync/profiles')) return jsonResponse(200, [{ id: 'p1', name: 'main', documentCount: 1 }]);
    if (path.endsWith('/documents') && (init?.method ?? 'GET') === 'GET') {
      return jsonResponse(
        200,
        serverDocs.map((doc) => ({ ...doc, updatedBy: 'other', updatedAt: new Date().toISOString() })),
      );
    }
    const pushMatch = /\/documents\/([^/]+)$/.exec(path);
    if (pushMatch && init?.method === 'PUT') {
      const body = JSON.parse(init?.body ?? '{}') as { baseVersion: number | null; content: Record<string, unknown>; force: boolean };
      const namespace = pushMatch[1] ?? '';
      pushes.push({ namespace, base: body.baseVersion, content: body.content, force: body.force });
      const existing = serverDocs.find((doc) => doc.namespace === namespace);
      if (existing && !body.force && body.baseVersion !== existing.version) {
        return jsonResponse(409, {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Mismatch.',
          details: { server: { ...existing, updatedBy: 'other', updatedAt: new Date().toISOString() } },
        });
      }
      const version = (existing?.version ?? 0) + 1;
      const next = { namespace, version, content: body.content };
      if (existing) existing.version = version;
      else serverDocs.push(next);
      const row = serverDocs.find((doc) => doc.namespace === namespace);
      if (row) row.content = body.content;
      return jsonResponse(200, { ...next, updatedBy: 'me', updatedAt: new Date().toISOString() });
    }
    return jsonResponse(404, { statusCode: 404, code: 'NOT_FOUND', message: 'Nope.' });
  }) as unknown as typeof fetch;
  const client = new KlymonClient({
    baseUrl: 'http://api.test',
    storage: { loadRefresh: () => 'r1', saveRefresh: () => undefined },
    fetchImpl,
  });
  const platform = {
    status: () => ({ signedIn: options.signedIn ?? true }),
    getClient: () => client,
  } as unknown as PlatformAuthService;
  const gameDir = options.gameDir === undefined ? mkdtempSync(join(tmpdir(), 'klymon-sync-game-')) : options.gameDir;
  const service = new SyncService({
    platform,
    settings,
    progression: new ProgressionRepository(handle.db, () => 'seal'),
    sync: new SyncRepository(handle.db),
    logger: new LauncherLogger({ level: 'silent' }),
    clientGameDir: () => gameDir,
  });
  return { service, settingsState, pushes, serverDocs, gameDir: gameDir ?? '' };
}

describe('SyncService', () => {
  it('requires sign-in and a selected profile', async () => {
    const signedOut = await createService({ signedIn: false });
    await expect(signedOut.service.profiles()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(signedOut.service.push('loadout')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    const noProfile = await createService({ syncProfileId: null });
    await expect(noProfile.service.push('loadout')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(noProfile.service.status()).toEqual([]);
    await expect(noProfile.service.profiles()).resolves.toHaveLength(1);
    await noProfile.service.selectProfile('p2');
    expect(noProfile.settingsState.syncProfileId).toBe('p2');
  });

  it('rejects unknown and launcher-unsupported namespaces', async () => {
    const fixture = await createService();
    await expect(fixture.service.push('nope')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(fixture.service.push('hud-layout')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('pushes launcher settings without secrets or machine-local keys', async () => {
    const fixture = await createService();
    const result = await fixture.service.push('launcher-settings');
    expect(result).toMatchObject({ status: 'pushed', version: 1 });
    expect(fixture.pushes).toHaveLength(1);
    expect(fixture.pushes[0]?.base).toBeNull();
    expect(fixture.pushes[0]?.content).toMatchObject({ theme: 'dark', language: 'es' });
    expect(fixture.pushes[0]?.content).not.toHaveProperty('curseforgeApiKey');
    expect(fixture.pushes[0]?.content).not.toHaveProperty('dataDirectory');
    expect(fixture.pushes[0]?.content).not.toHaveProperty('platformApiUrl');
    expect(fixture.pushes[0]?.content).not.toHaveProperty('syncProfileId');
    const again = await fixture.service.push('launcher-settings');
    expect(again).toMatchObject({ status: 'pushed', version: 2 });
    expect(fixture.pushes[1]?.base).toBe(1);
  });

  it('pushes the cosmetic loadout from the database', async () => {
    const fixture = await createService();
    expect(handle).not.toBeNull();
    const progression = new ProgressionRepository(handle?.db as never, () => 'seal');
    progression.setLoadout('cape', 'cape-ember');
    const result = await fixture.service.push('loadout');
    expect(result).toMatchObject({ status: 'pushed', version: 1 });
    expect(fixture.pushes[0]?.content).toEqual({ cape: 'cape-ember' });
  });

  it('pushes client-config files and skips honestly when absent', async () => {
    const fixture = await createService();
    expect(await fixture.service.push('client-config')).toMatchObject({ status: 'skipped' });
    mkdirSync(join(fixture.gameDir, 'config'), { recursive: true });
    writeFileSync(join(fixture.gameDir, 'config', 'klymon-client.json'), JSON.stringify({ hud: true }));
    writeFileSync(join(fixture.gameDir, 'config', 'klymon-client.json'), 'not-json{{');
    expect(await fixture.service.push('client-config')).toMatchObject({ status: 'skipped' });
    writeFileSync(join(fixture.gameDir, 'config', 'klymon-client.json'), JSON.stringify({ hud: true }));
    const result = await fixture.service.push('client-config');
    expect(result).toMatchObject({ status: 'pushed', version: 1 });
    expect(fixture.pushes[0]?.content).toEqual({ hud: true });

    const noInstance = await createService({ gameDir: null });
    expect(await noInstance.service.push('client-config')).toMatchObject({ status: 'skipped' });
  });

  it('pushes keybindings parsed from options.txt', async () => {
    const fixture = await createService();
    expect(await fixture.service.push('keybindings')).toMatchObject({ status: 'skipped' });
    writeFileSync(join(fixture.gameDir, 'options.txt'), 'version:1\nkey_key.attack:key.mouse.left\nkey_key.use:key.mouse.right\nrenderDistance:12\n');
    const result = await fixture.service.push('keybindings');
    expect(result).toMatchObject({ status: 'pushed' });
    expect(fixture.pushes[0]?.content).toEqual({ 'key_key.attack': 'key.mouse.left', 'key_key.use': 'key.mouse.right' });
  });

  it('queues offline and surfaces conflicts', async () => {
    const fixture = await createService({ online: false });
    expect(await fixture.service.push('loadout')).toMatchObject({ status: 'queued' });
    expect(fixture.service.status()).toMatchObject([{ namespace: 'loadout', dirty: true, queued: true }]);

    const online = await createService();
    online.serverDocs.push({ namespace: 'loadout', version: 2, content: { cape: 'theirs' } });
    // Local base 0 (never pulled) vs server v2 → conflict.
    const conflicted = await online.service.push('loadout');
    expect(conflicted).toMatchObject({ status: 'conflict', version: 2 });
  });

  it('pulls and applies fast-forwards to settings and files', async () => {
    const fixture = await createService();
    mkdirSync(join(fixture.gameDir, 'config'), { recursive: true });
    fixture.serverDocs.push(
      { namespace: 'launcher-settings', version: 1, content: { theme: 'light', curseforgeApiKey: 'evil', platformApiUrl: 'http://evil' } },
      { namespace: 'client-config', version: 1, content: { hud: false } },
      { namespace: 'keybindings', version: 1, content: { 'key_key.attack': 'key.keyboard.f' } },
    );
    writeFileSync(join(fixture.gameDir, 'options.txt'), 'version:1\nkey_key.attack:key.mouse.left\n');
    const results = await fixture.service.pull();
    expect(results).toMatchObject([
      { namespace: 'launcher-settings', status: 'fast-forwarded', applied: true },
      { namespace: 'client-config', status: 'fast-forwarded', applied: true },
      { namespace: 'keybindings', status: 'fast-forwarded', applied: true },
    ]);
    // Applied, but secrets and machine-local keys are never overwritten.
    expect(fixture.settingsState.theme).toBe('light');
    expect(fixture.settingsState.curseforgeApiKey).toBe('local-secret');
    expect(fixture.settingsState.platformApiUrl).toBe('http://api.test');
    expect(JSON.parse(readFileSync(join(fixture.gameDir, 'config', 'klymon-client.json'), 'utf8'))).toEqual({ hud: false });
    expect(readFileSync(join(fixture.gameDir, 'options.txt'), 'utf8')).toBe('version:1\nkey_key.attack:key.keyboard.f\n');
  });

  it('resolves conflicts and reverts to last-known-good', async () => {
    const fixture = await createService();
    fixture.serverDocs.push({ namespace: 'loadout', version: 1, content: { cape: 'a' } });
    await fixture.service.pull();
    // Diverge: server moves on, local edits offline.
    fixture.serverDocs[0] = { namespace: 'loadout', version: 2, content: { cape: 'theirs' } };
    const progression = new ProgressionRepository(handle?.db as never, () => 'seal');
    progression.setLoadout('cape', 'mine');
    const conflicted = await fixture.service.push('loadout');
    expect(conflicted.status).toBe('conflict');

    const kept = await fixture.service.resolve('loadout', 'mine');
    expect(kept).toMatchObject({ status: 'pushed', version: 3 });

    // Fresh conflict, resolved the other way: target adopts the server copy.
    fixture.serverDocs[0] = { namespace: 'loadout', version: 4, content: { cape: 'v4' } };
    progression.setLoadout('cape', 'mine-2');
    expect(await fixture.service.push('loadout')).toMatchObject({ status: 'conflict', version: 4 });
    const adopted = await fixture.service.resolve('loadout', 'theirs');
    expect(adopted).toMatchObject({ status: 'adopted', version: 4 });
    expect(progression.loadout()).toContainEqual(expect.objectContaining({ slot: 'cape', cosmeticId: 'v4' }));

    // Revert restores the last-known-good copy into the target.
    progression.setLoadout('cape', 'draft');
    await fixture.service.push('loadout');
    progression.setLoadout('cape', 'draft-2');
    const reverted = await fixture.service.revert('loadout');
    expect(reverted).toEqual({ namespace: 'loadout', reverted: true });
    expect(progression.loadout()).toContainEqual(expect.objectContaining({ slot: 'cape', cosmeticId: 'draft' }));

    // Nothing to revert on a namespace that never synced.
    expect(await fixture.service.revert('keybindings')).toEqual({ namespace: 'keybindings', reverted: false });
  });
});

describe('keybindings codec', () => {
  it('parses key_ lines and ignores the rest', () => {
    expect(parseKeybindings('version:1\nkey_a:b\nnotkey:c\nkey_broken\nkey_c:d:e\n')).toEqual({ key_a: 'b', 'key_c': 'd:e' });
  });

  it('merges preserving order, EOLs and unknown lines', () => {
    expect(mergeKeybindings('version:1\nkey_a:old\n', { key_a: 'new', key_b: 'added' })).toBe('version:1\nkey_a:new\nkey_b:added\n');
    expect(mergeKeybindings('version:1\nkey_a:old', { key_a: 'new' })).toBe('version:1\nkey_a:new');
    expect(mergeKeybindings('key_a:old\r\nversion:1\r\n', { key_a: 'new' })).toBe('key_a:new\r\nversion:1\r\n');
    expect(mergeKeybindings('', { key_a: 'x', other: 'y' })).toBe('key_a:x');
  });
});
