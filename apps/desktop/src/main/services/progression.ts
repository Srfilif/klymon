import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ensureDir, LauncherError, writeJsonAtomic, type LauncherLogger } from '@klymon/core';
import type { ProgressionRepository, ProgressionProfileRow } from '@klymon/database';
import {
  ACHIEVEMENTS,
  applyDailyCap,
  cosmeticById,
  COSMETIC_CATALOG,
  dailyQuestsFor,
  dailyRewardForStreak,
  FIRST_SESSION_OF_DAY_BONUS,
  formatDisplayName,
  levelForPoints,
  localDayKey,
  localWeekKey,
  MAX_REWARDED_PLAY_MINUTES_PER_DAY,
  playtimePointsForSession,
  progressToNextLevel,
  rankById,
  SESSION_COMPLETE_BONUS,
  titleById,
  TITLES,
  weeklyQuestsFor,
  zIdentity,
  type Identity,
  type QuestDef,
  type QuestMetric,
} from '@klymon/progression';
import type {
  CosmeticModel,
  DailyStateModel,
  IpcEventMap,
  LedgerEntryModel,
  ProgressionProfileModel,
  QuestStateModel,
} from '@klymon/shared-types';

export interface ProgressionServiceDeps {
  repo: ProgressionRepository;
  logger: LauncherLogger;
  /** Display name of the active account (identity never mutates it). */
  displayName: () => string;
  /** Game dir of the Klymon Client instance, for the in-game bridge file. */
  resolveClientGameDir: () => string | null;
  emit: <K extends 'progression:reward' | 'data:changed'>(event: K, payload: IpcEventMap[K]) => void;
}

export interface SessionAward {
  seconds: number;
  minutesRewarded: number;
  points: number;
  completed: boolean;
  firstOfDay: boolean;
  leveledUp: boolean;
  newLevel: number;
  questsCompleted: string[];
}

/** Versioned payload the in-game mod reads from `<gameDir>/config/klymon-bridge.json`. */
export interface KlymonBridge {
  version: 1;
  exportedAt: string;
  displayName: string;
  rankPrefix: string;
  rankColor: string;
  title: string | null;
  titleColor: string | null;
  level: number;
  balance: number;
  lifetimePoints: number;
  playSeconds: number;
  sessions: number;
  loadout: Array<{
    slot: string;
    id: string;
    colors: string[];
    particle: string | null;
    shape: string | null;
    baseItem: string | null;
  }>;
}

const ACHIEVEMENT_WINDOW = 'lifetime';

export class ProgressionService {
  constructor(private readonly deps: ProgressionServiceDeps) {}

  // ---------------------------------------------------------------- profile

  private identityOf(row: ProgressionProfileRow): Identity {
    try {
      const parsed = zIdentity.parse(JSON.parse(row.identityJson || '{}'));
      const ownedRankIds = parsed.ownedRankIds.includes('klymon') ? parsed.ownedRankIds : [...parsed.ownedRankIds, 'klymon'];
      return { ...parsed, rankId: parsed.rankId || 'klymon', ownedRankIds };
    } catch {
      return { rankId: 'klymon', ownedRankIds: ['klymon'], titleId: null, ownedTitleIds: ['rookie'] };
    }
  }

  private daysOf(row: ProgressionProfileRow): string[] {
    try {
      const parsed: unknown = JSON.parse(row.daysJson || '[]');
      return Array.isArray(parsed) ? parsed.filter((day): day is string => typeof day === 'string') : [];
    } catch {
      return [];
    }
  }

  /** Titles unlock automatically by level or by claimed achievements. */
  private refreshTitles(row: ProgressionProfileRow, identity: Identity): Identity {
    const level = levelForPoints(row.lifetimePoints);
    const owned = new Set(identity.ownedTitleIds);
    for (const title of TITLES) {
      if (owned.has(title.id)) continue;
      if (level < title.minLevel) continue;
      if (title.questUnlock) {
        const state = this.deps.repo.questState(title.questUnlock, ACHIEVEMENT_WINDOW);
        if (!state?.claimed) continue;
      }
      owned.add(title.id);
    }
    const ownedTitleIds = [...owned];
    const titleId = identity.titleId && owned.has(identity.titleId) ? identity.titleId : identity.titleId;
    return { ...identity, ownedTitleIds, titleId: titleId ?? null };
  }

