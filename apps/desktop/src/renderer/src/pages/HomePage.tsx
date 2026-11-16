import { useNavigate } from 'react-router-dom';
import { ArrowRight, Clock, Cpu, Download, Layers, Play, Puzzle, Sparkles } from 'lucide-react';
import type { ActivityEntry, NewsItem } from '@klymon/shared-types';
import { invoke, useAsync, errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { cn, formatBytes, formatDate, formatDuration } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { ClientCard } from '../components/ClientCard';
import { Badge } from '../components/ui/badge';
import { EmptyState, PageHeader, Progress, Spinner } from '../components/ui/misc';

const QUICK_LINKS = [
  { to: '/mods', labelKey: 'nav.mods', icon: Puzzle },
  { to: '/modpacks', labelKey: 'nav.modpacks', icon: Layers },
  { to: '/resourcepacks', labelKey: 'nav.resourcepacks', icon: Sparkles },
  { to: '/versions', labelKey: 'nav.versions', icon: Download },
] as const;

export function HomePage(): React.JSX.Element {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const { activeInstance, activeAccount, launch, downloads, instances, toast } = useApp();
  const activity = useAsync<ActivityEntry[]>(() => invoke('activity:list', { limit: 6 }), []);
  const news = useAsync<NewsItem[]>(() => invoke('news:list'), []);

  const launching = launch.phase !== 'idle' && launch.phase !== 'exited' && launch.phase !== 'failed';

  const startGame = async (): Promise<void> => {
    if (!activeInstance) {
      navigate('/instances');
      return;
    }
    try {
      await invoke('instances:launch', { id: activeInstance.id });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <ClientCard />

      <Card className="relative overflow-hidden border-primary/20">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-accent/10" aria-hidden />
        <CardContent className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              {activeAccount ? `${t('home.welcome')}, ${activeAccount.name}` : t('home.welcome')}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{activeInstance ? activeInstance.name : 'Klymon Launcher'}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {activeInstance ? (
                <>
                  <Badge variant="outline">Minecraft {activeInstance.mcVersion}</Badge>
                  <Badge variant={activeInstance.loaderType === 'vanilla' ? 'muted' : 'default'}>
                    {activeInstance.loaderType === 'vanilla' ? 'Vanilla' : `${activeInstance.loaderType} ${activeInstance.loaderVersion ?? ''}`}
                  </Badge>
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" /> {formatDuration(activeInstance.playTimeSeconds)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Cpu className="size-3" /> {activeInstance.maxMemoryMb} MB
                  </span>
                </>
              ) : (
                <span>{instances.length === 0 ? t('play.noInstances') : t('play.subtitle')}</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-2">
            <Button size="xl" onClick={() => void startGame()} loading={launching} className="min-w-52 shadow-xl shadow-primary/25">
              {!launching ? <Play className="size-5" /> : null}
              {launching ? t('play.launching') : t('common.play')}
            </Button>
            {launch.phase !== 'idle' && launch.phase !== 'exited' ? (
              <div className="flex flex-col gap-1">
                <Progress value={launch.progress} />
                <p className="truncate text-[10px] text-muted-foreground">{launch.message}</p>
              </div>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => navigate('/instances')}>
              {t('nav.instances')} <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {downloads.some((entry) => entry.state === 'running') ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('play.downloads')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {downloads
              .filter((entry) => entry.state === 'running' || entry.state === 'queued')
              .map((entry) => (
                <div key={entry.id}>
                  <div className="flex items-center justify-between gap-3 text-[11px]">
                    <p className="truncate">{entry.label}</p>
                    <p className="shrink-0 text-muted-foreground">
                      {formatBytes(entry.receivedBytes)} / {formatBytes(entry.totalBytes)}
                    </p>
                  </div>
                  <Progress className="mt-1" value={entry.totalBytes ? entry.receivedBytes / entry.totalBytes : 0} />
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        {QUICK_LINKS.map(({ to, labelKey, icon: Icon }) => (
          <button
            key={to}
            type="button"
            onClick={() => navigate(to)}
            className="focus-ring glass flex items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:border-primary/40"
          >
            <span className="grid size-9 place-items-center rounded-md bg-primary/15 text-primary">
              <Icon className="size-4" />
            </span>
            <span className="text-sm font-medium">{t(labelKey)}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="flex flex-col">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm">{t('home.news')}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/news')}>
              {t('common.all')}
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {news.loading ? <Spinner /> : null}
            {news.error ? <p className="text-xs text-destructive">{news.error}</p> : null}
            {(news.data ?? []).slice(0, 4).map((item) => (
              <article key={item.id} className="flex gap-3">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="size-14 shrink-0 rounded-md object-cover" loading="lazy" />
                ) : (
                  <div className="size-14 shrink-0 rounded-md bg-muted" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{item.title}</p>
                  <p className="line-clamp-2 text-[11px] text-muted-foreground">{item.summary}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/70">{formatDate(item.publishedAt)}</p>
                </div>
              </article>
            ))}
            {!news.loading && (news.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">{t('news.empty')}</p> : null}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-sm">{t('home.activity')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {activity.loading ? <Spinner /> : null}
            {!activity.loading && (activity.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('home.noActivity')}</p>
            ) : null}
            {(activity.data ?? []).map((entry) => (
              <div key={entry.id} className={cn('flex items-start gap-2 border-b border-border/40 pb-2 last:border-0')}>
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/70" />
                <div className="min-w-0">
                  <p className="truncate text-[11px]">{entry.message}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatDate(entry.createdAt)}
                    {entry.detail ? ` · ${entry.detail}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {instances.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-6" />}
          title={t('play.noInstances')}
          description={language === 'es' ? 'Las instancias aíslan mods, mundos y configuraciones.' : 'Instances isolate mods, worlds and configs.'}
          action={
            <Button onClick={() => navigate('/instances')}>
              <Layers className="size-4" /> {t('play.createInstance')}
            </Button>
          }
        />
      ) : null}
    </div>
  );
}
