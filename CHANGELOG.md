# Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Priority addon system in `klymon-menu` 1.2.0: 13 built-in modules (keystrokes, CPS, combo, hit indicators, block overlay, FPS & ping, armor status, potion effects, watermark, coordinates, custom crosshair, toggle sprint/sneak, fullbright) with per-addon validated settings and reset-to-defaults.
- Visual HUD editor: drag-and-drop layout over the live game with per-element scale, opacity, anchor, visibility, lock and enable controls.
- Configuration profiles (Default, PvP, BedWars, SkyWars, Practice, Survival, Performance) with create/duplicate/rename/delete, JSON export/import and per-server auto-load bindings; persisted in `config/klymon-client.json` with migration from the legacy properties file.
- In-game Performance tab with live installed/missing detection for the eight evaluated performance mods.
- Headless Java logic suite (`LogicTest`, 80+ assertions) executed from `tests/client-addons.test.ts`.
- Skins page preview modes: flat 2D paper-doll render (with overlay layer, slim support and legacy mirroring) next to the 3D viewer, which now takes the explicit arm model, right-drag panning and zoom in/out/reset controls.
- Local progression ecosystem (`@klymon/progression` + `ProgressionService` + 11 `progression:*` IPC channels): points for playtime/sessions/dailies/quests, level curve, points ledger, tamper-evident SQLite storage (migration `0002_progression`), and a versioned `config/klymon-bridge.json` export for the game.
- Cosmetics shop and inventory (28 items across cape/wings/hat/particles/aura/trail/pet/emote/entrance/profile, five rarities), equip/unequip loadout, daily streak rewards, rotating daily/weekly quests and permanent achievements with claim flow.
- Player profile page (identity, level, stats, loadout, points history), quests page, shop page, header balance chip and reward toasts; Spanish/English strings throughout.
- `klymon-menu` 1.3.0: `[K]` identity on every Klymon surface, in-game player profile screen, level-progress HUD addon, and real client-side cosmetics (procedural cape/wings, item hats/pets, particle trails/auras, entrance bursts, emote keybind).
- Automated releases: pushing a `v*` tag runs typecheck, tests and packaging on Windows/Linux/macOS and uploads the installers to a draft GitHub release; every push/PR runs the lighter CI gates.

### Changed

- Curated profile: added More Culling (verified for 1.21.1/Fabric), retired the third-party Toggle Sprint mod (superseded by the built-in addon), and documented why ModernFix stays optional instead of auto-installed.

### Fixed

- Live playtime sync: the launcher used to record sessions only on game exit and the mod read a bridge frozen at launch, so playtime never updated while playing. Sessions now accrue every 30 s from the mod heartbeat (`klymon-session.json`, reconciled with the wall clock), refreshing points, quests, the launcher UI and the in-game bridge in both directions; the profile shows a live session card.
- Linux CI crashes: raised the Node floor to >= 22.14 (better-sqlite3 13 needs Node-API 10 and segfaulted workers on Node 20 with `ERR_IPC_CHANNEL_CLOSED`), fixed a Windows-only `;` classpath split in the fabric-libraries test, and removed the purposeless shebang from `build-client-mod.mjs` (it broke Vitest collection of the importing test on older Node).
- 3D skin preview for local skins: `klymon-media://` responses now carry `Access-Control-Allow-Origin: *` and the scheme is CORS-enabled, so skinview3d's CORS texture loads (required for WebGL upload) succeed instead of failing silently. Texture load failures now warn in the console.
- Recovered all `packages/*` sources (lost during the monorepo move to `C:\Dev\Mc`) from the production bundles, tests and docs; full suite green (87 passed).

## [0.1.0] — 2026-11-15

First functional release. Everything below is implemented against real services; the limitations section is part of the release notes.

### Added

