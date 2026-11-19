import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { dirname } from 'node:path';
import { ensureDir } from '@klymon/core';
import { runMigrations } from './migrations';
import { schema, type LauncherDatabase } from './schema';

export interface DatabaseHandle {
  sqlite: Database.Database;
  db: LauncherDatabase;
  close: () => void;
}

export async function openDatabase(file: string): Promise<DatabaseHandle> {
  await ensureDir(dirname(file));
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  runMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  return {
    sqlite,
    db,
    close: () => {
      sqlite.close();
    },
  };
}

export { schema } from './schema';
export type {
  AccountRecord,
  ActivityRow,
  BackupRow,
  ContentRow,
  CosmeticLoadoutRow,
  CosmeticsInventoryRow,
  DailyClaimRow,
  InstanceRow,
  LauncherDatabase,
  PlatformSessionRow,
  PlaylistRow,
  PointsLedgerRow,
  ProgressionProfileRow,
  QuestProgressRow,
  ServerRow,
  SkinRow,
  SyncDocRow,
  SyncLkgRow,
  SyncQueueRow,
  TrackRow,
  VersionInstallationRow,
} from './schema';
export {
  AccountRepository,
  ActivityRepository,
  BackupRepository,
  CacheRepository,
  ContentRepository,
  InstanceRepository,
  MusicRepository,
  PlatformSessionRepository,
  ProgressionRepository,
  ServerRepository,
  SettingsRepository,
  SkinRepository,
  SyncRepository,
} from './repositories';
