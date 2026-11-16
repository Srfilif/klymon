import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleStop, Play, Terminal } from 'lucide-react';
import { invoke, useEvent, errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { formatDuration } from '../lib/utils';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { EmptyState, PageHeader, Progress, Stat } from '../components/ui/misc';

export function PlayPage(): React.JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { instances, activeInstance, activeAccount, setActiveInstanceId, launch, toast, downloads } = useApp();
  const [gameLines, setGameLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEvent('game:log', ({ line }) => setGameLines((current) => [...current.slice(-299), line]));

  const running = launch.phase === 'running';
  const launching = useMemo(
    () => ['validating', 'checking-java', 'installing', 'verifying', 'preparing', 'starting'].includes(launch.phase),
    [launch.phase],
  );

  const start = async (): Promise<void> => {
    if (!activeInstance) return;
    setBusy(true);
    try {
      await invoke('instances:launch', { id: activeInstance.id });
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (instances.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('play.title')} subtitle={t('play.subtitle')} />
        <EmptyState
          icon={<Play className="size-6" />}
          title={t('play.noInstances')}
          action={<Button onClick={() => navigate('/instances')}>{t('play.createInstance')}</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('play.title')} subtitle={t('play.subtitle')} />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('play.instance')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {instances.map((instance) => (
                <button
                  key={instance.id}
                  type="button"
                  onClick={() => setActiveInstanceId(instance.id)}
                  className={`focus-ring rounded-md border px-3 py-2 text-left transition-colors ${
                    activeInstance?.id === instance.id ? 'border-primary/60 bg-primary/10' : 'border-border bg-surface-raised/50 hover:border-border/80'
                  }`}
                >
                  <p className="truncate text-sm font-medium">{instance.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {instance.mcVersion} · {instance.loaderType === 'vanilla' ? 'Vanilla' : instance.loaderType} · {formatDuration(instance.playTimeSeconds)}
                  </p>
                </button>
              ))}
            </div>

            {activeInstance ? (
              <div className="grid gap-2 sm:grid-cols-4">
                <Stat label="Minecraft" value={activeInstance.mcVersion} />
                <Stat label={t('instances.loader')} value={activeInstance.loaderType === 'vanilla' ? 'Vanilla' : activeInstance.loaderType} hint={activeInstance.loaderVersion ?? undefined} />
                <Stat label={t('instances.maxMemory')} value={`${activeInstance.maxMemoryMb} MB`} />
                <Stat label={t('accounts.title')} value={activeAccount?.name ?? t('common.none')} />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg" onClick={() => void start()} loading={busy || launching} disabled={running || !activeInstance}>
                <Play className="size-4" /> {launching ? t('play.launching') : t('common.play')}
              </Button>
              <Button
                variant="destructive"
                size="lg"
                disabled={!running}
                onClick={() => {
                  void invoke('instances:kill').catch((error: unknown) => toast(errorMessage(error), 'error'));
                }}
              >
                <CircleStop className="size-4" /> {t('play.stop')}
              </Button>
              <Badge variant={running ? 'success' : launch.phase === 'failed' ? 'destructive' : 'muted'}>{launch.phase}</Badge>
            </div>

            {launch.phase !== 'idle' ? (
              <div className="flex flex-col gap-1">
                <Progress value={launch.progress} />
                <p className="text-[11px] text-muted-foreground">{launch.message}</p>
              </div>
            ) : null}

            {downloads.filter((entry) => entry.state === 'running').length > 0 ? (
              <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-surface-raised/40 p-2">
                <p className="text-[11px] font-medium">{t('play.downloads')}</p>
                {downloads
                  .filter((entry) => entry.state === 'running')
                  .map((entry) => (
                    <div key={entry.id}>
                      <p className="truncate text-[10px] text-muted-foreground">{entry.currentFile || entry.label}</p>
                      <Progress value={entry.totalBytes ? entry.receivedBytes / entry.totalBytes : 0} />
                    </div>
                  ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="flex min-h-[320px] flex-col">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Terminal className="size-4" /> {t('play.console')}
            </CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1">
            <div className="h-64 overflow-y-auto rounded-md bg-black/40 p-2 font-mono text-[10px] leading-relaxed">
              {gameLines.length === 0 ? <p className="text-muted-foreground">{t('console.empty')}</p> : null}
              {gameLines.map((line, index) => (
                <p key={index} className="whitespace-pre-wrap break-all text-foreground/80">
                  {line}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
