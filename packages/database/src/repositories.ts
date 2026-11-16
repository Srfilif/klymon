import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  accountsTable,
  activityTable,
  backupsTable,
  cacheTable,
  contentTable,
  instancesTable,
  playlistsTable,
  playlistTracksTable,
  serversTable,
  settingsTable,
  skinsTable,
  tracksTable,
  versionInstallationsTable,
  type AccountRecord,
  type ActivityRow,
  type BackupRow,
  type ContentRow,
  type InstanceRow,
  type LauncherDatabase,
  type PlaylistRow,
  type ServerRow,
  type SkinRow,
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
