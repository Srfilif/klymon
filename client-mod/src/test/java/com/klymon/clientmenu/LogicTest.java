package com.klymon.clientmenu;

import java.util.List;
import java.util.Map;

import com.klymon.clientmenu.addon.Addon;
import com.klymon.clientmenu.addon.AddonCategory;
import com.klymon.clientmenu.addon.Setting;
import com.klymon.clientmenu.config.ProfileDocument;
import com.klymon.clientmenu.config.ProfileManager;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.logic.ComboTracker;
import com.klymon.clientmenu.logic.CpsTracker;

/**
 * Headless tests for the Minecraft-free core (settings, trackers, profiles,
 * anchors). Plain {@code main} assertions — no JUnit — compiled and run by
 * {@code tests/client-addons.test.ts} against the real sources.
 */
public final class LogicTest {
    private static int passed;

    public static void main(String[] args) {
        testSettings();
        testCpsTracker();
        testComboTracker();
        testProfileDocument();
        testProfileManager();
        testHudAnchor();
        testAddonState();
        System.out.println("LOGIC-TEST-PASS count=" + passed);
    }

    private static void check(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError("FAILED: " + message);
        }
        passed++;
    }

    // ---------------------------------------------------------------- settings

    private static void testSettings() {
        Setting<Boolean> bool = Setting.bool("t", "b", true);
        check(bool.getBoolean(), "bool default");
        bool.cycle(1);
        check(!bool.getBoolean(), "bool cycle toggles");
        check(bool.serialize().equals("false"), "bool serialize");
        bool.deserialize("not-a-bool");
        check(!bool.getBoolean(), "bool invalid parses false");

        Setting<Integer> number = Setting.integer("t", "n", 5, 0, 10, 2);
        number.setInt(99);
        check(number.getInt() == 10, "int clamps max");
        number.setInt(-99);
        check(number.getInt() == 0, "int clamps min");
        number.setInt(4);
        number.cycle(1);
        check(number.getInt() == 6, "int cycles by step");
        number.deserialize("oops");
        check(number.getInt() == 5, "int invalid restores default");
        number.deserialize("7");
        check(number.getInt() == 7, "int parses");

        Setting<Double> decimal = Setting.decimal("t", "d", 1.0, 0.1, 2.0, 0.1);
        decimal.setDouble(Double.NaN);
        check(decimal.getDouble() == 1.0, "double NaN restores default");
        decimal.setDouble(99.0);
        check(decimal.getDouble() == 2.0, "double clamps max");

        Setting<String> enumeration = Setting.enumeration("t", "e", "a", "a", "b", "c");
        enumeration.setEnum("zzz");
        check(enumeration.getEnum().equals("a"), "enum invalid restores default");
        enumeration.cycle(1);
        check(enumeration.getEnum().equals("b"), "enum cycles forward");
        enumeration.cycle(-1);
        check(enumeration.getEnum().equals("a"), "enum cycles back");
        enumeration.cycle(-1);
        check(enumeration.getEnum().equals("c"), "enum wraps around");

        Setting<Integer> color = Setting.color("t", "c", 0xFF112233, 0xFF112233, 0xFF445566);
        check(Setting.parseColor("#80112233") == 0x80112233, "color parses #AARRGGBB");
        check(Setting.parseColor("#112233") == 0xFF112233, "color parses #RRGGBB");
        check(Setting.parseColor("123") == 123, "color parses decimal");
        check(color.serialize().equals("#FF112233"), "color serializes #AARRGGBB");
        color.cycle(1);
        check(color.getInt() == 0xFF445566, "color cycles palette");
        color.deserialize("oops");
        check(color.getInt() == 0xFF112233, "color invalid restores default");

        Setting<String> text = Setting.text("t", "s", "hi");
        text.setString(null);
        check(text.getString().equals(""), "text null becomes empty");
        check(text.labelKey().equals("klymon.setting.t.s"), "setting label key");
    }

    // ---------------------------------------------------------------- trackers

    private static void testCpsTracker() {
        CpsTracker tracker = new CpsTracker();
        tracker.setWindowMs(1000);
        for (long t = 0; t <= 400; t += 100) {
            tracker.record(t);
        }
        check(tracker.count(1000, 1000) == 5, "cps counts window");
        check(tracker.count(1401, 1000) == 0, "cps expires old clicks");
        check(tracker.max() == 5, "cps tracks max");
        tracker.setWindowMs(1);
        check(tracker.windowMs() == 250, "cps window clamps min");
        tracker.setWindowMs(99999);
        check(tracker.windowMs() == 5000, "cps window clamps max");
        tracker.resetMax();
        check(tracker.max() == tracker.count(400, tracker.windowMs()), "cps resetMax reseeds");
        tracker.clear();
        check(tracker.count(400, 5000) == 0 && tracker.max() == 0, "cps clears");
    }

    private static void testComboTracker() {
        ComboTracker combo = new ComboTracker();
        check(combo.ageMs(100) == -1, "combo age -1 before hits");
        combo.recordHit(1000);
        combo.recordHit(1500);
        check(combo.combo(1600, 2000) == 2, "combo counts hits");
        check(combo.combo(5000, 2000) == 0, "combo expires after reset window");
        check(combo.best() == 2, "combo keeps best");
        combo.recordHit(6000);
        combo.breakCombo();
        check(combo.combo(6000, 2000) == 0, "combo break drops hits");
        check(combo.best() == 2, "combo break keeps best");
    }

    // ---------------------------------------------------------------- document

    private static void testProfileDocument() {
        check(ProfileDocument.normalizeAddress("  Hypixel.NET ").equals("hypixel.net"), "address normalizes");
        check(ProfileDocument.stripPort("play.example.com:25565").equals("play.example.com"), "port strips");
        check(ProfileDocument.stripPort("play.example.com").equals("play.example.com"), "host without port kept");
        Map<String, String> bindings = Map.of("hypixel.net", "bedwars", "play.example.com:25565", "pvp");
        check(ProfileDocument.matchBinding(bindings, "Hypixel.net").equals("bedwars"), "binding exact match");
        check(ProfileDocument.matchBinding(bindings, "play.example.com:25565").equals("pvp"), "binding port match");
        check(ProfileDocument.matchBinding(bindings, "unknown.gg") == null, "binding miss returns null");
        check(ProfileDocument.matchBinding(Map.of(), "hypixel.net") == null, "empty bindings miss");
        check(ProfileDocument.sanitizeId("  My Profile! ").equals("my-profile"), "id sanitizes");
        check(ProfileDocument.sanitizeId("").equals("profile"), "id falls back");
    }

    private static void testProfileManager() {
        ProfileDocument document = new ProfileDocument();
        ProfileManager.ensureDefaults(document);
        check(document.profiles.size() >= 7, "builtins exist");
        for (String id : ProfileManager.BUILTIN_IDS) {
            check(!ProfileManager.builtinAddonFlags(id).isEmpty(), "builtin flags for " + id);
            check(document.profiles.get(id).builtin, "builtin flag for " + id);
        }
        check(document.profiles.get("pvp").addons.get("combo-counter").enabled, "pvp enables combo");
        check(!document.profiles.get("survival").addons.get("combo-counter").enabled, "survival disables combo");
        check(!document.profiles.get("performance").addons.get("keystrokes").enabled, "performance trims hud");

        List<String> ordered = ProfileManager.orderedIds(document);
        check(ordered.get(0).equals("default") && ordered.size() == document.profiles.size(), "ids ordered");

        String copy = ProfileManager.duplicate(document, "pvp", "Ranked");
        check(document.profiles.get(copy).name.equals("Ranked"), "duplicate names copy");
        check(!document.profiles.get(copy).builtin, "duplicate is custom");
        String second = ProfileManager.duplicate(document, "pvp", "Ranked");
        check(!second.equals(copy), "duplicate ids stay unique");

        ProfileManager.rename(document, copy, "Ranked Night");
        check(document.profiles.get(copy).name.equals("Ranked Night"), "rename applies");
        boolean renameRejected = false;
        try {
            ProfileManager.rename(document, copy, "  ");
        } catch (IllegalArgumentException expected) {
            renameRejected = true;
        }
        check(renameRejected, "rename rejects blank");

        boolean builtinProtected = false;
        try {
            ProfileManager.delete(document, "pvp");
        } catch (IllegalStateException expected) {
            builtinProtected = true;
        }
        check(builtinProtected, "delete protects builtins");
        boolean activeProtected = false;
        try {
            ProfileManager.delete(document, document.activeProfile);
        } catch (IllegalStateException expected) {
            activeProtected = true;
        }
        check(activeProtected, "delete protects active");
        document.serverBindings.put("test.gg", copy);
        ProfileManager.delete(document, copy);
        check(!document.profiles.containsKey(copy), "delete removes custom");
        check(!document.serverBindings.containsKey("test.gg"), "delete clears bindings");

        String exported = ProfileManager.exportProfile(document, "bedwars");
        check(exported.contains("\"generator\"") && exported.contains("bedwars"), "export payload");
        String imported = ProfileManager.importProfile(document, exported);
        check(document.profiles.get(imported).name.equals("BedWars"), "import roundtrips name");
        check(!document.profiles.get(imported).builtin, "import is custom");
        boolean corruptRejected = false;
        try {
            ProfileManager.parseExport("{oops");
        } catch (IllegalArgumentException expected) {
            corruptRejected = true;
        }
        check(corruptRejected, "import rejects invalid json");
        boolean shapeRejected = false;
        try {
            ProfileManager.parseExport("{\"version\":2}");
        } catch (IllegalArgumentException expected) {
            shapeRejected = true;
        }
        check(shapeRejected, "import rejects non-profile json");

        ProfileManager.resetBuiltin(document, "pvp");
        check(document.profiles.get("pvp").builtin, "reset keeps builtin");
    }

    // ---------------------------------------------------------------- anchors

    private static void testHudAnchor() {
        for (HudAnchor anchor : HudAnchor.values()) {
            int x = anchor.resolveX(800, 100, 7);
            int y = anchor.resolveY(600, 40, 9);
            check(anchor.toOffsetX(800, 100, x) == 7, "anchor " + anchor + " x roundtrips");
            check(anchor.toOffsetY(600, 40, y) == 9, "anchor " + anchor + " y roundtrips");
        }
        check(HudAnchor.TOP_LEFT.resolveX(800, 100, 3) == 3, "top-left x");
        check(HudAnchor.TOP_RIGHT.resolveX(800, 100, 3) == 697, "top-right x");
        check(HudAnchor.CENTER.resolveX(800, 100, 0) == 350, "center x");
        check(HudAnchor.parse("bogus", HudAnchor.TOP_LEFT) == HudAnchor.TOP_LEFT, "anchor parse fallback");
    }

    // ---------------------------------------------------------------- addon state

    private static final class Probe extends Addon {
        final Setting<Boolean> flag = setting(Setting.bool("probe", "flag", true));
        final Setting<Integer> level = setting(Setting.integer("probe", "level", 3, 0, 9, 1));

        Probe() {
            super("probe", AddonCategory.PVP, "1.2.0", true);
        }
    }

    private static void testAddonState() {
        Probe addon = new Probe();
        check(addon.settings().size() == 2, "addon exposes settings");
        check(addon.setting("level") != null && addon.setting("nope") == null, "addon setting lookup");
        addon.setEnabled(false);
        addon.flag.setBoolean(false);
        addon.level.setInt(9);
        addon.resetToDefaults();
        check(addon.enabled() && addon.flag.getBoolean() && addon.level.getInt() == 3, "addon resets");
        Map<String, String> exported = addon.exportSettings();
        check(exported.get("flag").equals("true") && exported.get("level").equals("3"), "addon exports");
        addon.importSettings(Map.of("flag", "false", "level", "oops", "unknown", "x"));
        check(!addon.flag.getBoolean() && addon.level.getInt() == 3, "addon imports leniently");
        check(addon.nameKey().equals("klymon.addon.probe"), "addon name key");
        check(addon.dependencies().contains("fabric-api"), "addon default deps");
    }
}
