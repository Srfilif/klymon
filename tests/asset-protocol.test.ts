import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempPaths } from './helpers';

type SchemeHandler = (request: { url: string }) => Promise<Response>;

const electron = vi.hoisted(() => ({
  schemes: [] as Array<{ scheme: string; privileges: Record<string, unknown> }>,
  handlers: new Map<string, SchemeHandler>(),
}));

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: (schemes: Array<{ scheme: string; privileges: Record<string, unknown> }>) => {
      electron.schemes.push(...schemes);
    },
    handle: (scheme: string, handler: SchemeHandler) => {
      electron.handlers.set(scheme, handler);
    },
  },
  net: {
    fetch: async () => new Response('fake-bytes', { status: 200 }),
  },
  session: {},
  shell: {},
}));

// Imported after the mock so protocols.ts picks up the stubbed electron module.
const { registerAssetProtocols, registerSchemes } = await import('../apps/desktop/src/main/protocols');

describe('klymon-media protocol', () => {
  beforeEach(() => {
    electron.schemes.length = 0;
    electron.handlers.clear();
  });

  it('registers klymon-media as CORS-enabled for WebGL texture uploads', () => {
    registerSchemes();
    const media = electron.schemes.find((entry) => entry.scheme === 'klymon-media');
    expect(media?.privileges.corsEnabled).toBe(true);
  });

  it('serves files with a MIME type and a CORS wildcard', async () => {
    const paths = tempPaths();
    await paths.ensureAll();
    const skinsDir = join(paths.root, 'skins');
    mkdirSync(skinsDir, { recursive: true });
    writeFileSync(join(skinsDir, 'steve.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    registerAssetProtocols(() => ({ data: paths.root, renderer: null, music: null }));
    const handler = electron.handlers.get('klymon-media');
    expect(handler).toBeDefined();
    const response = await handler!({ url: 'klymon-media://data/skins/steve.png' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('still rejects missing files and path traversal', async () => {
    const paths = tempPaths();
    await paths.ensureAll();
    registerAssetProtocols(() => ({ data: paths.root, renderer: null, music: null }));
    const handler = electron.handlers.get('klymon-media');
    expect(handler).toBeDefined();
    expect((await handler!({ url: 'klymon-media://data/skins/missing.png' })).status).toBe(404);
    expect((await handler!({ url: 'klymon-media://data/../outside.png' })).status).toBe(404);
  });
});
