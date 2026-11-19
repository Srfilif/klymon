import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiError, type KlymonClient, type SyncConflictDetails } from '@klymon/api-client';
import { LauncherError, type LauncherLogger } from '@klymon/core';
import type { ProgressionRepository, SyncRepository } from '@klymon/database';
import {
  SqliteSyncStore,
  SyncConflictError,
  SyncEngine,
  SyncNetworkError,
  type ServerDocument,
  type SyncTransport,
} from '@klymon/sync-engine';
import type {
  Settings,
  SyncDocStatusModel,
  SyncProfileModel,
  SyncPullResultModel,
  SyncPullState,
  SyncPushResultModel,
} from '@klymon/shared-types';
import { mapPlatformError, type PlatformAuthService } from './platform';
import type { SettingsService } from './settings';

export interface SyncServiceDeps {
  platform: PlatformAuthService;
  settings: SettingsService;
  progression: ProgressionRepository;
  sync: SyncRepository;
  logger: LauncherLogger;
  /** Game dir of the Klymon Client instance (file-backed namespaces). */
  clientGameDir: () => string | null;
}

const UNSYNCABLE_SETTINGS = new Set(['dataDirectory', 'defaultGameDirectory', 'clientInstanceId', 'platformApiUrl', 'syncProfileId', 'curseforgeApiKey']);

export const SYNCABLE_NAMESPACES = ['launcher-settings', 'loadout', 'client-config', 'keybindings'] as const;

function mapSyncError(error: unknown): Error {
  if (error instanceof ApiError && error.statusCode === 0) return new SyncNetworkError();
  if (error instanceof ApiError && error.statusCode === 401) {
    return new LauncherError('AUTH_REQUIRED', 'Platform session expired. Sign in again.');
  }
  if (error instanceof ApiError && error.statusCode === 409) {
    const details = error.details as SyncConflictDetails | undefined;
    const server = details && typeof details === 'object' && 'server' in details ? details.server : null;
    return new SyncConflictError(server);
  }
  return mapPlatformError(error);
}

class ApiSyncTransport implements SyncTransport {
  constructor(private readonly resolveClient: () => KlymonClient) {}

  async listDocuments(profileId: string): Promise<ServerDocument[]> {
    try {
      return await this.resolveClient().listSyncDocuments(profileId);
    } catch (error) {
      throw mapSyncError(error);
    }
  }

  async push(
    profileId: string,
    namespace: string,
    baseVersion: number | null,
    content: Record<string, unknown>,
    force: boolean,
  ): Promise<ServerDocument> {
    try {
      return await this.resolveClient().pushSyncDocument(profileId, namespace, baseVersion, content, force);
    } catch (error) {
      throw mapSyncError(error);
    }
  }
}

export function parseKeybindings(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line.startsWith('key_')) continue;
    const idx = line.indexOf(':');
    if (idx <= 4) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1).replace(/\r$/, '');
  }
  return out;
}

