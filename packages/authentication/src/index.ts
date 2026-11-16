import { LauncherError, notFound, offlineUuid, postJson } from '@klymon/core';

export interface SecretStore {
  readonly available: boolean;
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export class InMemorySecretStore implements SecretStore {
  readonly available = false;
  private readonly memory = new Map<string, string>();

  encrypt(plaintext: string): string {
    const key = `mem-${this.memory.size}-${Date.now()}`;
    this.memory.set(key, plaintext);
    return `insecure:${key}`;
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext.startsWith('insecure:')) throw new Error('Unknown secret format');
    const value = this.memory.get(ciphertext.slice('insecure:'.length));
    if (value === undefined) throw new Error('Secret not available in this process');
    return value;
  }
}

export interface MicrosoftSession {
  microsoftAccessToken: string;
  microsoftRefreshToken: string;
  microsoftExpiresAt: number;
  minecraftAccessToken: string;
  minecraftExpiresAt: number;
  profileId: string;
  profileName: string;
  skinUrl: string | null;
  capeUrl: string | null;
  skinVariant: 'classic' | 'slim';
  xuid: string | null;
  obtainedAt: number;
}

export interface DeviceCodeInfo {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresInSec: number;
  message: string;
}

interface PendingFlow {
  deviceCode: string;
  expiresAt: number;
  promise: Promise<MicrosoftSession>;
  controller: AbortController;
  settle: { resolve: (session: MicrosoftSession) => void; reject: (error: unknown) => void };
}

const MICROSOFT_CLIENT_ID = '00000000402b5328';
const MICROSOFT_SCOPE = 'XboxLive.signin offline_access';
const CONSUMERS_TENANT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const OAUTH_ENDPOINTS = {
  deviceCode: `${CONSUMERS_TENANT}/devicecode`,
  token: `${CONSUMERS_TENANT}/token`,
};
const MINECRAFT_ENDPOINTS = {
  login: 'https://api.minecraftservices.com/authentication/login_with_xbox',
  profile: 'https://api.minecraftservices.com/minecraft/profile',
  entitlements: 'https://api.minecraftservices.com/entitlements/mcstore',
};
const SESSION_MARGIN_MS = 5 * 60 * 1000;

function describeXstsError(body: { XErr?: number; Message?: string; error_description?: string }): string {
  switch (body.XErr) {
    case 2148916233:
      return 'This Microsoft account has no Xbox profile. Create one at xbox.com before signing in.';
    case 2148916235:
      return 'Xbox Live is not available in this account region.';
    case 2148916236:
    case 2148916237:
      return 'This account needs adult verification (child account).';
    case 2148916238:
      return 'This account is managed by a family group and must be added to a family first.';
    default:
      return body.Message ?? body.error_description ?? 'Xbox Live authentication failed.';
  }
}

function formEncode(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function tokenRequest(values: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(OAUTH_ENDPOINTS.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: formEncode(values),
  });
  const text = await response.text();
  if (!response.ok) {
    let code = '';
    let description = '';
    try {
      const parsed = JSON.parse(text) as { error?: string; error_description?: string };
      code = parsed.error ?? '';
      description = parsed.error_description ?? '';
    } catch {
      description = text.slice(0, 200);
    }
    const error = Object.assign(new LauncherError('AUTH_FAILED', description || 'Microsoft login failed.'), { oauthError: code });
    throw error;
  }
  return JSON.parse(text) as TokenResponse;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  try {
    return await postJson<DeviceCodeResponse>(
      OAUTH_ENDPOINTS.deviceCode,
      { client_id: MICROSOFT_CLIENT_ID, scope: MICROSOFT_SCOPE },
      { retries: 2, timeoutMs: 20_000 },
    );
  } catch (error) {
    throw new LauncherError('AUTH_FAILED', 'Could not start Microsoft sign-in. Check your connection.', undefined, error);
  }
}

async function pollDeviceCodeToken(
  deviceCode: string,
  options: { intervalSec: number; expiresAt: number; signal?: AbortSignal; onTick?: () => void },
): Promise<TokenResponse> {
  let intervalMs = Math.max(options.intervalSec, 2) * 1000;
  for (;;) {
    if (Date.now() > options.expiresAt) {
      throw new LauncherError('AUTH_FAILED', 'The sign-in code expired. Start the process again.');
    }
    if (options.signal?.aborted) throw new LauncherError('CANCELLED', 'Sign-in cancelled.');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    options.onTick?.();
    try {
      return await tokenRequest({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: MICROSOFT_CLIENT_ID,
        device_code: deviceCode,
      });
    } catch (error) {
      const code = (error as { oauthError?: string }).oauthError ?? '';
      if (code === 'authorization_pending') continue;
      if (code === 'slow_down') {
        intervalMs += 3000;
        continue;
      }
      if (code === 'expired_token') {
        throw new LauncherError('AUTH_FAILED', 'The sign-in code expired. Start the process again.');
      }
      if (code === 'authorization_declined') {
        throw new LauncherError('AUTH_FAILED', 'Sign-in was declined.');
      }
      throw error;
    }
  }
}

