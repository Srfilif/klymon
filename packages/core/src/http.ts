import { networkError } from './errors';

export const USER_AGENT = 'KlymonLauncher/0.1 (+https://github.com/klymon-launcher)';
const DEFAULT_TIMEOUT = 20_000;

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

function combineSignals(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  return AbortSignal.any([timeout, external]);
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { headers = {}, timeoutMs = DEFAULT_TIMEOUT, retries = 2, signal } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
        signal: combineSignals(timeoutMs, signal),
      });
      if (!response.ok) {
        throw networkError(`Request failed (${response.status} ${response.statusText}): ${url}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
      }
    }
  }
  throw lastError instanceof Error && lastError.name === 'LauncherError'
    ? lastError
    : networkError(`Unable to reach ${url}`, lastError);
}

export async function postJson<T>(url: string, body: unknown, options: FetchOptions = {}): Promise<T> {
  const { headers = {}, timeoutMs = DEFAULT_TIMEOUT, retries = 1, signal } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
        signal: combineSignals(timeoutMs, signal),
      });
      const text = await response.text();
      if (!response.ok) {
        throw networkError(`Request failed (${response.status}): ${text.slice(0, 400)}`);
      }
      return (text.length > 0 ? JSON.parse(text) : {}) as T;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw lastError instanceof Error ? lastError : networkError(`Unable to reach ${url}`, lastError);
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const { headers = {}, timeoutMs = DEFAULT_TIMEOUT, retries = 2, signal } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...headers },
        signal: combineSignals(timeoutMs, signal),
      });
      if (!response.ok) throw networkError(`Request failed (${response.status}): ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : networkError(`Unable to reach ${url}`, lastError);
}