  profile(): ProgressionProfileModel {
    const row = this.deps.repo.profile();
    const integrityOk = this.deps.repo.sealValid(row);
    if (!integrityOk) {
      this.deps.logger.warn('progression', 'Profile seal mismatch: local data was edited outside the launcher. Counters kept as-is.');
    }
    let identity = this.refreshTitles(row, this.identityOf(row));
    if (identity.ownedTitleIds.join(',') !== this.identityOf(row).ownedTitleIds.join(',')) {
      this.deps.repo.saveProfile({ identityJson: JSON.stringify(identity) });
    }
    const rank = rankById(identity.rankId);
    const title = titleById(identity.titleId);
    const name = this.deps.displayName();
    const loadoutRows = this.deps.repo.loadout();
    const loadout: Record<string, string | null> = {};
    for (const entry of loadoutRows) loadout[entry.slot] = entry.cosmeticId;
    const progress = progressToNextLevel(row.lifetimePoints);
    return {
      balance: row.lifetimePoints - row.spentPoints,
      lifetimePoints: row.lifetimePoints,
      spentPoints: row.spentPoints,
      level: {
        level: progress.level,
        lifetimePoints: progress.lifetimePoints,
        intoLevel: progress.intoLevel,
        neededForLevel: progress.neededForLevel,
        fraction: progress.fraction,
      },
      playSeconds: row.playSeconds,
      sessions: row.sessions,
      daysUsed: this.daysOf(row).length,
      streakCount: row.streakCount,
      firstSeenAt: row.firstSeenAt,
      identity: {
        rankId: rank.id,
        rankPrefix: rank.prefix,
        rankColor: rank.color,
        ownedRankIds: identity.ownedRankIds,
        titleId: identity.titleId,
        titleText: title ? { ...title.text } : null,
        titleColor: title?.color ?? null,
        ownedTitleIds: identity.ownedTitleIds,
        displayName: formatDisplayName(name, rank.id, identity.titleId),
      },
      loadout,
      inventoryCount: this.deps.repo.inventory().length,
      integrityOk,
      localOnly: true,
    };
  }

