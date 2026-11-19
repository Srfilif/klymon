package com.klymon.clientmenu;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;

import com.klymon.clientmenu.addon.Addon;
import com.klymon.clientmenu.addon.AddonCategory;
import com.klymon.clientmenu.addon.Setting;
import com.klymon.clientmenu.config.ProfileDocument;
import com.klymon.clientmenu.config.ProfileManager;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.logic.BoundedCache;
import com.klymon.clientmenu.logic.ComboTracker;
import com.klymon.clientmenu.logic.HurtEdge;
import com.klymon.clientmenu.logic.CpsTracker;
import com.klymon.clientmenu.logic.GammaPolicy;
import com.klymon.clientmenu.logic.LevelCurve;
import com.klymon.clientmenu.logic.SessionAccumulator;
import com.klymon.clientmenu.platform.ApiBaseStore;
import com.klymon.clientmenu.platform.DeviceLink;
import com.klymon.clientmenu.platform.HandoffExchange;
import com.klymon.clientmenu.platform.HandoffOffer;
import com.klymon.clientmenu.platform.PlatformHttp;
import com.klymon.clientmenu.platform.PlatformSession;
import com.klymon.clientmenu.platform.PlatformSessionStore;
import com.klymon.clientmenu.platform.PlatformUrls;
import com.klymon.clientmenu.thirdparty.api.HudCanvas;
import com.klymon.clientmenu.thirdparty.api.TickState;
import com.klymon.clientmenu.thirdparty.sandbox.AddonManifest;
import com.klymon.clientmenu.thirdparty.sandbox.AddonSandbox;
import com.klymon.clientmenu.thirdparty.sandbox.ClassPolicy;
import com.klymon.clientmenu.thirdparty.sandbox.ConstantPool;
import fixtures.addons.CleanHudAddon;
import fixtures.addons.ConfigEchoAddon;
import fixtures.addons.HandleSneakAddon;
import fixtures.addons.MeanAddon;
import fixtures.addons.MultiAddon;
import fixtures.addons.SneakyAddon;

/**
 * Headless tests for the Minecraft-free core (settings, trackers, profiles,
 * anchors). Plain {@code main} assertions — no JUnit — compiled and run by
 * {@code tests/client-addons.test.ts} against the real sources.
 */
public final class LogicTest {
    private static int passed;
    private static String TEST_TMP_BASE;

