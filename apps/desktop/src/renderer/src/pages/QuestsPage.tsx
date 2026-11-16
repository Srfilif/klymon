import { useState } from 'react';
import { Award, CalendarDays, Gift, Trophy } from 'lucide-react';
import type { DailyStateModel, QuestStateModel } from '@klymon/shared-types';
import { errorMessage, invoke, useAsync, useEvent } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { useProgressionProfile } from '../lib/progression';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { PageHeader, Progress, Section, Spinner } from '../components/ui/misc';

interface QuestGroups {
  daily: QuestStateModel[];
  weekly: QuestStateModel[];
  achievements: QuestStateModel[];
}

export function QuestsPage(): React.JSX.Element {
  const { t, language } = useI18n();
  const { toast } = useApp();
  const profile = useProgressionProfile();
  const quests = useAsync<QuestGroups>(() => invoke('progression:quests'), []);
  const daily = useAsync<DailyStateModel>(() => invoke('progression:daily'), []);
  const [busy, setBusy] = useState<string | null>(null);

  useEvent('data:changed', ({ scope }) => {
    if (scope === 'progression') {
      quests.reload();
      daily.reload();
    }
  });

  const claimQuest = async (id: string): Promise<void> => {
    setBusy(id);
    try {
      await invoke('progression:claim-quest', { id });
      quests.reload();
      daily.reload();
      profile.reload();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const claimDaily = async (): Promise<void> => {
    setBusy('daily');
    try {
      await invoke('progression:claim-daily');
      quests.reload();
      daily.reload();
      profile.reload();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const lang = language === 'es' ? 'es' : 'en';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('prog.quests.title')} subtitle={t('prog.quests.subtitle')} />

      <Card className="border-warning/30">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-md bg-warning/15 text-warning">
              <Gift className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">{t('prog.daily.title')}</p>
              <p className="text-xs text-muted-foreground">
                {daily.data ? t('prog.daily.streak', { days: daily.data.streak }) : '…'} · +{daily.data?.nextReward ?? 0} {t('prog.points')}
              </p>
            </div>
          </div>
          {daily.loading ? (
            <Spinner />
          ) : daily.data?.canClaim ? (
            <Button onClick={() => void claimDaily()} loading={busy === 'daily'}>
              {t('prog.daily.claim')} · +{daily.data.nextReward}
            </Button>
          ) : (
            <Badge variant="success">{t('prog.daily.claimed')}</Badge>
          )}
        </CardContent>
      </Card>

      {quests.loading ? <Spinner label={t('common.loading')} /> : null}
      {quests.error ? <p className="text-xs text-destructive">{quests.error}</p> : null}

      {quests.data ? (
        <>
          <Section title={t('prog.quests.daily')}>
            <div className="grid gap-3 md:grid-cols-3">
              {quests.data.daily.map((quest) => (
                <QuestCard key={quest.id} quest={quest} lang={lang} busy={busy === quest.id} onClaim={() => void claimQuest(quest.id)} icon={<CalendarDays className="size-4" />} />
              ))}
            </div>
          </Section>
          <Section title={t('prog.quests.weekly')}>
            <div className="grid gap-3 md:grid-cols-3">
              {quests.data.weekly.map((quest) => (
                <QuestCard key={quest.id} quest={quest} lang={lang} busy={busy === quest.id} onClaim={() => void claimQuest(quest.id)} icon={<Award className="size-4" />} />
              ))}
            </div>
          </Section>
          <Section title={t('prog.quests.achievements')}>
            <div className="grid gap-3 md:grid-cols-3">
              {quests.data.achievements.map((quest) => (
                <QuestCard key={quest.id} quest={quest} lang={lang} busy={busy === quest.id} onClaim={() => void claimQuest(quest.id)} icon={<Trophy className="size-4" />} />
              ))}
            </div>
          </Section>
        </>
      ) : null}
      <p className="text-[11px] text-muted-foreground">{t('prog.localOnly')}</p>
    </div>
  );
}

function QuestCard({
  quest,
  lang,
  busy,
  onClaim,
  icon,
}: {
  quest: QuestStateModel;
  lang: 'es' | 'en';
  busy: boolean;
  onClaim: () => void;
  icon: React.ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Card className={quest.completed && !quest.claimed ? 'border-success/40' : undefined}>
      <CardHeader className="flex-row items-center gap-2 pb-1">
        <span className="grid size-8 place-items-center rounded-md bg-primary/15 text-primary">{icon}</span>
        <CardTitle className="text-[13px]">{quest.name[lang]}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="min-h-7 text-[11px] text-muted-foreground">{quest.description[lang]}</p>
        <Progress value={quest.target > 0 ? quest.progress / quest.target : 0} />
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">{t('prog.quests.progress', { done: quest.progress, target: quest.target })}</span>
          <span className="font-semibold text-warning">{t('prog.quests.reward', { points: quest.points })}</span>
        </div>
        {quest.cosmeticId ? <Badge variant="outline">{t('prog.quests.grants')}</Badge> : null}
        {quest.claimed ? (
          <Badge variant="muted">{t('prog.quests.claimed')}</Badge>
        ) : quest.completed ? (
          <Button size="sm" onClick={onClaim} loading={busy}>
            {t('prog.quests.claim')}
          </Button>
        ) : (
          <Badge variant="outline">{t('prog.quests.progress', { done: quest.progress, target: quest.target })}</Badge>
        )}
      </CardContent>
    </Card>
  );
}
