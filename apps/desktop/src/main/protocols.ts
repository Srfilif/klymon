import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { isInside, normalizeSlashes } from '@klymon/core';
import { PRODUCTION_CSP } from './security';

export interface ProtocolRoots {
  /** Launcher data root: skins, instance icons, exported files. */
  data: string;
  /** Built renderer bundle (production only). */
  renderer: string | null;
  /** User-selected music folder (absolute, may be outside the data root). */
  music: string | null;
}

/** Must run before `app.whenReady()`. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'klymon-media',
      // corsEnabled + ACAO below: the 3D skin viewer uploads textures to WebGL,
      // which requires CORS-clean image loads (crossOrigin="anonymous").
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false, corsEnabled: true },
    },
    {
      scheme: 'klymon-music',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
    },
    {
      scheme: 'app',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ]);
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

function contentTypeFor(path: string): string {
  const match = /\.[a-z0-9]+$/i.exec(path);
  return (match && MIME_TYPES[match[0].toLowerCase()]) || 'application/octet-stream';
}

function safeJoin(root: string, pathname: string): string | null {
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (decoded.includes('\u0000')) return null;
  const normalizedRoot = normalizeSlashes(root);
  const candidate = normalizeSlashes(`${normalizedRoot}/${decoded}`);
  const withSep = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
  if (!candidate.startsWith(withSep)) return null;
  if (!isInside(normalizedRoot, candidate)) return null;
  return candidate;
}

/** Serves renderer files with a strict CSP and no node integration. */
export function registerAssetProtocols(getRoots: () => ProtocolRoots): void {
  protocol.handle('klymon-media', async (request) => {
    const roots = getRoots();
    const url = new URL(request.url);
    const filePath = safeJoin(roots.data, url.pathname);
    if (!filePath || !existsSync(filePath)) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(filePath).toString());
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': contentTypeFor(filePath),
        'Cache-Control': 'no-cache',
        // Only this app can request klymon-media:// URLs, so a wildcard is safe
        // and lets WebGL texture uploads (skin viewer) pass CORS checks.
        'Access-Control-Allow-Origin': '*',
      },
    });
  });

  protocol.handle('klymon-music', async (request) => {
    const roots = getRoots();
    if (!roots.music) return new Response('Music folder not configured', { status: 404 });
    const url = new URL(request.url);
    const filePath = safeJoin(roots.music, url.pathname);
    if (!filePath || !existsSync(filePath)) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(filePath).toString());
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': contentTypeFor(filePath),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      },
    });
  });

  protocol.handle('app', async (request) => {
    const roots = getRoots();
    if (!roots.renderer) return new Response('Renderer not available', { status: 404 });
    const url = new URL(request.url);
    const pathname = url.pathname === '/' || url.pathname === '' ? '/index.html' : url.pathname;
    const filePath = safeJoin(roots.renderer, pathname);
    if (!filePath || !existsSync(filePath)) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers();
    headers.set('Content-Type', contentTypeFor(filePath));
    headers.set('Content-Security-Policy', PRODUCTION_CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: 200, headers });
  });
}
