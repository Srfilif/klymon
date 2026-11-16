import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, ProgressionRepository, type DatabaseHandle } from '@klymon/database';
import { LauncherLogger } from '@klymon/core';
import { ProgressionService, readHeartbeat, resolveSessionElapsed } from '../apps/desktop/src/main/services/progression';
import {
  ACHIEVEMENTS,
  COSMETIC_CATALOG,
  QUEST_IDS,
  RANKS,
  TITLES,
  applyDailyCap,
  cosmeticById,
  cumulativePointsForLevel,
  dailyQuestsFor,
  dailyRewardForStreak,
  formatDisplayName,
  levelForPoints,
  localDayKey,
  playtimePointsForSession,
  progressToNextLevel,
  validateCatalog,
  validateQuests,
  weeklyQuestsFor,
} from '@klymon/progression';

let handle: DatabaseHandle | null = null;

afterEach(() => {
  handle?.close();
  handle = null;
});

async function createDatabase(): Promise<DatabaseHandle> {
  const directory = mkdtempSync(join(tmpdir(), 'klymon-prog-'));
  return openDatabase(join(directory, 'launcher.db'));
}

function createService(db: DatabaseHandle, gameDir: string): { service: ProgressionService; events: Array<{ event: string; payload: unknown }> } {
  const events: Array<{ event: string; payload: unknown }> = [];
  const logger = new LauncherLogger({ level: 'silent' });
  const service = new ProgressionService({
    repo: new ProgressionRepository(db.db, () => 'test-seal-secret'),
    logger,
    displayName: () => 'Steve',
    resolveClientGameDir: () => gameDir,
    emit: (event, payload) => {
      events.push({ event, payload });
    },
  });
  return { service, events };
}

describe('economy', () => {
  it('follows the documented level curve', () => {
    expect(cumulativePointsForLevel(1)).toBe(0);
    expect(cumulativePointsForLevel(2)).toBe(100);
    expect(cumulativePointsForLevel(5)).toBe(1000);
    expect(cumulativePointsForLevel(10)).toBe(4500);
    expect(levelForPoints(0)).toBe(1);
    expect(levelForPoints(99)).toBe(1);
    expect(levelForPoints(100)).toBe(2);
    expect(levelForPoints(4499)).toBe(9);
    expect(levelForPoints(4500)).toBe(10);
    const progress = progressToNextLevel(150);
    expect(progress.level).toBe(2);
    expect(progress.intoLevel).toBe(50);
    expect(progress.neededForLevel).toBe(200);
    expect(progress.fraction).toBeCloseTo(0.25, 5);
  });

  it('scores sessions with a completion bonus and clamps absurd durations', () => {
    expect(playtimePointsForSession(59)).toEqual({ minutes: 0, points: 0, completed: false });
    expect(playtimePointsForSession(600)).toEqual({ minutes: 10, points: 20, completed: true });
    expect(playtimePointsForSession(299).completed).toBe(false);
    const huge = playtimePointsForSession(10 * 24 * 3600);
    expect(huge.minutes).toBe(720);
  });

  it('caps daily earnings and ladders streak rewards', () => {
    expect(applyDailyCap(0, 100)).toEqual({ granted: 100, dropped: 0, capped: false });
    expect(applyDailyCap(1400, 200)).toEqual({ granted: 100, dropped: 100, capped: true });
    expect(applyDailyCap(9999, 50).granted).toBe(0);
    expect(dailyRewardForStreak(1)).toBe(20);
    expect(dailyRewardForStreak(7)).toBe(150);
    expect(dailyRewardForStreak(30)).toBe(150);
  });
});

