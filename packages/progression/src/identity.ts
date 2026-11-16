import { z } from 'zod';

export const zRank = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{2,32}$/),
    /** Short tag rendered before the player name, e.g. `[K]`. */
    prefix: z.string().min(1).max(12),
    /** Hex color for the prefix chip. */
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    name: z.object({ es: z.string().min(1).max(40), en: z.string().min(1).max(40) }).strict(),
    /** Display order (lower renders first when several apply). */
    priority: z.number().int().min(0).max(1000),
  })
  .strict();

export type Rank = z.infer<typeof zRank>;

export const zPlayerTitle = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{2,48}$/),
    text: z.object({ es: z.string().min(1).max(40), en: z.string().min(1).max(40) }).strict(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    /** Quest id that unlocks this title (undefined = available). */
    questUnlock: z.string().max(64).optional(),
    minLevel: z.number().int().min(1).max(999).default(1),
  })
  .strict();

export type PlayerTitle = z.infer<typeof zPlayerTitle>;

/**
 * Rank ladder. Today every Klymon user gets `klymon` automatically; extra
 * ranks (veteran, founder…) can be granted later without touching call sites:
 * the launcher always renders the highest-priority rank the player owns.
 */
export const RANKS: Rank[] = [
  {
    id: 'klymon',
    prefix: '[K]',
    color: '#22d3ee',
    name: { es: 'Klymon', en: 'Klymon' },
    priority: 10,
  },
  {
    id: 'veteran',
    prefix: '[KV]',
    color: '#a78bfa',
    name: { es: 'Veterano', en: 'Veteran' },
    priority: 20,
  },
  {
    id: 'founder',
    prefix: '[KF]',
    color: '#f5a623',
    name: { es: 'Fundador', en: 'Founder' },
    priority: 30,
  },
];

const RAW_TITLES: Array<z.input<typeof zPlayerTitle>> = [
  { id: 'rookie', text: { es: 'Novato', en: 'Rookie' }, color: '#9aa4b2' },
  { id: 'explorer', text: { es: 'Explorador', en: 'Explorer' }, color: '#3ddc84', minLevel: 3 },
  { id: 'warrior', text: { es: 'Guerrero', en: 'Warrior' }, color: '#ef4444', minLevel: 6 },
  { id: 'legend', text: { es: 'Leyenda', en: 'Legend' }, color: '#f5a623', minLevel: 12 },
  { id: 'pioneer', text: { es: 'Pionero', en: 'Pioneer' }, color: '#a78bfa', questUnlock: 'ach-pioneer' },
];

export const TITLES: PlayerTitle[] = RAW_TITLES.map((raw) => zPlayerTitle.parse(raw));

export function rankById(id: string): Rank {
  return RANKS.find((rank) => rank.id === id) ?? RANKS[0]!;
}

export function titleById(id: string | null): PlayerTitle | null {
  if (!id) return null;
  return TITLES.find((title) => title.id === id) ?? null;
}

/**
 * Builds the decorated display name. The original account name is never
 * mutated: callers keep `name` intact and render this string instead.
 */
export function formatDisplayName(name: string, rankId: string, titleId: string | null): string {
  const rank = rankById(rankId);
  const title = titleById(titleId);
  const clean = name.trim().slice(0, 16) || name;
  return title ? `${rank.prefix} ${clean} · ${title.text.en}` : `${rank.prefix} ${clean}`;
}

export const zIdentity = z
  .object({
    rankId: z.string().min(1).max(32).default('klymon'),
    ownedRankIds: z.array(z.string().max(32)).max(16).default(['klymon']),
    titleId: z.string().max(48).nullable().default(null),
    ownedTitleIds: z.array(z.string().max(48)).max(32).default(['rookie']),
  })
  .strict();

export type Identity = z.infer<typeof zIdentity>;
