import { createHash } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  accountsTable,
  activityTable,
  backupsTable,
  cacheTable,
  contentTable,
  cosmeticLoadoutTable,
  cosmeticsInventoryTable,
  dailyClaimsTable,
  instancesTable,
  playlistsTable,
  playlistTracksTable,
  platformSessionTable,
  pointsLedgerTable,
  progressionProfileTable,
  questProgressTable,
  serversTable,
  settingsTable,
  skinsTable,
  syncDocsTable,
  syncLkgTable,
  syncQueueTable,
  tracksTable,
  versionInstallationsTable,
  type AccountRecord,
  type ActivityRow,
  type BackupRow,
  type ContentRow,
  type CosmeticLoadoutRow,
  type CosmeticsInventoryRow,
  type DailyClaimRow,
  type InstanceRow,
  type LauncherDatabase,
  type PlatformSessionRow,
  type PlaylistRow,
  type PointsLedgerRow,
  type ProgressionProfileRow,
  type QuestProgressRow,
  type ServerRow,
  type SkinRow,
  type SyncDocRow,
  type SyncLkgRow,
  type SyncQueueRow,
  type TrackRow,
  type VersionInstallationRow,
} from './schema';

export class AccountRepository {
  constructor(private readonly db: LauncherDatabase) {}

  list(): AccountRecord[] {
    return this.db.select().from(accountsTable).all();
  }

  findById(id: string): AccountRecord | null {
    const rows = this.db.select().from(accountsTable).where(eq(accountsTable.id, id)).all();
    return rows[0] ?? null;
  }

  findActive(): AccountRecord | null {
    const rows = this.db.select().from(accountsTable).where(eq(accountsTable.active, true)).all();
    return rows[0] ?? null;
  }

  findByName(name: string): AccountRecord | null {
    const rows = this.db.select().from(accountsTable).where(eq(accountsTable.name, name)).all();
    return rows[0] ?? null;
  }

  insert(record: AccountRecord): AccountRecord {
    this.db.insert(accountsTable).values(record).run();
    return record;
  }

  update(id: string, patch: Partial<AccountRecord>): void {
    const { id: _ignored, ...rest } = patch;
    if (Object.keys(rest).length === 0) return;
    this.db.update(accountsTable).set(rest).where(eq(accountsTable.id, id)).run();
  }

  remove(id: string): void {
    this.db.delete(accountsTable).where(eq(accountsTable.id, id)).run();
  }

  setActive(id: string): void {
    this.db.update(accountsTable).set({ active: false }).run();
    this.db
      .update(accountsTable)
      .set({ active: true, lastUsedAt: new Date().toISOString() })
      .where(eq(accountsTable.id, id))
      .run();
  }
}

export class InstanceRepository {
  constructor(private readonly db: LauncherDatabase) {}

  list(): InstanceRow[] {
    return this.db.select().from(instancesTable).all();
  }

  findById(id: string): InstanceRow | null {
    const rows = this.db.select().from(instancesTable).where(eq(instancesTable.id, id)).all();
    return rows[0] ?? null;
  }

  findByDirectory(directory: string): InstanceRow | null {
    const rows = this.db.select().from(instancesTable).where(eq(instancesTable.directory, directory)).all();
    return rows[0] ?? null;
  }

  insert(record: InstanceRow): InstanceRow {
    this.db.insert(instancesTable).values(record).run();
    return record;
  }

  update(id: string, patch: Partial<InstanceRow>): void {
    const { id: _ignored, ...rest } = patch;
    if (Object.keys(rest).length === 0) return;
    this.db
      .update(instancesTable)
      .set({ ...rest, updatedAt: new Date().toISOString() })
      .where(eq(instancesTable.id, id))
      .run();
  }

  remove(id: string): void {
    this.db.delete(instancesTable).where(eq(instancesTable.id, id)).run();
  }

  listVersions(): VersionInstallationRow[] {
    return this.db.select().from(versionInstallationsTable).all();
  }

  recordVersion(record: VersionInstallationRow): void {
    this.db
      .insert(versionInstallationsTable)
      .values(record)
      .onConflictDoUpdate({ target: versionInstallationsTable.versionId, set: { installedAt: record.installedAt } })
      .run();
  }