async function refreshMicrosoftToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: 'refresh_token',
    client_id: MICROSOFT_CLIENT_ID,
    refresh_token: refreshToken,
    scope: MICROSOFT_SCOPE,
  });
}

interface XboxLiveResponse {
  Token: string;
}

async function authenticateXboxLive(microsoftAccessToken: string): Promise<XboxLiveResponse> {
  try {
    return await postJson<XboxLiveResponse>(
      'https://user.auth.xboxlive.com/user/authenticate',
      {
        Properties: {
          AuthMethod: 'RPS',
          SiteName: 'user.auth.xboxlive.com',
          RpsTicket: `d=${microsoftAccessToken}`,
        },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT',
      },
      { retries: 2 },
    );
  } catch (error) {
    throw new LauncherError('AUTH_FAILED', 'Xbox Live rejected the Microsoft token.', undefined, error);
  }
}

interface XstsToken {
  token: string;
  userHash: string;
  xuid: string | null;
}

async function authorizeXsts(xboxToken: string): Promise<XstsToken> {
  try {
    const response = await postJson<{
      Token?: string;
      DisplayClaims?: { xui?: Array<{ uhs?: string; xid?: string }> };
    }>('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xboxToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    });
    const userHash = response.DisplayClaims?.xui?.[0]?.uhs;
    if (!response.Token || !userHash) throw new LauncherError('AUTH_FAILED', 'Malformed XSTS response.');
    return { token: response.Token, userHash, xuid: response.DisplayClaims?.xui?.[0]?.xid ?? null };
  } catch (error) {
    if (error instanceof LauncherError && error.code === 'NETWORK') {
      const body = /request failed \(\d+\): (.*)$/i.exec(error.message)?.[1] ?? '';
      let parsed: { XErr?: number; Message?: string; error_description?: string } = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = {};
      }
      throw new LauncherError('AUTH_FAILED', describeXstsError(parsed), undefined, error);
    }
    throw error;
  }
}

async function loginWithXbox(xsts: XstsToken): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await postJson<{ access_token?: string; expires_in?: number }>(MINECRAFT_ENDPOINTS.login, {
    identityToken: `XBL3.0 x=${xsts.userHash};${xsts.token}`,
  });
  if (!response.access_token) throw new LauncherError('AUTH_FAILED', 'Minecraft did not return an access token.');
  return { accessToken: response.access_token, expiresIn: response.expires_in ?? 0 };
}

interface MinecraftProfile {
  id: string;
  name: string;
  skins: Array<{ url: string; variant?: string }>;
  capes: Array<{ url: string; state?: string }>;
}

