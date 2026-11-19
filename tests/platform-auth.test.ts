import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, PlatformSessionRepository, type DatabaseHandle } from '@klymon/database';
import type { SecretStore } from '@klymon/authentication';
import { LauncherLogger } from '@klymon/core';
import type { SettingsService } from '../apps/desktop/src/main/services/settings';
import { PlatformAuthService } from '../apps/desktop/src/main/services/platform';

let handle: DatabaseHandle | null = null;

afterEach(() => {
  handle?.close();
  handle = null;
});

function secretsStub(available = true): SecretStore {
  return {
    available,
    encrypt: (plain: string) => `enc:${plain}`,
    decrypt: (cipher: string) => {
      if (!cipher.startsWith('enc:')) throw new Error('bad keyring');
      return cipher.slice(4);
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const TOKENS = {
  accessToken: 'a1',
  refreshToken: 'r1',
  user: { id: 'u1', username: 'steve', email: 's@x.com', emailVerified: false, createdAt: '' },
  sessionId: 's1',
  expiresAt: '',
};

async function createService(options: { secrets?: SecretStore; fetchImpl?: typeof fetch; apiUrl?: string } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'klymon-platform-'));
  handle = await openDatabase(join(directory, 'launcher.db'));
  const settings = { get: () => ({ platformApiUrl: options.apiUrl ?? 'http://api.test' }) } as unknown as SettingsService;
  const service = new PlatformAuthService({
    settings,
    secrets: options.secrets ?? secretsStub(),
    sessions: new PlatformSessionRepository(handle.db),
    logger: new LauncherLogger({ level: 'silent' }),
    launcherVersion: '0.1.0-test',
    fetchImpl: options.fetchImpl,
  });
  return service;
}

function scriptedFetch(routes: Record<string, (url: string, init?: { method?: string }) => Response>): typeof fetch {
  return (async (url: string, init?: { method?: string }) => {
    const path = String(url).split('?')[0] ?? String(url);
    for (const [suffix, handler] of Object.entries(routes)) {
      if (path.endsWith(suffix)) return handler(String(url), init);
    }
    return jsonResponse(404, { statusCode: 404, code: 'NOT_FOUND', message: 'Nope.' });
  }) as unknown as typeof fetch;
}

describe('PlatformAuthService', () => {
  it('starts signed out and logs in with encrypted persistence', async () => {
    const seen: Array<{ url: string; ua: string | null }> = [];
    const fetchImpl = scriptedFetch({
      '/auth/login': () => jsonResponse(200, TOKENS),
    });
    const service = await createService({
      fetchImpl: (async (url: unknown, init?: { headers?: unknown }) => {
        const headers = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]);
        seen.push({ url: String(url), ua: headers.get('user-agent') });
        return fetchImpl(url as string, init as { method?: string });
      }) as unknown as typeof fetch,
    });
    expect(service.status()).toMatchObject({ signedIn: false, username: null, persisted: false });
    await expect(service.login('steve', 'pw')).resolves.toEqual({ username: 'steve' });
    expect(service.status()).toMatchObject({ signedIn: true, username: 'steve', userId: 'u1', persisted: true });
    expect(seen[0]?.ua).toBe('Klymon-Launcher/0.1.0-test');
    // The refresh token never lands in SQLite in plaintext.
    const stored = handle ? new PlatformSessionRepository(handle.db).load() : null;
    expect(stored?.refreshEnc).toBe('enc:r1');
    expect(stored?.username).toBe('steve');
  });

  it('maps auth failures and network errors to launcher codes', async () => {
    const bad = await createService({
      fetchImpl: scriptedFetch({ '/auth/login': () => jsonResponse(401, { statusCode: 401, code: 'UNAUTHORIZED', message: 'Bad.' }) }),
    });
    await expect(bad.login('steve', 'wrong')).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(bad.status().signedIn).toBe(false);

    const offline = await createService({
      fetchImpl: (() => {
        throw new Error('unreachable');
      }) as unknown as typeof fetch,
    });
    await expect(offline.login('steve', 'pw')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('registers, logs out and clears the stored session', async () => {
    const calls: string[] = [];
    const service = await createService({
      fetchImpl: scriptedFetch({
        '/auth/register': () => jsonResponse(201, TOKENS),
        '/auth/logout': (url, init) => {
          calls.push(`${init?.method} ${url}`);
          return new Response(null, { status: 204 });
        },
      }),
    });
    await expect(service.register('steve', 's@x.com', 'long-enough')).resolves.toEqual({ username: 'steve' });
    expect(service.status().signedIn).toBe(true);
    await service.logout();
    expect(service.status()).toMatchObject({ signedIn: false, username: null, persisted: false });
    expect(calls).toEqual(['POST http://api.test/v1/auth/logout']);
  });

  it('works memory-only without a keyring', async () => {
    const service = await createService({
      secrets: secretsStub(false),
      fetchImpl: scriptedFetch({ '/auth/login': () => jsonResponse(200, TOKENS) }),
    });
    await service.login('steve', 'pw');
    expect(service.status()).toMatchObject({ signedIn: true, username: 'steve', persisted: false });
    expect(handle ? new PlatformSessionRepository(handle.db).load() : null).toBeNull();
  });

  it('hands off best-effort codes and nulls when signed out or offline', async () => {
    const service = await createService({
      fetchImpl: scriptedFetch({
        '/auth/login': () => jsonResponse(200, TOKENS),
        '/auth/handoff': () => jsonResponse(201, { code: 'c1', expiresAt: '2030-01-01T00:01:00.000Z' }),
      }),
    });
    expect(await service.handoff()).toBeNull();
    await service.login('steve', 'pw');
    await expect(service.handoff()).resolves.toEqual({ code: 'c1', expiresAt: '2030-01-01T00:01:00.000Z', apiUrl: 'http://api.test' });

    const offline = await createService({
      fetchImpl: scriptedFetch({ '/auth/login': () => jsonResponse(200, TOKENS) }),
    });
    await offline.login('steve', 'pw');
    // '/auth/handoff' unrouted → 404 → null, never throws.
    expect(await offline.handoff()).toBeNull();
  });

  it('rebuilds the client when the API URL changes', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(String(url));
      return jsonResponse(200, TOKENS);
    }) as unknown as typeof fetch;
    let apiUrl = 'http://one.test';
    const directory = mkdtempSync(join(tmpdir(), 'klymon-platform-'));
    handle = await openDatabase(join(directory, 'launcher.db'));
    const settings = { get: () => ({ platformApiUrl: apiUrl }) } as unknown as SettingsService;
    const service = new PlatformAuthService({
      settings,
      secrets: secretsStub(),
      sessions: new PlatformSessionRepository(handle.db),
      logger: new LauncherLogger({ level: 'silent' }),
      launcherVersion: '0.1.0-test',
      fetchImpl,
    });
    await service.login('a', 'b');
    apiUrl = 'http://two.test';
    await service.login('a', 'b');
    expect(urls[0]).toContain('http://one.test');
    expect(urls[1]).toContain('http://two.test');
    expect(service.status().apiUrl).toBe('http://two.test');
  });
});
