import { ApiError, type AddonDependency, type AddonDetail, type AddonListItem, type AddonVersion, type AdminStats, type AdminUserRow, type PublisherKey, type Cosmetic, type Device, type DeviceCodeResponse, type DevicePreview, type DeviceTokenPending, type HandoffCode, type Inventory, type MinecraftAccount, type PublicProfile, type PublicUser, type Session, type SessionTokens, type SyncDocument, type SyncProfile, type SyncVersion, type SyncVersionDetail, type WalletBalance, type WalletEntry, type ApiErrorBody } from './types';

export interface TokenStorage {
  loadRefresh(): string | null;
  saveRefresh(token: string | null): void;
}

export interface KlymonClientOptions {
  baseUrl: string;
  storage: TokenStorage;
  /** Called whenever the signed-in state flips (login success / logout / refresh death). */
  onAuthChange?: (signedIn: boolean) => void;
  fetchImpl?: typeof fetch;
}

interface RequestOptions {
  method: string;
  auth?: boolean;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  retried?: boolean;
}

/**
 * Typed client for the Klymon /v1 API. Access tokens stay in memory; the
 * caller persists the refresh token (e.g. localStorage). A 401 triggers one
 * shared refresh + retry; if that fails the session is cleared.
 */
export class KlymonClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<string> | null = null;
  private readonly baseUrl: string;
  private readonly storage: TokenStorage;
  private readonly onAuthChange?: (signedIn: boolean) => void;
  private readonly fetchImpl: typeof fetch;

  constructor(options: KlymonClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.storage = options.storage;
    this.onAuthChange = options.onAuthChange;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get signedIn(): boolean {
    return this.accessToken !== null || this.storage.loadRefresh() !== null;
  }

  private setTokens(access: string | null, refresh: string | null): void {
    const was = this.signedIn;
    this.accessToken = access;
    this.storage.saveRefresh(refresh);
    const is = this.signedIn;
    if (was !== is) this.onAuthChange?.(is);
  }

  private async request<T>(path: string, options: RequestOptions): Promise<T> {
    const url = new URL(`${this.baseUrl}/v1${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.auth !== false && this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Could not reach the Klymon API.');
    }
    if (response.status === 401 && options.auth !== false && !options.retried && this.storage.loadRefresh()) {
      // Single shared refresh across concurrent 401s; exactly one retry.
      this.refreshPromise ??= this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
      try {
        await this.refreshPromise;
      } catch {
        this.setTokens(null, null);
        throw await toApiError(response);
      }
      return this.request<T>(path, { ...options, auth: true, retried: true });
    }
    if (!response.ok) {
      throw await toApiError(response);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async doRefresh(): Promise<string> {
    const refreshToken = this.storage.loadRefresh();
    if (!refreshToken) throw new Error('No refresh token.');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      throw new Error('Refresh unreachable.');
    }
    if (!response.ok) throw new Error('Refresh rejected.');
    const tokens = (await response.json()) as SessionTokens;
    this.setTokens(tokens.accessToken, tokens.refreshToken);
    return tokens.accessToken;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  async register(input: { username: string; email: string; password: string }): Promise<SessionTokens> {
    const tokens = await this.request<SessionTokens>('/auth/register', { method: 'POST', auth: false, body: input });
    this.setTokens(tokens.accessToken, tokens.refreshToken);
    return tokens;
  }

  async login(input: { identifier: string; password: string }): Promise<SessionTokens> {
    const tokens = await this.request<SessionTokens>('/auth/login', { method: 'POST', auth: false, body: input });
    this.setTokens(tokens.accessToken, tokens.refreshToken);
    return tokens;
  }

  async logout(): Promise<void> {
    try {
      await this.request<void>('/auth/logout', { method: 'POST' });
    } catch {
      // Best effort: the local session always ends, even if revocation failed.
    } finally {
      this.setTokens(null, null);
    }
  }

  me(): Promise<PublicUser> {
    return this.request<PublicUser>('/auth/me', { method: 'GET' });
  }

  /** Mint a short-lived single-use code to hand the session to the game client. */
  createHandoff(): Promise<HandoffCode> {
    return this.request<HandoffCode>('/auth/handoff', { method: 'POST' });
  }

  startDeviceFlow(clientName?: string): Promise<DeviceCodeResponse> {
    return this.request<DeviceCodeResponse>('/auth/device/code', { method: 'POST', auth: false, body: clientName === undefined ? {} : { clientName } });
  }

  pollDeviceToken(deviceCode: string): Promise<SessionTokens | DeviceTokenPending> {
    return this.request<SessionTokens | DeviceTokenPending>('/auth/device/token', { method: 'POST', auth: false, body: { deviceCode } });
  }

  previewDeviceCode(userCode: string): Promise<DevicePreview> {
    return this.request<DevicePreview>('/auth/device/preview', { method: 'GET', query: { code: userCode } });
  }

  approveDeviceCode(userCode: string): Promise<{ approved: boolean }> {
    return this.request('/auth/device/approve', { method: 'POST', body: { userCode } });
  }

  denyDeviceCode(userCode: string): Promise<{ denied: boolean }> {
    return this.request('/auth/device/deny', { method: 'POST', body: { userCode } });
  }

  sessions(): Promise<Session[]> {
    return this.request<Session[]>('/auth/sessions', { method: 'GET' });
  }

  async revokeSession(id: string): Promise<void> {
    await this.request<void>(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  requestEmailVerification(): Promise<{ alreadyVerified: boolean; devToken?: string }> {
    return this.request('/auth/email/request-verification', { method: 'POST', body: {} });
  }

  verifyEmail(token: string): Promise<{ verified: boolean }> {
    return this.request('/auth/email/verify', { method: 'POST', auth: false, body: { token } });
  }

  requestPasswordReset(email: string): Promise<{ requested: boolean; devToken?: string }> {
    return this.request('/auth/password/request-reset', { method: 'POST', auth: false, body: { email } });
  }

  resetPassword(token: string, newPassword: string): Promise<{ reset: boolean }> {
    return this.request('/auth/password/reset', { method: 'POST', auth: false, body: { token, newPassword } });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.request<void>('/auth/password/change', { method: 'POST', body: { currentPassword, newPassword } });
  }

  devices(): Promise<Device[]> {
    return this.request<Device[]>('/auth/devices', { method: 'GET' });
  }

  async revokeDevice(id: string): Promise<void> {
    await this.request<void>(`/auth/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  minecraftAccounts(): Promise<MinecraftAccount[]> {
    return this.request<MinecraftAccount[]>('/auth/minecraft', { method: 'GET' });
  }

  linkMinecraft(input: { uuid: string; username: string; minecraftAccessToken?: string }): Promise<MinecraftAccount> {
    return this.request<MinecraftAccount>('/auth/minecraft/link', { method: 'POST', body: input });
  }

  async unlinkMinecraft(id: string): Promise<void> {
    await this.request<void>(`/auth/minecraft/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async syncMinecraft(id: string, minecraftAccessToken: string): Promise<void> {
    await this.request<void>(`/auth/minecraft/${encodeURIComponent(id)}/sync`, { method: 'POST', body: { minecraftAccessToken } });
  }

  // ── Users ───────────────────────────────────────────────────────────────

  myProfile(): Promise<PublicUser> {
    return this.request<PublicUser>('/users/me', { method: 'GET' });
  }

  updateProfile(input: { bio: string | null }): Promise<PublicUser> {
    return this.request<PublicUser>('/users/me', { method: 'PATCH', body: input });
  }

  publicProfile(username: string): Promise<PublicProfile> {
    return this.request<PublicProfile>(`/users/${encodeURIComponent(username)}`, { method: 'GET', auth: false });
  }

  // ── Wallet ──────────────────────────────────────────────────────────────

  wallet(): Promise<WalletBalance> {
    return this.request<WalletBalance>('/wallet', { method: 'GET' });
  }

  transactions(limit = 50): Promise<WalletEntry[]> {
    return this.request<WalletEntry[]>('/wallet/transactions', { method: 'GET', query: { limit } });
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  catalog(): Promise<Cosmetic[]> {
    return this.request<Cosmetic[]>('/cosmetics', { method: 'GET', auth: false });
  }

  inventory(): Promise<Inventory> {
    return this.request<Inventory>('/inventory', { method: 'GET' });
  }

  purchase(cosmeticId: string): Promise<{ owned: boolean; balanceAfter: number }> {
    return this.request('/inventory/purchase', { method: 'POST', body: { cosmeticId } });
  }

  equip(slot: string, cosmeticId: string | null): Promise<Record<string, string>> {
    return this.request('/inventory/equip', { method: 'POST', body: { slot, cosmeticId } });
  }

  // ── Addons ──────────────────────────────────────────────────────────────

  browseAddons(query: { limit?: number; offset?: number; search?: string; mcVersion?: string; loader?: string } = {}): Promise<{
    total: number;
    addons: AddonListItem[];
  }> {
    return this.request('/addons', { method: 'GET', auth: false, query });
  }

  addonDetail(id: string): Promise<AddonDetail> {
    return this.request<AddonDetail>(`/addons/${encodeURIComponent(id)}`, { method: 'GET', auth: false });
  }

  addonVersions(id: string): Promise<AddonVersion[]> {
    return this.request<AddonVersion[]>(`/addons/${encodeURIComponent(id)}/versions`, { method: 'GET', auth: false });
  }

  myAddons(): Promise<AddonListItem[]> {
    return this.request<AddonListItem[]>('/addons/mine', { method: 'GET' });
  }

  createAddon(input: { id: string; name: string; summary: string; description?: string | null }): Promise<AddonDetail> {
    return this.request<AddonDetail>('/addons', { method: 'POST', body: input });
  }

  updateAddon(id: string, input: { name?: string; summary?: string; description?: string | null }): Promise<AddonDetail> {
    return this.request<AddonDetail>(`/addons/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });
  }

  publishAddonVersion(
    id: string,
    input: {
      version: string;
      mcVersions: string[];
      loaders: string[];
      dependencies?: AddonDependency[];
      downloadUrl: string;
      sha256: string;
      fileSize: number;
      changelog?: string | null;
      signature?: string;
      keyFingerprint?: string;
      capabilities?: string[];
    },
  ): Promise<AddonVersion> {
    return this.request<AddonVersion>(`/addons/${encodeURIComponent(id)}/versions`, { method: 'POST', body: input });
  }

  myAddonKeys(): Promise<PublisherKey[]> {
    return this.request<PublisherKey[]>('/addons/keys', { method: 'GET' });
  }

  registerAddonKey(name: string, publicKey: string): Promise<PublisherKey> {
    return this.request<PublisherKey>('/addons/keys', { method: 'POST', body: { name, publicKey } });
  }

  async revokeAddonKey(fingerprint: string): Promise<void> {
    await this.request<void>(`/addons/keys/${encodeURIComponent(fingerprint)}`, { method: 'DELETE' });
  }

  // ── Admin ───────────────────────────────────────────────────────────────

  adminStats(): Promise<AdminStats> {
    return this.request<AdminStats>('/admin/stats', { method: 'GET' });
  }

  adminUsers(query: { limit?: number; offset?: number; search?: string } = {}): Promise<{ total: number; users: AdminUserRow[] }> {
    return this.request('/admin/users', { method: 'GET', query });
  }

  adminAdjust(input: { userId: string; amount: number; reason: string }): Promise<WalletEntry> {
    return this.request<WalletEntry>('/admin/wallets/adjust', { method: 'POST', body: input });
  }

  adminCosmetics(): Promise<Cosmetic[]> {
    return this.request<Cosmetic[]>('/admin/cosmetics', { method: 'GET' });
  }

  adminCreateCosmetic(input: { id: string; name: string; slot: string; rarity: string; price: number; description?: string | null }): Promise<Cosmetic> {
    return this.request<Cosmetic>('/admin/cosmetics', { method: 'POST', body: input });
  }

  adminUpdateCosmetic(id: string, input: { name?: string; rarity?: string; price?: number; description?: string | null }): Promise<Cosmetic> {
    return this.request<Cosmetic>(`/admin/cosmetics/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });
  }

  async adminDeleteCosmetic(id: string): Promise<void> {
    await this.request<void>(`/admin/cosmetics/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  adminGrant(userId: string, cosmeticId: string): Promise<{ granted: boolean }> {
    return this.request('/admin/cosmetics/grant', { method: 'POST', body: { userId, cosmeticId } });
  }

  adminAddons(query: { limit?: number; offset?: number; search?: string } = {}): Promise<{ total: number; addons: AddonListItem[] }> {
    return this.request('/admin/addons', { method: 'GET', query });
  }

  adminSetAddonVisibility(id: string, visibility: 'draft' | 'published' | 'hidden'): Promise<AddonDetail> {
    return this.request<AddonDetail>(`/admin/addons/${encodeURIComponent(id)}/visibility`, { method: 'PATCH', body: { visibility } });
  }

  adminAddonDetail(id: string): Promise<AddonDetail> {
    return this.request<AddonDetail>(`/admin/addons/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  // ── Sync ───────────────────────────────────────────────────────────────

  listSyncProfiles(): Promise<SyncProfile[]> {
    return this.request<SyncProfile[]>('/sync/profiles', { method: 'GET' });
  }

  createSyncProfile(name: string): Promise<SyncProfile> {
    return this.request<SyncProfile>('/sync/profiles', { method: 'POST', body: { name } });
  }

  renameSyncProfile(id: string, name: string): Promise<SyncProfile> {
    return this.request<SyncProfile>(`/sync/profiles/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } });
  }

  async deleteSyncProfile(id: string): Promise<void> {
    await this.request<void>(`/sync/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  listSyncDocuments(profileId: string): Promise<SyncDocument[]> {
    return this.request<SyncDocument[]>(`/sync/profiles/${encodeURIComponent(profileId)}/documents`, { method: 'GET' });
  }

  pushSyncDocument(
    profileId: string,
    namespace: string,
    baseVersion: number | null,
    content: Record<string, unknown>,
    force = false,
  ): Promise<SyncDocument> {
    return this.request<SyncDocument>(`/sync/profiles/${encodeURIComponent(profileId)}/documents/${encodeURIComponent(namespace)}`, {
      method: 'PUT',
      body: { baseVersion, content, force },
    });
  }

  listSyncVersions(profileId: string, namespace: string, limit = 10): Promise<SyncVersion[]> {
    return this.request<SyncVersion[]>(`/sync/profiles/${encodeURIComponent(profileId)}/documents/${encodeURIComponent(namespace)}/versions`, {
      method: 'GET',
      query: { limit },
    });
  }

  getSyncVersion(profileId: string, namespace: string, version: number): Promise<SyncVersionDetail> {
    return this.request<SyncVersionDetail>(
      `/sync/profiles/${encodeURIComponent(profileId)}/documents/${encodeURIComponent(namespace)}/versions/${version}`,
      { method: 'GET' },
    );
  }

  restoreSyncVersion(profileId: string, namespace: string, baseVersion: number, version: number): Promise<SyncDocument> {
    return this.request<SyncDocument>(`/sync/profiles/${encodeURIComponent(profileId)}/documents/${encodeURIComponent(namespace)}/restore`, {
      method: 'POST',
      body: { baseVersion, version },
    });
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    return new ApiError(response.status, body.code ?? 'ERROR', body.message ?? `Request failed (${response.status}).`, body.details);
  } catch {
    return new ApiError(response.status, 'ERROR', `Request failed (${response.status}).`);
  }
}
