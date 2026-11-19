# Klymon — Security Requirements

Extends `SECURITY.md` (threat model stays authoritative for the desktop app).
Requirements are testable: each SHOULD have a vitest/LogicTest case or a CI gate.

## 1. Desktop boundary (already implemented — must not regress)

- R1.1: `BrowserWindow` keeps `contextIsolation:true`, `nodeIntegration:false`,
  `sandbox:true`, `webSecurity:true`; devTools only in dev.
- R1.2: Every IPC channel validates with a strict zod schema
  (`ipc-schemas.ts` `.strict()`) AND `assertTrustedSender` (allowlist:
  `app://bundle`, `localhost:5199`).
- R1.3: Preload exposes only `IPC_CHANNELS`-whitelisted `invoke`/`on` — no
  Node, fs, or shell primitives reach the renderer.
- R1.4: CSP enforced: production locks scripts to `'self'`, images to
  `klymon-media:`+`https:`, media to `klymon-music:`, frames to
  youtube-nocookie; dev variant only widens for HMR.
- R1.5: All file-backed IPC (`mediaUrl`/`musicUrl`/imports/exports/backups)
  goes through `safeJoin`/`isInside`/`resolveWithin`; `import-background`
  ≤12 MB, png/jpg/webp only.

## 2. Secrets and auth

- R2.1: Microsoft/Minecraft tokens and the CurseForge API key are encrypted
  with Electron safeStorage (`v1:` prefix) and stored as `secret_blob`.
  No plaintext fallback: without a keyring, sessions are memory-only and
  `sessionValid=false`.
- R2.2: Device-code flow (consumers tenant, documented client id) polls with
  `pending`/`slow_down`/`expired`/`declined` handling; XSTS errors mapped via
  `describeXstsError` (XErr codes); token refresh keeps a 5-min margin.
- R2.3: Logs (pino → `logs/launcher.log`, 500-line buffer, `log:line` events,
  game console) redact tokens/secrets/Bearer via `redactSecrets`.
- R2.4: No `.env` secrets in-repo; only `KLYMON_SMOKE_EXE`/`JAVA_HOME`/
  `GH_TOKEN` env vars; releases use `GITHUB_TOKEN` only.
- R2.5: Platform session: refresh token safeStorage-encrypted in
  `platform_session` (never plaintext, never in logs); access token
  memory-only; handoff codes 192-bit, 60 s TTL, single-use (atomic claim),
  exchanged for 24 h client sessions; codes travel launcher→game only via
  the bridge file (never IPC/renderer/JVM args/logs) and are scrubbed by
  the next bridge export.

## 3. Launch and install safety

- R3.1: Modloader installer jars run in a temp workspace with a 10-min timeout;
  merged versions+libraries only.
- R3.2: `extractNatives` excludes `META-INF`, resolves within the target dir
  (fflate, no zip-slip).
- R3.3: CurseForge files with `downloadUrl=null` (third-party blocked) are
  rejected with guidance, never fetched from mirrors.
- R3.4: User `jvmArgs`/`gameArgs` pass through unsanitized BY DESIGN (documented
  user power) — the requirement is that this stays explicit and never silently
  widens to other inputs.

## 4. Client mod (in-game)

- R4.1: The mod performs network I/O ONLY through the platform allowlist
  (amended M7, ADR-025): `platform/JdkPlatformHttp.java` alone may use
  `java.net.http`, and only for the four auth endpoints built by
  `platform/PlatformUrls` (`POST …/handoff/exchange`, `POST …/refresh`,
  `POST …/device/code`, `POST …/device/token`) — HTTPS, or loopback HTTP
  for dev. Pre-existing reads (`PlayerListEntry.getLatency()`,
  server-address strings) stay. Regression test: the network-allowlist case
  in `tests/client-addons.test.ts` greps every `client-mod/src/main` file for
  Http/Socket/URL(/openConnection tokens and fails on anything outside the
  two allowlisted files. Tokens are memory-only: never logged, never written.
- R4.2: All bridge/profile/setting parsing is lenient with safe defaults;
  corrupted `klymon-client.json` is backed up (`.corrupt-<ts>`), never deleted.
- R4.3: Bridge-driven effects (particles/items) resolve against static
  allowlists (15 particles, 14 items); unknown ids fall back, never crash.
- R4.4: `sanitizeId` on profile/addon ids; export path fixed to
  `selectedId.json` with a safe slug; toggle-sprint uses only vanilla
  `setPressed` (no packets); server auto-load never executes commands.

## 5. Supply chain and releases (to satisfy — see P0 debt)

- R5.1: Every client-mod toolchain download (Mojang/Fabric/Maven) pinned +
  hash-verified; hashes recorded in-repo.
- R5.2: Releases signed (or an ADR records why not); update feed URL pinned;
  updater keeps honest `disabled` state (checking/available/downloading/
  downloaded/error/disabled) and `autoDownload=false`.
- R5.3: Native rebuild story (`better-sqlite3`, Electron) stays working via
  `npmRebuild` + `onlyBuiltDependencies`; CI builds on ubuntu, packages on
  windows-latest per `release.yml`.
- R5.4: `pnpm audit --audit-level=high` runs on every CI build and blocks on
  any high/critical advisory. Moderate-or-lower residuals must be recorded
  in `TECHNICAL_DEBT.md` with their fix lever, never silently kept.

## 6. Future online services (only if Milestone 4 is approved)

- R6.1: Desktop works fully offline; online progression/shop/sync is additive.
- R6.2: No launcher-SQLite access from web surfaces; all web reads go through
  `apps/api` (placeholder `api.klymon.example` — confirm real domain).
- R6.3: Third-party addons ship through the signed registry (M5, ADR-028):
  Ed25519 author signatures verified at publish time, moderation publishes
  signed-only versions, revocation blocks future publishes. In-game execution
  runs sandboxed (M5, ADR-029): facade-only API, constant-pool policy scan +
  isolating loader, manifest capability wiring, per-session disable on any
  fault; v1 addon config is in-memory only, first real-game proof is
  CI-owned.
