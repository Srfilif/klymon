import { randomUUID } from 'node:crypto';
import { LauncherError, notFound, offlineUuid, isValidMinecraftUsername, type LauncherLogger } from '@klymon/core';
import { createOfflineProfile, type MicrosoftAuthService } from '@klymon/authentication';
import type { AccountRepository, AccountRecord, ActivityRepository } from '@klymon/database';
import type { Account } from '@klymon/shared-types';
import type { LaunchAccount } from '@klymon/version-manager';

export interface AccountServiceDeps {
  repo: AccountRepository;
  auth: MicrosoftAuthService;
  activity: ActivityRepository;
  logger: LauncherLogger;
  secretsAvailable: boolean;
  onDeviceCode?: (info: { flowId: string; userCode: string; verificationUri: string; expiresInSec: number; message: string }) => void;
}

export class AccountService {
  constructor(private readonly deps: AccountServiceDeps) {}

  private toDomain(record: AccountRecord): Account {
    return {
      id: record.id,
      type: record.type === 'microsoft' ? 'microsoft' : 'offline',
      name: record.name,
      uuid: record.uuid,
      skinUrl: record.skinUrl,
      capeUrl: record.capeUrl,
      localSkinPath: record.localSkinPath,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
      active: record.active,
      sessionValid: record.sessionValid,
    };
  }

  list(): Account[] {
    return this.deps.repo.list().map((record) => this.toDomain(record));
  }

  get(id: string): Account {
    const record = this.deps.repo.findById(id);
    if (!record) throw notFound('Account not found.');
    return this.toDomain(record);
  }

  active(): Account | null {
    const record = this.deps.repo.findActive();
    return record ? this.toDomain(record) : null;
  }

  async beginMicrosoft(): Promise<{ flowId: string; userCode: string; verificationUri: string; expiresInSec: number; message: string }> {
    const info = await this.deps.auth.beginLogin();
    this.deps.onDeviceCode?.(info);
    return info;
  }