  forgetVersion(versionId: string): void {
    this.db.delete(versionInstallationsTable).where(eq(versionInstallationsTable.versionId, versionId)).run();
  }
}

export class ContentRepository {
  constructor(private readonly db: LauncherDatabase) {}

  list(instanceId: string, kind?: string): ContentRow[] {
    const where = kind
      ? and(eq(contentTable.instanceId, instanceId), eq(contentTable.kind, kind))
      : eq(contentTable.instanceId, instanceId);
    return this.db.select().from(contentTable).where(where).all();
  }

  findById(id: string): ContentRow | null {
    const rows = this.db.select().from(contentTable).where(eq(contentTable.id, id)).all();
    return rows[0] ?? null;
  }

  findByProject(instanceId: string, projectId: string): ContentRow | null {
    const rows = this.db
      .select()
      .from(contentTable)
      .where(and(eq(contentTable.instanceId, instanceId), eq(contentTable.projectId, projectId)))
      .all();
    return rows[0] ?? null;
  }

  insert(record: ContentRow): ContentRow {
    this.db
      .insert(contentTable)
      .values(record)
      .onConflictDoUpdate({
        target: contentTable.id,
        set: { path: record.path, fileName: record.fileName, versionId: record.versionId, versionNumber: record.versionNumber },
      })
      .run();
    return record;
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.update(contentTable).set({ enabled }).where(eq(contentTable.id, id)).run();
  }

  setPinned(id: string, pinned: boolean): void {
    this.db.update(contentTable).set({ pinned }).where(eq(contentTable.id, id)).run();
  }

  setPath(id: string, path: string, fileName: string): void {
    this.db.update(contentTable).set({ path, fileName }).where(eq(contentTable.id, id)).run();
  }

  remove(id: string): void {
    this.db.delete(contentTable).where(eq(contentTable.id, id)).run();
  }

  removeByInstance(instanceId: string): void {
    this.db.delete(contentTable).where(eq(contentTable.instanceId, instanceId)).run();
  }
}

export class SettingsRepository {
  constructor(private readonly db: LauncherDatabase) {}

  readAll(): Record<string, string> {
    const rows = this.db.select().from(settingsTable).all();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  write(values: Record<string, string>): void {
    for (const [key, value] of Object.entries(values)) {
      this.db.insert(settingsTable).values({ key, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value } }).run();
    }
  }
}

export class CacheRepository {
  constructor(private readonly db: LauncherDatabase) {}

  get(key: string, maxAgeMs: number): string | null {
    const rows = this.db.select().from(cacheTable).where(eq(cacheTable.key, key)).all();
    const row = rows[0];
    if (!row) return null;
    const age = Date.now() - new Date(row.updatedAt).getTime();
    if (Number.isFinite(age) && age > maxAgeMs) return null;
    return row.value;
  }

  set(key: string, value: string): void {
    this.db
      .insert(cacheTable)
      .values({ key, value, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: cacheTable.key, set: { value, updatedAt: new Date().toISOString() } })
      .run();
  }

  clear(): void {
    this.db.delete(cacheTable).run();
  }
}

export class ActivityRepository {
  constructor(private readonly db: LauncherDatabase) {}

  list(limit = 50): ActivityRow[] {
    return this.db.select().from(activityTable).orderBy(desc(activityTable.createdAt)).limit(limit).all();
  }

  add(record: ActivityRow): void {
    this.db.insert(activityTable).values(record).run();
    this.db.run(sql`DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY created_at DESC LIMIT 500)`);
  }
}

export class ServerRepository {
  constructor(private readonly db: LauncherDatabase) {}

  list(): ServerRow[] {
    return this.db.select().from(serversTable).orderBy(asc(serversTable.createdAt)).all();
  }

  add(record: ServerRow): ServerRow {
    this.db.insert(serversTable).values(record).run();
    return record;
  }

  remove(id: string): void {
    this.db.delete(serversTable).where(eq(serversTable.id, id)).run();
  }
}

export class SkinRepository {
  constructor(private readonly db: LauncherDatabase) {}

  list(): SkinRow[] {
    return this.db.select().from(skinsTable).orderBy(desc(skinsTable.createdAt)).all();
  }

