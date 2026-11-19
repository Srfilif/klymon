package com.klymon.clientmenu.cosmetic;

import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.klymon.clientmenu.platform.HandoffOffer;

import net.fabricmc.loader.api.FabricLoader;

/**
 * Read-only view of the launcher's progression state, exported by the desktop
 * app to {@code config/klymon-bridge.json} (see {@code ProgressionService}).
 *
 * <p>The file is versioned and parsed leniently: a missing, outdated or
 * hand-edited bridge degrades to safe defaults (prefix {@code [K]}, level 1,
 * no cosmetics) instead of breaking the game. Reloads when the file changes.</p>
 */
public final class KlymonBridge {
    public static final String DEFAULT_PREFIX = "[K]";
    public static final int DEFAULT_PREFIX_COLOR = 0xFF22D3EE;

    /** One equipped cosmetic entry from the bridge loadout. */
    public record Equipped(String slot, String id, List<String> colors, String particle, String shape, String baseItem) {
    }

    private static final Gson GSON = new Gson();
    private static KlymonBridge instance;

    private final String displayName;
    private final String rankPrefix;
    private final int rankColor;
    private final String title;
    private final int level;
    private final int balance;
    private final long lifetimePoints;
    private final long playSeconds;
    private final int sessions;
    private final Map<String, Equipped> loadout;
    private final boolean fresh;
    private final HandoffOffer handoff;

    private KlymonBridge(String displayName, String rankPrefix, int rankColor, String title,
            int level, int balance, long lifetimePoints, long playSeconds, int sessions,
            Map<String, Equipped> loadout, boolean fresh, HandoffOffer handoff) {
        this.displayName = displayName;
        this.rankPrefix = rankPrefix;
        this.rankColor = rankColor;
        this.title = title;
        this.level = level;
        this.balance = balance;
        this.lifetimePoints = lifetimePoints;
        this.playSeconds = playSeconds;
        this.sessions = sessions;
        this.loadout = loadout;
        this.fresh = fresh;
        this.handoff = handoff;
    }

    public static Path file() {
        return FabricLoader.getInstance().getConfigDir().resolve("klymon-bridge.json");
    }

    private static FileTime lastSeen = null;
    private static long lastCheckMs = 0L;

    /** Cached snapshot; re-read when the file changes (checked at most twice a second). */
    public static synchronized KlymonBridge get() {
        long now = System.currentTimeMillis();
        if (instance != null && now - lastCheckMs < 500L) {
            return instance;
        }
        lastCheckMs = now;
        try {
            Path path = file();
            FileTime modified = Files.exists(path) ? Files.getLastModifiedTime(path) : null;
            if (instance != null && modified != null && modified.equals(lastSeen)) {
                return instance;
            }
            lastSeen = modified;
            instance = read(path);
        } catch (Exception ignored) {
            instance = defaults();
        }
        return instance;
    }

    /** Forces a re-read on the next {@link #get()}. */
    public static synchronized void invalidate() {
        lastSeen = null;
        lastCheckMs = 0L;
    }

    private static KlymonBridge defaults() {
        return new KlymonBridge(null, DEFAULT_PREFIX, DEFAULT_PREFIX_COLOR, null,
                1, 0, 0L, 0L, 0, Map.of(), false, null);
    }

