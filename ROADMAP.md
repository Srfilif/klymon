# Roadmap

Status reflects the repository, not intentions. Feature-level detail lives in [FEATURES.md](FEATURES.md).

## 0.1.0 — foundation (current)

- [x] Monorepo, 13 packages, Electron + React + TypeScript + Vite + Tailwind.
- [x] SQLite schema, migrations, repositories.
- [x] Microsoft device-code and offline accounts with encrypted storage.
- [x] Mojang manifest installation, legacy natives/virtual assets, hash-verified resumable downloads.
- [x] Launch pipeline with argument rules and Mojang Java runtime provisioning.
- [x] Verified real install (1.5.2, Fabric 1.21.1) and real launch (1.5.2).
- [x] Isolated instances with per-instance JVM settings.
- [x] Fabric/Quilt/LegacyFabric, Forge/NeoForge installers, OptiFine guidance.
- [x] Modrinth content (mods, packs, resource packs, shaders) and `.mrpack` packs.
- [x] 13-section bilingual UI, onboarding, 3D skins, news, music, performance panel, console.
- [x] Klymon Client: curated Fabric 1.21.1 profile, generated branding pack, and a first-party `klymon-menu` in-game menu, verified by a real install + launch script (`scripts/verify-client.mjs`).
- [x] Windows NSIS installer built and smoke-tested.

## 0.2 — distribution readiness

- [ ] Validate premium sign-in with real Microsoft accounts across regions and child/family accounts.
- [ ] Code signing and notarisation (Windows + macOS) and a real auto-update feed.
- [ ] Build and smoke-test Linux (AppImage/deb/rpm) and macOS (x64/arm64) artifacts in CI.
- [ ] Replace the CDP smoke script with a Playwright suite covering onboarding, instance creation, install and launch flows.
- [ ] Automated tests for Forge/NeoForge installs (needs a provisioned Java in CI).

## 0.3 — content and compatibility

- [ ] CurseForge modpack zip import (manifest + overrides).
- [ ] OptiFine automation through OptiFabric with verified versions, or documented manual import.
- [ ] Content update detection and one-click upgrade for installed mods.
- [ ] Server list with ping/status and quick join.
- [ ] World backups with retention policy.

## Later

- [ ] Multiple simultaneous downloads with per-item pause/resume in the UI.
- [ ] Skin cape management and per-instance skin overrides.
- [ ] Screenshot gallery per instance.
- [ ] Portable mode that keeps the data root next to the executable.
- [ ] ARM64 Windows builds.

## Out of scope

- Cracked/DRM-bypass account authentication. Offline profiles are for legitimate offline use only.
- Bundling or redistributing Minecraft assets or the game itself.
- A marketplace for paid content.
- Running mods in a sandbox; mods execute inside the game process as they always have.