  async awaitMicrosoft(flowId: string): Promise<Account> {
    const session = await this.deps.auth.awaitLogin(flowId);
    const existing = this.deps.repo.list().find((record) => record.uuid === session.profileId && record.type === 'microsoft');
    const now = new Date().toISOString();
    let blob: string | null = null;
    if (this.deps.secretsAvailable) {
      try {
        blob = this.deps.auth.encryptSession(session);
      } catch (error) {
        this.deps.logger.warn('accounts', `Session could not be encrypted: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const record: AccountRecord = {
      id: existing?.id ?? randomUUID(),
      type: 'microsoft',
      name: session.profileName,
      uuid: session.profileId,
      skinUrl: session.skinUrl,
      capeUrl: session.capeUrl,
      localSkinPath: existing?.localSkinPath ?? null,
      secretBlob: blob,
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: now,
      active: true,
      sessionValid: blob !== null,
    };
    if (existing) this.deps.repo.update(record.id, record);
    else this.deps.repo.insert(record);
    this.deps.repo.setActive(record.id);
    this.deps.activity.add({
      id: randomUUID(),
      kind: 'account',
      instanceId: null,
      message: `Microsoft account added: ${session.profileName}`,
      detail: null,
      createdAt: now,
    });
    this.deps.logger.info('accounts', `Signed in as ${session.profileName} (${session.profileId})`);
    return this.toDomain(this.deps.repo.findById(record.id)!);
  }

  createOffline(name: string): Account {
    const trimmed = name.trim();
    if (!isValidMinecraftUsername(trimmed)) {
      throw new LauncherError('INVALID_INPUT', 'Usernames must be 3-16 characters: letters, numbers or underscore.');
    }
    const profile = createOfflineProfile(trimmed);
    if (this.deps.repo.findByName(trimmed)) {
      throw new LauncherError('INVALID_INPUT', `An account named "${trimmed}" already exists.`);
    }
    const now = new Date().toISOString();
    const record: AccountRecord = {
      id: randomUUID(),
      type: 'offline',
      name: profile.name,
      uuid: profile.uuid,
      skinUrl: null,
      capeUrl: null,
      localSkinPath: null,
      secretBlob: null,
      createdAt: now,
      lastUsedAt: now,
      active: !this.deps.repo.findActive(),
      sessionValid: true,
    };
    this.deps.repo.insert(record);
    this.deps.activity.add({
      id: randomUUID(),
      kind: 'account',
      instanceId: null,
      message: `Offline profile created: ${profile.name}`,
      detail: 'Offline accounts only work in single-player and servers that allow offline mode.',
      createdAt: now,
    });
    return this.toDomain(record);
  }

  setActive(id: string): Account[] {
    this.get(id);
    this.deps.repo.setActive(id);
    return this.list();
  }

  async remove(id: string): Promise<void> {
    const record = this.deps.repo.findById(id);
    if (!record) return;
    this.deps.repo.remove(id);
    const next = this.deps.repo.list()[0];
    if (record.active && next) this.deps.repo.setActive(next.id);
    this.deps.activity.add({
      id: randomUUID(),
      kind: 'account',
      instanceId: null,
      message: `Account removed: ${record.name}`,
      detail: null,
      createdAt: new Date().toISOString(),
    });
  }

  /** Refreshes the Microsoft session and profile information. */
  async refresh(id: string): Promise<Account> {
    const record = this.deps.repo.findById(id);
    if (!record) throw notFound('Account not found.');
    if (record.type !== 'microsoft') return this.toDomain(record);
    if (!record.secretBlob) throw new LauncherError('AUTH_REQUIRED', 'Sign in with Microsoft again to restore this account.');

    try {
      const session = this.deps.auth.decryptSession(record.secretBlob);
      if (!session) throw new LauncherError('AUTH_REQUIRED', 'Stored session could not be decrypted. Sign in again.');
      const refreshed = await this.deps.auth.ensureValidSession(session);
      const blob = this.deps.auth.encryptSession(refreshed.session);
      this.deps.repo.update(id, {
        secretBlob: blob,
        sessionValid: true,
        name: refreshed.session.profileName,
        skinUrl: refreshed.session.skinUrl,
        capeUrl: refreshed.session.capeUrl,
      });
      return this.toDomain(this.deps.repo.findById(id)!);
    } catch (error) {
      this.deps.repo.update(id, { sessionValid: false });
      this.deps.logger.warn('accounts', `Session refresh failed for ${record.name}`);
      throw error instanceof LauncherError ? error : new LauncherError('AUTH_FAILED', 'Could not refresh the Microsoft session.', undefined, error);
    }
  }

  /** Returns a launch-ready account; refreshes premium sessions when needed. */
  async launchAccount(id: string): Promise<LaunchAccount> {
    const record = this.deps.repo.findById(id);
    if (!record) throw notFound('Account not found.');
    if (record.type === 'offline') {
      return {
        type: 'offline',
        name: record.name,
        uuid: record.uuid || offlineUuid(record.name),
        accessToken: '0',
        userType: 'legacy',
      };
    }
    if (!record.secretBlob) throw new LauncherError('AUTH_REQUIRED', 'Sign in with Microsoft again to launch the game.');
    const refreshed = await this.refresh(id);
    const stored = this.deps.auth.decryptSession(this.deps.repo.findById(id)?.secretBlob ?? null);
    if (!stored) throw new LauncherError('AUTH_REQUIRED', 'Stored session could not be read. Sign in again.');
    this.deps.repo.setActive(id);
    return {
      type: 'microsoft',
      name: refreshed.name,
      uuid: refreshed.uuid,
      accessToken: stored.minecraftAccessToken,
      userType: 'msa',
      xuid: stored.xuid,
    };
  }

  /** Direct Minecraft access token (used for skin upload). */
  async minecraftToken(id: string): Promise<string | null> {
    const record = this.deps.repo.findById(id);
    if (!record || record.type !== 'microsoft' || !record.secretBlob) return null;
    const session = this.deps.auth.decryptSession(record.secretBlob);
    if (!session) return null;
    const valid = await this.deps.auth.ensureValidSession(session);
    return valid.accessToken;
  }

  encryptedSession(id: string): string | null {
    return this.deps.repo.findById(id)?.secretBlob ?? null;
  }
}
