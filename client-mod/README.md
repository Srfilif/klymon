# Klymon Client mod (`klymon-menu` 1.3.0)

The first-party Fabric mod behind the client's interface, in the spirit of
Salwyrr Client: its own main menu, a modular addon system with 14 built-in
modules, a visual HUD editor, configuration profiles with per-server
auto-load, `[K]` player identity, an in-game profile screen, and real
client-side cosmetics driven by the launcher, plus live reporting of the
launcher-managed performance mods.

- Mod id: `klymon-menu`
- Environment: `client`
- Target: Minecraft `~1.21.1`, Fabric loader `>=0.15.0`, Java 21, Fabric API

## Addon system

Every module is an `addon.Addon`: unique id, category
(PvP / Performance / HUD / Visual / Utility), version, dependencies, enabled
flag and a list of validated `addon.Setting`s (boolean, int, double, enum,
color, text). The generic `KlymonAddonConfigScreen` renders every setting
type; each addon offers "Reset defaults".

| Id | Category | What it does |
| --- | --- | --- |
| `keystrokes` | PvP | WASD + Space + mouse buttons, per-key visibility, press animations |
| `cps-counter` | PvP | Left/right CPS, measurement window, session maximum |
| `combo-counter` | PvP | Consecutive entity hits; damage taken breaks the combo |
| `hit-indicators` | PvP | Damage dealt/taken flashes + optional particles |
| `block-overlay` | PvP | Custom targeted-block outline + fill (replaces vanilla) |
| `fps-ping` | HUD | FPS + ping, dynamic colours, single/multi line |
| `armor-status` | HUD | Armor icons, durability, percent, both orientations |
| `potion-effects` | HUD | Effect icons, level, duration, hideable ids |
| `watermark` | HUD | Klymon watermark with optional version |
| `coordinates` | HUD | Position with labels/facing options |
| `custom-crosshair` | Visual | 4 presets + size/gap/thickness/colours/outline, live preview |
| `level-progress` | HUD | Klymon level, points balance and level progress bar |
| `toggle-sprint-sneak` | Utility | One-tap sprint/sneak on vanilla keys only, state indicators |
| `fullbright` | Utility | Brightness boost with previous-value restore |

The Performance tab lists Sodium, Lithium, FerriteCore, ImmediatelyFast,
Entity Culling, More Culling, Dynamic FPS and ModernFix with live
installed/missing detection. They are installed by the launcher, never by
the mod; ModernFix is intentionally optional (see
`apps/desktop/src/main/services/client.ts` for the rationale).

## HUD editor

`KlymonHudEditorScreen` (in-game hub → HUD editor) renders every element live
over the game: drag to move, arrow keys nudge (Shift = ×10), and the bottom
bar tunes scale, opacity, anchor, visibility, lock and enable state per
element. Positions are anchor-relative offsets, so layouts survive resolution
and GUI-scale changes. The crosshair ships locked to the center because that
is the aim point.

## Profiles

`config/klymon-client.json` holds the global theme plus every profile: addon
states, HUD layouts, the active profile and the server bindings. Built-ins:
Default, PvP, BedWars, SkyWars, Practice, Survival, Performance. The profiles
screen (settings → profile) creates, duplicates, renames, deletes, exports
and imports profiles, and binds the current server to the selected profile so
it auto-loads on join. Imports/exports are plain JSON files in
`config/klymon-exports/`. The legacy `klymon-client.properties` (1.1) is
migrated into the Default profile on first run.

## Screens

| Screen | Where | Contents |
| --- | --- | --- |
| `KlymonTitleScreen` | Replaces vanilla title | Modes, client settings, addons, vanilla options, quit |
| `KlymonHubScreen` | Right Shift in game | Settings, addons, HUD editor, profiles, diagnostics |
| `KlymonPlayerProfileScreen` | Settings → profile | Level, points, playtime, equipped cosmetics (read-only) |
| `KlymonPauseScreen` | Esc pause menu | Vanilla pause untouched, plus client-settings and addons shortcuts |
| `KlymonSettingsScreen` | Title/hub | Master HUD, scale, accent, profile shortcut, editor, diagnostics |
| `KlymonAddonsScreen` | Title/hub | Category tabs, toggles, per-addon config, live perf status |
| `KlymonAddonConfigScreen` | Per addon | Every setting + reset; live crosshair preview |
| `KlymonHudEditorScreen` | In game | Visual drag-and-drop HUD layout |
| `KlymonProfilesScreen` | Settings | Profiles CRUD, import/export, server bindings |
| `KlymonScreen` | Settings/hub | Diagnostics (versions, profile, addons, mod list) + folders |

## Building

```bash
pnpm client:build
```

The build script is `scripts/build-client-mod.mjs` and needs a **JDK 21**
(`JAVA_HOME` or `javac` on `PATH`) plus network access on the first run. It
caches the Mojang client jar, mappings, Fabric modules and compile-only jars
(Gson, JOML — both ship with Minecraft and are never bundled) under `.tools/`.

Headless logic tests (settings, CPS/combo trackers, profiles, anchors,
addon state) live in `src/test/java/.../LogicTest.java` and run from
`tests/client-addons.test.ts` with plain `javac`/`java` — no JUnit, no
Minecraft needed.

## Why no Gradle?

Gradle + Loom would add a second dependency manager and a build step that is
awkward to keep reproducible inside a Node/pnpm repo. The mod only touches
public screen/HUD/render-event APIs, so the script uses `javac` against
Yarn-named jars, packages classes + `fabric.mod.json` + assets, and remaps to
intermediary with `tiny-remapper`. Both the script and
`tests/client-profile.test.ts` assert intermediary references before shipping.

## Output

The packaged jar is written to `apps/desktop/resources/client-mod/klymon-menu.jar`
and is committed, because the launcher ships it as an `extraResources` entry.
`ClientService` copies it into the Klymon Client instance's `mods/` directory
on install and launch (SHA-1 compared, so it is a no-op when current).

## Identity and cosmetics (local)

The launcher exports `config/klymon-bridge.json` (versioned, see
`ProgressionService.exportBridge`) with the `[K]` identity, level, points and
loadout. `cosmetic.KlymonBridge` reads it leniently — a missing or outdated
file degrades to prefix `[K]`, level 1, no cosmetics.

- Identity: title/hub screens, watermark surfaces and the profile screen show
  the decorated `[K] name` + level. The account name is never mutated.
- `CosmeticFeatureRenderer` draws the equipped cape/wings (procedural gradient
  textures rasterized at runtime) and hats/pets (vanilla items) on the local
  player. `CosmeticsManager` spawns trail/aura/entrance particles from the
  bridge ids and plays the equipped emote flourish on `G`.
- Everything is local-player only: other players would need the same bridge
  file, which only a future server could distribute.

## Known limitations

- The custom crosshair draws **over** the vanilla one: suppressing vanilla's
  crosshair needs a mixin, which this Gradle-free build deliberately avoids.
  Presets are designed to read well overlaid.
- Block-overlay line width is concentric outlines, not GL line width: most
  drivers clamp `glLineWidth` to 1px, so this is the only portable way to make
  it visibly thicker.
- The HUD editor pauses with the game in singleplayer (vanilla behaviour for
  open screens); layout still edits live.
- The `[K]` prefix is shown on Klymon-owned surfaces only. Nametags above
  players' heads and tab-list entries on servers are controlled by the server
  (scoreboard teams / server plugins); a client cannot change them. Showing
  other Klymon users' prefixes would require a server-side companion.
- Cosmetics render for the local player only (see above): without a server,
  other players cannot receive your bridge file.
