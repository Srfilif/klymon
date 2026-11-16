# Architecture

Klymon Launcher is a pnpm monorepo: one Electron application plus thirteen focused TypeScript packages. The renderer never talks to the network, the filesystem or the game directly — everything goes through a narrow, validated IPC boundary.

```
┌──────────────────────────────────────────── renderer (React) ────────────────────────────────────────────┐
│ pages / components / i18n / contexts                                                                     │
│                       window.klymon.invoke(channel, payload) · window.klymon.on(event, cb)                │
└───────────────────────────────────────────────┬──────────────────────────────────────────────────────────┘
                                                │ contextBridge (preload, sandboxed)
┌───────────────────────────────────────────────▼──────────────────────────────────────────────────────────┐
│ main process                                                                                             │
│  ipc.ts (87 channels, zod validation, sender check)  security.ts (CSP, navigation, permissions)          │
│  services/  context · game · client · accounts · settings · secrets · news · updater · crash             │
│  protocols.ts  app://bundle · klymon-media://data · klymon-music://music                                 │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ packages (pure Node/TS, no Electron imports except safeStorage adapters in the app layer)                 │
│  core · shared-types · database · download-manager · authentication · version-manager · java-manager      │
│  instance-manager · modloader-manager · mod-manager · skin-manager · performance-manager · music-manager  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Process model

| Process | Responsibility | Trust level |
| --- | --- | --- |
| Main | Filesystem, network, SQLite, child processes (Java), protocols | Fully trusted |
| Preload | Whitelisted channel bridge, no business logic | Trusted, sandboxed, no Node |
| Renderer | UI only. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` | Untrusted |

The window is created with a strict `webPreferences` set (`security.ts`), loaded from `app://bundle/index.html` in production and from the Vite dev server in development. DevTools are disabled in packaged builds.

## Packages

| Package | Responsibility |
| --- | --- |
| `shared-types` | Domain models, IPC contract and zod schemas shared by main and renderer. The preload imports from the dedicated `@klymon/shared-types/ipc` entry so the sandboxed bundle never pulls zod in. |
| `core` | Path layout, atomic JSON writes, logger (pino + UI stream), HTTP client with timeout/retry/progress, SHA-1/SHA-256 helpers, platform detection, `LauncherError`, Maven coordinate helpers. |
| `database` | Drizzle schema, migration runner and repositories over `better-sqlite3`. |
| `download-manager` | Bounded-concurrency downloader: SHA-1 verification, `Range` resume, already-present file skipping, in-flight de-duplication, aggregate progress events. |
| `authentication` | Microsoft device-code flow, Xbox Live + XSTS exchange, Minecraft services profile/login, token refresh, offline UUID derivation. |
| `version-manager` | Version manifest client, rule evaluation, library/native/asset planning and installation, launch argument construction, crash text analysis. |
| `java-manager` | Mojang runtime index client and installer, system Java discovery, major-version requirement calculation. |
| `instance-manager` | Instance lifecycle, directory provisioning, per-instance settings, export/import archives. |
| `modloader-manager` | Fabric/Quilt/LegacyFabric via meta API, Forge/NeoForge via official installers, OptiFine guidance, adapter registry. |
| `mod-manager` | Modrinth and CurseForge clients, content installation, `.mrpack` install/export. |
| `skin-manager` | Skin PNG validation, local library (import, rename, arm model, delete), player skin lookup via Mojang profile/session APIs, and skin upload/reset. |
| `performance-manager` | CPU/RAM detection and memory/JVM argument recommendations. |
| `music-manager` | Local music scanning, metadata parsing, playlists. |

Packages contain no UI and no Electron API calls where avoidable; `better-sqlite3` and `safeStorage` adapters are injected by the app layer.

## IPC

- 87 channels of the form `domain:action` (`versions:list`, `content:install`, `accounts:loginMicrosoft`, …).
- Every payload is validated with a zod schema (`apps/desktop/src/main/ipc-schemas.ts`) before it reaches a service.
- Handlers verify `event.senderFrame`/origin and reject invocations that do not come from the bundled renderer.
- Errors are serialised to a stable shape (`code`, `message`, `details`) and rethrown in the renderer as `LauncherError`.
- Events flow the other way through `webContents.send` on a fixed set of channels (`log:line`, `install:progress`, `download:progress`, `game:state`, `update:status`). The preload subscribes with `window.klymon.on`.

## Custom protocols

