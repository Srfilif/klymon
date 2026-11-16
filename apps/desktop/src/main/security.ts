import { session, shell, type BrowserWindow } from 'electron';

export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: klymon-media: https:",
  "media-src 'self' blob: klymon-music:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Dev needs the Vite HMR websocket plus its inline refresh preamble. */
export const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: klymon-media: https:",
  "media-src 'self' blob: klymon-music:",
  "font-src 'self' data:",
  "connect-src 'self' https: ws://localhost:* http://localhost:*",
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:']);

export function openExternalSafely(url: string): void {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) return;
    if (parsed.protocol === 'http:' && !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) {
      // Prefer HTTPS, but plain HTTP links are still opened in the browser, never in-app.
    }
    void shell.openExternal(parsed.toString());
  } catch {
    // Ignore malformed URLs instead of handing them to the OS.
  }
}

/** Locks down the default session: no permission prompts, no downloads from remote origins. */
export function hardenSession(devOrigin: string | null): void {
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    // The launcher needs no device permissions at all.
    callback(permission === 'clipboard-sanitized-write');
  });
  defaultSession.setPermissionCheckHandler(() => false);

  if (devOrigin) {
    defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [DEV_CSP],
        },
      });
    });
  }
}

/** Applies navigation and window-opening restrictions to a window. */
export function secureWindow(window: BrowserWindow, allowedOrigins: string[]): void {
  const contents = window.webContents;

  contents.setWindowOpenHandler(({ url }) => {
    if (ALLOWED_EXTERNAL_PROTOCOLS.has(new URL(url).protocol)) openExternalSafely(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    const allowed = allowedOrigins.some((origin) => url.startsWith(origin));
    if (!allowed) event.preventDefault();
  });

  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  contents.session.setDisplayMediaRequestHandler(() => {
    // Screen capture is never requested by this application.
  });
}