  findById(id: string): SkinRow | null {
    const rows = this.db.select().from(skinsTable).where(eq(skinsTable.id, id)).all();
    return rows[0] ?? null;
  }

  add(record: SkinRow): SkinRow {
    this.db.insert(skinsTable).values(record).run();
    return record;
  }

  update(id: string, patch: Partial<SkinRow>): void {
    if (Object.keys(patch).length === 0) return;
    this.db.update(skinsTable).set(patch).where(eq(skinsTable.id, id)).run();
  }

  setActive(accountId: string, skinId: string): void {
    this.db.update(skinsTable).set({ isActive: false }).where(eq(skinsTable.accountId, accountId)).run();
    this.db.update(skinsTable).set({ isActive: true }).where(eq(skinsTable.id, skinId)).run();
  }

  remove(id: string): void {
    this.db.delete(skinsTable).where(eq(skinsTable.id, id)).run();
  }
}

export class BackupRepository {
  constructor(private readonly db: LauncherDatabase) {}

  list(instanceId: string): BackupRow[] {
    return this.db.select().from(backupsTable).where(eq(backupsTable.instanceId, instanceId)).orderBy(desc(backupsTable.createdAt)).all();
  }

  findById(id: string): BackupRow | null {
    const rows = this.db.select().from(backupsTable).where(eq(backupsTable.id, id)).all();
    return rows[0] ?? null;
  }

  add(record: BackupRow): BackupRow {
    this.db.insert(backupsTable).values(record).run();
    return record;
  }

  remove(id: string): void {
    this.db.delete(backupsTable).where(eq(backupsTable.id, id)).run();
  }
}

export class MusicRepository {
  constructor(private readonly db: LauncherDatabase) {}

  tracks(): TrackRow[] {
    return this.db.select().from(tracksTable).orderBy(asc(tracksTable.title)).all();
  }

  upsertTracks(records: TrackRow[]): void {
    for (const record of records) {
      this.db
        .insert(tracksTable)
        .values(record)
        .onConflictDoUpdate({
          target: tracksTable.path,
          set: { title: record.title, artist: record.artist, album: record.album, durationSec: record.durationSec },
        })
        .run();
    }
  }

  findTrack(id: string): TrackRow | null {
    const rows = this.db.select().from(tracksTable).where(eq(tracksTable.id, id)).all();
    return rows[0] ?? null;
  }

  playlists(): PlaylistRow[] {
    return this.db.select().from(playlistsTable).orderBy(asc(playlistsTable.createdAt)).all();
  }

  createPlaylist(id: string, name: string, createdAt: string): void {
    this.db.insert(playlistsTable).values({ id, name, createdAt }).run();
  }

  deletePlaylist(id: string): void {
    this.db.delete(playlistTracksTable).where(eq(playlistTracksTable.playlistId, id)).run();
    this.db.delete(playlistsTable).where(eq(playlistsTable.id, id)).run();
  }

  playlistTrackIds(playlistId: string): string[] {
    return this.db
      .select()
      .from(playlistTracksTable)
      .where(eq(playlistTracksTable.playlistId, playlistId))
      .orderBy(asc(playlistTracksTable.position))
      .all()
      .map((row) => row.trackId);
  }

  setPlaylistTracks(playlistId: string, trackIds: string[]): void {
    this.db.delete(playlistTracksTable).where(eq(playlistTracksTable.playlistId, playlistId)).run();
    trackIds.forEach((trackId, index) => {
      this.db.insert(playlistTracksTable).values({ playlistId, trackId, position: index }).run();
    });
  }
}

/**
 * Local progression storage (points, cosmetics, quests, dailies).
 *
 * Integrity model: the numeric counters carry a SHA-256 seal keyed by a
 * per-install secret (generated once, stored in the settings table). This is
 * tamper-*evident*, not tamper-proof: a local user can always edit their own
 * database, but casual edits are detected and surfaced instead of silently
 * trusted. Points are never presented as transferable or server-verified.
 */
export class ProgressionRepository {
  constructor(
    private readonly db: LauncherDatabase,
    private readonly sealSecret: () => string,
  ) {}