| Scheme | Serves | Containment |
| --- | --- | --- |
| `app://bundle` | Built renderer (HTML/CSS/JS) | Served from `apps/desktop/out/renderer` only |
| `klymon-media` | Images and files inside the data root | `safeJoin` rejects `..`, absolute paths and separator tricks |
| `klymon-music` | Audio from the configured music folder | Same containment, plus extension allowlist |

Production responses carry a CSP header (`security.ts`): scripts only from the app bundle, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, images from the app/media schemes or HTTPS, media only from `klymon-music:`, and iframes only for YouTube embeds used by the news feed. Permission requests (camera, geolocation, notifications, …) are denied except sanitised clipboard writes; navigation and `window.open` are blocked in-app and HTTPS links are handed to the system browser.

## Install pipeline

1. `version-manager` fetches the Mojang manifest (`version_manifest_v2.json`) and a version JSON.
2. The installer resolves libraries for the current OS/arch using the `rules` block, including natives classifiers for legacy versions.
3. It selects the asset index (normal or `virtual` for pre-1.6) and plans every asset object by hash prefix.
4. `download-manager` downloads with bounded concurrency, verifying SHA-1 as each file lands, resuming partial files with `Range`, and skipping files already present.
5. Native jars are extracted into the version's native directory; legacy `virtual` assets are materialised into `assets/virtual/legacy`.
6. Metadata is written to `version_installations`, and progress is broadcast per phase.

## Launch pipeline

1. Resolve the account (Microsoft access token with refresh, or offline UUID).
2. Resolve the instance, merge its JVM arguments/memory, and pick the Java runtime: explicit override → instance setting → Mojang runtime for the required major → system Java.
3. Build the classpath from the (possibly modloader-merged) version profile and evaluate the argument templates with feature rules (`has_custom_resolution`, `is_demo_user`, …).
4. Spawn Java with `cwd` set to the instance game directory, stream stdout/stderr to the console drawer, and track lifecycle (`idle → launching → running → exited`).
5. On exit, record activity in the database and emit the final state to the UI. A non-zero exit triggers `CrashService`: it reads the newest crash report from `<gameDir>/crash-reports` (or a fresh `latest.log`), and broadcasts a structured diagnosis (`game:crash`) that the UI renders with hints and repair actions.

Legacy `minecraftArguments` strings, modern `arguments.game/arguments.jvm` arrays, and plain-string entries inside those arrays are all supported (each was a real bug found by the live tests).

## Modloader strategy

| Loader | Strategy |
| --- | --- |
| Fabric / Quilt / LegacyFabric | Fetch loader versions from `meta.fabricmc.net`-compatible APIs, merge the loader profile's libraries and `mainClass` into the base version. |
| Forge / NeoForge | Download the official installer jar, run it headlessly (`--installClient`) against a temporary workspace with a minimal `launcher_profiles.json`, then import the generated profile and libraries. |
| OptiFine | No public API and an interactive installer: the adapter returns explicit guidance instead of silently failing. |

Merged profiles are written as their own version id, so the base version stays pristine and instances stay isolated.

## Data model

`better-sqlite3` with Drizzle ORM and versioned migrations executed at startup.

| Table | Purpose |
| --- | --- |
| `settings` | Key/value settings; secrets (`curseforgeApiKey`) stored as `enc:` + `safeStorage` ciphertext |
| `accounts` | Microsoft and offline profiles, encrypted token blobs, active flag |
| `instances` | Instance metadata, loader, memory, game directory |
| `version_installations` | Installed versions and their install state |
| `activity` | Play sessions and install events |
| `servers` | Saved multiplayer entries |
| `skins` | Skin library entries |
| `backups` | Instance exports |
| `music_tracks`, `playlists`, `playlist_tracks` | Music library |
| `cache_entries` | TTL cache for API responses |

## Klymon Client

The launcher ships a curated client profile in `apps/desktop/src/main/services/client.ts`: the instance metadata (Fabric 1.21.1, memory, G1 flags) plus the Modrinth slugs it installs. `ClientService` is idempotent: it creates the instance if missing, installs the vanilla version + loader through the normal pipeline, resolves each slug to a stable Modrinth project id (and lets the content manager pull required dependencies), and exposes progress over `client:progress`.

`installed` is derived from the instance's install flag, the number of mod rows **and** the presence of the bundled menu mod, so a partially installed client shows as repairable instead of pretending to be ready. Running the installer again updates every curated mod to its latest compatible version.

