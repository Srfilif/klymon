import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, KlymonClient, type TokenStorage } from '@klymon/api-client';

function memoryStorage(refresh: string | null = null): TokenStorage & { saved: Array<string | null> } {
  let current = refresh;
  const saved: Array<string | null> = [];
  return {
    saved,
    loadRefresh: () => current,
    saveRefresh: (token: string | null) => {
      current = token;
      saved.push(token);
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('KlymonClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs in and stores the token pair', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { accessToken: 'a1', refreshToken: 'r1', user: { id: 'u1' }, sessionId: 's1', expiresAt: '' }),
    );
    const storage = memoryStorage();
    const client = new KlymonClient({ baseUrl: 'http://api.test', storage, fetchImpl: fetchImpl as unknown as typeof fetch });
    const tokens = await client.login({ identifier: 's', password: 'p' });
    expect(tokens.accessToken).toBe('a1');
    expect(storage.loadRefresh()).toBe('r1');
    expect(client.signedIn).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/v1/auth/login',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ identifier: 's', password: 'p' }) }),
    );
  });

  it('refreshes once on 401 and retries, sharing one refresh across concurrent calls', async () => {
    let refreshCalls = 0;
    const fetchImpl = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      if (String(url).endsWith('/auth/refresh')) {
        refreshCalls++;
        return jsonResponse(200, { accessToken: 'a2', refreshToken: 'r2', user: {}, sessionId: 's2', expiresAt: '' });
      }
      const auth = init?.headers?.authorization ?? '';
      if (auth === 'Bearer a2') return jsonResponse(200, { id: 'u1' });
      return jsonResponse(401, { statusCode: 401, code: 'UNAUTHORIZED', message: 'Expired.' });
    });
    const storage = memoryStorage('r1');
    const client = new KlymonClient({ baseUrl: 'http://api.test', storage, fetchImpl: fetchImpl as unknown as typeof fetch });
    const [first, second] = await Promise.all([client.me(), client.wallet()]);
    expect(first).toEqual({ id: 'u1' });
    expect(second).toBeTruthy();
    expect(refreshCalls).toBe(1);
    expect(storage.loadRefresh()).toBe('r2');
  });

  it('clears the session when refresh dies and surfaces envelope errors', async () => {
    const changes: boolean[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/auth/refresh')) return jsonResponse(401, { statusCode: 401, code: 'UNAUTHORIZED', message: 'Dead.' });
      if (String(url).endsWith('/admin/stats')) return jsonResponse(403, { statusCode: 403, code: 'FORBIDDEN', message: 'Admins only.' });
      return jsonResponse(401, { statusCode: 401, code: 'UNAUTHORIZED', message: 'Expired.' });
    });
    const storage = memoryStorage('dead');
    const client = new KlymonClient({
      baseUrl: 'http://api.test',
      storage,
      onAuthChange: (signedIn) => changes.push(signedIn),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const failure = await client.me().then(
      () => null,
      (error: unknown) => error as ApiError,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure?.statusCode).toBe(401);
    expect(storage.loadRefresh()).toBeNull();
    expect(client.signedIn).toBe(false);
    expect(changes).toEqual([false]);
    const forbidden = await client.adminStats().then(
      () => null,
      (error: unknown) => error as ApiError,
    );
    expect(forbidden?.code).toBe('FORBIDDEN');
  });

  it('maps network failures to ApiError 0/NETWORK', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = new KlymonClient({ baseUrl: 'http://api.test', storage: memoryStorage(), fetchImpl: fetchImpl as unknown as typeof fetch });
    const failure = await client.me().then(
      () => null,
      (error: unknown) => error as ApiError,
    );
    expect(failure?.statusCode).toBe(0);
    expect(failure?.code).toBe('NETWORK');
  });

  it('covers inventory and admin cosmetics routes', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: { method?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      const path = String(url);
      if (path.endsWith('/admin/cosmetics/grant')) return jsonResponse(201, { granted: true });
      if (path.endsWith('/admin/cosmetics')) return jsonResponse(200, []);
      if (path.endsWith('/cosmetics')) return jsonResponse(200, [{ id: 'c1' }]);
      if (path.endsWith('/inventory')) return jsonResponse(200, { owned: [], equipped: {} });
      if (path.endsWith('/inventory/purchase')) return jsonResponse(201, { owned: true, balanceAfter: 100 });
      if (path.endsWith('/inventory/equip')) return jsonResponse(201, { cape: 'c1' });
      return new Response(null, { status: 204 });
    });
    const storage = memoryStorage('r1');
    const client = new KlymonClient({ baseUrl: 'http://api.test', storage, fetchImpl: fetchImpl as unknown as typeof fetch });
    // Anonymous catalog (no auth header needed).
    await expect(client.catalog()).resolves.toEqual([{ id: 'c1' }]);
    const authed = new KlymonClient({
      baseUrl: 'http://api.test',
      storage: memoryStorage('r1'),
      fetchImpl: (async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/auth/refresh')) {
          return jsonResponse(200, { accessToken: 'a9', refreshToken: 'r9', user: {}, sessionId: 's', expiresAt: '' });
        }
        return fetchImpl(url, init);
      }) as unknown as typeof fetch,
    });
    await expect(authed.inventory()).resolves.toEqual({ owned: [], equipped: {} });
    await expect(authed.purchase('c1')).resolves.toEqual({ owned: true, balanceAfter: 100 });
    await expect(authed.equip('cape', 'c1')).resolves.toEqual({ cape: 'c1' });
    await expect(authed.adminCosmetics()).resolves.toEqual([]);
    await expect(authed.adminGrant('u1', 'c1')).resolves.toEqual({ granted: true });
    await authed.adminDeleteCosmetic('c1');
    const methods = calls.map((call) => `${call.method} ${call.url.replace('http://api.test/v1', '')}`);
    expect(methods).toContain('POST /inventory/purchase');
    expect(methods).toContain('DELETE /admin/cosmetics/c1');
  });

  it('covers addon browse, publisher and moderation routes', async () => {
    const calls: Array<{ url: string; method: string; auth: boolean; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: { method?: string; headers?: unknown; body?: unknown }) => {
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url: String(url), method: init?.method ?? 'GET', auth: Boolean(headers?.authorization), body: init?.body });
      const path = String(url).split('?')[0] ?? String(url);
      if (path.endsWith('/admin/addons')) return jsonResponse(200, { total: 0, addons: [] });
      if (path.endsWith('/admin/addons/jade')) return jsonResponse(200, { id: 'jade', versions: [] });
      if (path.endsWith('/visibility')) return jsonResponse(200, { id: 'jade', visibility: 'published' });
      if (path.endsWith('/addons/keys') && (init?.method ?? 'GET') === 'GET') return jsonResponse(200, [{ fingerprint: 'fp' }]);
      if (path.endsWith('/addons/keys')) return jsonResponse(201, { fingerprint: 'fp', name: 'laptop' });
      if (path.includes('/addons/keys/')) return new Response(null, { status: 204 });
      if (path.endsWith('/addons') && (init?.method ?? 'GET') === 'GET') return jsonResponse(200, { total: 1, addons: [{ id: 'jade' }] });
      if (path.endsWith('/addons/mine')) return jsonResponse(200, [{ id: 'mine' }]);
      if (path.endsWith('/addons/jade/versions')) return jsonResponse(200, [{ version: '1.2.0' }]);
      if (path.endsWith('/addons/jade')) return jsonResponse(200, { id: 'jade' });
      return jsonResponse(201, { id: 'jade' });
    });
    const authed = new KlymonClient({
      baseUrl: 'http://api.test',
      storage: memoryStorage('r1'),
      fetchImpl: (async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/auth/refresh')) {
          return jsonResponse(200, { accessToken: 'a9', refreshToken: 'r9', user: {}, sessionId: 's', expiresAt: '' });
        }
        return fetchImpl(url, init);
      }) as unknown as typeof fetch,
    });
    // Public routes send no Authorization header.
    await expect(authed.browseAddons({ search: 'jad', mcVersion: '1.21.1' })).resolves.toMatchObject({ total: 1 });
    await expect(authed.addonDetail('jade')).resolves.toMatchObject({ id: 'jade' });
    await expect(authed.addonVersions('jade')).resolves.toHaveLength(1);
    expect(calls.filter((call) => call.auth)).toHaveLength(0);
    await expect(authed.myAddons()).resolves.toEqual([{ id: 'mine' }]);
    await authed.createAddon({ id: 'jade', name: 'J', summary: 'S' });
    await authed.publishAddonVersion('jade', {
      version: '1.2.0',
      mcVersions: ['1.21.1'],
      loaders: ['fabric'],
      downloadUrl: 'https://cdn.example.com/j.jar',
      sha256: 'ab'.repeat(32),
      fileSize: 10,
      capabilities: ['hud'],
    });
    await expect(authed.adminAddons()).resolves.toEqual({ total: 0, addons: [] });
    await expect(authed.adminSetAddonVisibility('jade', 'published')).resolves.toMatchObject({ visibility: 'published' });
    await expect(authed.adminAddonDetail('jade')).resolves.toMatchObject({ id: 'jade' });
    await expect(authed.myAddonKeys()).resolves.toEqual([{ fingerprint: 'fp' }]);
    await expect(authed.registerAddonKey('laptop', 'dGVzdA')).resolves.toMatchObject({ name: 'laptop' });
    await authed.revokeAddonKey('fp');
    const methods = calls.map((call) => `${call.method} ${call.url.replace('http://api.test/v1', '')}`);
    expect(methods).toContain('GET /addons?search=jad&mcVersion=1.21.1');
    expect(methods).toContain('POST /addons/jade/versions');
    const published = calls.find((call) => call.method === 'POST' && call.url.endsWith('/addons/jade/versions'));
    expect(JSON.parse(String(published?.body))).toMatchObject({ capabilities: ['hud'] });
    expect(methods).toContain('PATCH /admin/addons/jade/visibility');
    expect(methods).toContain('GET /admin/addons/jade');
    expect(methods).toContain('GET /addons/keys');
    expect(methods).toContain('POST /addons/keys');
    expect(methods).toContain('DELETE /addons/keys/fp');
  });

  it('builds query strings and logouts idempotently', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('/auth/logout')) return new Response(null, { status: 500 });
      return jsonResponse(200, []);
    });
    const storage = memoryStorage('r1');
    const client = new KlymonClient({ baseUrl: 'http://api.test/', storage, fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.transactions(10);
    expect(calls[0]).toBe('http://api.test/v1/wallet/transactions?limit=10');
    await client.logout();
    expect(storage.loadRefresh()).toBeNull();
    expect(client.signedIn).toBe(false);
  });

  it('covers sync profiles/documents/versions and keeps 409 details', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      const path = String(url).split('?')[0] ?? String(url);
      if (path.endsWith('/sync/profiles') && (init?.method ?? 'GET') === 'GET') return jsonResponse(200, [{ id: 'p1', name: 'main' }]);
      if (path.endsWith('/sync/profiles') && init?.method === 'POST') return jsonResponse(201, { id: 'p2', name: 'pvp' });
      if (path.endsWith('/restore')) return jsonResponse(200, { namespace: 'loadout', version: 4 });
      if (path.endsWith('/versions/2')) return jsonResponse(200, { version: 2, content: { cape: 'old' } });
      if (path.endsWith('/versions')) return jsonResponse(200, [{ version: 3 }, { version: 2 }]);
      if (path.endsWith('/sync/profiles/p1')) return jsonResponse(200, { id: 'p1', name: 'renamed' });
      if (path.includes('/documents/') && init?.method === 'PUT') {
        const body = JSON.parse(init?.body ?? '{}') as { baseVersion: number | null };
        if (body.baseVersion === 1) {
          return jsonResponse(409, {
            statusCode: 409,
            code: 'CONFLICT',
            message: 'Version mismatch.',
            details: { server: { namespace: 'loadout', version: 3 } },
          });
        }
        return jsonResponse(200, { namespace: 'loadout', version: 4 });
      }
      if (path.endsWith('/sync/profiles/p9') && init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (path.endsWith('/documents')) return jsonResponse(200, [{ namespace: 'loadout', version: 3 }]);
      return new Response(null, { status: 204 });
    });
    const client = new KlymonClient({
      baseUrl: 'http://api.test',
      storage: memoryStorage('r1'),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.listSyncProfiles()).resolves.toHaveLength(1);
    await expect(client.createSyncProfile('pvp')).resolves.toMatchObject({ id: 'p2' });
    await expect(client.renameSyncProfile('p1', 'renamed')).resolves.toMatchObject({ name: 'renamed' });
    await client.deleteSyncProfile('p9');
    await expect(client.listSyncDocuments('p1')).resolves.toHaveLength(1);
    await expect(client.pushSyncDocument('p1', 'loadout', 3, { cape: 'x' })).resolves.toMatchObject({ version: 4 });
    const conflict = await client.pushSyncDocument('p1', 'loadout', 1, { cape: 'x' }).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(ApiError);
    expect((conflict as ApiError).statusCode).toBe(409);
    expect((conflict as ApiError).details).toEqual({ server: { namespace: 'loadout', version: 3 } });
    await expect(client.listSyncVersions('p1', 'loadout', 5)).resolves.toHaveLength(2);
    await expect(client.getSyncVersion('p1', 'loadout', 2)).resolves.toMatchObject({ version: 2 });
    await expect(client.restoreSyncVersion('p1', 'loadout', 3, 2)).resolves.toMatchObject({ version: 4 });
    const methods = calls.map((call) => `${call.method} ${call.url.replace('http://api.test/v1', '')}`);
    expect(methods).toContain('PUT /sync/profiles/p1/documents/loadout');
    expect(methods).toContain('POST /sync/profiles/p1/documents/loadout/restore');
    expect(methods).toContain('DELETE /sync/profiles/p9');
  });

  it('mints handoff codes for the game client', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: { method?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      return jsonResponse(201, { code: 'abc123', expiresAt: '2030-01-01T00:01:00.000Z' });
    });
    const client = new KlymonClient({
      baseUrl: 'http://api.test',
      storage: memoryStorage('r1'),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.createHandoff()).resolves.toMatchObject({ code: 'abc123' });
    expect(calls).toEqual([{ url: 'http://api.test/v1/auth/handoff', method: 'POST' }]);
  });

  it('covers the device authorization flow', async () => {
    const calls: Array<{ url: string; method: string; auth: boolean }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: { method?: string; headers?: unknown }) => {
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url: String(url), method: init?.method ?? 'GET', auth: Boolean(headers?.authorization) });
      const path = String(url).split('?')[0] ?? String(url);
      if (path.endsWith('/auth/device/code')) {
        return jsonResponse(201, { deviceCode: 'dc', userCode: 'ABCD-2345', verificationUri: 'https://x/devices', expiresIn: 600, interval: 5 });
      }
      if (path.endsWith('/auth/device/token')) return jsonResponse(202, { status: 'pending', interval: 5 });
      if (path.endsWith('/auth/device/preview')) return jsonResponse(200, { clientName: 'Klymon Client', expiresAt: '' });
      if (path.endsWith('/auth/device/approve')) return jsonResponse(200, { approved: true });
      if (path.endsWith('/auth/device/deny')) return jsonResponse(200, { denied: true });
      return new Response(null, { status: 204 });
    });
    const client = new KlymonClient({
      baseUrl: 'http://api.test',
      storage: memoryStorage('r1'),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.startDeviceFlow('Klymon Client')).resolves.toMatchObject({ userCode: 'ABCD-2345' });
    await expect(client.pollDeviceToken('dc')).resolves.toEqual({ status: 'pending', interval: 5 });
    // Anonymous device endpoints send no Authorization header.
    expect(calls.filter((call) => call.auth)).toHaveLength(0);
    await expect(client.previewDeviceCode('ABCD-2345')).resolves.toMatchObject({ clientName: 'Klymon Client' });
    await expect(client.approveDeviceCode('ABCD-2345')).resolves.toEqual({ approved: true });
    await expect(client.denyDeviceCode('WXYZ-9999')).resolves.toEqual({ denied: true });
    const methods = calls.map((call) => `${call.method} ${call.url.replace('http://api.test/v1', '')}`);
    expect(methods).toContain('POST /auth/device/code');
    expect(methods).toContain('POST /auth/device/token');
    expect(methods).toContain('GET /auth/device/preview?code=ABCD-2345');
  });
});