    public static void main(String[] args) throws Exception {
        TEST_TMP_BASE = args.length > 0 ? args[0] : null;
        testSettings();
        testCpsTracker();
        testComboTracker();
        testProfileDocument();
        testProfileManager();
        testHudAnchor();
        testAddonState();
        testLevelCurve();
        testSessionAccumulator();
        testGammaPolicy();
        testWriteJsonFile();
        testPaging();
        testComboHurt();
        testBoundedCache();
        testHurtEdge();
        testPlatformLink();
        testDeviceLink();
        testApiBaseStore();
        testAddonSandbox();
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
        check(bool.getBoolean(), "bool invalid restores default");
        Setting<Boolean> offByDefault = Setting.bool("t", "b2", false);
        offByDefault.deserialize("wat");
        check(!offByDefault.getBoolean(), "bool invalid restores false default");
        bool.deserialize("no");
        check(!bool.getBoolean(), "bool parses no as false");
        bool.deserialize("YES");
        check(bool.getBoolean(), "bool parses YES as true");

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
        check(Setting.parseColor("#F0A") == 0xFFFF00AA, "color parses #RGB short");
        check(Setting.parseColor("#f0a") == 0xFFFF00AA, "color parses #rgb lowercase");
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
        boolean oversizeRejected = false;
        try {
            // Valid JSON shape, oversized body: must be rejected by size, not by parsing.
            ProfileManager.parseExport("{\"generator\":\"klymon-client\",\"version\":2,\"id\":\"big\","
                    + "\"profile\":{\"name\":\"" + "A".repeat(ProfileManager.MAX_EXPORT_BYTES) + "\"}}");
        } catch (IllegalArgumentException expected) {
            oversizeRejected = true;
        }
        check(oversizeRejected, "import rejects oversized payload");

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

    // -------------------------------------------------------------- levelCurve

    private static void testLevelCurve() {
        check(LevelCurve.cumulativePointsForLevel(1) == 0L, "curve L1 is zero");
        check(LevelCurve.cumulativePointsForLevel(2) == 100L, "curve L2 is 100");
        check(LevelCurve.cumulativePointsForLevel(5) == 1000L, "curve L5 is 1000");
        check(LevelCurve.cumulativePointsForLevel(10) == 4500L, "curve L10 is 4500");
        check(LevelCurve.levelForPoints(0L) == 1, "level of zero is 1");
        check(LevelCurve.levelForPoints(99L) == 1, "level below L2 floor");
        check(LevelCurve.levelForPoints(100L) == 2, "level at L2 floor");
        check(LevelCurve.levelForPoints(1000L) == 5, "level at L5 floor");
        check(LevelCurve.levelForPoints(-50L) == 1, "level clamps negatives");
        float fraction = LevelCurve.progressFraction(150L);
        check(fraction > 0.24f && fraction < 0.26f, "fraction halfway L2 (150/200)");
        check(LevelCurve.progressFraction(100L) == 0.0f, "fraction at floor is zero");
    }

    // ----------------------------------------------------- sessionAccumulator

    private static void testSessionAccumulator() {
        SessionAccumulator acc = new SessionAccumulator();
        acc.tick(1000L, true);
        check(acc.totalSeconds() == 0L, "accumulator ignores the first tick");
        acc.tick(3000L, true);
        check(acc.totalSeconds() == 2L, "accumulator counts in-world time");
        acc.tick(8000L, false);
        check(acc.totalSeconds() == 2L, "accumulator skips menu time");
        acc.tick(9000L, true);
        check(acc.totalSeconds() == 3L, "accumulator resumes in world");
        acc.tick(5000L, true);
        check(acc.totalSeconds() == 3L, "accumulator ignores clock jumps back");
        String json = SessionAccumulator.heartbeatJson("run-1", 1234L, 42L);
        check(json.contains("\"version\":1"), "heartbeat carries version");
        check(json.contains("\"runId\":\"run-1\""), "heartbeat carries run id");
        check(json.contains("\"totalInWorldSeconds\":42"), "heartbeat carries seconds");
        acc.reset();
        check(acc.totalSeconds() == 0L, "accumulator resets");
    }

    // ------------------------------------------------------------- gammaPolicy

    private static void testGammaPolicy() {
        check(GammaPolicy.resolvePrevious(0.5, 1.0) == 0.5, "gamma keeps genuine value");
        check(GammaPolicy.resolvePrevious(0.0, 1.0) == 0.0, "gamma keeps darkest value");
        check(GammaPolicy.resolvePrevious(1.0, 0.5) == 1.0, "gamma keeps brightest slider value");
        check(GammaPolicy.resolvePrevious(2.5, 0.7) == 2.5, "gamma keeps hand-edited value");
        check(GammaPolicy.resolvePrevious(10.0, 0.7) == 0.7, "gamma residue falls back to persisted");
        check(GammaPolicy.resolvePrevious(10.0, 10.0) == 1.0, "gamma residue with poisoned persisted uses default");
        check(GammaPolicy.resolvePrevious(10.0, -1.0) == 1.0, "gamma residue with negative persisted uses default");
        check(GammaPolicy.resolvePrevious(10.0, Double.NaN) == 1.0, "gamma residue with NaN persisted uses default");
    }

    // ------------------------------------------------------------ writeJsonFile

    private static void testWriteJsonFile() throws Exception {
        // args[0] carries a writable base dir (the vitest harness passes the
        // build dir); fall back to the system temp dir for ad-hoc runs.
        String base = System.getProperty("java.io.tmpdir");
        if (TEST_TMP_BASE != null) {
            base = TEST_TMP_BASE;
        }
        Path dir = Files.createTempDirectory(Path.of(base), "klymon-logic-test");
        Path nested = dir.resolve("sub").resolve("doc.json");
        ProfileManager.writeJsonFile(nested, "{\"a\":1}");
        check(Files.readString(nested, StandardCharsets.UTF_8).equals("{\"a\":1}"), "writeJsonFile roundtrips");
        boolean directoryRejected = false;
        try {
            ProfileManager.writeJsonFile(dir, "{}");
        } catch (Exception expected) {
            directoryRejected = true;
        }
        check(directoryRejected, "writeJsonFile throws for directory target");
    }

    // ----------------------------------------------------------------- paging

    private static void testPaging() {
        List<String> ids = List.of("a", "b", "c", "d", "e", "f", "g");
        check(ProfileManager.pageCount(7, 3) == 3, "pages divide up");
        check(ProfileManager.pageCount(6, 3) == 2, "pages exact fit");
        check(ProfileManager.pageCount(0, 3) == 1, "pages empty is one");
        check(ProfileManager.page(ids, 0, 3).equals(List.of("a", "b", "c")), "page first");
        check(ProfileManager.page(ids, 2, 3).equals(List.of("g")), "page last partial");
        check(ProfileManager.page(ids, 9, 3).equals(List.of("g")), "page clamps high");
        check(ProfileManager.page(ids, -2, 3).equals(List.of("a", "b", "c")), "page clamps low");
        check(ProfileManager.page(List.of(), 0, 3).isEmpty(), "page empty");
    }

    // -------------------------------------------------------------- comboHurt

    private static void testComboHurt() {
        ComboTracker tracker = new ComboTracker();
        tracker.recordHit(1000L);
        tracker.recordHit(1100L);
        check(!tracker.noteHurtTime(0), "combo ignores resting hurt");
        check(tracker.combo(1200L, 2000L) == 2, "combo survives rest");
        check(tracker.noteHurtTime(10), "combo notices damage spike");
        check(tracker.combo(1300L, 2000L) == 0, "combo breaks on damage");
        check(tracker.best() == 2, "combo keeps best after break");
        tracker.recordHit(1400L);
        check(!tracker.noteHurtTime(9), "combo ignores falling hurt");
        check(!tracker.noteHurtTime(9), "combo ignores steady hurt");
        check(tracker.combo(1500L, 2000L) == 1, "combo survives decay");
        check(tracker.noteHurtTime(10), "combo notices second spike");
        check(tracker.combo(1600L, 2000L) == 0, "combo breaks again");
    }

    // ------------------------------------------------------------ boundedCache

    private static void testBoundedCache() {
        List<String> evicted = new ArrayList<>();
        BoundedCache<String, Integer> cache = new BoundedCache<>(2, (key, value) -> evicted.add(key + "=" + value));
        cache.put("a", 1);
        cache.put("b", 2);
        check(cache.size() == 2, "cache fills to cap");
        cache.put("c", 3);
        check(cache.size() == 2 && !cache.containsKey("a"), "cache evicts eldest");
        check(evicted.equals(List.of("a=1")), "cache reports eviction");
        cache.get("b");
        cache.put("d", 4);
        check(!cache.containsKey("c") && cache.containsKey("b") && cache.containsKey("d"), "cache evicts least-recently-used");
        check(evicted.equals(List.of("a=1", "c=3")), "cache reports second eviction");
        boolean rejected = false;
        try {
            new BoundedCache<String, Integer>(0, null);
        } catch (IllegalArgumentException expected) {
            rejected = true;
        }
        check(rejected, "cache rejects non-positive cap");
    }

    // ---------------------------------------------------------------- hurtEdge

    private static void testHurtEdge() {
        HurtEdge edge = new HurtEdge();
        check(!edge.rose(0), "edge ignores rest");
        check(edge.rose(10), "edge reports spike");
        check(!edge.rose(9), "edge ignores decay");
        check(!edge.rose(9), "edge ignores steady");
        edge.observe(4);
        check(!edge.rose(4), "edge observe seeds silently");
        check(edge.rose(5), "edge reports rise after seed");
        edge.reset();
        check(!edge.rose(0), "edge reset clears");
    }

    private static void testPlatformLink() {
        // ---- HandoffOffer: lenient bridge parsing, fail-closed expiry.
        HandoffOffer offer = HandoffOffer.parse(com.google.gson.JsonParser.parseString(
                "{\"handoff\":{\"code\":\"c1\",\"apiUrl\":\"https://api.example.com/\",\"expiresAt\":\"2030-01-01T00:00:00Z\"}}")
                .getAsJsonObject());
        check(offer != null && offer.code().equals("c1"), "offer parses");
        check(!offer.expired(1_000L), "offer fresh");
        check(offer.expired(1_893_456_000_000L), "offer expires");
        check(HandoffOffer.parse(com.google.gson.JsonParser.parseString("{}").getAsJsonObject()) == null, "offer missing");
        check(HandoffOffer.parse(com.google.gson.JsonParser.parseString("{\"handoff\":{\"code\":\"\",\"apiUrl\":\"x\"}}").getAsJsonObject()) == null,
                "offer blank code");
        HandoffOffer timeless = HandoffOffer.parse(com.google.gson.JsonParser.parseString(
                "{\"handoff\":{\"code\":\"c\",\"apiUrl\":\"https://x\",\"expiresAt\":\"not-a-date\"}}").getAsJsonObject());
        check(timeless != null && timeless.expired(1_000L), "offer bad timestamp fails closed");

        // ---- PlatformUrls: normalize + https-or-loopback policy.
        check("https://api.example.com".equals(PlatformUrls.normalizeBase("https://api.example.com///")), "base trims slashes");
        check("http://localhost:3001".equals(PlatformUrls.normalizeBase("  http://localhost:3001 ")), "base keeps loopback port");
        check(PlatformUrls.normalizeBase("https://user@evil.example.com") == null, "base rejects userinfo");
        check(PlatformUrls.normalizeBase("ftp://x.example.com") == null, "base rejects scheme");
        check(PlatformUrls.normalizeBase("not a url") == null, "base rejects garbage");
        check(PlatformUrls.exchangeUrl("https://api.example.com").equals("https://api.example.com/v1/auth/handoff/exchange"), "exchange path");
        check(PlatformUrls.refreshUrl("https://api.example.com").equals("https://api.example.com/v1/auth/refresh"), "refresh path");
        check(PlatformUrls.deviceCodeUrl("https://api.example.com").equals("https://api.example.com/v1/auth/device/code"), "device code path");
        check(PlatformUrls.deviceTokenUrl("https://api.example.com").equals("https://api.example.com/v1/auth/device/token"), "device token path");
        check(PlatformUrls.allowed("https://api.example.com/v1/auth/handoff/exchange"), "https allowed");
        check(PlatformUrls.allowed("http://localhost:3001/v1/auth/handoff/exchange"), "loopback http allowed");
        check(PlatformUrls.allowed("http://127.0.0.1:3001/v1/auth/refresh"), "127 http allowed");
        check(!PlatformUrls.allowed("http://evil.example.com/v1/auth/handoff/exchange"), "cleartext remote rejected");
        check(!PlatformUrls.allowed("http://localhost.evil.example.com/v1/auth/refresh"), "lookalike host rejected");
        check(!PlatformUrls.allowed("file:///etc/passwd"), "file rejected");

        // ---- PlatformSession: token parsing, refresh timing, redaction.
        String body = "{\"accessToken\":\"a1\",\"refreshToken\":\"r1\",\"user\":{\"username\":\"steve\"},\"sessionId\":\"s1\",\"expiresAt\":\"x\"}";
        PlatformSession session = PlatformSession.parse(body, null, 10_000L);
        check(session != null && session.username().equals("steve"), "session parses");
        check(!session.needsRefresh(10_000L + 12 * 60 * 1000L), "session fresh");
        check(session.needsRefresh(10_000L + 14 * 60 * 1000L), "session ages out");
        check(!session.redacted().contains("a1") && !session.redacted().contains("r1"), "redacted hides tokens");
        check(PlatformSession.parse("not json", null, 0L) == null, "session rejects garbage");
        check(PlatformSession.parse("{\"accessToken\":\"a\"}", null, 0L) == null, "session needs both tokens");
        PlatformSession kept = PlatformSession.parse("{\"accessToken\":\"a2\",\"refreshToken\":\"r2\"}", "steve", 0L);
        check(kept != null && kept.username().equals("steve"), "refresh keeps username");

        // ---- HandoffExchange: single-flight linking with cooldowns.
        ScriptHttp http = new ScriptHttp();
        HandoffExchange exchange = new HandoffExchange(http, new PlatformSessionStore());
        HandoffOffer live = new HandoffOffer("c9", "https://api.example.com", null, Long.MAX_VALUE);
        check(exchange.shouldExchange(live, 0L), "exchange due");
        http.next = new PlatformHttp.Result(201, body);
        check(exchange.exchange(live, 0L) == HandoffExchange.Outcome.LINKED, "exchange links");
        check("steve".equals(exchange.username()), "exchange stores username");
        check(http.calls == 1 && http.lastUrl.equals("https://api.example.com/v1/auth/handoff/exchange"), "exchange posts once");
        check(http.lastBody.contains("\"code\":\"c9\""), "exchange sends the code");
        check(!exchange.shouldExchange(live, 1_000L), "linked never re-exchanges");

        HandoffExchange retry = new HandoffExchange(http, new PlatformSessionStore());
        http.failures = 1;
        check(retry.exchange(live, 0L) == HandoffExchange.Outcome.FAILED_TRANSIENT, "network failure is transient");
        check(!retry.shouldExchange(live, 1_000L), "transient backs off");
        check(retry.shouldExchange(live, HandoffExchange.RETRY_COOLDOWN_MS + 1L), "cooldown expires");
        http.next = new PlatformHttp.Result(401, "{}");
        check(retry.exchange(live, 40_000L) == HandoffExchange.Outcome.FAILED_REJECTED, "401 consumes the code");
        check(!retry.shouldExchange(live, 1_000_000L), "consumed never retries");

        HandoffExchange evil = new HandoffExchange(http, new PlatformSessionStore());
        int before = http.calls;
        HandoffOffer evilOffer = new HandoffOffer("c9", "http://evil.example.com", null, Long.MAX_VALUE);
        check(evil.exchange(evilOffer, 0L) == HandoffExchange.Outcome.FAILED_REJECTED, "evil base rejected");
        check(http.calls == before, "rejected base makes no request");

        HandoffExchange refresher = new HandoffExchange(http, new PlatformSessionStore());
        http.next = new PlatformHttp.Result(200, body);
        refresher.exchange(live, 0L);
        check(refresher.refreshIfNeeded(60_000L), "fresh session skips refresh");
        http.next = new PlatformHttp.Result(200, "{\"accessToken\":\"a2\",\"refreshToken\":\"r2\"}");
        check(refresher.refreshIfNeeded(20 * 60 * 1000L), "stale session refreshes");
        check(http.lastUrl.equals("https://api.example.com/v1/auth/refresh"), "refresh posts correctly");
        http.next = new PlatformHttp.Result(401, "{}");
        check(!refresher.refreshIfNeeded(40 * 60 * 1000L), "refresh 401 unlinks");
        check(!refresher.linked(), "unlinked after 401");

        check(HandoffExchange.escape("a\"b\\c").equals("a\\\"b\\\\c"), "escape quotes");
    }

    private static void testDeviceLink() {
        ScriptHttp http = new ScriptHttp();
        PlatformSessionStore sessions = new PlatformSessionStore();
        DeviceLink link = new DeviceLink(http, sessions);
        check(link.state() == DeviceLink.State.IDLE, "device starts idle");

        String grant = "{\"deviceCode\":\"dc1\",\"userCode\":\"ABCD-2345\","
                + "\"verificationUri\":\"https://account.example.com/devices\",\"expiresIn\":600,\"interval\":5}";
        http.next = new PlatformHttp.Result(201, grant);
        check(link.start("https://api.example.com/", "Klymon Client 1.3.0", 0L), "device start shows a code");
        check(link.state() == DeviceLink.State.AWAITING, "device awaits approval");
        check("ABCD-2345".equals(link.userCode()), "device keeps the user code");
        check(http.lastUrl.equals("https://api.example.com/v1/auth/device/code"), "device posts for a code");
        check(http.lastBody.contains("Klymon Client 1.3.0"), "device sends its name");
        check(!link.pollDue(1_000L), "device respects the interval");
        check(link.pollDue(5_000L), "device polls when due");

        http.next = new PlatformHttp.Result(202, "{\"status\":\"pending\",\"interval\":5}");
        link.poll(5_000L);
        check(link.state() == DeviceLink.State.AWAITING, "pending stays awaiting");
        check(!link.pollDue(6_000L), "pending rearms the interval");
        http.next = new PlatformHttp.Result(429, "{}");
        link.poll(10_000L);
        check(link.state() == DeviceLink.State.AWAITING, "slow-down stays awaiting");
        check(!link.pollDue(11_000L), "slow-down doubles the wait");

        String tokens = "{\"accessToken\":\"a9\",\"refreshToken\":\"r9\",\"user\":{\"username\":\"steve\"}}";
        http.next = new PlatformHttp.Result(200, tokens);
        link.poll(30_000L);
        check(link.state() == DeviceLink.State.LINKED, "approval links");
        check(sessions.linked() && "steve".equals(sessions.username()), "device stores the session");

        DeviceLink denied = new DeviceLink(http, new PlatformSessionStore());
        http.next = new PlatformHttp.Result(201, grant);
        denied.start("https://api.example.com", null, 0L);
        http.next = new PlatformHttp.Result(410, "{}");
        denied.poll(5_000L);
        check(denied.state() == DeviceLink.State.FAILED, "denial fails the flow");

        DeviceLink offline = new DeviceLink(http, new PlatformSessionStore());
        http.failures = 1;
        check(!offline.start("https://api.example.com", null, 0L), "start failure surfaces");
        check(offline.state() == DeviceLink.State.FAILED, "start failure fails");

        DeviceLink evil = new DeviceLink(http, new PlatformSessionStore());
        int before = http.calls;
        check(!evil.start("http://evil.example.com", null, 0L), "evil base rejected");
        check(http.calls == before, "rejected base makes no request");

        DeviceLink stale = new DeviceLink(http, new PlatformSessionStore());
        http.next = new PlatformHttp.Result(201, grant);
        stale.start("https://api.example.com", null, 0L);
        stale.poll(601_000L);
        check(stale.state() == DeviceLink.State.FAILED, "expiry fails without a request");

        DeviceLink cancelled = new DeviceLink(http, new PlatformSessionStore());
        http.next = new PlatformHttp.Result(201, grant);
        cancelled.start("https://api.example.com", null, 0L);
        cancelled.cancel();
        check(cancelled.state() == DeviceLink.State.IDLE, "cancel resets");

        System.clearProperty("klymon.e2e.autolink");
        check(!DeviceLink.autostartRequested(false, false), "autolink defaults off");
        System.setProperty("klymon.e2e.autolink", "true");
        try {
            check(DeviceLink.autostartRequested(false, false), "autolink fires when idle");
            check(!DeviceLink.autostartRequested(true, false), "autolink skips linked runs");
            check(!DeviceLink.autostartRequested(false, true), "autolink yields to handoffs");
        } finally {
            System.clearProperty("klymon.e2e.autolink");
        }
    }

    private static void testApiBaseStore() throws Exception {
        String base = System.getProperty("java.io.tmpdir");
        if (TEST_TMP_BASE != null) {
            base = TEST_TMP_BASE;
        }
        Path dir = Files.createTempDirectory(Path.of(base), "klymon-platform-test");
        check(ApiBaseStore.read(dir) == null, "store reads missing as null");
        ApiBaseStore.write(dir, "https://api.example.com");
        check("https://api.example.com".equals(ApiBaseStore.read(dir)), "store roundtrips");
        Files.writeString(dir.resolve("klymon-platform.json"), "not json{{", StandardCharsets.UTF_8);
        check(ApiBaseStore.read(dir) == null, "store reads corrupt as null");
        Files.writeString(dir.resolve("klymon-platform.json"), "{\"apiUrl\":123}", StandardCharsets.UTF_8);
        check(ApiBaseStore.read(dir) == null, "store rejects non-strings");
    }

    private static void testAddonSandbox() throws Exception {
        // Policy: the facade plus boring JDK value types are allowed.
        check(ClassPolicy.isAllowed("java/lang/String"), "policy allows String");
        check(ClassPolicy.isAllowed("java.lang.Object"), "policy accepts dotted names");
        check(ClassPolicy.isAllowed("java/util/ArrayList"), "policy allows collections");
        check(ClassPolicy.isAllowed("java/util/HashMap"), "policy allows maps");
        check(ClassPolicy.isAllowed("java/time/Instant"), "policy allows time");
        check(ClassPolicy.isAllowed("java/math/BigDecimal"), "policy allows math");
        check(ClassPolicy.isAllowed("com/klymon/clientmenu/thirdparty/api/HudAddon"), "policy allows the facade");
        check(ClassPolicy.isAllowed("[Ljava/lang/String;"), "policy allows arrays of allowed types");
        check(ClassPolicy.isAllowed("java/lang/invoke/StringConcatFactory"), "policy allows string concat");
        check(ClassPolicy.isAllowed("java/lang/invoke/LambdaMetafactory"), "policy allows lambdas");
        check(ClassPolicy.isAllowed("java/lang/invoke/MethodHandles$Lookup"), "policy allows lookup refs");
        check(ClassPolicy.isAllowed("java/lang/invoke/MethodType"), "policy allows method types");
        check(ClassPolicy.isAllowed("java/lang/invoke/MethodHandle"), "policy allows handle refs");
        check(ClassPolicy.isAllowed("java/lang/invoke/MethodHandles"), "scan tolerates the phantom ref");
        check(!ClassPolicy.isLoadable("java/lang/invoke/MethodHandles"), "loader refuses the lookup factory");
        check(ClassPolicy.isLoadable("java/lang/String"), "loader serves allowed classes");
        check(!ClassPolicy.isAllowed("java/lang/invoke/VarHandle"), "policy denies var handles");
        check(ClassPolicy.isAllowed("int"), "policy allows primitives");
        // Policy: I/O, network, processes, reflection, threads, and the game are denied.
        check(!ClassPolicy.isAllowed("java/io/File"), "policy denies io");
        check(!ClassPolicy.isAllowed("java/nio/ByteBuffer"), "policy denies nio");
        check(!ClassPolicy.isAllowed("java/net/Socket"), "policy denies net");
        check(!ClassPolicy.isAllowed("java/lang/Runtime"), "policy denies Runtime");
        check(!ClassPolicy.isAllowed("java/lang/System"), "policy denies System");
        check(!ClassPolicy.isAllowed("java/lang/Class"), "policy denies Class");
        check(!ClassPolicy.isAllowed("java/lang/ClassLoader"), "policy denies ClassLoader");
        check(!ClassPolicy.isAllowed("java/lang/Thread"), "policy denies Thread");
        check(!ClassPolicy.isAllowed("java/lang/reflect/Method"), "policy denies reflection");
        check(!ClassPolicy.isAllowed("java/util/concurrent/Executors"), "policy denies executors");
        check(!ClassPolicy.isAllowed("java/util/ServiceLoader"), "policy denies ServiceLoader");
        check(!ClassPolicy.isAllowed("java/util/zip/ZipFile"), "policy denies zip");
        check(!ClassPolicy.isAllowed("net/minecraft/client/MinecraftClient"), "policy denies the game");
        check(!ClassPolicy.isAllowed("net/fabricmc/api/ModInitializer"), "policy denies the loader");
        check(!ClassPolicy.isAllowed("com/mojang/authlib/GameProfile"), "policy denies authlib");
        check(!ClassPolicy.isAllowed("com/google/gson/Gson"), "policy denies gson");
        check(!ClassPolicy.isAllowed("com/klymon/clientmenu/KlymonConfig"), "policy denies platform classes");
        check(!ClassPolicy.isAllowed("jdk/internal/loader/ClassLoaders"), "policy denies jdk internals");
        check(!ClassPolicy.isAllowed("sun/misc/Unsafe"), "policy denies Unsafe");
        check(!ClassPolicy.isAllowed("javax/swing/JFrame"), "policy denies swing");
        check(!ClassPolicy.isAllowed("java/awt/Color"), "policy denies awt");
        check(!ClassPolicy.isAllowed(null), "policy denies null");
        check(!ClassPolicy.isAllowed(""), "policy denies empty names");

        // Constant pool: fixture references are visible before any class loads.
        Set<String> refs = ConstantPool.referencedClasses(classBytes(CleanHudAddon.class));
        check(refs.contains("fixtures/addons/CleanHudAddon"), "pool sees the fixture itself");
        check(refs.contains("java/lang/Object"), "pool sees the superclass");
        check(refs.contains("com/klymon/clientmenu/thirdparty/api/HudAddon"), "pool sees the facade");
        check(refs.contains("com/klymon/clientmenu/thirdparty/api/HudCanvas"), "pool sees canvas calls");
        check(!refs.contains("java/io/File"), "pool finds no io in the clean fixture");
        checkThrows(() -> ConstantPool.referencedClasses(new byte[]{0, 1, 2, 3}), "pool rejects garbage");
        byte[] cleanBytes = classBytes(CleanHudAddon.class);
        byte[] truncated = new byte[40];
        System.arraycopy(cleanBytes, 0, truncated, 0, 40);
        checkThrows(() -> ConstantPool.referencedClasses(truncated), "pool rejects truncated classes");

        // Manifest: valid documents parse, everything else is a rejection.
        AddonManifest manifest = AddonManifest.parse(manifestJson("my-addon", "fixtures.addons.CleanHudAddon", "hud"));
        check("my-addon".equals(manifest.id()), "manifest keeps the id");
        check("fixtures.addons.CleanHudAddon".equals(manifest.mainClass()), "manifest keeps main");
        check(manifest.capabilities().equals(List.of("hud")), "manifest keeps capabilities");
        checkRejectManifest("{oops", "manifest rejects broken json");
        checkRejectManifest("[]", "manifest rejects non-objects");
        checkRejectManifest("{\"version\":\"1\",\"mainClass\":\"a.B\",\"capabilities\":[\"hud\"]}", "manifest needs an id");
        checkRejectManifest(manifestJson("My Addon!", "fixtures.addons.CleanHudAddon", "hud"), "manifest validates ids");
        checkRejectManifest(manifestJson("my-addon", "NoDots", "hud"), "manifest needs a dotted main");
        checkRejectManifest("{\"id\":\"a\",\"version\":\"1\",\"mainClass\":\"a.B\"}", "manifest needs capabilities");
        checkRejectManifest(manifestJson("my-addon", "fixtures.addons.CleanHudAddon"), "manifest needs one capability");
        checkRejectManifest(
                manifestJson("my-addon", "fixtures.addons.CleanHudAddon", "hud", "fly"), "manifest rejects unknown caps");

        // Clean load: the addon runs and its canvas output is observable.
        AddonSandbox.Loaded clean =
                AddonSandbox.load(addonJar("clean", "fixtures.addons.CleanHudAddon", classBytes(CleanHudAddon.class), "hud"));
        check("clean".equals(clean.id()), "load keeps the id");
        check(clean.hasCapability("hud") && !clean.hasCapability("tick"), "load reports capabilities");
        HudCanvas canvas = new HudCanvas();
        clean.asHud().render(canvas, new TickState(7, 60, "Steve", true));
        check(canvas.texts().size() == 1 && "clean".equals(canvas.texts().get(0).text()), "hud output is recorded");
        check(canvas.texts().get(0).x() == 3 && canvas.texts().get(0).y() == 4, "hud positions are recorded");
        check(canvas.rects().size() == 1 && canvas.rects().get(0).width() == 10, "rect output is recorded");
        check(canvas.dropped() == 0, "clean frames drop nothing");

        // Multi-capability load: tick state flows in, hud output flows out.
        AddonSandbox.Loaded multi =
                AddonSandbox.load(addonJar("multi", "fixtures.addons.MultiAddon", classBytes(MultiAddon.class), "hud", "tick"));
        multi.asTick().tick(new TickState(42, 120, null, false));
        HudCanvas multiCanvas = new HudCanvas();
        multi.asHud().render(multiCanvas, new TickState(43, 120, null, false));
        check("tick=42 fps=120".equals(multiCanvas.texts().get(0).text()), "tick state reaches the addon");
        check("lambda=n42n120".equals(multiCanvas.texts().get(1).text()), "lambdas survive the sandbox");

        // Isolation: every load gets its own classes and its own loader.
        AddonSandbox.Loaded cleanAgain =
                AddonSandbox.load(addonJar("clean", "fixtures.addons.CleanHudAddon", classBytes(CleanHudAddon.class), "hud"));
        check(clean.instance() != cleanAgain.instance(), "loads do not share instances");
        check(clean.instance().getClass() != cleanAgain.instance().getClass(), "loads do not share classes");
        check(clean.loader() != cleanAgain.loader(), "loads do not share loaders");

        // Hostile code is rejected at scan time, before it can run.
        check(reject(addonJar("mean", "fixtures.addons.MeanAddon", classBytes(MeanAddon.class), "hud"))
                .contains("sandbox policy"), "hostile addon is rejected");
        // Manifest and code must match in both directions.
        check(reject(addonJar("sneaky", "fixtures.addons.SneakyAddon", classBytes(SneakyAddon.class), "hud"))
                .contains("without declaring"), "undeclared capability is rejected");
        check(reject(addonJar("sneaky", "fixtures.addons.SneakyAddon", classBytes(SneakyAddon.class), "hud", "tick", "config"))
                .contains("without implementing"), "undeclared implementation is rejected");
        // Reserved namespaces cannot be shadowed from inside a jar.
        check(reject(addonJar("spoof", "com.klymon.Evil", classBytes(CleanHudAddon.class), "hud")).contains("must not ship"),
                "platform namespace is reserved");
        check(reject(addonJar("spoof", "java.lang.Evil", classBytes(CleanHudAddon.class), "hud")).contains("must not ship"),
                "jdk namespace is reserved");
        // Caps and structural failures reject before any code runs.
        check(reject(manyClassJar()).contains("300-class"), "class cap is enforced");
        check(reject(new byte[(int) (AddonSandbox.MAX_JAR_BYTES + 1)]).contains("8 MiB"), "jar cap is enforced");
        LinkedHashMap<String, byte[]> noManifest = new LinkedHashMap<>();
        noManifest.put("fixtures/addons/CleanHudAddon.class", classBytes(CleanHudAddon.class));
        check(reject(buildJar(noManifest)).contains("missing"), "missing manifest is rejected");
        LinkedHashMap<String, byte[]> ghost = new LinkedHashMap<>();
        ghost.put(AddonManifest.PATH, manifestJson("ghost", "fixtures.addons.Ghost", "hud").getBytes(StandardCharsets.UTF_8));
        ghost.put("fixtures/addons/CleanHudAddon.class", classBytes(CleanHudAddon.class));
        check(reject(buildJar(ghost)).contains("missing from the jar"), "missing main is rejected");
        check(reject(addonJar("ghost", "fixtures.addons.Ghost", classBytes(CleanHudAddon.class), "hud"))
                .contains("CleanHudAddon"), "mismatched main bytes are rejected");

        // Loader gate: a direct MethodHandles call links nothing and dies when invoked.
        AddonSandbox.Loaded sneak = AddonSandbox.load(
                addonJar("sneak", "fixtures.addons.HandleSneakAddon", classBytes(HandleSneakAddon.class), "hud"));
        HudCanvas sneakCanvas = new HudCanvas();
        TickState sneakState = new TickState(1, 60, null, false);
        checkThrows(() -> sneak.asHud().render(sneakCanvas, sneakState), "direct lookup call cannot link");

        // Config: defaults are delivered at load as an unmodifiable map.
        AddonSandbox.Loaded echo = AddonSandbox.load(
                addonJar("echo", "fixtures.addons.ConfigEchoAddon", classBytes(ConfigEchoAddon.class), "hud", "config"));
        HudCanvas echoCanvas = new HudCanvas();
        echo.asHud().render(echoCanvas, new TickState(1, 60, null, false));
        check("color=red".equals(echoCanvas.texts().get(0).text()), "defaults reach configure at load");
        check("unmodifiable=true".equals(echoCanvas.texts().get(1).text()), "configure gets an unmodifiable map");

        // Canvas budgets: over-budget, degenerate, and oversized output drops safely.
        HudCanvas small = new HudCanvas(2);
        small.text("a", 0, 0, 0);
        small.text("b", 0, 0, 0);
        small.text("c", 0, 0, 0);
        check(small.texts().size() == 2 && small.dropped() == 1, "canvas enforces its budget");
        HudCanvas clip = new HudCanvas();
        clip.text("x".repeat(300), 0, 0, 0);
        check(clip.texts().get(0).text().length() == HudCanvas.MAX_TEXT_LENGTH, "canvas truncates long text");
        checkThrows(() -> new HudCanvas().text(null, 0, 0, 0), "canvas rejects null text");
        HudCanvas flat = new HudCanvas();
        flat.rect(0, 0, 0, 10, 0);
        check(flat.rects().isEmpty() && flat.dropped() == 1, "canvas drops degenerate rects");
        checkThrows(() -> new HudCanvas(0), "canvas needs a positive budget");
        small.clear();
        check(small.texts().isEmpty() && small.dropped() == 0, "canvas clear resets drops");
        checkThrows(() -> new TickState(-1, 60, null, false), "tick state rejects negative ticks");
        checkThrows(() -> new TickState(0, -1, null, false), "tick state rejects negative fps");
    }

    private static byte[] classBytes(Class<?> type) throws Exception {
        try (var stream = type.getResourceAsStream(type.getSimpleName() + ".class")) {
            if (stream == null) {
                throw new AssertionError("missing class bytes for " + type.getName());
            }
            return stream.readAllBytes();
        }
    }

    private static String manifestJson(String id, String mainClass, String... capabilities) {
        StringBuilder caps = new StringBuilder("[");
        for (int index = 0; index < capabilities.length; index++) {
            if (index > 0) {
                caps.append(',');
            }
            caps.append('"').append(capabilities[index]).append('"');
        }
        caps.append(']');
        return "{\"id\":\"" + id + "\",\"version\":\"1.0.0\",\"mainClass\":\"" + mainClass + "\",\"capabilities\":" + caps + "}";
    }

    private static byte[] addonJar(String id, String mainClass, byte[] mainBytes, String... capabilities) throws Exception {
        LinkedHashMap<String, byte[]> entries = new LinkedHashMap<>();
        entries.put(AddonManifest.PATH, manifestJson(id, mainClass, capabilities).getBytes(StandardCharsets.UTF_8));
        entries.put(mainClass.replace('.', '/') + ".class", mainBytes);
        return buildJar(entries);
    }

    private static byte[] manyClassJar() throws Exception {
        LinkedHashMap<String, byte[]> entries = new LinkedHashMap<>();
        entries.put(AddonManifest.PATH, manifestJson("many", "p.C0", "hud").getBytes(StandardCharsets.UTF_8));
        byte[] filler = classBytes(CleanHudAddon.class);
        for (int index = 0; index <= AddonSandbox.MAX_CLASSES; index++) {
            entries.put("p/C" + index + ".class", filler);
        }
        return buildJar(entries);
    }

    private static byte[] buildJar(Map<String, byte[]> entries) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (JarOutputStream jar = new JarOutputStream(out)) {
            for (Map.Entry<String, byte[]> entry : entries.entrySet()) {
                jar.putNextEntry(new JarEntry(entry.getKey()));
                jar.write(entry.getValue());
                jar.closeEntry();
            }
        }
        return out.toByteArray();
    }

