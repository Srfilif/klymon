import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export const settingsTable = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const accountsTable = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  uuid: text('uuid').notNull(),
  skinUrl: text('skin_url'),
  capeUrl: text('cape_url'),
  localSkinPath: text('local_skin_path'),
  /** Encrypted session payload (safeStorage). Never plaintext tokens. */
  secretBlob: text('secret_blob'),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  sessionValid: integer('session_valid', { mode: 'boolean' }).notNull().default(false),
});

export const instancesTable = sqliteTable('instances', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  mcVersion: text('mc_version').notNull(),
  loaderType: text('loader_type').notNull().default('vanilla'),
  loaderVersion: text('loader_version'),
  launchVersionId: text('launch_version_id').notNull(),
  directory: text('directory').notNull(),
  javaPath: text('java_path'),
  minMemoryMb: integer('min_memory_mb').notNull().default(1024),
  maxMemoryMb: integer('max_memory_mb').notNull().default(4096),
  jvmArgs: text('jvm_args').notNull().default('[]'),
  gameArgs: text('game_args').notNull().default('[]'),
  accountId: text('account_id'),
  iconPath: text('icon_path'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastPlayedAt: text('last_played_at'),
  playTimeSeconds: integer('play_time_seconds').notNull().default(0),
  installed: integer('installed', { mode: 'boolean' }).notNull().default(false),
});

export const versionInstallationsTable = sqliteTable('version_installations', {
  versionId: text('version_id').primaryKey(),
  mcVersion: text('mc_version').notNull(),
  loaderType: text('loader_type').notNull().default('vanilla'),
  loaderVersion: text('loader_version'),
  installedAt: text('installed_at').notNull(),
});

export const contentTable = sqliteTable(
  'installed_content',
  {
    id: text('id').primaryKey(),
    instanceId: text('instance_id').notNull(),
    kind: text('kind').notNull(),
    fileName: text('file_name').notNull(),
    path: text('path').notNull(),
    projectId: text('project_id'),
    versionId: text('version_id'),
    title: text('title').notNull(),
    versionNumber: text('version_number'),
    iconUrl: text('icon_url'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    sizeBytes: integer('size_bytes').notNull().default(0),
    installedAt: text('installed_at').notNull(),
    sha1: text('sha1'),
    sourceUrl: text('source_url'),
  },
  (table) => [index('content_instance_idx').on(table.instanceId, table.kind)],
);

export const activityTable = sqliteTable('activity', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  instanceId: text('instance_id'),
  message: text('message').notNull(),
  detail: text('detail'),
  createdAt: text('created_at').notNull(),
});

export const serversTable = sqliteTable('servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address').notNull(),
  instanceId: text('instance_id'),
  createdAt: text('created_at').notNull(),
});

export const skinsTable = sqliteTable('skins', {
  id: text('id').primaryKey(),
  accountId: text('account_id'),
  name: text('name').notNull(),
  filePath: text('file_path').notNull(),
  variant: text('variant').notNull().default('classic'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const backupsTable = sqliteTable('backups', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').notNull(),
  label: text('label').notNull(),
  path: text('path').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const tracksTable = sqliteTable('music_tracks', {
  id: text('id').primaryKey(),
  path: text('path').notNull().unique(),
  title: text('title').notNull(),
  artist: text('artist').notNull().default(''),
  album: text('album').notNull().default(''),
  durationSec: integer('duration_sec').notNull().default(0),
});

export const playlistsTable = sqliteTable('playlists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const playlistTracksTable = sqliteTable('playlist_tracks', {
  playlistId: text('playlist_id').notNull(),
  trackId: text('track_id').notNull(),
  position: integer('position').notNull().default(0),
});

export const cacheTable = sqliteTable('cache_entries', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const schema = {
  settingsTable,
  accountsTable,
  instancesTable,
  versionInstallationsTable,
  contentTable,
  activityTable,
  serversTable,
  skinsTable,
  backupsTable,
  tracksTable,
  playlistsTable,
  playlistTracksTable,
  cacheTable,
};

export type LauncherDatabase = BetterSQLite3Database<typeof schema>;

export type AccountRecord = typeof accountsTable.$inferSelect;
export type InstanceRow = typeof instancesTable.$inferSelect;
export type VersionInstallationRow = typeof versionInstallationsTable.$inferSelect;
export type ContentRow = typeof contentTable.$inferSelect;
export type ActivityRow = typeof activityTable.$inferSelect;
export type ServerRow = typeof serversTable.$inferSelect;
export type SkinRow = typeof skinsTable.$inferSelect;
export type BackupRow = typeof backupsTable.$inferSelect;
export type TrackRow = typeof tracksTable.$inferSelect;
export type PlaylistRow = typeof playlistsTable.$inferSelect;