- Electron + React + TypeScript monorepo with 13 packages and a dependency-injected main-process composition root.
- Microsoft device-code authentication (Microsoft → Xbox Live → XSTS → Minecraft services), session refresh and `safeStorage`-encrypted token persistence.
- Offline accounts with Java-compatible offline UUIDs.
- Minecraft version installation from official Mojang manifests: library rule evaluation, legacy natives classifiers, `pre-1.6` virtual assets, hash-verified downloads with resume and de-duplication.
- Game launching with legacy and modern argument formats, classpath construction, per-instance game directory and streamed console output.
- Automatic Java runtime provisioning from Mojang's runtime index plus system Java discovery.
- Modloader support: Fabric, Quilt, LegacyFabric (meta API) and Forge/NeoForge (official installers run headlessly).
- Isolated instances with memory/JVM settings, backups and `.klymon.zip` export/import.
- Modrinth browsing and installation for mods, resource packs and shaders; `.mrpack` modpack install and export; CurseForge support with a user-supplied API key.
- Skin studio: 3D viewer with cape layer and idle/walk/run/fly animations, PNG import, player-skin import via Mojang profile APIs, classic/slim model selection, rename, delete, face thumbnails and applied-state tracking.
- Klymon Client: bundled Fabric 1.21.1 profile with 16 curated Modrinth performance/PvP mods, installed by default from onboarding and repairable/updatable from the Home card, with live install progress.
- Branding resource pack generated locally (klymon panorama, splashes, icon) and enabled in the client's `options.txt`; confirmed on the in-game title screen.
- Custom client UI: a first-party Fabric mod (`client-mod/`, `klymon-menu` 1.1.0) replaces the title screen with an Klymon menu (Singleplayer, Multiplayer, client settings, addons, vanilla Minecraft options, quit), opens the same hub in game with Right Shift, and adds a nine-module HUD (FPS, CPS, ping, coordinates, keystrokes, armour, potions, indicators, watermark) plus toggle sprint/sneak and fullbright. Built without Gradle via `pnpm client:build` (javac + Yarn mappings + `tiny-remapper`), shipped as an extra resource and installed into the instance by `ClientService`; verified live attaching to the title screen.
- Client settings and addons screens with a persisted `config/klymon-client.properties`; the addons screen configures the bundled modules and says explicitly that it does not install new ones.
- Stale mod pruning: slugs removed from the curated bundle (`retiredSlugs`) are deleted from `mods/` on install instead of lingering in the classpath.
- Fixed Fabric/Quilt launches: Maven-only loader libraries are downloaded and added to the classpath, and the inherited vanilla client jar is resolved from its own version folder.
- Retired Cull Less Leaves from the curated profile after a real launch showed it conflicts with Sodium 0.8.x, and made the client card report the menu mod separately (`client.menu`).
- Crash diagnosis: abnormal exits read the newest crash report or a fresh `latest.log`, explain the likely cause (memory, mods, Java, graphics, arguments, permissions, corrupt files) and offer concrete actions (repair, +1 GB memory, open logs/report, copy diagnosis, retry).
- Music player, Mojang news feed, performance recommendations, downloads manager, console drawer.
- Bilingual Spanish/English UI across 13 sections, onboarding wizard, dark/light themes, accent colours, reduced motion and font scaling.
- 87 IPC channels with zod validation, sender verification, strict CSP, sandboxed preload and path-contained custom protocols.
- Vitest suites (72 tests across 13 files), opt-in live install and launch E2E tests, a CDP UI smoke test, and `scripts/verify-client.mjs` for an end-to-end install + real launch of the Klymon Client.
- Windows NSIS installer (unsigned) with generated PNG/ICO icons; electron-builder configuration for Windows, Linux and macOS.

### Fixed during development

- Argument entries expressed as plain strings in version JSON are now accepted.
- Java major requirement is computed for 1.20.5+ instead of assuming 8/17.
- Libraries that only provide natives through classifiers no longer break installation.
- Legacy `virtual` assets are materialised correctly for pre-1.6 versions.
- `safeName` no longer leaves trailing dot sequences that Windows rejects.
- Mojang runtime index is keyed by platform first; the previous lookup order made `jre-legacy` appear missing.

### Known limitations

- OptiFine is not installed automatically (no public API, interactive installer); the launcher explains the manual/OptiFabric route.
- CurseForge requires a personal API key; CurseForge-format modpack zips are rejected with an explanatory message.
- Premium sign-in, Forge/NeoForge installs, skin uploads and music playback are implemented but not covered by automated tests.
- Auto-update needs a feed URL; builds are unsigned.
- Linux and macOS artifacts are configured but not built in this workspace.