  ledger(limit = 100): LedgerEntryModel[] {
    const safe = Math.max(1, Math.min(limit, 500));
    return this.deps.repo.ledger(safe).map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      source: row.source,
      delta: row.delta,
      balanceAfter: row.balanceAfter,
      detail: row.detail,
    }));
  }

  // ---------------------------------------------------------------- awards

  private recordLedger(source: string, delta: number, balanceAfter: number, detail: string | null, dayKey: string): void {
    this.deps.repo.addLedgerEntry({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      dayKey,
      source,
      delta,
      balanceAfter,
      detail,
    });
  }

  /**
   * The single funnel for every positive award: applies the daily cap,
   * persists, detects level-ups and notifies. Returns the granted amount.
   */
  private award(dayKey: string, source: string, candidate: number, detail: string | null): { granted: number; leveledUp: boolean; newLevel: number } {
    if (candidate <= 0) {
      const row = this.deps.repo.profile();
      return { granted: 0, leveledUp: false, newLevel: levelForPoints(row.lifetimePoints) };
    }
    const before = this.deps.repo.profile();
    const beforeLevel = levelForPoints(before.lifetimePoints);
    const decision = applyDailyCap(this.deps.repo.earnedOnDay(dayKey), candidate);
    if (decision.granted <= 0) {
      this.deps.logger.info('progression', `Daily cap reached: dropped ${decision.dropped} pts from ${source}.`);
      return { granted: 0, leveledUp: false, newLevel: beforeLevel };
    }
    const next = this.deps.repo.saveProfile({ lifetimePoints: before.lifetimePoints + decision.granted });
    this.recordLedger(source, decision.granted, next.lifetimePoints - next.spentPoints, detail, dayKey);
    const newLevel = levelForPoints(next.lifetimePoints);
    const leveledUp = newLevel > beforeLevel;
    if (leveledUp) {
      this.deps.emit('progression:reward', {
        kind: 'level-up',
        title: `¡Nivel ${newLevel}!`,
        detail: `Has alcanzado el nivel ${newLevel}.`,
        points: 0,
        level: newLevel,
      });
    }
    return { granted: decision.granted, leveledUp, newLevel };
  }

  private rewardedMinutesToday(dayKey: string): number {
    let minutes = 0;
    for (const row of this.deps.repo.ledger(2000)) {
      if (row.dayKey !== dayKey || row.source !== 'playtime' || !row.detail) continue;
      try {
        const parsed = JSON.parse(row.detail) as { minutes?: number };
        if (typeof parsed.minutes === 'number') minutes += Math.max(0, Math.floor(parsed.minutes));
      } catch {
        // Ignore legacy/unparseable rows.
      }
    }
    return minutes;
  }

  private hasLedgerSourceToday(dayKey: string, source: string): boolean {
    return this.deps.repo.ledger(2000).some((row) => row.dayKey === dayKey && row.source === source);
  }

  /** Called when a game session ends. Awards playtime + bonuses and tracks quests. */
  onSessionEnd(input: { seconds: number; instanceName: string }): SessionAward {
    const dayKey = localDayKey();
    const computed = playtimePointsForSession(input.seconds);
    const alreadyRewarded = this.rewardedMinutesToday(dayKey);
    const rewardableMinutes = Math.max(0, Math.min(computed.minutes, MAX_REWARDED_PLAY_MINUTES_PER_DAY - alreadyRewarded));
    const cappedSession = Math.min(Math.max(0, Math.floor(input.seconds)), 12 * 3600);

    const row = this.deps.repo.profile();
    const days = this.daysOf(row);
    const isNewDay = !days.includes(dayKey);
    this.deps.repo.saveProfile({
      playSeconds: row.playSeconds + cappedSession,
      sessions: row.sessions + 1,
      daysJson: JSON.stringify(isNewDay ? [...days, dayKey].slice(-3650) : days),
    });

    let points = 0;
    let leveledUp = false;
    let newLevel = levelForPoints(row.lifetimePoints);
    if (rewardableMinutes > 0) {
      const result = this.award(dayKey, 'playtime', rewardableMinutes * 2, JSON.stringify({ minutes: rewardableMinutes }));
      points += result.granted;
      leveledUp = leveledUp || result.leveledUp;
      newLevel = result.newLevel;
    }
    const firstOfDay = !this.hasLedgerSourceToday(dayKey, 'first-session');
    if (firstOfDay) {
      const result = this.award(dayKey, 'first-session', FIRST_SESSION_OF_DAY_BONUS, input.instanceName.slice(0, 80));
      points += result.granted;
      leveledUp = leveledUp || result.leveledUp;
      newLevel = result.newLevel;
    }
    if (computed.completed) {
      const result = this.award(dayKey, 'session-complete', SESSION_COMPLETE_BONUS, input.instanceName.slice(0, 80));
      points += result.granted;
      leveledUp = leveledUp || result.leveledUp;
      newLevel = result.newLevel;
    }

    const questsCompleted = this.trackSessionQuests({
      dayKey,
      weekKey: localWeekKey(),
      minutes: computed.minutes,
      sessions: 1,
      longSession: cappedSession >= 3600,
    });

    if (points > 0) {
      this.deps.emit('progression:reward', {
        kind: 'points',
        title: `+${points} puntos`,
        detail: `Sesión de ${Math.max(1, Math.round(cappedSession / 60))} min en ${input.instanceName}.`,
        points,
        level: null,
      });
    }
    this.changed();
    return { seconds: cappedSession, minutesRewarded: rewardableMinutes, points, completed: computed.completed, firstOfDay, leveledUp, newLevel, questsCompleted };
  }

  // ---------------------------------------------------------------- quests

  private metricValue(metric: QuestMetric): number {
    const row = this.deps.repo.profile();
    switch (metric) {
      case 'play_minutes':
        return Math.floor(row.playSeconds / 60);
      case 'sessions':
        return row.sessions;
      case 'days_used':
        return this.daysOf(row).length;
      case 'total_hours':
        return Math.floor(row.playSeconds / 3600);
      case 'cosmetics_owned':
        return this.deps.repo.inventory().length;
      case 'level_reached':
        return levelForPoints(row.lifetimePoints);
      case 'daily_streak':
        return row.streakCount;
      case 'quests_completed':
        return this.deps.repo.allQuestStates().filter((state) => state.claimed && state.windowKey === ACHIEVEMENT_WINDOW).length;
      default:
        return 0;
    }
  }

  private windowKeyFor(quest: QuestDef, dayKey: string, weekKey: string): string {
    if (quest.kind === 'daily') return `daily:${dayKey}`;
    if (quest.kind === 'weekly') return `weekly:${weekKey}`;
    return ACHIEVEMENT_WINDOW;
  }

  private toState(quest: QuestDef, windowKey: string): QuestStateModel {
    const stored = this.deps.repo.questState(quest.id, windowKey);
    let progress = stored?.progress ?? 0;
    if (quest.kind === 'achievement') {
      // Achievements mirror lifetime metrics so progress never goes stale.
      progress = Math.min(this.metricValue(quest.metric), quest.target);
      if (stored && stored.progress !== progress && !stored.claimed) {
        this.deps.repo.saveQuestState({ ...stored, progress });
      }
    }
    return {
      id: quest.id,
      kind: quest.kind,
      metric: quest.metric,
      target: quest.target,
      points: quest.points,
      ...(quest.cosmeticId ? { cosmeticId: quest.cosmeticId } : {}),
      name: quest.name,
      description: quest.description,
      windowKey,
      progress: Math.min(progress, quest.target),
      completed: stored?.completed ?? progress >= quest.target,
      claimed: stored?.claimed ?? false,
    };
  }

  quests(): { daily: QuestStateModel[]; weekly: QuestStateModel[]; achievements: QuestStateModel[] } {
    const dayKey = localDayKey();
    const weekKey = localWeekKey();
    return {
      daily: dailyQuestsFor().map((quest) => this.toState(quest, this.windowKeyFor(quest, dayKey, weekKey))),
      weekly: weeklyQuestsFor().map((quest) => this.toState(quest, this.windowKeyFor(quest, dayKey, weekKey))),
      achievements: ACHIEVEMENTS.map((quest) => this.toState(quest, ACHIEVEMENT_WINDOW)),
    };
  }

  /**
   * Advances windowed quests after a session and flags newly completed ones.
   * Achievements are evaluated lazily from lifetime metrics instead.
   */
  private trackSessionQuests(input: { dayKey: string; weekKey: string; minutes: number; sessions: number; longSession: boolean }): string[] {
    const newlyCompleted: string[] = [];
    const advance = (quest: QuestDef, windowKey: string, increment: number): void => {
      if (increment <= 0) return;
      const stored = this.deps.repo.questState(quest.id, windowKey) ?? {
        questId: quest.id,
        windowKey,
        progress: 0,
        completed: false,
        completedAt: null,
        claimed: false,
      };
      if (stored.claimed || stored.completed) return;
      const progress = Math.min(stored.progress + increment, quest.target);
      const completed = progress >= quest.target;
      this.deps.repo.saveQuestState({
        questId: quest.id,
        windowKey,
        progress,
        completed,
        completedAt: completed ? new Date().toISOString() : stored.completedAt,
        claimed: false,
      });
      if (completed) newlyCompleted.push(quest.id);
    };

    for (const quest of dailyQuestsFor()) {
      const windowKey = this.windowKeyFor(quest, input.dayKey, input.weekKey);
      if (quest.metric === 'play_minutes') advance(quest, windowKey, input.minutes);
      else if (quest.metric === 'sessions') advance(quest, windowKey, input.sessions);
    }
    for (const quest of weeklyQuestsFor()) {
      const windowKey = this.windowKeyFor(quest, input.dayKey, input.weekKey);
      if (quest.metric === 'play_minutes') advance(quest, windowKey, input.minutes);
      else if (quest.metric === 'sessions') advance(quest, windowKey, input.sessions);
      else if (quest.metric === 'days_used') {
        const stored = this.deps.repo.questState(quest.id, windowKey);
        if (!stored?.completed && !stored?.claimed) {
          const days = new Set<string>();
          for (const entry of this.deps.repo.ledger(2000)) {
            if (entry.source === 'first-session') days.add(entry.dayKey);
          }
          days.add(input.dayKey);
          const progress = Math.min(days.size, quest.target);
          const completed = progress >= quest.target;
          this.deps.repo.saveQuestState({
            questId: quest.id,
            windowKey,
            progress,
            completed,
            completedAt: completed ? new Date().toISOString() : null,
            claimed: false,
          });
          if (completed) newlyCompleted.push(quest.id);
        }
      }
    }

    // The hour-long-session achievement is event-based, not metric-based.
    if (input.longSession) {
      const stored = this.deps.repo.questState('ach-hour-session', ACHIEVEMENT_WINDOW);
      if (!stored?.completed && !stored?.claimed) {
        this.deps.repo.saveQuestState({
          questId: 'ach-hour-session',
          windowKey: ACHIEVEMENT_WINDOW,
          progress: 1,
          completed: true,
          completedAt: new Date().toISOString(),
          claimed: false,
        });
        newlyCompleted.push('ach-hour-session');
      }
    }

    // Metric achievements complete as soon as their lifetime value qualifies.
    for (const quest of ACHIEVEMENTS) {
      if (quest.id === 'ach-hour-session') continue;
      const stored = this.deps.repo.questState(quest.id, ACHIEVEMENT_WINDOW);
      if (stored?.completed || stored?.claimed) continue;
      if (this.metricValue(quest.metric) >= quest.target) {
        this.deps.repo.saveQuestState({
          questId: quest.id,
          windowKey: ACHIEVEMENT_WINDOW,
          progress: quest.target,
          completed: true,
          completedAt: new Date().toISOString(),
          claimed: false,
        });
        newlyCompleted.push(quest.id);
      }
    }

    for (const id of newlyCompleted) {
      const def = ACHIEVEMENTS.find((entry) => entry.id === id) ?? dailyQuestsFor().find((entry) => entry.id === id) ?? weeklyQuestsFor().find((entry) => entry.id === id);
      if (!def) continue;
      this.deps.emit('progression:reward', {
        kind: 'quest',
        title: `Desafío completado: ${def.name.es}`,
        detail: `Reclama ${def.points} puntos en Misiones.`,
        points: def.points,
        level: null,
      });
    }
    return newlyCompleted;
  }

  claimQuest(id: string): { profile: ProgressionProfileModel; quest: QuestStateModel } {
    const dayKey = localDayKey();
    const weekKey = localWeekKey();
    const all = this.quests();
    const quest = [...all.daily, ...all.weekly, ...all.achievements].find((entry) => entry.id === id);
    if (!quest) throw new LauncherError('NOT_FOUND', `Unknown quest "${id}".`);
    if (!quest.completed) throw new LauncherError('INVALID_INPUT', 'This quest is not completed yet.');
    if (quest.claimed) throw new LauncherError('INVALID_INPUT', 'This quest was already claimed.');
    const stored = this.deps.repo.questState(id, quest.windowKey);
    this.deps.repo.saveQuestState({
      questId: id,
      windowKey: quest.windowKey,
      progress: stored?.progress ?? quest.target,
      completed: true,
      completedAt: stored?.completedAt ?? new Date().toISOString(),
      claimed: true,
    });
    const awarded = this.award(dayKey, `quest:${id}`, quest.points, quest.name.es.slice(0, 80));
    if (quest.cosmeticId && cosmeticById(quest.cosmeticId)) {
      this.deps.repo.grant(quest.cosmeticId, `quest:${id}`);
      this.deps.emit('progression:reward', {
        kind: 'cosmetic',
        title: 'Cosmético desbloqueado',
        detail: quest.cosmeticId,
        points: 0,
        level: null,
      });
    }
    this.deps.emit('progression:reward', {
      kind: 'quest',
      title: `+${awarded.granted} puntos`,
      detail: `Recompensa de «${quest.name.es}».`,
      points: awarded.granted,
      level: null,
    });
    void weekKey;
    this.changed();
    return { profile: this.profile(), quest: { ...quest, claimed: true } };
  }

  // ---------------------------------------------------------------- dailies

  daily(): DailyStateModel {
    const dayKey = localDayKey();
    const claimed = this.deps.repo.dailyClaim(dayKey);
    const row = this.deps.repo.profile();
    const nextStreak = this.nextStreak(row.streakLastDay, row.streakCount, dayKey);
    return {
      dayKey,
      claimed: Boolean(claimed),
      streak: claimed ? claimed.streak : nextStreak,
      nextReward: dailyRewardForStreak(nextStreak),
      canClaim: !claimed,
    };
  }

  private yesterdayKey(dayKey: string): string {
    const [y, m, d] = dayKey.split('-').map(Number);
    const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
    date.setDate(date.getDate() - 1);
    return localDayKey(date);
  }

  private nextStreak(lastDay: string | null, streak: number, today: string): number {
    if (!lastDay) return 1;
    if (lastDay === today) return Math.max(1, streak);
    if (lastDay === this.yesterdayKey(today)) return streak + 1;
    return 1;
  }

  claimDaily(): { profile: ProgressionProfileModel; daily: DailyStateModel } {
    const dayKey = localDayKey();
    if (this.deps.repo.dailyClaim(dayKey)) {
      throw new LauncherError('INVALID_INPUT', 'The daily reward was already claimed today. Come back tomorrow.');
    }
    const row = this.deps.repo.profile();
    if (row.streakLastDay && row.streakLastDay > dayKey) {
      // The system clock moved backwards: refuse instead of corrupting the streak.
      throw new LauncherError('INVALID_INPUT', 'System clock looks inconsistent. The daily reward is unavailable right now.');
    }
    const streak = this.nextStreak(row.streakLastDay, row.streakCount, dayKey);
    const points = dailyRewardForStreak(streak);
    this.deps.repo.saveProfile({ streakCount: streak, streakLastDay: dayKey });
    this.deps.repo.recordDailyClaim({ dayKey, streak, points, claimedAt: new Date().toISOString() });
    const awarded = this.award(dayKey, 'daily', points, `streak:${streak}`);
    this.trackSessionQuests({ dayKey, weekKey: localWeekKey(), minutes: 0, sessions: 0, longSession: false });
    this.deps.emit('progression:reward', {
      kind: 'daily',
      title: `Racha de ${streak} día${streak === 1 ? '' : 's'}: +${awarded.granted}`,
      detail: 'Recompensa diaria reclamada.',
      points: awarded.granted,
      level: null,
    });
    this.changed();
    return { profile: this.profile(), daily: this.daily() };
  }

  // ---------------------------------------------------------------- shop

  catalog(): CosmeticModel[] {
    const row = this.deps.repo.profile();
    const level = levelForPoints(row.lifetimePoints);
    const balance = row.lifetimePoints - row.spentPoints;
    const loadout = new Map(this.deps.repo.loadout().map((entry) => [entry.slot, entry.cosmeticId]));
    return COSMETIC_CATALOG.map((entry) => {
      const owned = this.deps.repo.owns(entry.id);
      let lockedReason: string | null = null;
      if (entry.questUnlock && !owned) lockedReason = 'quest';
      else if (level < entry.minLevel) lockedReason = 'level';
      else if (!owned && balance < entry.price) lockedReason = 'funds';
      return {
        id: entry.id,
        slot: entry.slot,
        rarity: entry.rarity,
        name: entry.name,
        description: entry.description,
        price: entry.price,
        minLevel: entry.minLevel,
        ...(entry.questUnlock ? { questUnlock: entry.questUnlock } : {}),
        visual: {
          kind: entry.visual.kind,
          colors: entry.visual.colors,
          ...(entry.visual.particle ? { particle: entry.visual.particle } : {}),
          ...(entry.visual.shape ? { shape: entry.visual.shape } : {}),
          ...(entry.visual.baseItem ? { baseItem: entry.visual.baseItem } : {}),
        },
        addedIn: entry.addedIn,
        owned,
        equipped: loadout.get(entry.slot) === entry.id,
        lockedReason,
      };
    });
  }

  buy(id: string): { profile: ProgressionProfileModel; cosmetic: CosmeticModel } {
    const entry = cosmeticById(id);
    if (!entry) throw new LauncherError('NOT_FOUND', `Unknown cosmetic "${id}".`);
    if (this.deps.repo.owns(id)) throw new LauncherError('INVALID_INPUT', 'You already own this cosmetic.');
    if (entry.questUnlock) throw new LauncherError('INVALID_INPUT', 'This cosmetic is unlocked through a quest, not the shop.');
    const row = this.deps.repo.profile();
    const level = levelForPoints(row.lifetimePoints);
    if (level < entry.minLevel) throw new LauncherError('INVALID_INPUT', `This cosmetic requires level ${entry.minLevel}.`);
    const balance = row.lifetimePoints - row.spentPoints;
    if (balance < entry.price) throw new LauncherError('INVALID_INPUT', 'Not enough points for this cosmetic.');
    const dayKey = localDayKey();
    const next = this.deps.repo.saveProfile({ spentPoints: row.spentPoints + entry.price });
    this.recordLedger(`shop:${id}`, -entry.price, next.lifetimePoints - next.spentPoints, entry.name.es.slice(0, 80), dayKey);
    this.deps.repo.grant(id, 'shop');
    this.trackSessionQuests({ dayKey, weekKey: localWeekKey(), minutes: 0, sessions: 0, longSession: false });
    this.deps.emit('progression:reward', {
      kind: 'cosmetic',
      title: 'Cosmético desbloqueado',
      detail: entry.name.es,
      points: 0,
      level: null,
    });
    this.changed();
    const cosmetic = this.catalog().find((item) => item.id === id);
    if (!cosmetic) throw new LauncherError('NOT_FOUND', `Unknown cosmetic "${id}".`);
    return { profile: this.profile(), cosmetic };
  }

  equip(id: string): ProgressionProfileModel {
    const entry = cosmeticById(id);
    if (!entry) throw new LauncherError('NOT_FOUND', `Unknown cosmetic "${id}".`);
    if (!this.deps.repo.owns(id)) throw new LauncherError('INVALID_INPUT', 'You do not own this cosmetic yet.');
    this.deps.repo.setLoadout(entry.slot, id);
    this.changed();
    void this.exportBridge();
    return this.profile();
  }

  unequip(slot: string): ProgressionProfileModel {
    this.deps.repo.setLoadout(slot, null);
    this.changed();
    void this.exportBridge();
    return this.profile();
  }

  setTitle(titleId: string | null): ProgressionProfileModel {
    const row = this.deps.repo.profile();
    const identity = this.refreshTitles(row, this.identityOf(row));
    if (titleId !== null && !identity.ownedTitleIds.includes(titleId)) {
      throw new LauncherError('INVALID_INPUT', 'This title is not unlocked yet.');
    }
    this.deps.repo.saveProfile({ identityJson: JSON.stringify({ ...identity, titleId }) });
    this.changed();
    void this.exportBridge();
    return this.profile();
  }

  // ---------------------------------------------------------------- bridge

  private changed(): void {
    this.deps.emit('data:changed', { scope: 'progression' });
  }

  /**
   * Writes the versioned JSON bridge the in-game mod reads. Best-effort and
   * synchronous-safe: failures are logged, never thrown into game flows.
   */
  async exportBridge(): Promise<string | null> {
    const gameDir = this.deps.resolveClientGameDir();
    if (!gameDir) return null;
    try {
      const snapshot = this.profile();
      const equipped = this.catalog().filter((item) => item.equipped);
      const bridge: KlymonBridge = {
        version: 1,
        exportedAt: new Date().toISOString(),
        displayName: snapshot.identity.displayName,
        rankPrefix: snapshot.identity.rankPrefix,
        rankColor: snapshot.identity.rankColor,
        title: snapshot.identity.titleText?.es ?? null,
        titleColor: snapshot.identity.titleColor,
        level: snapshot.level.level,
        balance: snapshot.balance,
        lifetimePoints: snapshot.lifetimePoints,
        playSeconds: snapshot.playSeconds,
        sessions: snapshot.sessions,
        loadout: equipped.map((item) => ({
          slot: item.slot,
          id: item.id,
          colors: item.visual.colors,
          particle: item.visual.particle ?? null,
          shape: item.visual.shape ?? null,
          baseItem: item.visual.baseItem ?? null,
        })),
      };
      const dir = join(gameDir, 'config');
      await ensureDir(dir);
      const file = join(dir, 'klymon-bridge.json');
      await writeJsonAtomic(file, bridge);
      return file;
    } catch (error) {
      this.deps.logger.warn('progression', `Could not export the in-game bridge: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
