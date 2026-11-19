# Klymon Ecosystem — Architecture

Meta-name: **klymon-ecosystem**. Brand: **Klymon** (never "srclient").

> `klymon.*` domains below are PLACEHOLDERS. Confirm the real domain before
> provisioning anything (DNS, OAuth redirects, update feed, API base URLs).

## 1. Current layout (real, keep it)

```text
klymon-ecosystem (repo root: klymon-launcher, pnpm monorepo)
├── apps/desktop            # Electron app: main / preload / renderer
│   └── resources/client-mod/klymon-menu.jar   # built artifact (committed)
├── packages/@klymon/*      # 14 pure Node/TS libs (no Electron import)
│   ├── shared-types        # IPC_CHANNELS, IpcContract, models, zod schemas
│   ├── core                # paths, logger, http, fs guards, errors, text
│   ├── database            # drizzle schema (19 tables) + migrations + repos
│   ├── authentication      # Microsoft device-code → XBL → XSTS → MC
│   ├── version-manager     # manifest, installer, launch, rules, crash
│   ├── modloader-manager   # fabric/quilt/legacy/forge/neoforge, optifine-block
│   ├── mod-manager         # modrinth + curseforge + content orchestration
│   ├── instance-manager    # CRUD, export/import, backups
│   ├── java-manager        # Mojang runtimes + system detection
│   ├── download-manager    # queued downloads, single-flight, progress
│   ├── skin-manager        # Mojang skins, validation, preview data
│   ├── music-manager       # local tracks + playlists
│   ├── performance-manager # system info sampling
│   └── progression         # local-only economy/quests/identity/catalog
├── client-mod/             # Fabric mod klymon-menu (Java 21, no Gradle)
├── Mods/                   # UNTRACKED loose Gradle experiments (not shipped)
├── tests/                  # vitest suites (node), e2e opt-in
├── scripts/                # client-mod build, e2e, smoke, icons, verifiers
└── docs/                   # this doc set + DECISIONS + CI-CD
```

RULE: no blind rewrites. New capabilities extend this layout; existing package
boundaries and the IPC contract stay stable. Any future `apps/*` (backend,
landing, dashboard, admin — none exist today) must reuse `packages/*` behavior
through new adapters, never by forking logic.

## 2. Runtime communication

```text
┌──────────────┐  IPC_CHANNELS (invoke)   ┌──────────────────────┐
│   Renderer   │ ───────────────────────▶ │   Main (services)    │
│ React 19     │ ◀─────────────────────── │ AppContext + SQLite  │
│ HashRouter   │  IpcEventMap (push)      │ SafeSecretStore      │
└──────────────┘   via preload allowlist  └──────┬───────┬───────┘
        │                (no Node in             │       │
        │                 renderer)        Mojang/MS   Modrinth/CF
        │                                        │    meta/maven APIs
        │   file bridge (local JSON only)        │
        ▼                                        ▼
┌──────────────┐  klymon-bridge.json   game launches with
│ client-mod   │ ◀── (launcher→game)   managed java + mods
│ (in-game)    │ ──▶ klymon-session.json  + branding pack
└──────────────┘  (game→launcher, 10 s)
```

- Renderer ↔ main: typed `IpcContract` over `PreloadBridge.invoke`, strict zod
  request/response validation in main, `assertTrustedSender`, push events
  (`log:line`, `download:progress`, `launch:state`, `game:log/crash`,
  `client:progress`, `data:changed`, `auth:device-code`, `progression:reward`).
- Launcher ↔ game: ONLY local files (`config/klymon-bridge.json` v1,
  `config/klymon-session.json`). The mod has zero network. This boundary is
  load-bearing for the security model — keep it.
- Main ↔ external: `core/http` (`KlymonLauncher/0.1` UA, 20 s timeout, exp.
  retries) to Mojang/Microsoft/Modrinth/CurseForge/meta/maven endpoints.
  News cached 30 min in SQLite.

## 3. Target evolution (ecosystem, phased)

```text
Phase 0 (now) : desktop + packages + client-mod, fully local (done, 0.1.0)
Phase 1       : harden + sign + pin; resolve audit contradictions; close debt P0
Phase 2       : apps/api identity live (localhost, placeholder domain) *
Phase 3       : web surfaces live (landing + dashboard + admin, localhost) *
* = each new apps/* gets an ADR (ADR-019/020 cover apps/api); real domain still required before anything internet-facing.
```

Placement rules for future apps:

- `apps/api` (if built): REST/WS service; owns server-side progression/sync;
  the desktop keeps working offline — online is additive, never required.
- `apps/landing`, `apps/dashboard`, `apps/admin` (if built): static/SSR web;
  read from `apps/api`, never from the launcher's SQLite directly.
- Shared web code goes in `packages/` (e.g. extend `shared-types`), never
  duplicated per app.

## 4. Data ownership

- Launcher SQLite (`<userData>/data/launcher.db`): settings, accounts (encrypted
  blobs), instances, installs, content registry, activity, servers, skins,
  backups, music, cache, progression — owned by `packages/database` + main
  services. No other process writes to it.
- Game config dir: `klymon-client.json` (mod-owned), `klymon-bridge.json`
  (launcher writes, mod reads lenient), `klymon-session.json` (mod writes,
  launcher reads lenient + heartbeat freshness ≤45 s beats wall-clock).

## 5. Decisions carried forward (from docs/DECISIONS.md)

Monorepo pnpm; own installer (no CMDL wrapper); OS-keyring secrets with no
plaintext fallback; strict zod IPC; custom `app/klymon-media/klymon-music`
protocols; SQLite + drizzle + transactional migrations. New ADRs continue the
`docs/DECISIONS.md` numbering (next free ADR id).