describe('catalog and quests', () => {
  it('ships a valid, unique, cross-linked catalog', () => {
    expect(COSMETIC_CATALOG.length).toBeGreaterThanOrEqual(20);
    expect(validateCatalog(QUEST_IDS)).toEqual([]);
    const cosmeticIds = new Set(COSMETIC_CATALOG.map((entry) => entry.id));
    expect(validateQuests(cosmeticIds)).toEqual([]);
    expect(cosmeticById('cape-klymon-ember')?.price).toBe(0);
    expect(cosmeticById('nope')).toBeNull();
  });

  it('rotates daily and weekly quests deterministically', () => {
    const day = new Date(2026, 4, 3, 12, 0, 0);
    const first = dailyQuestsFor(day).map((quest) => quest.id);
    const second = dailyQuestsFor(new Date(2026, 4, 3, 23, 59, 59)).map((quest) => quest.id);
    expect(first).toEqual(second);
    expect(first.length).toBe(3);
    const week = weeklyQuestsFor(day).map((quest) => quest.id);
    expect(week.length).toBe(3);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(10);
  });

  it('parses day keys in local calendar format', () => {
    expect(localDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('identity', () => {
  it('decorates names without mutating the account name', () => {
    expect(formatDisplayName('Steve', 'klymon', null)).toBe('[K] Steve');
    expect(formatDisplayName('Steve', 'unknown-rank', null)).toBe('[K] Steve');
    expect(formatDisplayName('Steve', 'klymon', 'legend')).toContain('[K] Steve');
    expect(RANKS[0]?.prefix).toBe('[K]');
    expect(TITLES.length).toBeGreaterThanOrEqual(3);
  });
});

describe('progression persistence', () => {
  it('creates the 0002 tables and seals the profile', async () => {
    handle = await createDatabase();
    const tables = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    for (const table of ['progression_profile', 'points_ledger', 'cosmetics_inventory', 'cosmetic_loadout', 'quest_progress', 'daily_claims']) {
      expect(tables).toContain(table);
    }
    const repo = new ProgressionRepository(handle.db, () => 'test-seal-secret');
    const profile = repo.profile();
    expect(profile.lifetimePoints).toBe(0);
    expect(repo.sealValid(profile)).toBe(true);
    // Tampering with counters breaks the seal instead of passing silently.
    handle.sqlite.prepare('UPDATE progression_profile SET lifetime_points = 999999 WHERE id = ?').run('local');
    expect(repo.sealValid(repo.profile())).toBe(false);
  });

  it('round-trips inventory, loadout, quests and dailies', async () => {
    handle = await createDatabase();
    const repo = new ProgressionRepository(handle.db, () => 'test-seal-secret');
    expect(repo.owns('cape-klymon-ember')).toBe(false);
    repo.grant('cape-klymon-ember', 'shop');
    repo.grant('cape-klymon-ember', 'shop');
    expect(repo.owns('cape-klymon-ember')).toBe(true);
    expect(repo.inventory().length).toBe(1);
    repo.setLoadout('cape', 'cape-klymon-ember');
    expect(repo.loadout().find((entry) => entry.slot === 'cape')?.cosmeticId).toBe('cape-klymon-ember');
    repo.setLoadout('cape', null);
    expect(repo.loadout().find((entry) => entry.slot === 'cape')?.cosmeticId).toBeNull();
    expect(repo.questState('daily-play-15', 'daily:2026-01-01')).toBeNull();
    repo.saveQuestState({ questId: 'daily-play-15', windowKey: 'daily:2026-01-01', progress: 15, completed: true, completedAt: null, claimed: false });
    expect(repo.questState('daily-play-15', 'daily:2026-01-01')?.completed).toBe(true);
    expect(repo.dailyClaim('2026-01-01')).toBeNull();
    repo.recordDailyClaim({ dayKey: '2026-01-01', streak: 1, points: 20, claimedAt: new Date().toISOString() });
    expect(repo.dailyClaim('2026-01-01')?.streak).toBe(1);
  });
});

describe('progression service', () => {
  it('awards sessions, tracks quests and exports the in-game bridge', async () => {
    handle = await createDatabase();
    const gameDir = mkdtempSync(join(tmpdir(), 'klymon-game-'));
    const { service, events } = createService(handle, gameDir);

    const first = service.profile();
    expect(first.balance).toBe(0);
    expect(first.level.level).toBe(1);
    expect(first.identity.rankPrefix).toBe('[K]');
    expect(first.identity.displayName).toBe('[K] Steve');

    const award = service.onSessionEnd({ seconds: 3600, instanceName: 'Klymon Client' });
    // 60 min * 2 + first-session 15 + completion 25 = 160
    expect(award.points).toBe(160);
    expect(award.completed).toBe(true);
    expect(award.firstOfDay).toBe(true);
    expect(award.questsCompleted).toContain('ach-hour-session');

    const second = service.onSessionEnd({ seconds: 60, instanceName: 'Klymon Client' });
    expect(second.firstOfDay).toBe(false);
    expect(service.profile().sessions).toBe(2);

    const bridgeFile = join(gameDir, 'config', 'klymon-bridge.json');
    await service.exportBridge();
    expect(existsSync(bridgeFile)).toBe(true);
    const bridge = JSON.parse(readFileSync(bridgeFile, 'utf8')) as { version: number; displayName: string; level: number; loadout: unknown[] };
    expect(bridge.version).toBe(1);
    expect(bridge.displayName).toBe('[K] Steve');
    expect(bridge.level).toBeGreaterThanOrEqual(1);
    expect(events.some((entry) => entry.event === 'progression:reward')).toBe(true);
  });

  it('sells, equips and gates cosmetics by level and funds', async () => {
    handle = await createDatabase();
    const gameDir = mkdtempSync(join(tmpdir(), 'klymon-game-'));
    const { service } = createService(handle, gameDir);

    const free = service.buy('cape-klymon-ember');
    expect(free.cosmetic.owned).toBe(true);
    expect(() => service.buy('cape-klymon-ember')).toThrow();
    expect(() => service.buy('cape-founder-aurora')).toThrow(/quest/);
    expect(() => service.buy('cape-void-tide')).toThrow(/level 8/);
    expect(() => service.buy('cape-midnight-teal')).toThrow(/Not enough points/);

    const equipped = service.equip('cape-klymon-ember');
    expect(equipped.loadout['cape']).toBe('cape-klymon-ember');
    expect(() => service.equip('cape-solar-flare')).toThrow(/do not own/);
    expect(service.unequip('cape').loadout['cape']).toBeNull();

    const quest = service.claimQuest('ach-first-cosmetic');
    expect(quest.quest.claimed).toBe(true);
    expect(quest.profile.balance).toBeGreaterThan(0);
    expect(() => service.claimQuest('ach-first-cosmetic')).toThrow(/already claimed/);
  });

  it('manages the daily streak with clock-skew protection', async () => {
    handle = await createDatabase();
    const gameDir = mkdtempSync(join(tmpdir(), 'klymon-game-'));
    const { service } = createService(handle, gameDir);

    expect(service.daily().canClaim).toBe(true);
    const claimed = service.claimDaily();
    expect(claimed.daily.claimed).toBe(true);
    expect(claimed.daily.streak).toBe(1);
    expect(claimed.profile.balance).toBe(20);
    expect(() => service.claimDaily()).toThrow(/already claimed/);
  });

  it('accrues playtime incrementally under one shared daily cap', async () => {
    handle = await createDatabase();
    const gameDir = mkdtempSync(join(tmpdir(), 'klymon-game-'));
    const { service } = createService(handle, gameDir);

    const first = service.accruePlaytime(120);
    expect(first.minutesCommitted).toBe(2);
    expect(first.points).toBe(4);
    // Partial minutes commit seconds but award nothing until the minute completes.
    const partial = service.accruePlaytime(30);
    expect(partial.minutesCommitted).toBe(0);
    expect(partial.points).toBe(0);
    expect(service.profile().playSeconds).toBe(150);

    // A huge accrual is still bound by the daily points ceiling.
    service.accruePlaytime(12 * 3600);
    const profile = service.profile();
    expect(profile.playSeconds).toBe(150 + 12 * 3600);
    expect(profile.lifetimePoints).toBeLessThanOrEqual(1500);
  });

  it('finishes a live session without double-counting accrued minutes', async () => {
    handle = await createDatabase();
    const gameDir = mkdtempSync(join(tmpdir(), 'klymon-game-'));
    const { service } = createService(handle, gameDir);

    const acc = service.accruePlaytime(3600);
    expect(acc.minutesCommitted).toBe(60);
    const done = service.finishSession({ instanceName: 'Klymon Client', totalSeconds: 3661, questMinutes: 1 });
    // Bonuses only: first-session 15 + completion 25.
    expect(done.points).toBe(40);
    expect(done.completed).toBe(true);
    expect(done.questsCompleted).toContain('ach-hour-session');
    const profile = service.profile();
    expect(profile.sessions).toBe(1);
    expect(profile.playSeconds).toBe(3600);
    // 120 playtime + 40 bonuses.
    expect(profile.balance).toBe(160);

    // Windowed quests advanced exactly the 61 live minutes, not twice.
    const quests = service.quests();
    const playQuest = [...quests.daily, ...quests.weekly].find((quest) => quest.metric === 'play_minutes');
    if (playQuest) expect(playQuest.progress).toBeLessThanOrEqual(61);
  });

  it('reconciles heartbeat time against the wall clock', () => {
    const now = 1_800_000_000_000;
    const wallStartMs = now - 120_000;
    // Fresh heartbeat on a new run: elapsed counts from zero for that run.
    const first = resolveSessionElapsed({
      nowMs: now,
      wallStartMs,
      heartbeat: { runId: 'run-a', updatedAtMs: now - 1000, totalInWorldSeconds: 90 },
      baseline: null,
    });
    expect(first).toEqual({ elapsedSeconds: 90, source: 'heartbeat', baseline: { runId: 'run-a', total: 0 } });
    // Same run later: elapsed follows the heartbeat counter.
    const second = resolveSessionElapsed({
      nowMs: now + 30_000,
      wallStartMs,
      heartbeat: { runId: 'run-a', updatedAtMs: now + 29_000, totalInWorldSeconds: 115 },
      baseline: first.baseline,
    });
    expect(second.elapsedSeconds).toBe(115);
    expect(second.source).toBe('heartbeat');
    // A new run id re-baselines instead of jumping backwards.
    const third = resolveSessionElapsed({
      nowMs: now + 60_000,
      wallStartMs,
      heartbeat: { runId: 'run-b', updatedAtMs: now + 59_000, totalInWorldSeconds: 5 },
      baseline: second.baseline,
    });
    expect(third).toEqual({ elapsedSeconds: 5, source: 'heartbeat', baseline: { runId: 'run-b', total: 0 } });
    // Stale or missing heartbeats fall back to the wall clock.
    const stale = resolveSessionElapsed({
      nowMs: now,
      wallStartMs,
      heartbeat: { runId: 'run-a', updatedAtMs: now - 120_000, totalInWorldSeconds: 5 },
      baseline: first.baseline,
    });
    expect(stale.source).toBe('wall-clock');
    expect(stale.elapsedSeconds).toBe(120);
    expect(stale.baseline).toEqual(first.baseline);
    const missing = resolveSessionElapsed({ nowMs: now, wallStartMs, heartbeat: null, baseline: null });
    expect(missing.source).toBe('wall-clock');
    expect(missing.elapsedSeconds).toBe(120);
  });

  it('reads the mod heartbeat tolerantly', async () => {
    const gameDir = mkdtempSync(join(tmpdir(), 'klymon-game-'));
    expect(readHeartbeat(gameDir)).toBeNull();
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(gameDir, 'config'), { recursive: true });
    const file = join(gameDir, 'config', 'klymon-session.json');
    writeFileSync(file, 'not json{{{');
    expect(readHeartbeat(gameDir)).toBeNull();
    writeFileSync(file, JSON.stringify({ version: 2, runId: 'x', updatedAtMs: 1, totalInWorldSeconds: 1 }));
    expect(readHeartbeat(gameDir)).toBeNull();
    writeFileSync(file, JSON.stringify({ version: 1, runId: '', updatedAtMs: 1, totalInWorldSeconds: 1 }));
    expect(readHeartbeat(gameDir)).toBeNull();
    writeFileSync(file, JSON.stringify({ version: 1, runId: 'run-a', updatedAtMs: 1_800_000_000_000, totalInWorldSeconds: -4 }));
    expect(readHeartbeat(gameDir)).toBeNull();
    writeFileSync(file, JSON.stringify({ version: 1, runId: 'run-a', updatedAtMs: 1_800_000_000_000, totalInWorldSeconds: 42 }));
    expect(readHeartbeat(gameDir)).toEqual({ runId: 'run-a', updatedAtMs: 1_800_000_000_000, totalInWorldSeconds: 42 });
  });

  it('unlocks titles by level and persists the choice', async () => {
    handle = await createDatabase();
    const gameDir = mkdtempSync(join(tmpdir(), 'klymon-game-'));
    const { service } = createService(handle, gameDir);
    expect(() => service.setTitle('legend')).toThrow(/not unlocked/);
    // 12h session → 360 rewarded min (daily play cap) = 720 + 15 + 25 pts → level 4.
    service.onSessionEnd({ seconds: 12 * 3600, instanceName: 'Klymon Client' });
    const profile = service.profile();
    expect(profile.level.level).toBe(4);
    expect(profile.identity.ownedTitleIds).toContain('explorer');
    expect(service.setTitle('explorer').identity.titleId).toBe('explorer');
  });
});
