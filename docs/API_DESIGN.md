# Klymon — API Design

Covers the four real interfaces in the repo: IPC, custom protocols, the
file bridge, and the HTTP backend (`apps/api`, live since M4).

## 1. IPC contract (renderer ↔ main)

- Definition: `packages/shared-types/src/ipc.ts` — `IPC_CHANNELS` (118 channels,
  105 counted M1 + `onboarding:event` in M3 + `content:pin` in M4 + 4
  `platform:*` and 7 `sync:*` in M7; = 118 handlers in `main/ipc.ts`),
  `IpcContract` (typed req/res per channel), `IpcEventMap` (12 push events),
  `PreloadBridge {invoke,on,versions,platform}`.
- Validation: `apps/desktop/src/main/ipc-schemas.ts` — one strict zod schema
  (`.strict()`) per payload-carrying channel (76 of 118; the rest are void);
  failures return `INVALID_INPUT`.
- Envelope: `handle()` wrapper — `assertTrustedSender` → validate → run →
  `encodeError` JSON `{code,message}`. Error codes: `LauncherErrorCode`
  (13 codes, `models.ts`).
- Renderer access: `renderer/src/lib/api.ts` — `invoke`/`onEvent`/`useEvent`/
  `useAsync`, `IpcError` parsing. `models.ts` types: `LoaderType` (7),
  `VersionType`, `Settings` (~23 fields), `Account`, `Instance`,
  `VersionInstallResult`, `LaunchState` (9 phases), `Content*`,
  `DownloadStatus`, `SkinRecord`, `Music`, `News`, `UpdateStatus` (8 states),
  `ClientStatus`, `CrashDiagnosis` + 9 hint ids, `Cosmetic`/`Quest`/`Identity`/
  `Level`/`ProgressionProfile(localOnly:true)`.
- Push events: `log:line`, `download:progress`, `launch:state`, `game:log`,
  `game:crash`, `client:progress`, `data:changed`, `auth:device-code`,
  `progression:reward`.
- Channel groups: app, settings, accounts, versions, instances, loaders,
  content, java, system, skins, news, update, activity, servers, music, logs,
  downloads, progression.
- Rules for new channels: add to `IPC_CHANNELS` + `IpcContract` + zod schema +
  preload allowlist in the same change; request/response types in `models.ts`;
  emit `data:changed` when stores mutate; renderer never imports Node.

## 2. Custom protocols (main → renderer/chromium)

| Scheme | Serves | Notes |
|---|---|---|
| `app://bundle/` | renderer bundle | CSP + nosniff headers |
| `klymon-media://` | skins, images | CORS `*` for WebGL skinviewer; `isInside`-guarded |
| `klymon-music://` | local audio | no-cache; `isInside`-guarded |

All three resolve through `safeJoin` with traversal rejection.

## 3. File bridge (launcher ↔ game)

The ONLY launcher↔mod interface. Both sides parse leniently with defaults.

| File | Direction | Content |
|---|---|---|
| `config/klymon-bridge.json` v1 | launcher → game | identity (`[K]` default), level (1 default), points, loadout, optional `handoff` (`{code, expiresAt, apiUrl}`, single-use §6 code + API base, scrubbed on next export, exchanged by `platform.PlatformLink`); mod re-reads ≤2/s |
| `config/klymon-session.json` | game → launcher | RUN_ID (random), in-world seconds; written every 10 s + on disconnect |

Launcher freshness rule: heartbeat ≤45 s old beats wall-clock; per-run baseline
keyed by runId with anti-jump clamping. Mod rule: cosmetic ids resolve against
static allowlists; unknown → fallback.

## 4. HTTP API (`apps/api`, identity live since M4)

- Base: `https://api.klymon.example` — PLACEHOLDER, confirm the real domain.
  Local: `http://localhost:3001`, Swagger at `/docs`.
- Principles (as built): URI-versioned (`/v1`), zod-validated DTOs, token
  auth (JWT access 15 min + rotating opaque refresh 30 d; never the
  Minecraft tokens — separate ecosystem credentials), offline-first desktop
  (nothing calls the API yet), single error envelope
  `{statusCode, code, message, path, timestamp}`, rate-limited auth routes.
- Live resources: `GET /v1/health/live|ready`, `POST /v1/auth/register|login|
  refresh|logout`, `POST /v1/auth/handoff` (authed, mints a 60 s single-use
  code), `POST /v1/auth/handoff/exchange` (anon, mints a limited 24 h client
  session), device flow (`POST /v1/auth/device/code` anon → user code,
  `POST …/token` → 202 pending | 200 tokens | 410 gone, `GET …/preview` +
  `POST …/approve|deny` authed), `GET /v1/auth/me|sessions` (sessions carry
  `clientSession`),
  `DELETE /v1/auth/sessions/:id`,
  email verify (`POST …/email/request-verification|verify`), password
  (`POST …/password/request-reset|reset|change`), devices (`GET|DELETE
  /v1/auth/devices[/:id]`), minecraft (`GET|POST …/minecraft/link`,
  `DELETE …/minecraft/:id`, `POST …/minecraft/:id/sync`), users
  (`GET|PATCH /v1/users/me`, `GET /v1/users/:username`), wallet
  (`GET /v1/wallet|/transactions`), catalog (`GET /v1/cosmetics`, public),
  inventory (`GET /v1/inventory`, `POST …/purchase|equip`), addons
  (public: `GET /v1/addons[?search&mcVersion&loader]` paginated,
  `GET /v1/addons/:id|/:id/versions`; authed: `GET /v1/addons/mine`,
  `POST /v1/addons`, `PATCH /v1/addons/:id`, `POST /v1/addons/:id/versions`
  (optional Ed25519 `signature`+`keyFingerprint`, verified live; declared
  `capabilities[]` from `hud|tick|config`),
  `GET|POST /v1/addons/keys`, `DELETE /v1/addons/keys/:fp`),
  sync (authed: `GET|POST /v1/sync/profiles`, `PATCH|DELETE …/:id`,
  `GET …/:id/documents[/:ns]`, `PUT …/:ns` versioned push with 409 +
  `details.server`, `GET …/:ns/versions[/:v]`, `POST …/:ns/restore`;
  full protocol in [CLOUD_SYNC](./CLOUD_SYNC.md)),
  admin (`GET /v1/admin/stats|users|cosmetics|addons`,
  `GET /v1/admin/addons/:id` (versions + signature state + capabilities),
  `POST /v1/admin/wallets/adjust`, `POST|PATCH|DELETE
  /v1/admin/cosmetics[/:id]`, `POST …/cosmetics/grant`,
  `PATCH /v1/admin/addons/:id/visibility` (publishing needs a signed latest
  version with a live key → else 409), role-guarded).
  Addon rule: only `published` rows are public (drafts/hidden → 404);
  versions are semver-ordered, downloads stay external (`downloadUrl` +
  `sha256` per version, integrity is the installer's job).
  Refresh reuse revokes the whole session family (theft response); reset
  revokes all sessions, change keeps the current one. Earn/spend/adjust are
  service-only until quest/shop modules call them; no public mint route.
- Next candidates: `GET /v1/news`, progression sync, shop fulfillment, update
  metadata. New surfaces still need an ADR each (ADR-019 covers the scaffold).
