import { useEffect, useState } from 'react';
import { Coins, Gamepad2, ShieldAlert } from 'lucide-react';
import type { LedgerEntryModel, LiveSessionModel } from '@klymon/shared-types';
import { errorMessage, invoke, useAsync, useEvent } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { useProgressionProfile } from '../lib/progression';
import { cn, formatDate, formatDuration } from '../lib/utils';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { PageHeader, Progress, Section, Spinner, Stat } from '../components/ui/misc';

export function ProfilePage(): React.JSX.Element {
  const { t, language } = useI18n();
  const { toast, activeAccount, launch } = useApp();
  const profile = useProgressionProfile();
  const ledger = useAsync<LedgerEntryModel[]>(() => invoke('progression:ledger', { limit: 60 }), []);
  const [busyTitle, setBusyTitle] = useState(false);
  const [live, setLive] = useState<LiveSessionModel | null>(null);

  useEvent('data:changed', ({ scope }) => {
    if (scope === 'progression') ledger.reload();
  });

  useEffect(() => {
    if (launch.phase !== 'running') {
      setLive(null);
      return;
    }
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const session = await invoke('progression:session');
        if (!cancelled) setLive(session.running ? session : null);
      } catch {
        if (!cancelled) setLive(null);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [launch.phase]);

  const setTitle = async (titleId: string | null): Promise<void> => {
    setBusyTitle(true);
    try {
      await invoke('progression:set-title', { titleId });
      profile.reload();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusyTitle(false);
    }
  };

  const data = profile.data;
  const lang = language === 'es' ? 'es' : 'en';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('prog.profile.title')} subtitle={t('prog.profile.subtitle')} />

      {profile.loading ? <Spinner label={t('common.loading')} /> : null}
      {profile.error ? <p className="text-xs text-destructive">{profile.error}</p> : null}

      {data ? (
        <>
          <Card className="relative overflow-hidden border-primary/20">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-accent/10" aria-hidden />
            <CardContent className="relative flex flex-col gap-5 p-6 md:flex-row md:items-center">
              <div className="grid size-20 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-accent text-3xl font-black text-white shadow-lg shadow-primary/30">
                {(activeAccount?.name ?? '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-xs font-black tracking-wide"
                    style={{ color: data.identity.rankColor, background: `${data.identity.rankColor}22`, border: `1px solid ${data.identity.rankColor}66` }}
                  >
                    {data.identity.rankPrefix}
                  </span>
                  <h2 className="truncate text-2xl font-semibold tracking-tight">{activeAccount?.name ?? 'Jugador'}</h2>
                  {data.identity.titleText ? (
                    <span className="text-sm" style={{ color: data.identity.titleColor ?? undefined }}>
                      · {data.identity.titleText[lang]}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">
                    {t('prog.level')} {data.level.level}
                  </Badge>
                  <Badge variant="outline" className="flex items-center gap-1">
                    <Coins className="size-3 text-warning" /> {data.balance} {t('prog.points')}
                  </Badge>
                  <Badge variant="muted">
                    {t('prog.profile.rank')}: {data.identity.rankId}
                  </Badge>
                </div>
                <div className="mt-3 max-w-md">
                  <Progress value={data.level.fraction} />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t('prog.nextLevel', { points: data.level.neededForLevel - data.level.intoLevel, level: data.level.level + 1 })}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-6 text-center">
                <div>
                  <p className="text-xl font-bold text-success">+{data.lifetimePoints}</p>
                  <p className="text-[11px] text-muted-foreground">{t('prog.earned')}</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-destructive">−{data.spentPoints}</p>
                  <p className="text-[11px] text-muted-foreground">{t('prog.spent')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {live ? (
            <Card className="border-success/40">
              <CardContent className="flex items-center gap-3 p-4">
                <span className="relative flex size-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex size-3 rounded-full bg-success" />
                </span>
                <Gamepad2 className="size-5 text-success" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {t('prog.session.live')} · {formatDuration(live.elapsedSeconds)}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {live.instanceName ?? ''} ·{' '}
                    {live.source === 'heartbeat' ? t('prog.session.source.heartbeat') : t('prog.session.source.wall')}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {!data.integrityOk ? (
            <Card className="border-warning/40">
              <CardContent className="flex items-center gap-2 p-4 text-xs text-warning">
                <ShieldAlert className="size-4" />
                {language === 'es'
                  ? 'Los contadores locales parecen editados fuera del launcher. Se conservan, pero no son verificables.'
                  : 'Local counters look edited outside the launcher. They are kept, but they are not verifiable.'}
              </CardContent>
            </Card>
          ) : null}

          <Section title={t('prog.profile.stats')}>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label={t('prog.profile.playtime')} value={formatDuration(data.playSeconds)} />
              <Stat label={t('prog.profile.sessions')} value={data.sessions} />
              <Stat label={t('prog.profile.days')} value={data.daysUsed} />
              <Stat label={t('prog.profile.streak')} value={data.streakCount} />
              <Stat label={t('prog.profile.cosmetics')} value={data.inventoryCount} />
              <Stat label={t('prog.profile.firstSeen')} value={formatDate(data.firstSeenAt)} />
            </div>
          </Section>

          <Section title={t('prog.profile.title.label')}>
            <Card>
              <CardContent className="flex flex-wrap gap-1.5 p-4">
                <TitleChip selected={data.identity.titleId === null} disabled={busyTitle} label={t('prog.profile.title.none')} onClick={() => void setTitle(null)} />
                {data.identity.ownedTitleIds.map((titleId) => (
                  <TitleChip
                    key={titleId}
                    selected={data.identity.titleId === titleId}
                    disabled={busyTitle}
                    label={titleId}
                    onClick={() => void setTitle(titleId)}
                  />
                ))}
              </CardContent>
            </Card>
          </Section>

          <Section title={t('prog.profile.loadout')}>
            <Card>
              <CardContent className="flex flex-wrap gap-1.5 p-4">
                {Object.entries(data.loadout).filter(([, id]) => id).length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('common.empty')}</p>
                ) : (
                  Object.entries(data.loadout)
                    .filter(([, id]) => id)
                    .map(([slot, id]) => (
                      <Badge key={slot} variant="outline">
                        {slot}: {id}
                      </Badge>
                    ))
                )}
              </CardContent>
            </Card>
          </Section>

          <Section title={t('prog.profile.history')}>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm">{t('prog.balance')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5">
                {ledger.loading ? <Spinner /> : null}
                {!ledger.loading && (ledger.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('prog.profile.noHistory')}</p>
                ) : null}
                {(ledger.data ?? []).slice(0, 30).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-3 border-b border-border/40 pb-1.5 text-[11px] last:border-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{entry.source}</p>
                      <p className="truncate text-muted-foreground">
                        {formatDate(entry.createdAt)}
                        {entry.detail ? ` · ${entry.detail}` : ''}
                      </p>
                    </div>
                    <p className={cn('shrink-0 font-bold', entry.delta >= 0 ? 'text-success' : 'text-destructive')}>
                      {entry.delta >= 0 ? `+${entry.delta}` : entry.delta}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </Section>
        </>
      ) : null}
      <p className="text-[11px] text-muted-foreground">{t('prog.localOnly')}</p>
    </div>
  );
}

function TitleChip({ selected, disabled, label, onClick }: { selected: boolean; disabled: boolean; label: string; onClick: () => void }): React.JSX.Element {
  return (
    <Button variant={selected ? 'default' : 'ghost'} size="sm" disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  );
}
