# Klymon Launcher

A modern Minecraft Java Edition launcher built with Electron, React and TypeScript. It installs and launches real Minecraft versions, installs real modloaders, manages isolated instances, and browses Modrinth content — no mock data and no dead buttons.

<p align="center">
  <img src="build/icon.png" width="120" alt="Klymon Launcher icon">
</p>

## What it does

- **Premium and offline accounts** — Microsoft device-code sign-in with encrypted token storage (Electron `safeStorage`), plus offline profiles that reproduce Java's offline UUID algorithm exactly.
- **Real game installation** — official Mojang version manifests, rule-based library selection, legacy native classifiers, pre-1.6 `virtual` assets, SHA-1 verified downloads with resume and de-duplication.
- **Real game launch** — builds the classpath and argument list from the version JSON, provisions a matching Java runtime from Mojang's runtime index when needed, streams stdout/stderr to the in-app console.
- **Modloaders** — Fabric, Quilt, LegacyFabric (meta API), Forge and NeoForge (official installers run headlessly). OptiFine is guided, not automated (see [FEATURES.md](FEATURES.md)).
- **Isolated instances** — per-instance game directory, JVM memory/arguments, mods, resource packs, shaders, worlds, backups, export/import.
- **Content** — Modrinth search/install for mods, resource packs and shaders; `.mrpack` modpack install and export; CurseForge with a user API key.
- **Klymon Client** — a bundled Fabric 1.21.1 profile with 16 curated performance/PvP mods and its own Salwyrr-style UI: branded title screen, client settings, an addons screen for the built-in HUD, nine configurable HUD modules, toggle sprint/sneak and fullbright, plus a generated branding resource pack. Installed by default from onboarding and repairable/updatable from the Home card.
- **Crash diagnosis** — when the game dies, Klymon reads the crash report or `latest.log`, explains the likely cause and offers repairs (memory, reinstall, logs) instead of a bare exit code.
- **Skins** — 3D preview with capes and animations, PNG import, import another player's skin straight from Mojang, classic/slim models, rename/delete, and upload or reset on premium accounts.
- **Quality of life** — news from Mojang's launcher content API, local music player, performance recommendations, onboarding wizard, Spanish/English UI, accessible components.

## Requirements

- Node.js ≥ 20.11 and pnpm 10 (`corepack enable`).
- Windows, Linux or macOS. Packaging targets are configured for all three; only the Windows installer has been built and smoke-tested in this workspace.
- A Minecraft: Java Edition licence for premium sign-in. Offline mode works without one (single-player and offline-mode servers only).
- A JDK 21 on `PATH` **only** if you rebuild the bundled client menu mod (`pnpm client:build`). The committed jar is used otherwise.

## Development

```bash
pnpm install
pnpm dev            # Electron + Vite with hot reload
pnpm typecheck      # main/preload and renderer TypeScript projects
pnpm test           # Vitest unit/integration tests
pnpm build          # production bundles in apps/desktop/out
pnpm client:build   # rebuild the bundled Klymon menu mod (needs JDK 21, caches jars in .tools/)
node scripts/smoke.mjs   # launch the built app over CDP and assert the UI boots
node scripts/verify-client.mjs   # install the Klymon Client over IPC and launch it for real
```

End-to-end tests that hit real Mojang/Fabric servers are opt-in:

```bash
pnpm test:e2e:install   # downloads and installs real Minecraft 1.5.2 and Fabric 1.21.1
pnpm test:e2e:launch    # installs + boots Minecraft 1.5.2 with Mojang's Java 8 runtime
```

## Packaging

```bash
pnpm icon             # regenerate build/icon.png and build/icon.ico
pnpm package:win      # NSIS installer -> release/
pnpm package:linux    # AppImage, deb, rpm (must run on Linux)
pnpm package:mac      # dmg x64 + arm64 (must run on macOS)
```

Builds are unsigned. Windows SmartScreen and macOS Gatekeeper will warn until you configure code signing (`CSC_LINK`/`CSC_KEY_PASSWORD`, `APPLE_ID`, …).

## Where data lives

The launcher keeps everything under its data root, `<userData>/data` by default (`%APPDATA%/Klymon Launcher/data` on Windows, `~/.config/Klymon Launcher/data` on Linux, `~/Library/Application Support/Klymon Launcher/data` on macOS):

```
data/
  launcher.db        SQLite database (settings, accounts, instances, activity, …)
  logs/              rotating launcher logs
  java/              Mojang-provided Java runtimes
  libraries/         shared Maven libraries
  assets/            shared asset objects and indexes
  versions/          installed version profiles
  instances/         one isolated game directory per instance
  backups/           instance exports and .mrpack files
  temp/              staging area for downloads and installers
```

The location can be changed in Settings; the new path is stored in `bootstrap.json` next to the app's user data and takes effect after a restart (files are not moved automatically).

## Project layout

```
apps/desktop        Electron main, preload and React renderer
packages/*          13 focused libraries (auth, versions, modloaders, content, …)
tests/              Vitest suites, including opt-in live downloads
scripts/            icon generation, CDP smoke test, E2E runner
docs/DECISIONS.md   Architecture decision records
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together.

## Documentation

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Process model, modules, IPC, install/launch pipelines, data model |
| [FEATURES.md](FEATURES.md) | Feature-by-feature status matrix, including limitations |
| [ROADMAP.md](ROADMAP.md) | What is done, what is next, what is explicitly out of scope |
| [SECURITY.md](SECURITY.md) | Threat model, token handling, CSP, IPC and protocol hardening |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, conventions, tests, review checklist |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [docs/DECISIONS.md](docs/DECISIONS.md) | ADRs for the non-obvious choices |
| [client-mod/README.md](client-mod/README.md) | The Klymon in-game menu mod: build, remap step, output jar |

## Limitations (short version)

- OptiFine cannot be installed automatically: there is no public API and its installer is interactive. The launcher explains the OptiFabric route instead of pretending.
- CurseForge needs a personal API key entered in Settings; without it the launcher says so.
- CurseForge-format modpack zips are recognised but rejected with a clear message; Modrinth `.mrpack` packs are fully supported.
- Auto-update is wired through `electron-updater` but needs a real feed URL configured in Settings.
- Premium sign-in has not been exercised by automated tests (it needs a real Microsoft account). Offline profiles, installation and launching are tested end to end.

## Licence

MIT — see [LICENSE](LICENSE).
