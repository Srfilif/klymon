# Klymon — Database Design

Engine: SQLite via better-sqlite3 (WAL, foreign keys, 5-s busy timeout).
Access: drizzle-orm (`packages/database/schema.ts`), repositories
(`repositories.ts` — full read pending, see debt item 13), transactional
migrations (`migrations.ts`, `_migrations` table).
File: `<userData>/data/launcher.db` (data dir overridable via
`userData/bootstrap.json`; changing it requires restart).
Owner: main-process services ONLY. No other process writes to this DB.

## Tables (23)

| # | Table | Purpose | Key notes |
|---|---|---|---|
| 1 | `settings` | key/value launcher settings | ~23 fields; includes `progression.seal.v1` (random seal secret); `curseforgeApiKey` stored ENCRYPTED |
| 2 | `accounts` | linked MC/Microsoft + offline profiles | `secret_blob` encrypted via safeStorage; `sessionValid=false` when keyring absent |
| 3 | `instances` | user game instances | unique slug+uuid6 dir, mc version, loader, memory floor 512 |
| 4 | `version_installations` | installed vanilla/loader versions | written by GameService `recordVersion`/`markInstalled` |
| 5 | `installed_content` | per-instance content registry | + index; sha1 per file, origin URLs for mrpack export, `pinned` flag (0003) |
| 6 | `activity` | launcher activity feed | launch/install events |
| 7 | `servers` | saved servers | host regex-validated at IPC layer |
| 8 | `skins` | local skin records | Mojang/sessionserver-sourced |
| 9 | `backups` | instance backup records | saves/config/mods/options.txt zips |
| 10 | `music_tracks` | local music library | metadata via music-metadata |
| 11 | `playlists` | user playlists | — |
| 12 | `playlist_tracks` | playlist membership | — |
| 13 | `cache` | generic KV cache | news entries (30-min TTL), manifest disk cache (15-min TTL) |
| 14 | `progression_profile` | local-only level/points/streaks | sealed; `sealValid` warns on tamper |
| 15 | `progression_ledger` | point awards ledger | single-funnel `award()` writes |
| 16 | `progression_inventory` | owned cosmetics/titles | — |
| 17 | `progression_loadout` | equipped cosmetics | exported to `klymon-bridge.json` |
| 18 | `progression_quest_progress` | quest state | daily/weekly/achievement windows |
| 19 | `progression_daily_claims` | daily cap bookkeeping | `applyDailyCap` enforcement |
| 20 | `sync_docs` | offline doc cache | per (profile, namespace): content + baseVersion + dirty + persisted conflict |
| 21 | `sync_lkg` | last-known-good | last server-accepted copy applied locally; self-heals corrupt cache |
| 22 | `sync_queue` | offline push queue | one coalesced op per doc, FIFO flush |
| 23 | `platform_session` | platform refresh (single row) | safeStorage-encrypted; username + userId alongside |

## Migrations

- `0001_initial`: base tables (1–13 + early progression).
- `0002_progression`: progression tables (14–19).
- `0003_content_pins` (M4): `installed_content.pinned INTEGER NOT NULL
  DEFAULT 0` — existing rows keep working, default unpinned; covered by an
  upgrade test (`tests/content-pins.test.ts`, pre-0003 fixture DB).
- `0004_cloud_sync` (M6): `sync_docs`/`sync_lkg`/`sync_queue` for the
  offline-first engine (`@klymon/sync-engine`); covered by
  `tests/sync-engine.test.ts` (SQLite round-trip + self-heal).
- `0005_platform_session` (M7): `platform_session` single row for the
  encrypted platform refresh token; covered by `tests/platform-auth.test.ts`.
- New changes: add `000N_*` step in `migrations.ts`, transactional,
  backward-compatible (additive preferred; the launcher auto-repairs install
  state but never auto-heals DB rows — keep it that way).

## Related on-disk state (NOT in SQLite)

- `logs/launcher.log` (pino, redacted) + 500-line memory buffer.
- `java/` managed runtimes + `.klymon-runtime.json` markers.
- `versions/`, `libraries/`, `assets/` (+`indexes/objects/log_configs/`),
  `instances/`, `skins/`, `backups/`, `temp/`, `installers/`, `cache/`.
- Game dirs: `klymon-client.json` (mod-owned), `klymon-bridge.json`,
  `klymon-session.json` — see [API_DESIGN](./API_DESIGN.md) §3.

## Server-side storage (`apps/api`, Postgres + Prisma, live since M4)

Source of truth: `apps/api/prisma/schema.prisma` + `prisma/migrations/0001–
0012` (identity, email/password recovery, users, wallet ledger, roles,
cosmetics/inventory, addon catalog, cloud sync, handoff codes + client-session
flag, device flow, addon publisher keys + version signatures + per-version
capabilities). Launcher SQLite stays the offline cache
and source of truth when offline. Sync protocol lives in [CLOUD_SYNC](./CLOUD_SYNC.md) — never direct
DB replication of `secret_blob` (tokens never leave the device keyring).