    static KlymonBridge read(Path path) {
        if (!Files.isRegularFile(path)) {
            return defaults();
        }
        try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            JsonElement root = JsonParser.parseReader(reader);
            if (!root.isJsonObject()) {
                return defaults();
            }
            JsonObject json = root.getAsJsonObject();
            if (optInt(json, "version", 0) != 1) {
                return defaults();
            }
            Map<String, Equipped> loadout = new LinkedHashMap<>();
            JsonElement loadoutJson = json.get("loadout");
            if (loadoutJson != null && loadoutJson.isJsonArray()) {
                JsonArray array = loadoutJson.getAsJsonArray();
                for (JsonElement element : array) {
                    if (!element.isJsonObject()) {
                        continue;
                    }
                    JsonObject entry = element.getAsJsonObject();
                    String slot = optString(entry, "slot", "");
                    String id = optString(entry, "id", "");
                    if (slot.isEmpty() || id.isEmpty()) {
                        continue;
                    }
                    List<String> colors = new ArrayList<>();
                    JsonElement colorsJson = entry.get("colors");
                    if (colorsJson != null && colorsJson.isJsonArray()) {
                        for (JsonElement color : colorsJson.getAsJsonArray()) {
                            if (color.isJsonPrimitive() && color.getAsJsonPrimitive().isString()) {
                                colors.add(color.getAsString());
                            }
                        }
                    }
                    loadout.put(slot, new Equipped(slot, id, List.copyOf(colors),
                            optNullable(entry, "particle"), optNullable(entry, "shape"), optNullable(entry, "baseItem")));
                }
            }
            return new KlymonBridge(
                    optNullable(json, "displayName"),
                    optString(json, "rankPrefix", DEFAULT_PREFIX),
                    parseColor(optString(json, "rankColor", "#22d3ee"), DEFAULT_PREFIX_COLOR),
                    optNullable(json, "title"),
                    Math.max(1, optInt(json, "level", 1)),
                    Math.max(0, optInt(json, "balance", 0)),
                    Math.max(0L, optLong(json, "lifetimePoints", 0L)),
                    Math.max(0L, optLong(json, "playSeconds", 0L)),
                    Math.max(0, optInt(json, "sessions", 0)),
                    loadout, true, HandoffOffer.parse(json));
        } catch (Exception ignored) {
            return defaults();
        }
    }

    private static String optString(JsonObject json, String key, String fallback) {
        JsonElement element = json.get(key);
        if (element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isString()) {
            return element.getAsString();
        }
        return fallback;
    }

    private static String optNullable(JsonObject json, String key) {
        JsonElement element = json.get(key);
        if (element != null && !element.isJsonNull() && element.isJsonPrimitive() && element.getAsJsonPrimitive().isString()) {
            return element.getAsString();
        }
        return null;
    }

    private static int optInt(JsonObject json, String key, int fallback) {
        try {
            JsonElement element = json.get(key);
            if (element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isNumber()) {
                return element.getAsInt();
            }
        } catch (RuntimeException ignored) {
            // Fall through to the default.
        }
        return fallback;
    }

    private static long optLong(JsonObject json, String key, long fallback) {
        try {
            JsonElement element = json.get(key);
            if (element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isNumber()) {
                return element.getAsLong();
            }
        } catch (RuntimeException ignored) {
            // Fall through to the default.
        }
        return fallback;
    }

    /** Parses {@code #rrggbb} into opaque ARGB. */
    public static int parseColor(String raw, int fallback) {
        if (raw == null) {
            return fallback;
        }
        String clean = raw.trim().toLowerCase(Locale.ROOT);
        if (clean.startsWith("#")) {
            clean = clean.substring(1);
        }
        if (clean.length() != 6) {
            return fallback;
        }
        try {
            return 0xFF000000 | Integer.parseInt(clean, 16);
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    /**
     * Display name for Klymon surfaces. The bridge already carries the decorated
     * name; when it is missing (launcher never exported), the session username
     * is shown with the default prefix. The account name itself is never changed.
     */
    public String displayName(String sessionUsername) {
        if (this.displayName != null && !this.displayName.isBlank()) {
            return this.displayName;
        }
        String base = sessionUsername == null || sessionUsername.isBlank() ? "?" : sessionUsername.trim();
        return DEFAULT_PREFIX + " " + base;
    }

    public String rankPrefix() {
        return this.rankPrefix;
    }

    public int rankColor() {
        return this.rankColor;
    }

    public String title() {
        return this.title;
    }

    public int level() {
        return this.level;
    }

    public int balance() {
        return this.balance;
    }

    public long lifetimePoints() {
        return this.lifetimePoints;
    }

    public long playSeconds() {
        return this.playSeconds;
    }

    public int sessions() {
        return this.sessions;
    }

    public Equipped equipped(String slot) {
        return this.loadout.get(slot);
    }

    public Map<String, Equipped> loadout() {
        return this.loadout;
    }

    /** True when the snapshot came from a real launcher export. */
    public boolean fresh() {
        return this.fresh;
    }

    /** The launcher's login handoff, if this export carries one. Never logged. */
    public HandoffOffer handoff() {
        return this.handoff;
    }

    static String debugJson(KlymonBridge bridge) {
        return GSON.toJson(Map.of(
                "prefix", bridge.rankPrefix,
                "level", bridge.level,
                "loadout", bridge.loadout.keySet().toString()));
    }
}
