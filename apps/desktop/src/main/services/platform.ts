import { ApiError, KlymonClient, type TokenStorage } from '@klymon/api-client';
import type { SecretStore } from '@klymon/authentication';
import { LauncherError, type LauncherLogger } from '@klymon/core';
import type { PlatformSessionRepository } from '@klymon/database';
import type { SettingsService } from './settings';

export interface PlatformStatus {
  signedIn: boolean;
  username: string | null;
  userId: string | null;
  apiUrl: string;
  /** False when the keyring is unavailable and the session is memory-only. */
  persisted: boolean;
}

export interface PlatformServiceDeps {
  settings: SettingsService;
  secrets: SecretStore;
  sessions: PlatformSessionRepository;
  logger: LauncherLogger;
  launcherVersion: string;
  fetchImpl?: typeof fetch;
}

export function mapPlatformError(error: unknown): LauncherError {
  if (error instanceof LauncherError) return error;
  if (error instanceof ApiError) {
    if (error.statusCode === 0) return new LauncherError('NETWORK', 'Could not reach the Klymon API. Check the server URL.');
    if (error.statusCode === 401) return new LauncherError('AUTH_FAILED', 'Invalid credentials.');
    if (error.statusCode === 409) return new LauncherError('INVALID_INPUT', error.message);
    if (error.statusCode === 429) return new LauncherError('INVALID_INPUT', 'Too many attempts. Wait a minute and retry.');
    return new LauncherError('INTERNAL', error.message);
  }
  return new LauncherError('INTERNAL', error instanceof Error ? error.message : String(error));
}

/**
 * Platform (Klymon API) session for the launcher. Access tokens stay in
 * memory inside the KlymonClient; the refresh token is safeStorage-encrypted
 * in SQLite (memory-only fallback when no keyring exists, like accounts).
 */
export class PlatformAuthService {
  private client: KlymonClient | null = null;
  private clientApiUrl = '';
  private memoryRefresh: string | null = null;
  private memoryIdentity: { username: string; userId: string } | null = null;

  constructor(private readonly deps: PlatformServiceDeps) {}

  private storage(): TokenStorage {
    return {
      loadRefresh: () => {
        if (!this.deps.secrets.available) return this.memoryRefresh;
        const row = this.deps.sessions.load();
        if (!row) return this.memoryRefresh;
        try {
          return this.deps.secrets.decrypt(row.refreshEnc);
        } catch (error) {
          this.deps.logger.warn('platform', `Stored session is unreadable, ignoring: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      },
      saveRefresh: (token: string | null) => {
        if (token === null) {
          this.deps.sessions.clear();
          this.memoryRefresh = null;
          return;
        }
        if (!this.deps.secrets.available) {
          this.memoryRefresh = token;
          return;
        }
        const current = this.deps.sessions.load();
        this.deps.sessions.save({
          refreshEnc: this.deps.secrets.encrypt(token),
          username: current?.username ?? this.memoryIdentity?.username ?? '',
          userId: current?.userId ?? this.memoryIdentity?.userId ?? '',
        });
        this.memoryRefresh = null;
      },
    };
  }

  private fetchWithUa(): typeof fetch {
    const base = this.deps.fetchImpl ?? fetch;
    const userAgent = `Klymon-Launcher/${this.deps.launcherVersion}`;
    return (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const headers = new Headers(init?.headers);
      headers.set('user-agent', userAgent);
      return base(url, { ...init, headers });
    }) as typeof fetch;
  }

  /** Shared client for platform calls (SyncService reuses it, same session). */
  getClient(): KlymonClient {
    const apiUrl = this.deps.settings.get().platformApiUrl;
    if (!this.client || this.clientApiUrl !== apiUrl) {
      this.client = new KlymonClient({ baseUrl: apiUrl, storage: this.storage(), fetchImpl: this.fetchWithUa() });
      this.clientApiUrl = apiUrl;
    }
    return this.client;
  }

  status(): PlatformStatus {
    const apiUrl = this.deps.settings.get().platformApiUrl;
    const client = this.clientApiUrl === apiUrl ? this.client : null;
    const row = this.deps.secrets.available ? this.deps.sessions.load() : null;
    const signedIn = client ? client.signedIn : row !== null || this.memoryRefresh !== null;
    return {
      signedIn,
      username: row?.username || this.memoryIdentity?.username || null,
      userId: row?.userId || this.memoryIdentity?.userId || null,
      apiUrl,
      persisted: this.deps.secrets.available && row !== null,
    };
  }

  private remember(user: { username: string; id: string }): void {
    this.memoryIdentity = { username: user.username, userId: user.id };
    if (!this.deps.secrets.available) return;
    const row = this.deps.sessions.load();
    if (row) this.deps.sessions.save({ refreshEnc: row.refreshEnc, username: user.username, userId: user.id });
  }

  async login(identifier: string, password: string): Promise<{ username: string }> {
    try {
      const tokens = await this.getClient().login({ identifier, password });
      this.remember(tokens.user);
      this.deps.logger.info('platform', `Signed in as ${tokens.user.username}.`);
      return { username: tokens.user.username };
    } catch (error) {
      throw mapPlatformError(error);
    }
  }

  async register(username: string, email: string, password: string): Promise<{ username: string }> {
    try {
      const tokens = await this.getClient().register({ username, email, password });
      this.remember(tokens.user);
      this.deps.logger.info('platform', `Registered platform account ${tokens.user.username}.`);
      return { username: tokens.user.username };
    } catch (error) {
      throw mapPlatformError(error);
    }
  }

  async logout(): Promise<void> {
    try {
      await this.getClient().logout();
    } finally {
      this.memoryIdentity = null;
      this.deps.logger.info('platform', 'Signed out.');
    }
  }

  /**
   * Best-effort handoff for the game launch flow: the single-use code plus
   * the API base the mod must exchange it against. Returns null when signed
   * out or unreachable — launching the game never depends on it.
   */
  async handoff(): Promise<{ code: string; expiresAt: string; apiUrl: string } | null> {
    const current = this.status();
    if (!current.signedIn) return null;
    try {
      const code = await this.getClient().createHandoff();
      return { ...code, apiUrl: current.apiUrl };
    } catch (error) {
      this.deps.logger.warn('platform', `Handoff unavailable, launching offline: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
