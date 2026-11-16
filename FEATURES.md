# Feature status

Legend: **✅** implemented and covered by automated tests · **🔵** implemented, verified manually or only compiled · **🟡** implemented but requires external configuration/credentials · **⛔** not implemented

## Accounts

| Feature | Status | Notes |
| --- | --- | --- |
| Microsoft device-code sign-in | 🟡 | Real endpoints (`login.microsoftonline.com`, `Xbox Live`, `XSTS`, `api.minecraftservices.com`). Automated tests cannot sign in without a real Microsoft account. |
| Token storage | ✅ | `safeStorage`-encrypted blobs in SQLite; refresh handled before expiry. |
| Token refresh / session restore | 🔵 | Refresh path implemented; exercised only with synthetic responses. |
| Offline profiles | ✅ | UUID algorithm matches Java's offline mode (verified against known values). |
| Account switching / removal | ✅ | Active account persisted; removal clears encrypted blobs. |
| Skin fetch for the active account | ✅ | Profile skin and cape URLs resolved from the session and rendered in the 3D viewer. |

## Versions and launching

| Feature | Status | Notes |
| --- | --- | --- |
| Mojang version manifest (all release types) | ✅ | Snapshot, release, old_beta, old_alpha. |
| Library rule evaluation (OS, arch, features) | ✅ | Unit-tested against modern and legacy manifests. |
| Legacy natives (classifier-only libraries) | ✅ | Real 1.5.2 install verified. |
| Legacy `virtual` assets / `pre-1.6` index | ✅ | Real 1.5.2 install verified. |
| Hash-verified downloads | ✅ | SHA-1 mismatch deletes the file and fails. |
| Download resume (`Range`) and cache skip | ✅ | Covered by unit tests. |
| Launch argument construction (legacy + modern) | ✅ | Unit-tested; real launch verified. |
| Real game launch | ✅ | Minecraft 1.5.2 boots with Mojang's Java 8 runtime in the E2E suite. |
| Modern version install (1.21.x) | 🔵 | Fabric 1.21.1 install verified; vanilla 1.21.1 uses the same code path but is not separately asserted. |
| Java runtime auto-provision (Mojang index) | ✅ | Platform/component lookup fixed and verified live. |
| System Java discovery | ✅ | Registry/`PATH`/`JAVA_HOME` parsing and version requirement calculation unit-tested. |
| Console (stdout/stderr) streaming | 🔵 | Wired to the console drawer; visible during the live launch. |
| Crash/exit state reporting | ✅ | Exit code and duration recorded as activity; abnormal exits trigger automatic diagnosis. |
| Crash diagnosis | ✅ | Reads the newest `crash-reports/*.txt` (or a fresh `logs/latest.log`), extracts headline, exception, `Caused by`, mod/memory/Java/graphics/permissions hints, and offers repair, memory increase, log/report opening, copy and retry. |

## Modloaders

| Loader | Status | Notes |
| --- | --- | --- |
| Fabric | ✅ | Live install/merge for 1.21.1. |
| Quilt | 🔵 | Meta API adapter, same merge path as Fabric. |
| LegacyFabric | 🔵 | Meta API adapter. |
| Forge | 🔵 | Official installer run headlessly; not asserted by an automated test (needs a Java 8/17 runtime and several minutes). |
| NeoForge | 🔵 | Same installer path, NeoForge Maven version list. |
| OptiFine | ⛔ | No public API and an interactive installer. The adapter returns guidance (OptiFabric + OptiFine jar). |

## Klymon Client

| Feature | Status | Notes |
| --- | --- | --- |
| Bundled client profile | ✅ | "Klymon Client" instance: Minecraft 1.21.1 + Fabric, 16 curated Modrinth mods (Sodium, Lithium, FerriteCore, Krypton, Iris, Zoomify, Toggle Sprint…), G1 JVM flags. Verified live: ~100 s, 21 jars (16 curated mods, their dependencies and `klymon-menu`), no duplicates, and a real launch to the title screen with an offline account (pack list shows `file/klymon-branding.zip`). |
| Default installation | ✅ | Onboarding offers it checked by default and starts the install in the background; the Home card shows progress and re-runs as "Repair & update". |
| One-click play | ✅ | Launches the client instance through the normal launch pipeline (needs an account). |
| Branding resource pack | ✅ | Procedurally generated pack (360° klymon panorama, overlay, 16 splash texts, icon) installed into `resourcepacks/` and enabled in `options.txt`. Verified end-to-end (221 KB, 10 entries, keeps existing settings) and visually in-game: the title screen renders the Klymon panorama and a custom splash. |
| Custom client UI (`klymon-menu`) | ✅ | A first-party Fabric mod compiled by `pnpm client:build` (javac + Yarn mappings + `tiny-remapper`) and shipped inside the app as `client-mod/klymon-menu.jar`. It replaces the title screen with an Klymon menu (Singleplayer, Multiplayer, client settings, addons, **vanilla Minecraft options**, quit; account and version chips), and Right Shift opens the same hub in game. Verified live: `Klymon Client menu 1.1.0 attached to the title screen`. |
| Client settings screen | ✅ | HUD on/off, HUD scale (75–150 %), HUD corner, accent colour, toggle sprint, toggle sneak and fullbright. Stored in `config/klymon-client.properties` and applied immediately. |
| Client addons screen | ✅ | Toggles the nine bundled HUD modules (watermark, FPS, CPS, ping, coordinates, keystrokes, armour, potions, sprint/sneak indicators), with descriptions, enable/disable all and the explicit note that it configures existing modules instead of installing new ones. |
| Modular HUD | ✅ | Scalable column in any screen corner: FPS, CPS (left/right), ping colour-coded by latency, coordinates, WASD + LMB/RMB keystrokes, armour durability, potion effects with level and timer, and sprint/sneak indicators. |
| Stale-mod pruning | ✅ | Slugs dropped from the curated list are recorded in `retiredSlugs` and removed from `mods/` on install. This fixed a real launch failure where `Cull Less Leaves` declared `sodium <0.6` and hard-failed Fabric loading after the move to Sodium 0.8. |

