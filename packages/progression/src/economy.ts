/**
 * Points economy and level curve.
 *
 * Everything here is pure and deterministic so the launcher, the tests and —
 * in the future — a central server can share the exact same rules.
 *
 * Design goals:
 * - steady play earns steadily, but daily caps stop infinite farming;
 * - short sessions still count, long sessions do not scale without bound;
 * - every award path goes through a single function so caps cannot be bypassed.
 */

/** Points granted per full minute of playtime. */
export const POINTS_PER_PLAY_MINUTE = 2;

/** Bonus for finishing a session that lasted at least this long. */
export const SESSION_COMPLETE_MIN_SECONDS = 300;
export const SESSION_COMPLETE_BONUS = 25;

/** Bonus for launching the client at most once per calendar day. */
export const FIRST_SESSION_OF_DAY_BONUS = 15;

/** Hard ceilings that keep the economy bounded (anti-exploit). */
export const MAX_REWARDED_PLAY_MINUTES_PER_DAY = 360; // 6h/day counts
export const MAX_POINTS_PER_DAY = 1500; // all sources combined
export const MAX_SESSION_SECONDS_PER_AWARD = 12 * 3600; // ignore absurd durations

/** Level curve: cumulative lifetime points needed to *reach* a level. */
export function cumulativePointsForLevel(level: number): number {
  const safe = Math.max(1, Math.floor(level));
  if (safe <= 1) return 0;
  // 50 * L * (L-1): L2=100, L5=1000, L10=4500, L20=19000, L30=43500
  return 50 * safe * (safe - 1);
}

export function levelForPoints(lifetimePoints: number): number {
  const total = Math.max(0, Math.floor(lifetimePoints));
  // Invert 50*L*(L-1) <= total → L = (1 + sqrt(1 + total/12.5)) / 2
  const level = Math.floor((1 + Math.sqrt(1 + total / 12.5)) / 2);
  return Math.max(1, Math.min(level, 999));
}

export interface LevelProgress {
  level: number;
  lifetimePoints: number;
  /** Points earned inside the current level. */
  intoLevel: number;
  /** Points needed to go from the current level to the next one. */
  neededForLevel: number;
  /** 0..1 progress towards the next level. */
  fraction: number;
}

export function progressToNextLevel(lifetimePoints: number): LevelProgress {
  const total = Math.max(0, Math.floor(lifetimePoints));
  const level = levelForPoints(total);
  const floor = cumulativePointsForLevel(level);
  const ceiling = cumulativePointsForLevel(level + 1);
  const intoLevel = total - floor;
  const neededForLevel = Math.max(1, ceiling - floor);
  return {
    level,
    lifetimePoints: total,
    intoLevel,
    neededForLevel,
    fraction: Math.min(1, intoLevel / neededForLevel),
  };
}

/**
 * Playtime points for a finished session, before the daily cap is applied.
 * Sessions shorter than a minute earn nothing; absurd durations are clamped.
 */
export function playtimePointsForSession(sessionSeconds: number): { minutes: number; points: number; completed: boolean } {
  const clamped = Math.max(0, Math.min(Math.floor(sessionSeconds), MAX_SESSION_SECONDS_PER_AWARD));
  const minutes = Math.floor(clamped / 60);
  return {
    minutes,
    points: minutes * POINTS_PER_PLAY_MINUTE,
    completed: clamped >= SESSION_COMPLETE_MIN_SECONDS,
  };
}

/** Daily-streak reward ladder (day 1..7+, repeating the day-7 value). */
export function dailyRewardForStreak(streakDay: number): number {
  const ladder = [20, 30, 45, 60, 80, 110, 150];
  const index = Math.max(1, Math.min(Math.floor(streakDay), 7)) - 1;
  return ladder[index] ?? 20;
}

export interface DailyCapDecision {
  /** Points actually granted after the cap. */
  granted: number;
  /** Points dropped because of the cap. */
  dropped: number;
  capped: boolean;
}

/** Applies the global daily ceiling to a candidate award. */
export function applyDailyCap(alreadyEarnedToday: number, candidate: number): DailyCapDecision {
  const remaining = Math.max(0, MAX_POINTS_PER_DAY - Math.max(0, Math.floor(alreadyEarnedToday)));
  const granted = Math.max(0, Math.min(Math.floor(candidate), remaining));
  return { granted, dropped: Math.max(0, Math.floor(candidate) - granted), capped: granted < Math.floor(candidate) };
}
