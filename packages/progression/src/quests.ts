import { z } from 'zod';

export const QUEST_KINDS = ['daily', 'weekly', 'achievement'] as const;
export type QuestKind = (typeof QUEST_KINDS)[number];

/**
 * Progress metrics the launcher can observe locally:
 * - play_minutes: minutes inside a finished session window
 * - sessions: finished game sessions
 * - days_used: distinct calendar days with a session
 * - total_hours: lifetime hours (rounded down)
 * - cosmetics_owned: distinct cosmetics in the inventory
 * - level_reached: current level
 * - daily_streak: consecutive daily-claim streak
 * - quests_completed: achievements finished (meta)
 */
export const QUEST_METRICS = [
  'play_minutes',
  'sessions',
  'days_used',
  'total_hours',
  'cosmetics_owned',
  'level_reached',
  'daily_streak',
  'quests_completed',
] as const;
export type QuestMetric = (typeof QUEST_METRICS)[number];

export const zQuestDef = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{3,48}$/),
    kind: z.enum(QUEST_KINDS),
    metric: z.enum(QUEST_METRICS),
    /** Target inside the quest window (day/week) or lifetime for achievements. */
    target: z.number().int().min(1).max(100000),
    points: z.number().int().min(0).max(100000),
    /** Optional cosmetic granted on completion (must exist in the catalog). */
    cosmeticId: z.string().max(64).optional(),
    name: z.object({ es: z.string().min(1).max(80), en: z.string().min(1).max(80) }).strict(),
    description: z.object({ es: z.string().min(1).max(240), en: z.string().min(1).max(240) }).strict(),
  })
  .strict();

export type QuestDef = z.infer<typeof zQuestDef>;

/** Daily pool: 3 quests picked deterministically per calendar day. */
export const DAILY_QUEST_POOL: QuestDef[] = [
  {
    id: 'daily-play-15',
    kind: 'daily',
    metric: 'play_minutes',
    target: 15,
    points: 40,
    name: { es: 'Calentamiento', en: 'Warm-up' },
    description: { es: 'Juega 15 minutos hoy.', en: 'Play 15 minutes today.' },
  },
  {
    id: 'daily-play-45',
    kind: 'daily',
    metric: 'play_minutes',
    target: 45,
    points: 90,
    name: { es: 'Sesión seria', en: 'Serious session' },
    description: { es: 'Juega 45 minutos hoy.', en: 'Play 45 minutes today.' },
  },
  {
    id: 'daily-play-90',
    kind: 'daily',
    metric: 'play_minutes',
    target: 90,
    points: 160,
    name: { es: 'Maratón diaria', en: 'Daily marathon' },
    description: { es: 'Juega 90 minutos hoy.', en: 'Play 90 minutes today.' },
  },
  {
    id: 'daily-sessions-2',
    kind: 'daily',
    metric: 'sessions',
    target: 2,
    points: 60,
    name: { es: 'Doble turno', en: 'Double shift' },
    description: { es: 'Completa 2 sesiones de juego hoy.', en: 'Finish 2 game sessions today.' },
  },
  {
    id: 'daily-sessions-4',
    kind: 'daily',
    metric: 'sessions',
    target: 4,
    points: 110,
    name: { es: 'Incansable', en: 'Relentless' },
    description: { es: 'Completa 4 sesiones de juego hoy.', en: 'Finish 4 game sessions today.' },
  },
];

/** Weekly pool: 3 quests picked deterministically per ISO week. */
export const WEEKLY_QUEST_POOL: QuestDef[] = [
  {
    id: 'weekly-play-180',
    kind: 'weekly',
    metric: 'play_minutes',
    target: 180,
    points: 250,
    name: { es: 'Tres horas semanales', en: 'Three weekly hours' },
    description: { es: 'Juega 3 horas esta semana.', en: 'Play 3 hours this week.' },
  },
  {
    id: 'weekly-play-600',
    kind: 'weekly',
    metric: 'play_minutes',
    target: 600,
    points: 500,
    name: { es: 'Diez horas semanales', en: 'Ten weekly hours' },
    description: { es: 'Juega 10 horas esta semana.', en: 'Play 10 hours this week.' },
  },
  {
    id: 'weekly-days-4',
    kind: 'weekly',
    metric: 'days_used',
    target: 4,
    points: 350,
    name: { es: 'Constancia', en: 'Consistency' },
    description: { es: 'Juega 4 días distintos esta semana.', en: 'Play on 4 different days this week.' },
  },
  {
    id: 'weekly-sessions-10',
    kind: 'weekly',
    metric: 'sessions',
    target: 10,
    points: 300,
    name: { es: 'Ritmo alto', en: 'High pace' },
    description: { es: 'Completa 10 sesiones esta semana.', en: 'Finish 10 sessions this week.' },
  },
];