async function fetchMinecraftProfile(accessToken: string): Promise<MinecraftProfile> {
  const response = await fetch(MINECRAFT_ENDPOINTS.profile, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (response.status === 401) throw new LauncherError('AUTH_REQUIRED', 'Minecraft session expired.');
  if (response.status === 404) {
    throw new LauncherError('FORBIDDEN', 'This Microsoft account does not own Minecraft Java Edition.');
  }
  if (!response.ok) throw new LauncherError('NETWORK', `Unable to read Minecraft profile (${response.status}).`);
  const profile = (await response.json()) as MinecraftProfile;
  if (!profile.id || !profile.name) throw new LauncherError('AUTH_FAILED', 'Minecraft profile is incomplete.');
  return profile;
}

async function hasJavaEntitlement(accessToken: string): Promise<boolean | null> {
  const response = await fetch(MINECRAFT_ENDPOINTS.entitlements, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { items?: Array<{ name?: string }> };
  return (data.items ?? []).some((item) => item.name === 'product_minecraft' || item.name === 'game_minecraft');
}

export class MicrosoftAuthService {
  private readonly pending = new Map<string, PendingFlow>();

  constructor(private readonly secrets: SecretStore) {}

  async runChain(microsoftAccessToken: string, microsoftRefreshToken: string, microsoftExpiresAt: number): Promise<MicrosoftSession> {
    const xbl = await authenticateXboxLive(microsoftAccessToken);
    const xsts = await authorizeXsts(xbl.Token);
    const mc = await loginWithXbox(xsts);
    const profile = await fetchMinecraftProfile(mc.accessToken);
    const ownsGame = await hasJavaEntitlement(mc.accessToken);
    if (ownsGame === false) {
      throw new LauncherError('FORBIDDEN', 'This Microsoft account does not own Minecraft Java Edition.');
    }
    const skin = profile.skins[0];
    const cape = profile.capes.find((entry) => entry.state === 'ACTIVE') ?? profile.capes[0];
    return {
      microsoftAccessToken,
      microsoftRefreshToken,
      microsoftExpiresAt,
      minecraftAccessToken: mc.accessToken,
      minecraftExpiresAt: Date.now() + Math.max(mc.expiresIn - 60, 3600) * 1000,
      profileId: profile.id,
      profileName: profile.name,
      skinUrl: skin?.url ?? null,
      capeUrl: cape?.url ?? null,
      skinVariant: skin?.variant === 'slim' ? 'slim' : 'classic',
      xuid: xsts.xuid,
      obtainedAt: Date.now(),
    };
  }

  /** Starts the device-code flow and returns immediately with the code for the UI. */
  async beginLogin(): Promise<DeviceCodeInfo> {
    const device = await requestDeviceCode();
    const flowId = crypto.randomUUID();
    const controller = new AbortController();
    let resolve: (session: MicrosoftSession) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<MicrosoftSession>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const flow: PendingFlow = {
      deviceCode: device.device_code,
      expiresAt: Date.now() + device.expires_in * 1000,
      promise,
      controller,
      settle: { resolve, reject },
    };
    this.pending.set(flowId, flow);
    void (async () => {
      try {
        const token = await pollDeviceCodeToken(device.device_code, {
          intervalSec: device.interval,
          expiresAt: flow.expiresAt,
          signal: controller.signal,
        });
        const session = await this.runChain(token.access_token, token.refresh_token, Date.now() + token.expires_in * 1000);
        flow.settle.resolve(session);
      } catch (error) {
        flow.settle.reject(error);
      } finally {
        this.pending.delete(flowId);
      }
    })();
    return {
      flowId,
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      expiresInSec: device.expires_in,
      message: device.message,
    };
  }

  async awaitLogin(flowId: string): Promise<MicrosoftSession> {
    const flow = this.pending.get(flowId);
    if (!flow) throw notFound('That sign-in attempt is no longer active.');
    return flow.promise;
  }

  cancelLogin(flowId: string): void {
    const flow = this.pending.get(flowId);
    if (!flow) return;
    flow.controller.abort();
    flow.settle.reject(new LauncherError('CANCELLED', 'Sign-in cancelled.'));
    this.pending.delete(flowId);
  }

  /** Refreshes an expired session using the stored refresh token. */
  async refresh(session: MicrosoftSession): Promise<MicrosoftSession> {
    if (!session.microsoftRefreshToken) {
      throw new LauncherError('AUTH_REQUIRED', 'Session expired. Sign in with Microsoft again.');
    }
    const token = await refreshMicrosoftToken(session.microsoftRefreshToken);
    return this.runChain(token.access_token, token.refresh_token, Date.now() + token.expires_in * 1000);
  }

  /** Returns a valid Minecraft access token, refreshing transparently when needed. */
  async ensureValidSession(session: MicrosoftSession): Promise<{ session: MicrosoftSession; accessToken: string }> {
    if (session.minecraftExpiresAt - SESSION_MARGIN_MS > Date.now() && session.minecraftAccessToken) {
      return { session, accessToken: session.minecraftAccessToken };
    }
    const refreshed = await this.refresh(session);
    return { session: refreshed, accessToken: refreshed.minecraftAccessToken };
  }

  encryptSession(session: MicrosoftSession): string {
    return this.secrets.encrypt(JSON.stringify(session));
  }

  decryptSession(blob: string | null): MicrosoftSession | null {
    if (!blob) return null;
    try {
      const parsed = JSON.parse(this.secrets.decrypt(blob)) as Partial<MicrosoftSession>;
      if (!parsed.minecraftAccessToken || !parsed.profileName) return null;
      return parsed as MicrosoftSession;
    } catch {
      return null;
    }
  }

  /** Builds a launch-ready session for a Microsoft account, refreshing if required. */
  async sessionForLaunch(blob: string | null): Promise<{ accessToken: string; expiresAt: number; profile: MinecraftProfile; session: MicrosoftSession }> {
    const stored = this.decryptSession(blob);
    if (!stored) throw new LauncherError('AUTH_REQUIRED', 'No stored Microsoft session. Sign in again.');
    const { session, accessToken } = await this.ensureValidSession(stored);
    const profile = await fetchMinecraftProfile(accessToken);
    return { accessToken, expiresAt: session.minecraftExpiresAt, profile, session };
  }
}

export function createOfflineProfile(name: string): { name: string; uuid: string } {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new LauncherError('INVALID_INPUT', 'Usernames must be 3-16 characters: letters, numbers or underscore.');
  }
  return { name, uuid: offlineUuid(name) };
}