  computeSeal(row: Pick<ProgressionProfileRow, 'lifetimePoints' | 'spentPoints' | 'playSeconds' | 'sessions'>): string {
    const canonical = [row.lifetimePoints, row.spentPoints, row.playSeconds, row.sessions].join(':');
    return createHash('sha256').update(`${this.sealSecret()}:${canonical}`).digest('hex');
  }

  sealValid(row: ProgressionProfileRow): boolean {
    if (!row.seal) return true; // rows written before sealing are grandfathered once, then sealed
    return row.seal === this.computeSeal(row);
  }

  profile(): ProgressionProfileRow {
    const rows = this.db.select().from(progressionProfileTable).where(eq(progressionProfileTable.id, 'local')).all();
    const existing = rows[0];
    if (existing) return existing;
    const now = new Date().toISOString();
    const fresh: ProgressionProfileRow = {
      id: 'local',
      lifetimePoints: 0,
      spentPoints: 0,
      playSeconds: 0,
      sessions: 0,
      daysJson: '[]',
      streakCount: 0,
      streakLastDay: null,
      firstSeenAt: now,
      identityJson: '{}',
      seal: '',
      updatedAt: now,
    };
    fresh.seal = this.computeSeal(fresh);
    this.db.insert(progressionProfileTable).values(fresh).run();
    return fresh;
  }

  saveProfile(patch: Partial<ProgressionProfileRow>): ProgressionProfileRow {
    const current = this.profile();
    const next: ProgressionProfileRow = {
      ...current,
      ...patch,
      id: 'local',
      updatedAt: new Date().toISOString(),
    };
    next.seal = this.computeSeal(next);
    this.db.update(progressionProfileTable).set(next).where(eq(progressionProfileTable.id, 'local')).run();
    return next;
  }

  addLedgerEntry(entry: PointsLedgerRow): void {
    this.db.insert(pointsLedgerTable).values(entry).run();
    this.db.run(sql`DELETE FROM points_ledger WHERE id NOT IN (SELECT id FROM points_ledger ORDER BY created_at DESC LIMIT 2000)`);
  }

  ledger(limit = 100): PointsLedgerRow[] {
    return this.db.select().from(pointsLedgerTable).orderBy(desc(pointsLedgerTable.createdAt)).limit(limit).all();
  }

  earnedOnDay(dayKey: string): number {
    const rows = this.db
      .select({ total: sql<number>`COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0)` })
      .from(pointsLedgerTable)
      .where(eq(pointsLedgerTable.dayKey, dayKey))
      .all();
    return rows[0]?.total ?? 0;
  }

  inventory(): CosmeticsInventoryRow[] {
    return this.db.select().from(cosmeticsInventoryTable).orderBy(asc(cosmeticsInventoryTable.acquiredAt)).all();
  }

  owns(cosmeticId: string): boolean {
    const rows = this.db.select().from(cosmeticsInventoryTable).where(eq(cosmeticsInventoryTable.cosmeticId, cosmeticId)).all();
    return rows.length > 0;
  }

  grant(cosmeticId: string, source: string): void {
    if (this.owns(cosmeticId)) return;
    this.db.insert(cosmeticsInventoryTable).values({ cosmeticId, acquiredAt: new Date().toISOString(), source }).run();
  }

  loadout(): CosmeticLoadoutRow[] {
    return this.db.select().from(cosmeticLoadoutTable).all();
  }

  setLoadout(slot: string, cosmeticId: string | null): void {
    this.db
      .insert(cosmeticLoadoutTable)
      .values({ slot, cosmeticId })
      .onConflictDoUpdate({ target: cosmeticLoadoutTable.slot, set: { cosmeticId } })
      .run();
  }

  questState(questId: string, windowKey: string): QuestProgressRow | null {
    const rows = this.db
      .select()
      .from(questProgressTable)
      .where(and(eq(questProgressTable.questId, questId), eq(questProgressTable.windowKey, windowKey)))
      .all();
    return rows[0] ?? null;
  }

  questStatesForWindow(windowKey: string): QuestProgressRow[] {
    return this.db.select().from(questProgressTable).where(eq(questProgressTable.windowKey, windowKey)).all();
  }

  allQuestStates(): QuestProgressRow[] {
    return this.db.select().from(questProgressTable).all();
  }

