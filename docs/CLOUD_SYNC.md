# Klymon — Cloud Sync

Versioned configuration sync between launcher, client and dashboard.
Offline-first: every device works without the API; the server never
silently overwrites newer data.

## 1. Model

- **Profile**: a named bucket of documents (`work`, `pvp`, …). Max 10 per
  user. Users pick the active profile per device; devices may use
  different profiles.
- **Document**: one JSON object per `(profile, namespace)`. Namespaces are
  a closed enum (server-validated); adding one is a deliberate change:
  - `launcher-settings` — syncable launcher `Settings` subset (see §5).
  - `client-config` — `klymon-client.json` (mod-owned config file).
  - `hud-layout` — HUD element layout (mod config file or dashboard edit).
  - `keybindings` — keybind map.
  - `loadout` — equipped cosmetics `{slot: cosmeticId}` (mirrors inventory).
- **Version**: integer, starts at 1, +1 per accepted write. The version is
  the ONLY ordering signal (no wall-clock comparison — clocks lie).
- **History**: every accepted write appends the new content to a capped
  log (last 20 per document). This log IS the server-side
  last-known-good store: anything ever accepted can be restored.

Limits: content ≤ 256 KiB serialized (else `413`), profile name 1–40
chars, history kept 20. All routes require Bearer auth; documents are
per-user (no sharing in v1).

## 2. Push protocol (client → server)

`PUT /v1/sync/profiles/:id/documents/:ns {baseVersion, content, force?}`

- `baseVersion: null` + no server doc → create at v1.
- `baseVersion: null` + server doc exists → `409 CONFLICT` (client must
  pull first; prevents resurrecting deletes/stale creates).
- `baseVersion === server.version` → accept at v+1, append history.
- `baseVersion !== server.version` → `409 CONFLICT` with the server copy:
  `{server: {version, content, updatedAt, updatedBy}}`.
- `force: true` → accept at v+1 from ANY base (explicit "keep mine").
  History still appends, so the overwritten server copy stays restorable.

`updatedBy` is the pusher's truncated user-agent (device label) so the
conflict UI can say "changed on Windows · Chrome".

Restores are pushes with old content: `POST …/restore {baseVersion,
version}` re-applies history entry `version` as a new version. Same
409 rules — a restore never stomps a concurrent write.

## 3. Pull protocol (server → client)

- `GET …/documents` → all docs in a profile with content + version.
- `GET …/documents/:ns` → one doc (`404` if never pushed).
- `GET …/versions?limit=` → history metadata (no content; capped
  payloads), `GET …/versions/:version` → one entry with content.

Client merge rule (engine-enforced, §4): a dirty local doc (unpushed
edits) is NEVER overwritten by a pull. Pull either fast-forwards clean
docs or surfaces a conflict for dirty ones.

## 4. Offline-first engine (`packages/sync-engine` + SQLite `0004`)

The launcher keeps three things per `(profile, namespace)`:

1. **Cache**: last content the device agreed on + `baseVersion` (the
   server version it matches) + `dirty` flag.
2. **Queue**: pushes that failed with network errors, in order. Flushed
   on reconnect / next sync; each flush is a normal push (409s surface
   as conflicts, never auto-forced).
3. **Last-known-good (LKG)**: last server-accepted content successfully
   applied locally. Used when the cache is corrupt and for "discard my
   changes" — always available offline.

Engine operations (pure, transport-injected, fully unit-tested):

- `push(ns, content)` → `pushed | queued | conflict(server)`.
- `pull()` → per-doc `fast-forwarded | up-to-date | conflict(server)`.
- `resolveKeepMine(ns)` → force-push. `resolveKeepTheirs(ns, server)` →
  adopt server, clear dirty, update LKG.
- `status()` → per-doc `{baseVersion, serverVersion?, dirty, queued,
  conflict?}` for honest UI ("synced 2 min ago", "1 conflict", "offline,
  3 queued").

## 5. Launcher wiring (landed M7)

`SyncService` (desktop main) drives the engine over the platform session
(`PlatformAuthService`, shared `KlymonClient`), with `sync:*` IPC channels
(status/profiles/select/push/pull/resolve/revert) and the renderer's
Platform page. Status reads the local cache (works offline/unsigned);
push/pull/resolve need a signed-in profile. The file mapping:

| Namespace | Launcher source | Direction |
|---|---|---|
| `launcher-settings` | `Settings` MINUS secrets (`curseforgeApiKey`) and machine-local keys (`dataDirectory`, `defaultGameDirectory`, `clientInstanceId`, `platformApiUrl`, `syncProfileId`) | both |
| `client-config` | `<game>/config/klymon-client.json` of the client instance | both |
| `hud-layout` | UNSUPPORTED (no stable mod path yet) — rejected with `INVALID_INPUT` | — |
| `keybindings` | `options.txt` `key_*` lines of the client instance (subset merge) | both |
| `loadout` | `cosmetic_loadout` table | both |

Merge rules: settings apply only known syncable keys (unknown keys ignored
for forward-compat); loadout sets provided slots only; keybindings preserve
non-`key_*` lines, order and EOLs. Pulled docs that cannot apply (no client
instance) stay cached with `applied: false` — never lost, applied later.

No Java changes: the mod keeps reading its files; the launcher syncs
those files. Sync replaces nothing, it only moves config bytes. (The
`klymon-bridge.json` `handoff` field is the §6 login handoff, not sync.)

## 6. Threats (sync-specific)

- **Secret upload**: only the §5 allowlist ever leaves the device; the
  server cap (256 KiB) bounds abuse. A malicious client can still push
  junk into its OWN docs — it only hurts itself (per-user isolation).
- **Version forgery**: versions are server-assigned; `baseVersion` is a
  claim, not a write. `force` is authenticated + history-appended, so a
  stolen token can overwrite but never erase history.
- **Replay**: pushes are idempotent-safe (same content + same base →
  second attempt 409s with identical server state, no duplication).
- **Downgrade/restore abuse**: restores need the current base, so two
  devices cannot ping-pong restores without seeing each other's writes.
