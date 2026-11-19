# Klymon Ecosystem — Project Audit

Brand: **Klymon**. Target meta-name: **klymon-ecosystem**.
Date: 2026-11-17. Scope: `C:\Dev\Mc` (klymon-launcher monorepo).

> Domain placeholders in this doc set use `klymon.*` (e.g. `api.klymon.example`).
> The real domain is **not confirmed** — confirm before provisioning DNS, OAuth
> redirects, or update feeds.

## 1. What exists

| Area | Evidence |
|---|---|
| Monorepo | `package.json` klymon-launcher 0.1.0, pnpm@10.18.0, node>=22.14 |
| Workspaces | `pnpm-workspace.yaml`: `apps/*`, `packages/*`; `.npmrc` hoisted linker |
| Desktop app | `apps/desktop` @klymon/desktop 0.1.0, Electron 45 + React 19 + TS strict |
| Packages | 14 × `@klymon/*` v0.1.0: auth, core, database, download, instance, java, mod, modloader, music, performance, progression, shared-types, skin, version |
| Client mod | `client-mod/` klymon-menu 1.3.0, Fabric MC 1.21.1, Java 21, no-mixin, Gradle-free build |
| Tests | `tests/` 24 vitest suites + helpers (17 at audit + 4 in M3 + 3 content suites in M4); e2e opt-in with real servers; `vitest.config.ts` node, 30 s timeout |
| Scripts | `scripts/`: build-client-mod, e2e, smoke (CDP :9333), generate-icon, verify-client, verify-progression |
| CI/CD | `.github/workflows/ci.yml` (typecheck+test+build, ubuntu); `release.yml` (NSIS win, artifact on main, GitHub release on `v*` tags); `docs/CI-CD.md`; unsigned builds |
| Git | `main` synced with `origin/main` (github.com/Srfilif/klymon), 8 commits; untracked: `.pnpm-store/`, `Mods/` |
| Docs | README, ARCHITECTURE, FEATURES, ROADMAP, SECURITY, CONTRIBUTING, CHANGELOG, `docs/DECISIONS.md` (ADRs 001-007+), `client-mod/README.md` |
| Loose mods | `Mods/{oleoled,oleotu,tornix-mod}`: three AutoUtils variants (Gradle+Loom, untracked, NOT part of the client) — oleoled (MC 1.21.4, nested config), oleotu (MC 1.21.8 port attempt, `com.example` coordinates, has `run/` saves), tornix-mod (MC 1.21.4, flat config, features default OFF). All keep stock Example-template files alongside. Corrected M2 (audit called two of them pure templates). |
| Absent | No backend, landing, dashboard, admin projects; no Dockerfile/docker-compose; no `.env` files |

## 2. Architecture (as built)

- Electron main (`apps/desktop/src/main/`): single-instance, BrowserWindow
  1320×840, `contextIsolation/sandbox/no-node-integration`, bootstrap
  data dir → paths → logger → AppContext, `before-quit` kills game + closes DB.
- IPC: 118 channels (105 M1 + `onboarding:event` M3 + `content:pin` M4 + 4 `platform:*` and 7 `sync:*` M7; `packages/shared-types/src/ipc.ts` IPC_CHANNELS +
  IpcContract + IpcEventMap), `main/ipc.ts` wrapper with
  `assertTrustedSender` + per-channel strict zod schemas (`ipc-schemas.ts`),
  JSON `{code,message}` errors; preload is an allowlist bridge only.
- Custom protocols (`protocols.ts`): `app://` (renderer + CSP), `klymon-media://`
  (CORS * for WebGL skin viewer), `klymon-music://`; `safeJoin`/`isInside`
  anti-traversal on every file-backed channel.
- Renderer: HashRouter + I18n/App/Music providers, onboarding gate, 14 page
  files / 16 routes (Home, Play, Instances, Versions, Content splits, Skins,
  Music, News, Settings, Accounts, Profile, Quests, Shop, Onboarding).
