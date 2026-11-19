const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:3001';
const REPO = (import.meta.env.VITE_GITHUB_REPO as string | undefined) || 'Srfilif/klymon';

export type ApiStatus = 'checking' | 'online' | 'offline';

export function releasesUrl(): string {
  return `https://github.com/${REPO}/releases`;
}

export function repoUrl(): string {
  return `https://github.com/${REPO}`;
}

export function docsUrl(): string {
  return `${API_URL}/docs`;
}

/** Liveness probe against the versioned API. Never throws. */
export async function checkApiStatus(timeoutMs = 5000): Promise<Exclude<ApiStatus, 'checking'>> {
  try {
    const response = await fetch(`${API_URL}/v1/health/live`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? 'online' : 'offline';
  } catch {
    return 'offline';
  }
}
