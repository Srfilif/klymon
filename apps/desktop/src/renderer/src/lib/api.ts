import { useEffect, useRef, useState, type DependencyList } from 'react';
import type { KlymonBridge, IpcChannel, IpcContract, LauncherErrorCode, IpcEventMap, IpcEventName } from '@klymon/shared-types';

export type IpcErrorCode = LauncherErrorCode;

export class IpcError extends Error {
  readonly code: IpcErrorCode;

  constructor(code: IpcErrorCode, message: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
  }
}

declare global {
  interface Window {
    klymon: KlymonBridge;
  }
}

function bridge(): KlymonBridge {
  if (!window.klymon) throw new Error('Klymon bridge is unavailable.');
  return window.klymon;
}

function parseError(error: unknown): IpcError {
  const raw = error instanceof Error ? error.message : String(error);
  const match = /\{.*\}$/s.exec(raw);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { code?: IpcErrorCode; message?: string };
      return new IpcError(parsed.code ?? 'INTERNAL', parsed.message ?? raw);
    } catch {
      // Fall through to the raw message.
    }
  }
  return new IpcError('INTERNAL', raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
}

export async function invoke<K extends IpcChannel>(channel: K, payload?: IpcContract[K]['req']): Promise<IpcContract[K]['res']> {
  try {
    return await bridge().invoke(channel, payload);
  } catch (error) {
    throw parseError(error);
  }
}

export function onEvent<K extends IpcEventName>(event: K, listener: (payload: IpcEventMap[K]) => void): () => void {
  return bridge().on(event, listener);
}

export function useEvent<K extends IpcEventName>(event: K, listener: (payload: IpcEventMap[K]) => void): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => {
    const unsubscribe = onEvent(event, (payload) => ref.current(payload));
    return unsubscribe;
  }, [event]);
}

export function errorMessage(error: unknown): string {
  if (error instanceof IpcError || error instanceof Error) return error.message;
  return String(error);
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (value: T | null) => void;
}

/** Minimal data-loading hook with manual reload, used across all pages. */
export function useAsync<T>(loader: () => Promise<T>, deps: DependencyList = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload: () => setNonce((value) => value + 1), setData };
}

export const platform = (): NodeJS.Platform => window.klymon?.platform ?? 'win32';
