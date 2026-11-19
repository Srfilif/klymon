import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, KlymonClient, type PublicUser } from '@klymon/api-client';

const REFRESH_KEY = 'klymon.refreshToken';

function createClient(onAuthChange: (signedIn: boolean) => void): KlymonClient {
  return new KlymonClient({
    baseUrl: (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3001',
    storage: {
      loadRefresh: () => localStorage.getItem(REFRESH_KEY),
      saveRefresh: (token) => {
        if (token) localStorage.setItem(REFRESH_KEY, token);
        else localStorage.removeItem(REFRESH_KEY);
      },
    },
    onAuthChange,
  });
}

interface SessionValue {
  client: KlymonClient;
  user: PublicUser | null;
  loading: boolean;
  error: string | null;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(() => createClient(() => undefined), []);

  const refreshUser = useCallback(async () => {
    if (!client.signedIn) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setUser(await client.me());
    } catch (err) {
      setUser(null);
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la sesión.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const logout = useCallback(async () => {
    await client.logout();
    setUser(null);
  }, [client]);

  const value = useMemo(() => ({ client, user, loading, error, refreshUser, logout }), [client, user, loading, error, refreshUser, logout]);
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
