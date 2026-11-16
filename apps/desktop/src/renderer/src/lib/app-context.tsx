import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Account, DownloadStatus, Instance, LaunchState, Settings } from '@klymon/shared-types';
import { invoke, useEvent, errorMessage } from './api';
import { useI18n } from './i18n';

export interface Toast {
  id: number;
  message: string;
  variant: 'info' | 'success' | 'error';
}

interface AppContextValue {
  ready: boolean;
  settings: Settings | null;
  accounts: Account[];
  instances: Instance[];
  activeAccount: Account | null;
  activeInstance: Instance | null;
  activeInstanceId: string | null;
  launch: LaunchState;
  downloads: DownloadStatus[];
  toasts: Toast[];
  setActiveInstanceId: (id: string | null) => void;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  refreshAccounts: () => Promise<void>;
  refreshInstances: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  toast: (message: string, variant?: Toast['variant']) => void;
  dismissToast: (id: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const IDLE_LAUNCH: LaunchState = {
  instanceId: null,
  phase: 'idle',
  message: '',
  progress: 0,
  pid: null,
  exitCode: null,
  startedAt: null,
};

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { setLanguage } = useI18n();
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [activeInstanceId, setActiveInstanceIdState] = useState<string | null>(null);
  const [launch, setLaunch] = useState<LaunchState>(IDLE_LAUNCH);
  const [downloads, setDownloads] = useState<DownloadStatus[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, variant: Toast['variant'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, variant }]);
    setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), 6000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const refreshAccounts = useCallback(async () => {
    setAccounts(await invoke('accounts:list'));
  }, []);

  const refreshInstances = useCallback(async () => {
    setInstances(await invoke('instances:list'));
  }, []);

  const refreshSettings = useCallback(async () => {
    const value = await invoke('settings:get');
    setSettings(value);
    setLanguage(value.language);
  }, [setLanguage]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [loadedSettings, loadedAccounts, loadedInstances, loadedDownloads] = await Promise.all([
        invoke('settings:get'),
        invoke('accounts:list'),
        invoke('instances:list'),
        invoke('downloads:status'),
      ]);
      if (cancelled) return;
      setSettings(loadedSettings);
      setLanguage(loadedSettings.language);
      setAccounts(loadedAccounts);
      setInstances(loadedInstances);
      setDownloads(loadedDownloads);
      const stored = localStorage.getItem('klymon.activeInstance');
      const initial = loadedInstances.find((instance) => instance.id === stored) ?? loadedInstances[0] ?? null;
      setActiveInstanceIdState(initial?.id ?? null);
      setReady(true);
    })().catch((error: unknown) => {
      if (!cancelled) toast(errorMessage(error), 'error');
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [setLanguage, toast]);

  useEvent('data:changed', ({ scope }) => {
    void (async () => {
      if (scope === 'accounts') await refreshAccounts();
      if (scope === 'instances') await refreshInstances();
      if (scope === 'settings') await refreshSettings();
    })();
  });

  useEvent('launch:state', (state) => setLaunch(state));

  useEvent('progression:reward', (reward) => {
    toast(`${reward.title} — ${reward.detail}`, 'success');
  });

  useEvent('download:progress', (status) => {
    setDownloads((current) => {
      const next = current.filter((entry) => entry.id !== status.id);
      next.push(status);
      return next.slice(-6);
    });
  });

  const activeInstance = useMemo(
    () => instances.find((instance) => instance.id === activeInstanceId) ?? instances[0] ?? null,
    [instances, activeInstanceId],
  );

  const activeAccount = useMemo(() => accounts.find((account) => account.active) ?? accounts[0] ?? null, [accounts]);

  const setActiveInstanceId = useCallback((id: string | null) => {
    setActiveInstanceIdState(id);
    if (id) localStorage.setItem('klymon.activeInstance', id);
    else localStorage.removeItem('klymon.activeInstance');
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      try {
        const next = await invoke('settings:update', patch);
        setSettings(next);
        setLanguage(next.language);
        toast('✓', 'success');
      } catch (error) {
        toast(errorMessage(error), 'error');
        throw error;
      }
    },
    [setLanguage, toast],
  );

  // Theme, accent, font scale and background are applied at the document level.
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    root.classList.toggle('light', settings.theme === 'light');
    root.classList.toggle('dark', settings.theme === 'dark');
    root.style.setProperty('--primary', settings.accentColor);
    root.style.setProperty('--ring', settings.accentColor);
    root.style.fontSize = `${Math.round(14 * settings.fontScale)}px`;
    root.dataset.reducedMotion = settings.reducedMotion ? 'true' : 'false';
  }, [settings]);

  const value: AppContextValue = {
    ready,
    settings,
    accounts,
    instances,
    activeAccount,
    activeInstance,
    activeInstanceId: activeInstance?.id ?? null,
    launch,
    downloads,
    toasts,
    setActiveInstanceId,
    updateSettings,
    refreshAccounts,
    refreshInstances,
    refreshSettings,
    toast,
    dismissToast,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}
