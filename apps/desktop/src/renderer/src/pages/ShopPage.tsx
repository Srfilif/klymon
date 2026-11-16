import { useState } from 'react';
import { Coins, RotateCcw } from 'lucide-react';
import type { CosmeticModel } from '@klymon/shared-types';
import { errorMessage, invoke, useAsync, useEvent } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { useProgressionProfile } from '../lib/progression';
import { cn } from '../lib/utils';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { EmptyState, PageHeader, Spinner } from '../components/ui/misc';
import { CosmeticCard } from '../components/progression/CosmeticCard';

const SLOTS = ['all', 'cape', 'wings', 'hat', 'particles', 'aura', 'trail', 'pet', 'emote', 'entrance', 'profile'] as const;
const RARITIES = ['all', 'common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

export function ShopPage(): React.JSX.Element {
  const { t } = useI18n();
  const { toast } = useApp();
  const profile = useProgressionProfile();
  const catalog = useAsync<CosmeticModel[]>(() => invoke('progression:catalog'), []);
  const [slot, setSlot] = useState<(typeof SLOTS)[number]>('all');
  const [rarity, setRarity] = useState<(typeof RARITIES)[number]>('all');
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEvent('data:changed', ({ scope }) => {
    if (scope === 'progression') catalog.reload();
  });

  const run = async (id: string, action: () => Promise<unknown>): Promise<void> => {
    setBusyId(id);
    try {
      await action();
      catalog.reload();
      profile.reload();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const items = (catalog.data ?? []).filter(
    (entry) => (slot === 'all' || entry.slot === slot) && (rarity === 'all' || entry.rarity === rarity) && (!ownedOnly || entry.owned),
  );
  const balance = profile.data?.balance ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('prog.shop.title')}
        subtitle={t('prog.shop.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="flex items-center gap-1.5 px-3 py-1.5 text-sm">
              <Coins className="size-4 text-warning" />
              <span className="font-bold">{balance}</span>
              <span className="text-muted-foreground">{t('prog.points')}</span>
            </Badge>
            <Button variant="ghost" size="icon" onClick={() => { catalog.reload(); profile.reload(); }} aria-label={t('common.retry')}>
              <RotateCcw className="size-4" />
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {SLOTS.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setSlot(entry)}
            className={cn(
              'focus-ring rounded-md border px-2.5 py-1 text-xs transition-colors',
              slot === entry ? 'border-primary/60 bg-primary/15 text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}
          >
            {entry === 'all' ? t('prog.shop.all') : t(`prog.slot.${entry}` as TranslationKey)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {RARITIES.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setRarity(entry)}
            className={cn(
              'focus-ring rounded-md border px-2.5 py-1 text-xs transition-colors',
              rarity === entry ? 'border-primary/60 bg-primary/15 text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}
          >
            {entry === 'all' ? t('prog.shop.all') : t(`prog.rarity.${entry}` as TranslationKey)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOwnedOnly((value) => !value)}
          className={cn(
            'focus-ring ml-2 rounded-md border px-2.5 py-1 text-xs transition-colors',
            ownedOnly ? 'border-primary/60 bg-primary/15 text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
          )}
        >
          {t('prog.shop.inventory')}
        </button>
      </div>

      {catalog.loading ? <Spinner label={t('common.loading')} /> : null}
      {catalog.error ? <p className="text-xs text-destructive">{catalog.error}</p> : null}
      {!catalog.loading && !catalog.error && items.length === 0 ? (
        <EmptyState title={t('prog.shop.empty')} description={t('prog.localOnly')} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((entry) => (
          <CosmeticCard
            key={entry.id}
            cosmetic={entry}
            balance={balance}
            busy={busyId === entry.id}
            onBuy={(id) => void run(id, () => invoke('progression:buy', { id }))}
            onEquip={(id) => void run(id, () => invoke('progression:equip', { id }))}
            onUnequip={(slotName) => void run(entry.id, () => invoke('progression:unequip', { slot: slotName }))}
          />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('prog.localOnly')}</p>
    </div>
  );
}
