import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, KlymonClient, type PublicUser } from '@klymon/api-client';

const REFRESH_KEY = 'klymon.admin.refreshToken';

interface SessionValue {
  client: KlymonClient;
  user: PublicUser | null;
  isAdmin: boolean | null;
  loading: boolean;
  error: string | null;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(
    () =>
      new KlymonClient({
        baseUrl: (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3001',
        storage: {
          loadRefresh: () => localStorage.getItem(REFRESH_KEY),
          saveRefresh: (token) => {
            if (token) localStorage.setItem(REFRESH_KEY, token);
            else localStorage.removeItem(REFRESH_KEY);
          },
        },
      }),
    [],
  );

  const refreshSession = useCallback(async () => {
    if (!client.signedIn) {
      setUser(null);
      setIsAdmin(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [profile, stats] = await Promise.allSettled([client.me(), client.adminStats()]);
      if (profile.status === 'rejected') throw profile.reason;
      setUser(profile.value);
      setIsAdmin(stats.status === 'fulfilled');
    } catch (err) {
      setUser(null);
      setIsAdmin(null);
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la sesión.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const logout = useCallback(async () => {
    await client.logout();
    setUser(null);
    setIsAdmin(null);
  }, [client]);

  const value = useMemo(
    () => ({ client, user, isAdmin, loading, error, refreshSession, logout }),
    [client, user, isAdmin, loading, error, refreshSession, logout],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider.');
  return value;
}

export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Algo salió mal. Inténtalo de nuevo.';
}