- Services (main): settings, accounts, secrets, game, client, branding,
  progression, crash, updater, news-cache, download orchestration.
- Packages: pure Node/TS libraries, no Electron dependency; strict TS +
  `noUncheckedIndexedAccess`, ES2023/Bundler, `@klymon/*` path aliases.
- Client mod (~50 Java files, `com.klymon.clientmenu`): KlymonMenuClient
  entrypoint, 14 internal addons + 8 read-only ExternalModAddon mirrors,
  HudManager/HUD editor, 7 profile presets, KlymonBridge
  (`config/klymon-bridge.json` v1 lenient) launcher→game,
  SessionHeartbeat (`config/klymon-session.json` every 10 s in-world) game→launcher.
- Persistence: SQLite via better-sqlite3 (WAL, FK, 5 s busy), drizzle schema,
  19 tables, migrations `0001_initial` + `0002_progression`, transactional
  `_migrations` table. Secrets via OS keyring (Electron safeStorage, `v1:`
  prefix, refuses plaintext when unavailable).
- External APIs: Mojang piston-meta/piston-data/launchermeta/java-runtime,
  resources.download.minecraft.net, launchercontent news, Mojang sessionserver,
  minecraftservices, Microsoft/Xbox device-code chain, Modrinth v2, CurseForge
  v1 (user key), meta fabric/quilt/legacy-fabric, Forge/NeoForge maven.

## 3. Strengths

- Defense in depth on the desktop boundary: sandbox, CSP (prod/dev), sender
  check, strict zod IPC, anti-traversal, redacted logs, keyring-only secrets.
- No network in the client mod: local JSON bridge files only, lenient parsing
  with defaults, static allowlists for bridge-driven particles/items.
- Deterministic, dependency-light client-mod build (javac + tiny-remapper +
  Yarn mappings) with jar/i18n/intermediary sanity asserts in vitest.
- Local-only progression economy with sealed profile, daily caps, heartbeat >
  wall-clock session accounting.
- Honest updater: `disabled` state instead of faked checks when no feed URL.

## 4. Gaps and risks

- Unsigned builds; updater feed URL manual without pin; release `latest.yml`
  name-mismatch decision pending.
- Client-mod toolchain downloads (Mojang/Fabric/Maven) without hash/pin —
  supply-chain gap.
- `Mods/` loose projects untracked and unaudited in depth; `client-mod/build/
  old-aurora-stale/` leftover from the aurora→klymon rename.
- Renderer trusts remote `https:` images for icons (by CSP); user jvmArgs/
  gameArgs unsanitized by design (user power — document, do not silently change).
- Count contradictions RESOLVED in M1 by code counting: IPC = 105 channels
  at audit, 107 now (+ `onboarding:event` M3, + `content:pin` M4);
  (`IPC_CHANNELS` = handlers in `main/ipc.ts`); pages = 14 files / 16 app
  routes (`App.tsx`: index + 15 paths + 1 wildcard catch-all; `ContentPages.tsx`
  holds 4 routes); addons = 14 internal + 8 external = 22 registered
  (`AddonManager.createDefault`; the "18" figure was wrong); test suites = 17
  at audit, 24 now (+ 4 in M3, + `content-curseforge`, `content-mrpack`,
  `content-pins` in M4)
  (+ Java `LogicTest`, run from `client-addons.test.ts`).
- Coverage gaps: ALL CLOSED in M2 (see §6). No unread production file remains
  from the audit gap list.

## 5. Reuse / refactor / create (summary)

- **Reuse as-is**: all 14 packages' public behavior, IPC contract, DB schema +
  migrations, client-mod addon/HUD/bridge protocol, CI release pipeline shape.
- **Refactor (no blind rewrites)**: count contradictions, stale build output,
  profile-list cap, fullbright gamma persistence, i18n gaps, unbounded caches.
- **Create**: future `apps/*` (backend/landing/dashboard/admin do not exist —
  only scaffold when a milestone requires them), signed releases, pinned
  toolchain, server-side progression/sync if/when the ecosystem goes online.

