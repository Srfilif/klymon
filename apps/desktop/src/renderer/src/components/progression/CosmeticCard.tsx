import { Check, Coins, Lock } from 'lucide-react';
import type { CosmeticModel } from '@klymon/shared-types';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { CosmeticPreview, RARITY_COLORS } from './CosmeticPreview';

interface Props {
  cosmetic: CosmeticModel;
  balance: number;
  busy: boolean;
  onBuy: (id: string) => void;
  onEquip: (id: string) => void;
  onUnequip: (slot: string) => void;
}

export function CosmeticCard({ cosmetic, balance, busy, onBuy, onEquip, onUnequip }: Props): React.JSX.Element {
  const { t, language } = useI18n();
  const rarityColor = RARITY_COLORS[cosmetic.rarity] ?? '#fff';
  const name = language === 'es' ? cosmetic.name.es : cosmetic.name.en;
  const description = language === 'es' ? cosmetic.description.es : cosmetic.description.en;

  const lockedText =
    cosmetic.lockedReason === 'level'
      ? t('prog.shop.locked.level', { level: cosmetic.minLevel })
      : cosmetic.lockedReason === 'funds'
        ? t('prog.shop.locked.funds', { points: cosmetic.price - balance })
        : cosmetic.lockedReason === 'quest'
          ? t('prog.shop.locked.quest')
          : null;

  return (
    <Card className={cn('overflow-hidden transition-colors', cosmetic.equipped && 'border-primary/60')} style={{ borderTop: `3px solid ${rarityColor}` }}>
      <CardContent className="flex flex-col gap-2.5 p-3">
        <CosmeticPreview slot={cosmetic.slot} visual={cosmetic.visual} rarity={cosmetic.rarity} />
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[13px] font-semibold">{name}</p>
            {cosmetic.equipped ? <Badge variant="success">{t('prog.shop.equipped')}</Badge> : null}
          </div>
          <p className="mt-0.5 line-clamp-2 min-h-7 text-[11px] text-muted-foreground">{description}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <Badge variant="outline">{t(`prog.slot.${cosmetic.slot}` as TranslationKey)}</Badge>
            <Badge variant="outline">{t(`prog.rarity.${cosmetic.rarity}` as TranslationKey)}</Badge>
            {cosmetic.minLevel > 1 ? <Badge variant="muted">Nv. {cosmetic.minLevel}</Badge> : null}
          </div>
        </div>

        {cosmetic.owned ? (
          cosmetic.equipped ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onUnequip(cosmetic.slot)}>
              {t('prog.shop.unequip')}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => onEquip(cosmetic.id)}>
              <Check className="size-3.5" /> {t('prog.shop.equip')}
            </Button>
          )
        ) : (
          <div className="flex flex-col gap-1.5">
            <Button size="sm" disabled={busy || cosmetic.lockedReason === 'level' || cosmetic.lockedReason === 'quest'} onClick={() => onBuy(cosmetic.id)}>
              <Coins className="size-3.5" />
              {cosmetic.price === 0 ? t('prog.shop.free') : t('prog.shop.buy', { price: cosmetic.price })}
            </Button>
            {lockedText ? (
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Lock className="size-3" /> {lockedText}
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