    /** Loads expecting rejection; returns the rejection message. */
    private static String reject(byte[] jarBytes) {
        try {
            AddonSandbox.load(jarBytes);
        } catch (AddonSandbox.RejectedException e) {
            return String.valueOf(e.getMessage());
        }
        throw new AssertionError("expected the addon jar to be rejected");
    }

    private static void checkRejectManifest(String json, String message) {
        try {
            AddonManifest.parse(json);
        } catch (AddonSandbox.RejectedException e) {
            passed++;
            return;
        }
        throw new AssertionError("FAILED: " + message);
    }

    private static void checkThrows(Throwing runnable, String message) {
        try {
            runnable.run();
        } catch (RuntimeException | Error e) {
            passed++;
            return;
        }
        throw new AssertionError("FAILED: " + message);
    }

    private interface Throwing {
        void run();
    }

    /** Scripted transport for the exchange tests. */
    static final class ScriptHttp implements PlatformHttp {
        int calls;
        int failures;
        String lastUrl = "";
        String lastBody = "";
        Result next = new Result(200, "{}");

        @Override
        public Result postJson(String url, String json, String bearerOrNull) throws java.io.IOException {
            calls++;
            lastUrl = url;
            lastBody = json;
            if (failures > 0) {
                failures--;
                throw new java.io.IOException("simulated");
            }
            return next;
        }
    }
}