See [ARCHITECTURE](./ARCHITECTURE.md) for the target layout and
[IMPLEMENTATION_ROADMAP](./IMPLEMENTATION_ROADMAP.md) for sequencing.

## 6. Coverage closure (M2 — every gap read)

- **Renderer pages (14/14):** Settings (6 cards: appearance/downloads+behavior/
  java/storage/updates/diagnostics + music/about; update-feed hint is a
  `updates.example.com` placeholder), Versions (filter + install dialog with
  recommended loader ★), Instances (full CRUD + launch/install/duplicate/
  export/backup/restore; delete dialog hardcodes `deleteFiles: true`),
  ContentPages (4 thin wrappers over `ContentBrowser`), Skins (3D viewer +
  2D canvas head preview, library, Mojang upload/reset), Music (library +
  player + playlists via `music-context`), News (cards from `news:list`),
  Profile (rank/level/ledger + live-session poll 10 s + seal warning),
  Shop (slot/rarity filters + buy/equip), Quests (daily + rotation + claim),
  Onboarding (6 steps, fires `client:install` in background on finish).
- **Renderer lib:** `i18n.tsx` — single `es` dict is the key source of truth,
  `en` type-must-match (missing translations are compile errors);
  `music-context.tsx` — queue + HTMLAudio playback over `music:read-file`
  URLs; `progression.ts` — 13-line `useProgressionProfile` hook.
- **`core/{platform,maven}.ts`:** Java version/vendor parsing, `inspectJava`
  (10 s probe), search roots per OS (win/mac/linux), depth-3 scan;
  Maven coordinate → repo path + Forge `mc-forge` split.
- **`database/repositories.ts` (517 lines, 11 repos):** activity capped at 500
  rows, points ledger at 2000; progression seal = SHA-256(secret + counters),
  tamper-evident by design (documented in-code).
- **`progression/*`:** economy (2 pts/min, 1500/day cap, 6 h/day, curve
  50·L·(L−1), streak ladder 20→150); identity (3 ranks, 5 titles);
  catalog (28 procedurals, 10 slots, quest-gated legendaries);
  quests (5 daily + 4 weekly pools → 3 picked by FNV-1a rotation, 13
  achievements, cross-validated against the catalog).
- **Java addons (6):** watermark/coords/armor/potions/hit-indicators/
  crosshair — standard HudElement pattern; crosshair draws OVER vanilla
  (no-mixin limit, documented); hit-indicators had the same fragile
  peak-frame sampling as combo — fixed together in M2 (shared `HurtEdge`).
- **Java screens (6):** diagnostics/clipboard screen, settings hub,
  category-tabbed addons list, generic per-setting config editor (with live
  crosshair preview), pause-menu subclass (vanilla preserved), read-only
  bridge profile view.
- **i18n JSONs:** 279 keys each, script-verified zero missing/extra either way.
- **`Mods/*`:** three AutoUtils variants, not templates (see table row above);
  all workflows byte-identical; AntiAfk/AutoClick identical in oleoled+oleotu.
- **Lockfile:** pnpm v9, key pins — electron 45.3.2 (exact), TS 5.9.3,
  vitest 3.2.7, react 19.3.1, zod 4.6.7, better-sqlite3 13.2.0,
  tailwind 4.3.5, electron-builder 26.18.0, electron-updater 6.8.11.
- **Workflows + scripts:** `ci.yml` = install/typecheck/test/build on
  ubuntu+Node22+JDK21; `smoke.mjs`/`verify-client.mjs`/
  `verify-progression.mjs` = CDP harnesses (ports 9333/9334) asserting bridge,
  title-screen attach (`/Klymon Client menu \S+ attached/`), and the full
  progression economy; `generate-icon.mjs` = dependency-free PNG/ICO painter.
- **Follow-ups spotted (not M2 scope):** `Combo`/`Best`/`CPS`/`Ping` HUD labels
  still hardcoded English; download-manager User-Agent points at placeholder
  `github.com/klymon-launcher`; instance delete always wipes files by design.