## Instances and content

| Feature | Status | Notes |
| --- | --- | --- |
| Isolated instances | ✅ | Separate game dirs, per-instance memory/JVM args and loader profile. |
| Instance export/import (`.klymon.zip`) | 🔵 | Implemented with path containment; not covered by tests. |
| Backups | 🔵 | Database entries and archive creation. |
| Mods from Modrinth | ✅ | Search, version resolution for game+loader, download and install. |
| Resource packs from Modrinth | ✅ | Installed into `resourcepacks/`. |
| Shaders from Modrinth | ✅ | Installed into `shaderpacks/`. |
| Modpacks (`.mrpack`) | 🔵 | Installs files and overrides into a new instance; export supported. |
| CurseForge browsing/installing | 🟡 | Requires a personal API key in Settings; explicit error otherwise. |
| CurseForge-format modpack zips | ⛔ | Detected and rejected with a clear message. |
| Content enable/disable/remove | 🔵 | Filesystem operations with safe-name checks. |
| Update check for installed content | 🔵 | Version lookup against the source API. |

## Experience

| Feature | Status | Notes |
| --- | --- | --- |
| 13 UI sections | ✅ | Inicio, Jugar, Versiones, Instancias, Mods, Modpacks, Resource Packs, Shaders, Cuentas, Skins, Música, Noticias, Ajustes. |
| Bilingual UI (es/en) | ✅ | All user-facing strings through the i18n dictionary; Spanish is the default. |
| Onboarding wizard | ✅ | Renders on first run; persisted completion flag. |
| 3D skin viewer | ✅ | `skinview3d` with orbit controls, official cape layer, idle/walk/run/fly animations and auto-rotate toggle. |
| Skin library | ✅ | Import PNG, rename, change arm model (classic/slim), delete, pixel-crisp face thumbnails, applied-state badge. |
| Import a player's skin | ✅ | Real lookup through Mojang profile + session server APIs (verified live with a real account, including texture decoding). |
| Skin upload/apply | 🔵 | Legacy 64x32 uploads blocked with an explanation; Mojang upload/reset use the active account (not exercised by tests). |
| Music player | 🔵 | Folder scan, metadata, playlists, `klymon-music://` streaming. |
| News | ✅ | Live Mojang launcher content API with caching and offline fallback. |
| Performance recommendations | ✅ | Detects CPU/RAM and recommends memory/JVM arguments. |
| Downloads manager | ✅ | Per-transfer progress, speed and aggregate state in the UI. |
| Settings persistence | ✅ | SQLite with encrypted secrets. |
| Data directory relocation | 🔵 | Saved to `bootstrap.json`; applies after restart. |
| Auto-update | 🟡 | `electron-updater` wired, disabled until a feed URL is set in Settings. |
| Accessibility | 🔵 | Focus-visible styles, ARIA labels, keyboardable Radix primitives, reduced-motion and font-scale settings. |
| Theming (dark/light, accent, background image) | 🔵 | Applied through CSS variables. |

## Testing and delivery

| Item | Status | Notes |
| --- | --- | --- |
| Unit/integration tests (Vitest) | ✅ | 13 files, 72 tests: offline UUID, path safety, launch args, Java parsing, crash analysis, skin PNG, database repositories/migrations, download manager, Fabric library resolution, branding pack generation, Klymon Client profile, shipped mod jar, client UI classes and es/en dictionary parity. |
| Live install E2E | ✅ | `tests/e2e-install.test.ts` — real 1.5.2 and Fabric 1.21.1 downloads. |
| Live launch E2E | ✅ | `tests/e2e-launch.test.ts` — boots Minecraft 1.5.2. |
| Klymon Client end-to-end verification | ✅ | `scripts/verify-client.mjs` drives the built app over CDP: runs `client:install` through IPC, asserts the menu jar and retired-slug pruning, launches the real game and requires fresh log lines (Fabric loader, `klymon-menu`, LWJGL backend, title-screen attach) with no renderer console errors. |
| UI smoke test | ✅ | `scripts/smoke.mjs` drives the built app over the DevTools protocol (Playwright-equivalent, no extra dependency). |
| Playwright | ⛔ | Not used; replaced by the CDP smoke test above. |
| Windows installer (NSIS) | ✅ | Built and the packaged app was smoke-tested (`isPackaged: true`, SQLite migrations run, zero console errors). |
| Portable Windows build | 🔵 | Script exists (`pnpm package:win:portable`); electron-builder staging race when combined with NSIS, so it is a separate invocation. |
| Linux (AppImage/deb/rpm) | 🔵 | Configured; not built here (requires Linux). |
| macOS (dmg x64/arm64) | 🔵 | Configured; not built here (requires macOS). |
| Code signing | ⛔ | Not configured. Builds are unsigned. |