/** Permanent achievements (lifetime metrics, claimed once). */
export const ACHIEVEMENTS: QuestDef[] = [
  {
    id: 'ach-first-steps',
    kind: 'achievement',
    metric: 'play_minutes',
    target: 30,
    points: 50,
    name: { es: 'Primeros pasos', en: 'First steps' },
    description: { es: 'Acumula 30 minutos de juego.', en: 'Reach 30 minutes of playtime.' },
  },
  {
    id: 'ach-hour-session',
    kind: 'achievement',
    metric: 'sessions',
    target: 1,
    points: 60,
    name: { es: 'Hora completa', en: 'Full hour' },
    description: {
      es: 'Completa una sesión de al menos una hora.',
      en: 'Finish a session of at least one hour.',
    },
  },
  {
    id: 'ach-five-days',
    kind: 'achievement',
    metric: 'days_used',
    target: 5,
    points: 200,
    name: { es: 'Cinco días', en: 'Five days' },
    description: { es: 'Usa Klymon en 5 días distintos.', en: 'Use Klymon on 5 different days.' },
  },
  {
    id: 'ach-ten-hours',
    kind: 'achievement',
    metric: 'total_hours',
    target: 10,
    points: 300,
    name: { es: 'Diez horas', en: 'Ten hours' },
    description: { es: 'Acumula 10 horas de juego.', en: 'Reach 10 hours of playtime.' },
  },
  {
    id: 'ach-fifty-hours',
    kind: 'achievement',
    metric: 'total_hours',
    target: 50,
    points: 800,
    name: { es: 'Cincuenta horas', en: 'Fifty hours' },
    description: { es: 'Acumula 50 horas de juego.', en: 'Reach 50 hours of playtime.' },
  },
  {
    id: 'ach-first-cosmetic',
    kind: 'achievement',
    metric: 'cosmetics_owned',
    target: 1,
    points: 80,
    name: { es: 'Mi primer cosmético', en: 'My first cosmetic' },
    description: { es: 'Desbloquea tu primer cosmético.', en: 'Unlock your first cosmetic.' },
  },
  {
    id: 'ach-collector-5',
    kind: 'achievement',
    metric: 'cosmetics_owned',
    target: 5,
    points: 250,
    name: { es: 'Coleccionista', en: 'Collector' },
    description: { es: 'Reúne 5 cosméticos.', en: 'Collect 5 cosmetics.' },
  },
  {
    id: 'ach-collector-15',
    kind: 'achievement',
    metric: 'cosmetics_owned',
    target: 15,
    points: 600,
    cosmeticId: 'wings-void-collector',
    name: { es: 'Gran coleccionista', en: 'Grand collector' },
    description: { es: 'Reúne 15 cosméticos.', en: 'Collect 15 cosmetics.' },
  },
  {
    id: 'ach-level-5',
    kind: 'achievement',
    metric: 'level_reached',
    target: 5,
    points: 200,
    name: { es: 'Nivel 5', en: 'Level 5' },
    description: { es: 'Alcanza el nivel 5.', en: 'Reach level 5.' },
  },
  {
    id: 'ach-level-10',
    kind: 'achievement',
    metric: 'level_reached',
    target: 10,
    points: 500,
    name: { es: 'Nivel 10', en: 'Level 10' },
    description: { es: 'Alcanza el nivel 10.', en: 'Reach level 10.' },
  },
  {
    id: 'ach-level-20',
    kind: 'achievement',
    metric: 'level_reached',
    target: 20,
    points: 1200,
    name: { es: 'Nivel 20', en: 'Level 20' },
    description: { es: 'Alcanza el nivel 20.', en: 'Reach level 20.' },
  },
  {
    id: 'ach-streak-7',
    kind: 'achievement',
    metric: 'daily_streak',
    target: 7,
    points: 700,
    name: { es: 'Semana perfecta', en: 'Perfect week' },
    description: { es: 'Reclama la recompensa diaria 7 días seguidos.', en: 'Claim the daily reward 7 days in a row.' },
  },
  {
    id: 'ach-pioneer',
    kind: 'achievement',
    metric: 'quests_completed',
    target: 5,
    points: 400,
    cosmeticId: 'cape-founder-aurora',
    name: { es: 'Pionero Klymon', en: 'Klymon Pioneer' },
    description: { es: 'Completa 5 logros.', en: 'Complete 5 achievements.' },
  },
];

export const ALL_QUESTS: QuestDef[] = [...DAILY_QUEST_POOL, ...WEEKLY_QUEST_POOL, ...ACHIEVEMENTS];
export const QUEST_IDS = new Set(ALL_QUESTS.map((quest) => quest.id));

/** FNV-1a 32-bit hash: stable rotation without storing a schedule. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministically picks `count` quests from a pool for a given window key. */
export function pickRotation(pool: QuestDef[], windowKey: string, count: number): QuestDef[] {
  if (pool.length <= count) return [...pool];
  const scored = pool.map((quest) => ({ quest, score: hashSeed(`${windowKey}:${quest.id}`) }));
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, count).map((entry) => entry.quest);
}

export function localDayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** ISO week key (YYYY-Www) in local time. */
export function localWeekKey(date = new Date()): string {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day + 3);
  const firstThursday = new Date(copy.getFullYear(), 0, 4);
  const week = 1 + Math.round(((copy.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${copy.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function dailyQuestsFor(date = new Date()): QuestDef[] {
  return pickRotation(DAILY_QUEST_POOL, `daily:${localDayKey(date)}`, 3);
}

export function weeklyQuestsFor(date = new Date()): QuestDef[] {
  return pickRotation(WEEKLY_QUEST_POOL, `weekly:${localWeekKey(date)}`, 3);
}

export function validateQuests(cosmeticIds: Set<string>): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const quest of ALL_QUESTS) {
    const parsed = zQuestDef.safeParse(quest);
    if (!parsed.success) errors.push(`invalid quest ${quest.id}: ${parsed.error.issues[0]?.message ?? 'schema'}`);
    if (seen.has(quest.id)) errors.push(`duplicate quest id: ${quest.id}`);
    seen.add(quest.id);
    if (quest.cosmeticId && !cosmeticIds.has(quest.cosmeticId)) {
      errors.push(`quest ${quest.id} grants unknown cosmetic ${quest.cosmeticId}`);
    }
  }
  return errors;
}