  saveQuestState(row: QuestProgressRow): void {
    this.db
      .insert(questProgressTable)
      .values(row)
      .onConflictDoUpdate({
        target: [questProgressTable.questId, questProgressTable.windowKey],
        set: { progress: row.progress, completed: row.completed, completedAt: row.completedAt, claimed: row.claimed },
      })
      .run();
  }

  dailyClaim(dayKey: string): DailyClaimRow | null {
    const rows = this.db.select().from(dailyClaimsTable).where(eq(dailyClaimsTable.dayKey, dayKey)).all();
    return rows[0] ?? null;
  }

  recordDailyClaim(row: DailyClaimRow): void {
    this.db.insert(dailyClaimsTable).values(row).onConflictDoNothing().run();
  }
}

export class SyncRepository {
  constructor(private readonly db: LauncherDatabase) {}

  getDoc(profileId: string, namespace: string): SyncDocRow | null {
    const rows = this.db
      .select()
      .from(syncDocsTable)
      .where(and(eq(syncDocsTable.profileId, profileId), eq(syncDocsTable.namespace, namespace)))
      .all();
    return rows[0] ?? null;
  }

  listDocs(profileId: string): SyncDocRow[] {
    return this.db.select().from(syncDocsTable).where(eq(syncDocsTable.profileId, profileId)).all();
  }

  saveDoc(row: SyncDocRow): void {
    this.db
      .insert(syncDocsTable)
      .values(row)
      .onConflictDoUpdate({
        target: [syncDocsTable.profileId, syncDocsTable.namespace],
        set: { content: row.content, baseVersion: row.baseVersion, dirty: row.dirty, conflict: row.conflict, updatedAt: row.updatedAt },
      })
      .run();
  }

  getLkg(profileId: string, namespace: string): SyncLkgRow | null {
    const rows = this.db
      .select()
      .from(syncLkgTable)
      .where(and(eq(syncLkgTable.profileId, profileId), eq(syncLkgTable.namespace, namespace)))
      .all();
    return rows[0] ?? null;
  }

  saveLkg(row: SyncLkgRow): void {
    this.db
      .insert(syncLkgTable)
      .values(row)
      .onConflictDoUpdate({
        target: [syncLkgTable.profileId, syncLkgTable.namespace],
        set: { content: row.content, version: row.version, updatedAt: row.updatedAt },
      })
      .run();
  }

  /** Latest write wins: pushes are full-document, so one queued op per doc suffices. */
  enqueue(row: SyncQueueRow): void {
    this.db
      .delete(syncQueueTable)
      .where(and(eq(syncQueueTable.profileId, row.profileId), eq(syncQueueTable.namespace, row.namespace)))
      .run();
    this.db.insert(syncQueueTable).values(row).run();
  }

  listQueue(profileId: string): SyncQueueRow[] {
    return this.db
      .select()
      .from(syncQueueTable)
      .where(eq(syncQueueTable.profileId, profileId))
      .orderBy(asc(syncQueueTable.enqueuedAt))
      .all();
  }

  dropQueued(id: string): void {
    this.db.delete(syncQueueTable).where(eq(syncQueueTable.id, id)).run();
  }

  clearQueued(profileId: string, namespace: string): void {
    this.db
      .delete(syncQueueTable)
      .where(and(eq(syncQueueTable.profileId, profileId), eq(syncQueueTable.namespace, namespace)))
      .run();
  }
}

export class PlatformSessionRepository {
  constructor(private readonly db: LauncherDatabase) {}

  load(): PlatformSessionRow | null {
    const rows = this.db.select().from(platformSessionTable).where(eq(platformSessionTable.id, 'current')).all();
    return rows[0] ?? null;
  }

  save(row: Omit<PlatformSessionRow, 'id' | 'updatedAt'>): void {
    this.db
      .insert(platformSessionTable)
      .values({ ...row, id: 'current', updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: platformSessionTable.id,
        set: { refreshEnc: row.refreshEnc, username: row.username, userId: row.userId, updatedAt: new Date().toISOString() },
      })
      .run();
  }

  clear(): void {
    this.db.delete(platformSessionTable).where(eq(platformSessionTable.id, 'current')).run();
  }
}
