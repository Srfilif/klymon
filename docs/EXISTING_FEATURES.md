# Klymon — Existing Features

Source of truth for behavior that MUST be preserved. Status legend: ✅ shipped,
🔵 local-only by design, 🟡 partial/known gap. (Mirrors `FEATURES.md` matrix;
that file stays the per-feature board.)

## Launcher (desktop app)

- ✅ Microsoft device-code auth (consumers tenant) + offline profiles
  (`^[A-Za-z0-9_]{3,16}$`); session refresh with 5-min margin; tokens encrypted
  in SQLite via OS keyring (`v1:` prefix); no persistence without keyring
  (`sessionValid=false`).
- ✅ Vanilla version install: piston-meta manifest (15-min cache), inheritsFrom
  resolution (depth ≤5), client jar + ruled libraries + assets + logging config,
  legacy virtual assets, `repair()` = reinstall.
- ✅ Modloaders: Fabric / Quilt / Legacy Fabric via meta APIs; Forge + NeoForge
  via installer jar in a temp workspace (10-min timeout); OptiFine deliberately
  UNSUPPORTED with OptiFabric guidance.
- ✅ Instances: CRUD, unique slug+uuid6 dirs, 512 MB floor, loader reset on MC
  change, duplicate, `.klymon.zip` export/import, backups (saves/config/mods/
  options.txt) + restore, all path-checked with `resolveWithin`.
- ✅ Java: Mojang runtime manifest install + system detection
  (managed → PATH → JAVA_HOME → roots, major desc), per-version major mapping
  (1.21+→21, 1.18+→17, 1.17→16, else 8), executable probe validation.
- ✅ Launch pipeline: phases validating → installing → checking-java →
  preparing → starting → running → exited/failed; AUTH_REQUIRED without account;
  auto-repair on missing profile; 30-s session tick; playtime accrual; kill().
- ✅ Crash diagnosis: prefers recent crash-report, falls back to recent
  latest.log; pure `analyzeCrash` with 9 hint patterns; bounded excerpts.
- ✅ Content: Modrinth v2 + CurseForge v1 (user key, encrypted setting) search/
  versions/install; recursive required deps (depth ≤5, dedupe); `.mrpack`
  install/export; CurseForge-zip modpacks explicitly UNSUPPORTED; toggle via
  `.disabled` rename; `klymon-content.json` manifest snapshots.
- ✅ Klymon Client one-click profile: MC 1.21.1 + Fabric + 16 curated Modrinth
  mods, retired-slug pruning, `klymon-menu.jar` SHA-1 sync, procedural branding
  pack (aurora panorama, icon, ES splashes) with idempotent options merge.
- 🔵 Progression (local-only): points/levels (`50·L·(L−1)` curve shared with
  mod), daily caps, streaks, titles, daily/weekly/achievement quests,
  sealed profile (`progression.seal.v1`), heartbeat-beats-wall-clock session
  elapsed, `exportBridge()` to `config/klymon-bridge.json`.
- ✅ Skins: Mojang/sessionserver lookup, 2D preview + 3D viewer
  (skinview3d/three over `klymon-media://`), local skin records.
- ✅ Music player, news cache (30-min SQLite), servers list (host-regex
  validated), download manager with per-destination single-flight + progress
  events, activity feed, multi-account switching.
- 🟡 Auto-update: electron-updater generic feed, manual channel (latest/beta),
  `disabled` without feed URL or in dev; releases unsigned; `latest.yml`
  hyphenated-name mismatch pending decision.

## Client mod (klymon-menu 1.3.0, in-game)

- ✅ 14 internal addons: keystrokes, cps-counter, combo-counter, hit-indicators,
  block-overlay, fps-ping, armor-status, potion-effects, watermark,
  coordinates, level-progress, custom-crosshair, toggle-sprint-sneak,
  fullbright — validated `Setting<>`s, tick-all (even disabled) for state release.
- ✅ 8 read-only external mirrors (sodium, lithium, ferrite-core,
  immediatelyfast, entityculling, moreculling, dynamic-fps, modernfix) via
  `FabricLoader.isModLoaded`; no toggle, no persistence.
- ✅ HUD engine: per-element anchor+offset+scale (0.5–3)+opacity+visible+lock,
  HUD editor screen (drag, arrow nudge, bottom bar), F1/menu respect, master
  switch, 5 theme accents + global scale 0.75–1.5.
- ✅ Profiles: doc v2 JSON + corrupt-backup + one-way legacy migration,
  7 builtin presets, CRUD with builtin/active protection, JSON export/import,
  per-server auto-load (exact → no-port, never runs commands).
- ✅ Cosmetics (local-only): bridge-driven trails/auras/entrance/emote (G key),
  local-player-only renderer (cape/wings/hat/pet), runtime-rasterized gradient
  textures, static particle/item allowlists (15/14).
- ✅ Session heartbeat: `config/klymon-session.json` every 10 s in-world +
  flush on disconnect, random RUN_ID, `SessionAccumulator` (in-world ticks only).
- ✅ Screens: hub (RightShift), settings, addons, addon-config, profiles,
  HUD editor, pause wrap, player profile; title screen swap; ES+EN i18n.
- 🟡 Known bugs kept as behavior until fixed: profile list capped at 9,
  fullbright gamma persistence, EN-hardcoded strings, `#RGB` short color,
  fragile combo-break heuristic. See [TECHNICAL_DEBT](./TECHNICAL_DEBT.md).

## Explicit non-goals (as built)

- No third-party addon API (registry is hardcoded); no server-side accounts,
  sync, shop fulfillment, or telemetry; cosmetics + `[K]` prefix are local-only.
