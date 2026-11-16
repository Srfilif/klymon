import { useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Boxes,
  Download,
  LayoutDashboard,
  Layers,
  Music,
  Newspaper,
  Package,
  Palette,
  Play,
  Puzzle,
  Settings as SettingsIcon,
  Shirt,
  Sparkles,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../../lib/app-context';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { cn, formatSpeed, shortUuid } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Progress, Spinner } from '../ui/misc';
import { ConsoleDrawer } from './ConsoleDrawer';
import { CrashDialog } from './CrashDialog';
import { MusicMiniPlayer } from './MusicMiniPlayer';

const NAV_ITEMS: { to: string; labelKey: TranslationKey; icon: typeof Play }[] = [
  { to: '/', labelKey: 'nav.home', icon: LayoutDashboard },
  { to: '/play', labelKey: 'nav.play', icon: Play },
  { to: '/versions', labelKey: 'nav.versions', icon: Layers },
  { to: '/instances', labelKey: 'nav.instances', icon: Boxes },
  { to: '/mods', labelKey: 'nav.mods', icon: Puzzle },
  { to: '/modpacks', labelKey: 'nav.modpacks', icon: Package },
  { to: '/resourcepacks', labelKey: 'nav.resourcepacks', icon: Palette },
  { to: '/shaders', labelKey: 'nav.shaders', icon: Sparkles },
  { to: '/accounts', labelKey: 'nav.accounts', icon: Users },
  { to: '/skins', labelKey: 'nav.skins', icon: Shirt },
  { to: '/music', labelKey: 'nav.music', icon: Music },
  { to: '/news', labelKey: 'nav.news', icon: Newspaper },
  { to: '/settings', labelKey: 'nav.settings', icon: SettingsIcon },
];

export function Shell(): React.JSX.Element {
  const { t } = useI18n();
  const { settings, activeAccount, launch, downloads, toasts, dismissToast, instances } = useApp();
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);

  const activeDownloads = useMemo(() => downloads.filter((entry) => entry.state === 'running' || entry.state === 'queued'), [downloads]);
  const runningInstance = instances.find((instance) => instance.id === launch.instanceId);

  return (
    <div className="relative flex h-full flex-col">
      {settings?.backgroundImage ? (
        <div className="app-background-image" style={{ backgroundImage: `url(${settings.backgroundImage})` }} aria-hidden />
      ) : null}
      <div className="relative z-10 flex min-h-0 flex-1">
        <aside className="flex w-[236px] shrink-0 flex-col gap-4 border-r border-border/70 bg-surface/70 px-3 py-4 backdrop-blur-xl">
          <div className="flex items-center gap-2.5 px-2">
            <div className="grid size-9 place-items-center rounded-md bg-gradient-to-br from-primary to-accent text-base font-black text-white shadow-lg shadow-primary/30">
              K
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">Klymon</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Launcher</p>
            </div>
          </div>

          <NavLink
            to="/accounts"
            className="focus-ring flex items-center gap-2.5 rounded-md border border-border/60 bg-surface-raised/60 px-2.5 py-2 hover:border-primary/40"
          >
            {activeAccount ? (
              <>
                <div className="grid size-8 shrink-0 place-items-center rounded-sm bg-primary/20 text-xs font-bold uppercase text-primary">
                  {activeAccount.name.slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{activeAccount.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {activeAccount.type === 'microsoft' ? t('accounts.premium') : `${t('accounts.offline')} · ${shortUuid(activeAccount.uuid)}`}
                  </p>
                </div>
                <span className={cn('size-1.5 rounded-full', activeAccount.sessionValid ? 'bg-success' : 'bg-warning')} />
              </>
            ) : (
              <>
                <div className="grid size-8 shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground">
                  <Users className="size-4" />
                </div>
                <p className="text-xs text-muted-foreground">{t('accounts.empty')}</p>
              </>
            )}
          </NavLink>

          <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1" aria-label="Main">
            {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'focus-ring flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                    isActive && 'bg-primary/15 text-foreground shadow-inner',
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{t(labelKey)}</span>
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => setConsoleOpen(true)}
            className="focus-ring flex items-center justify-between rounded-md border border-border/60 bg-surface-raised/50 px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <span className="flex items-center gap-2">
              <Terminal className="size-3.5" />
              {t('nav.console')}
            </span>
            <Badge variant={launch.phase === 'running' ? 'success' : 'muted'}>{launch.phase}</Badge>
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-surface/40 px-5 backdrop-blur-xl">
            <div className="flex min-w-0 items-center gap-3">
              {launch.phase !== 'idle' ? (
                <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-surface-raised/70 px-2.5 py-1">
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      launch.phase === 'running' ? 'bg-success' : launch.phase === 'failed' ? 'bg-destructive' : 'bg-primary',
                    )}
                  />
                  <p className="max-w-[380px] truncate text-[11px] text-muted-foreground">
                    {runningInstance ? `${runningInstance.name} — ` : ''}
                    {launch.message || launch.phase}
                  </p>
                  {launch.phase !== 'running' && launch.phase !== 'failed' && launch.phase !== 'exited' ? (
                    <div className="w-24">
                      <Progress value={launch.progress} />
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  {settings?.showLogConsole ? t('home.ready') : 'Klymon Launcher'}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="icon" onClick={() => setDownloadsOpen((value) => !value)} aria-label={t('downloads.title')}>
                <Download className={cn('size-4', activeDownloads.length > 0 && 'text-primary')} />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setConsoleOpen(true)} aria-label={t('console.title')}>
                <Terminal className="size-4" />
              </Button>
            </div>
          </header>

          {downloadsOpen ? (
            <div className="border-b border-border/60 bg-surface/70 px-5 py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium">{t('downloads.title')}</p>
                <Button variant="ghost" size="icon" onClick={() => setDownloadsOpen(false)} aria-label={t('common.close')}>
                  <X className="size-3.5" />
                </Button>
              </div>
              {downloads.length === 0 ? <p className="text-[11px] text-muted-foreground">{t('console.empty')}</p> : null}
              <div className="flex flex-col gap-2">
                {downloads.slice(-4).map((entry) => (
                  <div key={entry.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="truncate text-[11px]">{entry.label}</p>
                        <p className="shrink-0 text-[10px] text-muted-foreground">
                          {formatSpeed(entry.bytesPerSecond)} · {entry.completedFiles}/{entry.totalFiles} {t('downloads.files')}
                        </p>
                      </div>
                      <Progress value={entry.totalBytes > 0 ? entry.receivedBytes / entry.totalBytes : entry.completedFiles / Math.max(entry.totalFiles, 1)} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-24">
              <Outlet />
            </div>
          </main>

          <MusicMiniPlayer />
        </div>
      </div>

      <ConsoleDrawer open={consoleOpen} onOpenChange={setConsoleOpen} />
      <CrashDialog />

      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-xs shadow-xl backdrop-blur',
              toast.variant === 'error'
                ? 'border-destructive/40 bg-destructive/15 text-destructive'
                : toast.variant === 'success'
                  ? 'border-success/40 bg-success/15 text-success'
                  : 'border-border bg-surface-raised/95 text-foreground',
            )}
          >
            <p className="flex-1">{toast.message}</p>
            <button type="button" onClick={() => dismissToast(toast.id)} aria-label={t('common.close')}>
              <X className="size-3.5 opacity-70" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LaunchOverlayFallback(): React.JSX.Element {
  return (
    <div className="grid h-full place-items-center">
      <Spinner label="…" />
    </div>
  );
}