Slugs that are dropped from the bundle stay in an explicit `retiredSlugs` list. On every install the service deletes a matching jar from `mods/` — the launch pipeline otherwise keeps loading it, which is exactly how `Cull Less Leaves` (declares `sodium <0.6`) broke Fabric startup after the profile moved to Sodium 0.8. Pruning is limited to known slugs, so user-installed mods are never touched.

The companion branding pack (`services/branding.ts`) is generated at install time: a 360° cube-map panorama is sampled from a procedural northern-lights sky, PNG-encoded in-process, zipped with `fflate`, written to `resourcepacks/klymon-branding.zip` and enabled by merging `options.txt` (other settings and pack order are preserved). No third-party art or download is involved.

### Client UI

`client-mod/` is a Fabric mod (`klymon-menu` 1.2.0) that owns the client shell, Salwyrr-style: a modular addon system, a visual HUD editor and configuration profiles.

- `KlymonTitleScreen` replaces the vanilla title screen with an Klymon card: Singleplayer, Multiplayer, client settings, addons, **vanilla Minecraft options** and quit, plus the account name and Minecraft/Fabric versions. It uses the vanilla panorama/blur background and adapts its height to small scaled resolutions.
- `KlymonHubScreen` is the same entry point in game, bound to Right Shift, extended with the HUD editor and profiles.
- `KlymonSettingsScreen` covers the master HUD switch, global scale, accent colour and the entry points to addons, the HUD editor, profiles and diagnostics.
- `KlymonAddonsScreen` has PvP/Performance/HUD/Visual/Utility tabs: built-in modules toggle on/off and open a generic per-addon config screen; Performance entries report the launcher-managed mods live (installed version or missing) and are never toggled from the game. It states that new addons are not installed from there (mods remain the launcher's job).
- `KlymonAddonConfigScreen` renders every `Setting` type (toggles, steppers, cyclers, text fields, colour swatches) plus per-addon "Reset defaults" and a live crosshair preview running the addon's own draw code.
- `KlymonHudEditorScreen` renders every HUD element live over the game with drag-and-drop, arrow-key nudging and per-element scale/opacity/anchor/visibility/lock/enable controls.
- `KlymonProfilesScreen` manages profiles (create, duplicate, rename, delete, export/import as JSON) and per-server auto-load bindings.
- `KlymonHud` is a thin dispatcher: ticks go to `AddonManager.tick`, rendering to `HudManager` (anchor-relative, per-element scale/opacity), server changes to the profile watcher.
- `KlymonConfig` persists the global theme, profiles and bindings to `config/klymon-client.json` (Gson, compile-only — Minecraft ships it at runtime), migrating the legacy `klymon-client.properties` on first run.

Each screen draws its card in `renderBackground` (after the vanilla panorama/blur pass) rather than in `render`: `Screen.render` already performs that pass and then draws the widgets, so calling it manually would paint the blurred frame snapshot back over the panel and text. The HUD editor is the exception: it draws only a light scrim so the live game stays visible underneath.

The jar is built by `scripts/build-client-mod.mjs` (`pnpm client:build`), committed as `apps/desktop/resources/client-mod/klymon-menu.jar`, shipped through `electron-builder`'s `extraResources`, and copied into the instance by `ClientService` on install and launch (SHA-1 compared, so it is a no-op when current).

The build deliberately avoids Gradle/Loom: the script caches the Mojang client jar, Yarn and intermediary mappings, Fabric loader/API modules and compile-only jars (Gson, JOML) under `.tools/` (gitignored), compiles with `javac` against Yarn-named jars, packages `fabric.mod.json` + assets + classes, and remaps the result to intermediary with `tiny-remapper`. A jar that still references Yarn names would fail at runtime, so both the script and `tests/client-profile.test.ts` unzip the artifact and assert intermediary class references. The mod output is always remapped again (only toolchain artefacts are cached), otherwise a rebuild would ship the previous jar. The Minecraft-free core (settings, trackers, profiles, anchors) is covered headlessly by `client-mod/src/test/java/.../LogicTest.java`, compiled and run from `tests/client-addons.test.ts`.



## Failure behaviour

- Network operations have timeouts and retries; user-facing errors carry actionable messages (e.g. missing Java, missing CurseForge key, unsupported modpack format).
- Downloads fail closed: a hash mismatch deletes the file and reports `INTEGRITY` rather than launching with a corrupt jar.
- Installers run with a hard timeout and are killed on cancellation.
- Game processes are killed on launcher quit; the database is closed cleanly on `before-quit`.
