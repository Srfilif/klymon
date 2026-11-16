import type { CSSProperties } from 'react';
import type { CosmeticVisualModel, CosmeticSlotModel } from '@klymon/shared-types';
import { cn } from '../../lib/utils';

export const RARITY_COLORS: Record<string, string> = {
  common: '#9aa4b2',
  uncommon: '#3ddc84',
  rare: '#3b9ff0',
  epic: '#b15df0',
  legendary: '#f5a623',
};

/**
 * Live CSS preview of a procedural cosmetic. It mirrors the in-game look
 * (same color palette + effect family) without pretending to be the game.
 */
export function CosmeticPreview({ slot, visual, rarity }: { slot: CosmeticSlotModel; visual: CosmeticVisualModel; rarity: string }): React.JSX.Element {
  const [primary, secondary] = [visual.colors[0] ?? '#22d3ee', visual.colors[1] ?? visual.colors[0] ?? '#0e7490'];
  const glow: CSSProperties = { ['--glow' as string]: primary, ['--glow2' as string]: secondary };

  return (
    <div className="preview-stage relative h-28 overflow-hidden rounded-md bg-[#0b1117]" style={glow} aria-hidden>
      <div
        className="absolute inset-0 opacity-40"
        style={{ background: `radial-gradient(ellipse 80% 70% at 50% 110%, ${primary}55, transparent 70%)` }}
      />
      {/* Player silhouette anchor */}
      <div className="absolute bottom-2 left-1/2 h-14 w-7 -translate-x-1/2 rounded-t-md bg-gradient-to-b from-slate-500/80 to-slate-700/80" />
      <div className="absolute bottom-[60px] left-1/2 size-5 -translate-x-1/2 rounded-[4px] bg-gradient-to-b from-slate-400/90 to-slate-600/90" />

      {slot === 'cape' ? (
        <div
          className="absolute bottom-2 left-1/2 h-[72px] w-9 -translate-x-[10%] rounded-b-lg opacity-90"
          style={{ background: `linear-gradient(180deg, ${primary}, ${secondary})`, clipPath: 'polygon(8% 0, 92% 0, 100% 100%, 0 100%)' }}
        />
      ) : null}
      {slot === 'wings' ? <Wings primary={primary} secondary={secondary} /> : null}
      {slot === 'hat' ? (
        <div className="absolute bottom-[76px] left-1/2 h-4 w-8 -translate-x-1/2 rounded-t-full opacity-95" style={{ background: `linear-gradient(180deg, ${primary}, ${secondary})` }} />
      ) : null}
      {slot === 'aura' ? (
        <div className="absolute bottom-1 left-1/2 h-3 w-24 -translate-x-1/2 rounded-full opacity-80 blur-[1px]" style={{ background: primary, boxShadow: `0 0 18px 4px ${primary}` }} />
      ) : null}
      {slot === 'particles' || slot === 'trail' || slot === 'entrance' ? <Motes color={primary} /> : null}
      {slot === 'pet' ? (
        <div className="preview-bob absolute bottom-2 left-[68%] size-5 rounded-full opacity-95" style={{ background: `radial-gradient(circle at 35% 30%, ${primary}, ${secondary})` }} />
      ) : null}
      {slot === 'emote' ? (
        <div className="preview-bob absolute bottom-8 left-[30%] h-6 w-2 rotate-[24deg] rounded-full bg-slate-400/90" />
      ) : null}
      {slot === 'profile' ? (
        <div className="absolute inset-2 rounded-md border-2" style={{ borderColor: primary, boxShadow: `inset 0 0 18px ${primary}44` }} />
      ) : null}

      <span
        className={cn('absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider')}
        style={{ color: RARITY_COLORS[rarity] ?? '#fff', background: '#00000088', border: `1px solid ${RARITY_COLORS[rarity] ?? '#fff'}55` }}
      >
        {rarity}
      </span>
    </div>
  );
}

function Wings({ primary, secondary }: { primary: string; secondary: string }): React.JSX.Element {
  const wing = (flip: boolean): CSSProperties => ({
    background: `linear-gradient(${flip ? 135 : 225}deg, ${primary}, ${secondary})`,
    transform: `${flip ? 'scaleX(-1)' : ''} rotate(${flip ? -24 : 24}deg)`,
    clipPath: 'polygon(50% 0, 100% 35%, 82% 70%, 55% 100%, 40% 70%, 15% 80%, 30% 45%, 0 25%)',
  });
  return (
    <>
      <div className="absolute bottom-8 left-[16%] h-14 w-10 opacity-90" style={wing(false)} />
      <div className="absolute bottom-8 right-[16%] h-14 w-10 opacity-90" style={wing(true)} />
    </>
  );
}

function Motes({ color }: { color: string }): React.JSX.Element {
  const motes = [
    { left: '22%', bottom: '30%', size: 5, delay: '0s' },
    { left: '32%', bottom: '62%', size: 4, delay: '0.4s' },
    { left: '66%', bottom: '55%', size: 6, delay: '0.8s' },
    { left: '76%', bottom: '28%', size: 4, delay: '1.2s' },
    { left: '55%', bottom: '74%', size: 3, delay: '0.2s' },
  ];
  return (
    <>
      {motes.map((mote, index) => (
        <span
          key={index}
          className="preview-mote absolute rounded-full"
          style={{ left: mote.left, bottom: mote.bottom, width: mote.size, height: mote.size, background: color, boxShadow: `0 0 8px 2px ${color}`, animationDelay: mote.delay }}
        />
      ))}
    </>
  );
}