export function mergeKeybindings(text: string, patch: Record<string, unknown>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const trailing = text.endsWith('\n');
  const seen = new Set<string>();
  const lines = text === '' ? [] : text.split(/\r?\n/);
  if (trailing && lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const out = lines.map((line) => {
    if (!line.startsWith('key_')) return line;
    const idx = line.indexOf(':');
    if (idx <= 4) return line;
    const name = line.slice(0, idx);
    const value = patch[name];
    if (typeof value !== 'string') return line;
    seen.add(name);
    return `${name}:${value}`;
  });
  for (const [name, value] of Object.entries(patch)) {
    if (!name.startsWith('key_') || typeof value !== 'string' || seen.has(name)) continue;
    out.push(`${name}:${value}`);
  }
  return out.join(eol) + (trailing ? eol : '');
}

type Source = { ok: true; content: Record<string, unknown> } | { ok: false; reason: string };

export class SyncService {
  private readonly engine: SyncEngine;
  private readonly store: SqliteSyncStore;

  constructor(private readonly deps: SyncServiceDeps) {
    this.store = new SqliteSyncStore(deps.sync);
    this.engine = new SyncEngine(new ApiSyncTransport(() => deps.platform.getClient()), this.store);
  }

  private assertNamespace(namespace: string): void {
    if (!(SYNCABLE_NAMESPACES as readonly string[]).includes(namespace)) {
      throw new LauncherError('INVALID_INPUT', `Namespace "${namespace}" is not syncable from the launcher.`);
    }
  }

  private requireProfile(): string {
    const id = this.deps.settings.get().syncProfileId;
    if (!id) throw new LauncherError('INVALID_INPUT', 'Select a cloud profile first.');
    return id;
  }

  private requireSignedIn(): void {
    if (!this.deps.platform.status().signedIn) throw new LauncherError('AUTH_REQUIRED', 'Sign in to a Klymon account first.');
  }

  async profiles(): Promise<SyncProfileModel[]> {
    this.requireSignedIn();
    try {
      return await this.deps.platform.getClient().listSyncProfiles();
    } catch (error) {
      throw mapSyncError(error);
    }
  }

  async selectProfile(profileId: string | null): Promise<Settings> {
    return this.deps.settings.update({ syncProfileId: profileId });
  }

  /** Local-only: works offline and signed out. */
  status(): SyncDocStatusModel[] {
    const profileId = this.deps.settings.get().syncProfileId;
    if (!profileId) return [];
    return this.engine.status(profileId).map((doc) => ({
      namespace: doc.namespace,
      baseVersion: doc.baseVersion,
      dirty: doc.dirty,
      queued: doc.queued,
      conflict: doc.conflict ? { version: doc.conflict.version, updatedBy: doc.conflict.updatedBy } : null,
      lkgVersion: doc.lkgVersion,
    }));
  }

  async push(namespace: string): Promise<SyncPushResultModel> {
    this.assertNamespace(namespace);
    const profileId = this.requireProfile();
    this.requireSignedIn();
    const source = this.readSource(namespace);
    if (!source.ok) return { namespace, status: 'skipped', version: null, reason: source.reason };
    const outcome = await this.engine.push(profileId, namespace, source.content);
    if (outcome.status === 'pushed') return { namespace, status: 'pushed', version: outcome.doc.version, reason: null };
    if (outcome.status === 'queued') return { namespace, status: 'queued', version: null, reason: 'Offline. Queued for the next sync.' };
    return {
      namespace,
      status: 'conflict',
      version: outcome.server?.version ?? null,
      reason: 'The server copy changed. Resolve the conflict to continue.',
    };
  }

  async pull(): Promise<SyncPullResultModel[]> {
    const profileId = this.requireProfile();
    this.requireSignedIn();
    const outcomes = await this.engine.pull(profileId);
    const results: SyncPullResultModel[] = [];
    for (const outcome of outcomes) {
      if (outcome.status !== 'fast-forwarded' || !outcome.server) {
        results.push({ namespace: outcome.namespace, status: outcome.status as SyncPullState, applied: false, reason: null });
        continue;
      }
      try {
        await this.writeTarget(outcome.namespace, outcome.server.content);
        results.push({ namespace: outcome.namespace, status: outcome.status, applied: true, reason: null });
      } catch (error) {
        // Cache already advanced; the bytes stay cached until the target exists.
        const reason = error instanceof Error ? error.message : String(error);
        this.deps.logger.warn('sync', `Pulled ${outcome.namespace} v${outcome.server.version} but could not apply it: ${reason}`);
        results.push({ namespace: outcome.namespace, status: outcome.status, applied: false, reason });
      }
    }
    return results;
  }

  async resolve(namespace: string, keep: 'mine' | 'theirs'): Promise<SyncPushResultModel> {
    this.assertNamespace(namespace);
    const profileId = this.requireProfile();
    if (keep === 'mine') {
      this.requireSignedIn();
      const outcome = await this.engine.resolveKeepMine(profileId, namespace);
      if (outcome.status === 'pushed') return { namespace, status: 'pushed', version: outcome.doc.version, reason: null };
      if (outcome.status === 'queued') return { namespace, status: 'queued', version: null, reason: 'Offline. Queued for the next sync.' };
      return { namespace, status: 'conflict', version: outcome.server?.version ?? null, reason: 'Still conflicting.' };
    }
    const server = this.engine.resolveKeepTheirs(profileId, namespace);
    try {
      await this.writeTarget(namespace, server.content);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn('sync', `Adopted server ${namespace} v${server.version} but could not apply it: ${reason}`);
      return { namespace, status: 'adopted', version: server.version, reason };
    }
    return { namespace, status: 'adopted', version: server.version, reason: null };
  }

  async revert(namespace: string): Promise<{ namespace: string; reverted: boolean }> {
    this.assertNamespace(namespace);
    const profileId = this.requireProfile();
    const reverted = this.engine.revertToLkg(profileId, namespace);
    if (reverted) {
      const cached = this.store.getDoc(profileId, namespace);
      if (cached) {
        try {
          await this.writeTarget(namespace, cached.content);
        } catch (error) {
          this.deps.logger.warn('sync', `Reverted ${namespace} in cache but could not apply it: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return { namespace, reverted };
  }

  private readSource(namespace: string): Source {
    if (namespace === 'launcher-settings') {
      const settings = this.deps.settings.get();
      const content: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(settings)) {
        if (UNSYNCABLE_SETTINGS.has(key)) continue;
        content[key] = value;
      }
      return { ok: true, content };
    }
    if (namespace === 'loadout') {
      const content: Record<string, unknown> = {};
      for (const row of this.deps.progression.loadout()) content[row.slot] = row.cosmeticId;
      return { ok: true, content };
    }
    const gameDir = this.deps.clientGameDir();
    if (!gameDir) return { ok: false, reason: 'No Klymon Client instance. Install it first.' };
    if (namespace === 'client-config') {
      const file = join(gameDir, 'config', 'klymon-client.json');
      if (!existsSync(file)) return { ok: false, reason: 'No local klymon-client.json yet. Launch the client once.' };
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return { ok: false, reason: 'Local klymon-client.json is not an object.' };
        }
        return { ok: true, content: parsed as Record<string, unknown> };
      } catch {
        return { ok: false, reason: 'Local klymon-client.json is corrupt.' };
      }
    }
    if (namespace === 'keybindings') {
      const file = join(gameDir, 'options.txt');
      if (!existsSync(file)) return { ok: false, reason: 'No local options.txt yet. Launch the game once.' };
      return { ok: true, content: parseKeybindings(readFileSync(file, 'utf8')) };
    }
    return { ok: false, reason: `Namespace "${namespace}" has no launcher source.` };
  }

  private async writeTarget(namespace: string, content: Record<string, unknown>): Promise<void> {
    if (namespace === 'launcher-settings') {
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(content)) {
        if (UNSYNCABLE_SETTINGS.has(key)) continue;
        patch[key] = value;
      }
      await this.deps.settings.update(patch as Partial<Settings>);
      return;
    }
    if (namespace === 'loadout') {
      for (const [slot, id] of Object.entries(content)) {
        if (typeof id !== 'string' && id !== null) {
          this.deps.logger.warn('sync', `Ignoring malformed loadout slot "${slot}".`);
          continue;
        }
        this.deps.progression.setLoadout(slot, id);
      }
      return;
    }
    if (namespace === 'client-config' || namespace === 'keybindings') {
      const gameDir = this.deps.clientGameDir();
      if (!gameDir) throw new LauncherError('INVALID_INPUT', 'No Klymon Client instance. Install it first.');
      if (namespace === 'client-config') {
        const dir = join(gameDir, 'config');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'klymon-client.json'), `${JSON.stringify(content, null, 2)}\n`, 'utf8');
        return;
      }
      const file = join(gameDir, 'options.txt');
      const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
      await writeFile(file, mergeKeybindings(current, content), 'utf8');
      return;
    }
    throw new LauncherError('UNSUPPORTED', `Namespace "${namespace}" has no launcher target yet.`);
  }
}
