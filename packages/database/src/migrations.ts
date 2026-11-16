import type Database from 'better-sqlite3';

export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '0001_initial',
    sql: `
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, uuid TEXT NOT NULL,
        skin_url TEXT, cape_url TEXT, local_skin_path TEXT, secret_blob TEXT,
        created_at TEXT NOT NULL, last_used_at TEXT, active INTEGER NOT NULL DEFAULT 0,
        session_valid INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS instances (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        mc_version TEXT NOT NULL, loader_type TEXT NOT NULL DEFAULT 'vanilla', loader_version TEXT,
        launch_version_id TEXT NOT NULL, directory TEXT NOT NULL, java_path TEXT,
        min_memory_mb INTEGER NOT NULL DEFAULT 1024, max_memory_mb INTEGER NOT NULL DEFAULT 4096,
        jvm_args TEXT NOT NULL DEFAULT '[]', game_args TEXT NOT NULL DEFAULT '[]', account_id TEXT,
        icon_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_played_at TEXT,
        play_time_seconds INTEGER NOT NULL DEFAULT 0, installed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS version_installations (
        version_id TEXT PRIMARY KEY, mc_version TEXT NOT NULL, loader_type TEXT NOT NULL DEFAULT 'vanilla',
        loader_version TEXT, installed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS installed_content (
        id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, kind TEXT NOT NULL, file_name TEXT NOT NULL,
        path TEXT NOT NULL, project_id TEXT, version_id TEXT, title TEXT NOT NULL, version_number TEXT,
        icon_url TEXT, enabled INTEGER NOT NULL DEFAULT 1, size_bytes INTEGER NOT NULL DEFAULT 0,
        installed_at TEXT NOT NULL, sha1 TEXT, source_url TEXT
      );
      CREATE INDEX IF NOT EXISTS content_instance_idx ON installed_content (instance_id, kind);
      CREATE TABLE IF NOT EXISTS activity (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, instance_id TEXT, message TEXT NOT NULL, detail TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, instance_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS skins (
        id TEXT PRIMARY KEY, account_id TEXT, name TEXT NOT NULL, file_path TEXT NOT NULL,
        variant TEXT NOT NULL DEFAULT 'classic', is_active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, label TEXT NOT NULL, path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS music_tracks (
        id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT '',
        album TEXT NOT NULL DEFAULT '', duration_sec INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id TEXT NOT NULL, track_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS cache_entries (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
  },
  {
    id: '0002_progression',
    sql: `
      CREATE TABLE IF NOT EXISTS progression_profile (
        id TEXT PRIMARY KEY, lifetime_points INTEGER NOT NULL DEFAULT 0,
        spent_points INTEGER NOT NULL DEFAULT 0, play_seconds INTEGER NOT NULL DEFAULT 0,
        sessions INTEGER NOT NULL DEFAULT 0, days_json TEXT NOT NULL DEFAULT '[]',
        streak_count INTEGER NOT NULL DEFAULT 0, streak_last_day TEXT,
        first_seen_at TEXT NOT NULL, identity_json TEXT NOT NULL DEFAULT '{}',
        seal TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS points_ledger (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, day_key TEXT NOT NULL,
        source TEXT NOT NULL, delta INTEGER NOT NULL, balance_after INTEGER NOT NULL,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS ledger_day_idx ON points_ledger (day_key);
      CREATE TABLE IF NOT EXISTS cosmetics_inventory (
        cosmetic_id TEXT PRIMARY KEY, acquired_at TEXT NOT NULL, source TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cosmetic_loadout (
        slot TEXT PRIMARY KEY, cosmetic_id TEXT
      );
      CREATE TABLE IF NOT EXISTS quest_progress (
        quest_id TEXT NOT NULL, window_key TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT, claimed INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (quest_id, window_key)
      );
      CREATE TABLE IF NOT EXISTS daily_claims (
        day_key TEXT PRIMARY KEY, streak INTEGER NOT NULL, points INTEGER NOT NULL,
        claimed_at TEXT NOT NULL
      );
    `,
  },
];

export function runMigrations(sqlite: Database.Database): void {
  sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    sqlite
      .prepare('SELECT id FROM _migrations')
      .all()
      .map((row) => (row as { id: string }).id),
  );
  const record = sqlite.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)');
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    const apply = sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      record.run(migration.id, new Date().toISOString());
    });
    apply();
  }
}
