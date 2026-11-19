package com.klymon.clientmenu.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.klymon.clientmenu.config.ProfileDocument.AddonState;
import com.klymon.clientmenu.config.ProfileDocument.Profile;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonSyntaxException;

/**
 * Profile CRUD, built-in presets, JSON import/export and server bindings.
 * Operates on a {@link ProfileDocument} and has no Minecraft dependencies, so
 * the headless tests cover the same code the game uses.
 */
public final class ProfileManager {
    /**
     * Largest accepted profile-export payload, in bytes on disk / chars in
     * memory (exports are JSON, so chars conservatively over-count bytes).
     * Real exports are a few kilobytes; anything bigger is corruption or abuse.
     */
    public static final int MAX_EXPORT_BYTES = 1_000_000;

    public static final String DEFAULT_PROFILE = "default";
    public static final List<String> BUILTIN_IDS = List.of(
            "default", "pvp", "bedwars", "skywars", "practice", "survival", "performance");

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private ProfileManager() {
    }

    public static Gson gson() {
        return GSON;
    }

    /**
     * Writes JSON text to {@code file}, creating parent directories. Callers
     * decide how to surface the failure — this method never swallows it.
     */
    public static void writeJsonFile(Path file, String json) throws IOException {
        Path parent = file.toAbsolutePath().getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.writeString(file, json, StandardCharsets.UTF_8);
    }

    // ------------------------------------------------------------------ builtins

    /**
     * The addons switched on by each built-in preset. Addons missing from a set
     * stay at their own defaults; HUD layouts always start from the element
     * defaults so every preset looks sane on any resolution.
     */
    public static Map<String, Boolean> builtinAddonFlags(String profileId) {
        Map<String, Boolean> flags = new LinkedHashMap<>();
        switch (profileId) {
            case "pvp", "bedwars", "skywars", "practice" -> {
                flags.put("keystrokes", true);
                flags.put("cps-counter", true);
                flags.put("combo-counter", true);
                flags.put("hit-indicators", true);
                flags.put("block-overlay", true);
                flags.put("fps-ping", true);
                flags.put("armor-status", true);
                flags.put("potion-effects", false);
                flags.put("watermark", true);
                flags.put("coordinates", profileId.equals("bedwars") || profileId.equals("skywars"));
                flags.put("custom-crosshair", profileId.equals("practice"));
                flags.put("toggle-sprint-sneak", true);
                flags.put("fullbright", false);
            }
            case "survival" -> {
                flags.put("keystrokes", false);
                flags.put("cps-counter", false);
                flags.put("combo-counter", false);
                flags.put("hit-indicators", false);
                flags.put("block-overlay", false);
                flags.put("fps-ping", true);
                flags.put("armor-status", true);
                flags.put("potion-effects", true);
                flags.put("watermark", true);
                flags.put("coordinates", true);
                flags.put("custom-crosshair", false);
                flags.put("toggle-sprint-sneak", true);
                flags.put("fullbright", false);
            }
            case "performance" -> {
                flags.put("keystrokes", false);
                flags.put("cps-counter", false);
                flags.put("combo-counter", false);
                flags.put("hit-indicators", false);
                flags.put("block-overlay", false);
                flags.put("fps-ping", true);
                flags.put("armor-status", false);
                flags.put("potion-effects", false);
                flags.put("watermark", true);
                flags.put("coordinates", false);
                flags.put("custom-crosshair", false);
                flags.put("toggle-sprint-sneak", false);
                flags.put("fullbright", false);
            }
            default -> { // "default" and unknown ids
                flags.put("keystrokes", true);
                flags.put("cps-counter", true);
                flags.put("combo-counter", false);
                flags.put("hit-indicators", true);
                flags.put("block-overlay", false);
                flags.put("fps-ping", true);
                flags.put("armor-status", true);
                flags.put("potion-effects", false);
                flags.put("watermark", true);
                flags.put("coordinates", false);
                flags.put("custom-crosshair", false);
                flags.put("toggle-sprint-sneak", true);
                flags.put("fullbright", false);
            }
        }
        return flags;
    }

    public static String builtinName(String profileId) {
        return switch (profileId) {
            case "default" -> "Default";
            case "pvp" -> "PvP";
            case "bedwars" -> "BedWars";
            case "skywars" -> "SkyWars";
            case "practice" -> "Practice";
            case "survival" -> "Survival";
            case "performance" -> "Performance";
            default -> profileId;
        };
    }

    public static Profile builtinProfile(String profileId) {
        Profile profile = new Profile();
        profile.name = builtinName(profileId);
        profile.builtin = true;
        for (Map.Entry<String, Boolean> flag : builtinAddonFlags(profileId).entrySet()) {
            profile.addons.put(flag.getKey(), new AddonState(flag.getValue(), Map.of()));
        }
        return profile;
    }

    /** Adds any missing built-in preset and repairs structural damage. */
    public static void ensureDefaults(ProfileDocument document) {
        if (document.profiles == null) {
            document.profiles = new LinkedHashMap<>();
        }
        if (document.serverBindings == null) {
            document.serverBindings = new LinkedHashMap<>();
        }
        for (String id : BUILTIN_IDS) {
            document.profiles.computeIfAbsent(id, ProfileManager::builtinProfile);
        }
        for (Profile profile : document.profiles.values()) {
            if (profile == null) {
                continue;
            }
            if (profile.name == null || profile.name.isBlank()) {
                profile.name = "Profile";
            }
            if (profile.addons == null) {
                profile.addons = new LinkedHashMap<>();
            }
            if (profile.hud == null) {
                profile.hud = new LinkedHashMap<>();
            }
            profile.addons.values().removeIf(state -> state == null);
            for (AddonState state : profile.addons.values()) {
                if (state.settings == null) {
                    state.settings = new LinkedHashMap<>();
                }
                state.settings.values().removeIf(value -> value == null);
            }
        }
        document.serverBindings.values().removeIf(value -> value == null || value.isBlank());
        if (document.activeProfile == null || !document.profiles.containsKey(document.activeProfile)) {
            document.activeProfile = DEFAULT_PROFILE;
        }
        document.version = ProfileDocument.CURRENT_VERSION;
    }

    // ------------------------------------------------------------------ CRUD

    public static List<String> orderedIds(ProfileDocument document) {
        List<String> ids = new ArrayList<>();
        for (String id : BUILTIN_IDS) {
            if (document.profiles.containsKey(id)) {
                ids.add(id);
            }
        }
        for (String id : document.profiles.keySet()) {
            if (!ids.contains(id)) {
                ids.add(id);
            }
        }
        return ids;
    }

    /** Number of pages for {@code total} ids at {@code pageSize} per page (always >= 1). */
    public static int pageCount(int total, int pageSize) {
        if (pageSize <= 0) {
            throw new IllegalArgumentException("pageSize must be positive");
        }
        return Math.max(1, (Math.max(0, total) + pageSize - 1) / pageSize);
    }

    /** Window of ids for a 0-based page; out-of-range pages clamp to the nearest one. */
    public static List<String> page(List<String> ids, int page, int pageSize) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        int safe = Math.max(0, Math.min(page, pageCount(ids.size(), pageSize) - 1));
        int from = safe * pageSize;
        return new ArrayList<>(ids.subList(from, Math.min(from + pageSize, ids.size())));
    }

    public static String uniqueId(ProfileDocument document, String base) {
        String candidate = ProfileDocument.sanitizeId(base);
        if (!document.profiles.containsKey(candidate)) {
            return candidate;
        }
        int suffix = 2;
        while (document.profiles.containsKey(candidate + "-" + suffix)) {
            suffix++;
        }
        return candidate + "-" + suffix;
    }

    /** Creates a custom profile cloned from {@code sourceId}. Returns the new id. */
    public static String duplicate(ProfileDocument document, String sourceId, String name) {
        Profile source = document.profiles.get(sourceId);
        if (source == null) {
            throw new IllegalArgumentException("Unknown profile: " + sourceId);
        }
        String id = uniqueId(document, name == null || name.isBlank() ? source.name + "-copy" : name);
        Profile copy = GSON.fromJson(GSON.toJson(source), Profile.class);
        copy.name = name == null || name.isBlank() ? source.name + " (copy)" : name.trim();
        copy.builtin = false;
        document.profiles.put(id, copy);
        return id;
    }

    public static String create(ProfileDocument document, String name) {
        return duplicate(document, document.activeProfile, name);
    }

    public static void rename(ProfileDocument document, String id, String name) {
        Profile profile = document.profiles.get(id);
        if (profile == null) {
            throw new IllegalArgumentException("Unknown profile: " + id);
        }
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Profile name must not be empty");
        }
        profile.name = name.trim();
    }

    /** Deletes a custom profile; built-ins and the active profile are protected. */
    public static void delete(ProfileDocument document, String id) {
        Profile profile = document.profiles.get(id);
        if (profile == null) {
            throw new IllegalArgumentException("Unknown profile: " + id);
        }
        if (profile.builtin) {
            throw new IllegalStateException("Built-in profiles cannot be deleted");
        }
        if (id.equals(document.activeProfile)) {
            throw new IllegalStateException("The active profile cannot be deleted");
        }
        document.profiles.remove(id);
        document.serverBindings.values().removeIf(target -> target.equals(id));
    }

    /** Resets a built-in preset to its factory flags (custom profiles keep HUD). */
    public static void resetBuiltin(ProfileDocument document, String id) {
        if (!BUILTIN_IDS.contains(id) || !document.profiles.containsKey(id)) {
            throw new IllegalArgumentException("Unknown built-in profile: " + id);
        }
        document.profiles.put(id, builtinProfile(id));
    }

    // ------------------------------------------------------------------ import/export

    /** Serializes one profile for export (id travels inside the payload). */
    public static String exportProfile(ProfileDocument document, String id) {
        Profile profile = document.profiles.get(id);
        if (profile == null) {
            throw new IllegalArgumentException("Unknown profile: " + id);
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("generator", "klymon-client");
        payload.put("version", ProfileDocument.CURRENT_VERSION);
        payload.put("id", id);
        payload.put("profile", profile);
        return GSON.toJson(payload);
    }

    /**
     * Parses an export payload back into a profile. Unknown addon ids and HUD
     * entries are preserved (forward compatibility); structural damage throws
     * {@link IllegalArgumentException} with a readable message.
     */
    @SuppressWarnings("unchecked")
    public static Profile parseExport(String json) {
        if (json != null && json.length() > MAX_EXPORT_BYTES) {
            throw new IllegalArgumentException(
                    "Profile export is too large (" + json.length() + " chars, max " + MAX_EXPORT_BYTES + ")");
        }
        Map<String, Object> payload;
        try {
            payload = GSON.fromJson(json, Map.class);
        } catch (JsonSyntaxException error) {
            throw new IllegalArgumentException("Not valid JSON: " + error.getMessage());
        }
        if (payload == null || !(payload.get("profile") instanceof Map)) {
            throw new IllegalArgumentException("Not an Klymon profile export (missing \"profile\")");
        }
        Profile profile;
        try {
            profile = GSON.fromJson(GSON.toJson(payload.get("profile")), Profile.class);
        } catch (JsonSyntaxException error) {
            throw new IllegalArgumentException("Corrupt profile payload: " + error.getMessage());
        }
        if (profile == null || profile.name == null || profile.name.isBlank()) {
            throw new IllegalArgumentException("Corrupt profile payload (missing name)");
        }
        if (profile.addons == null) {
            profile.addons = new LinkedHashMap<>();
        }
        if (profile.hud == null) {
            profile.hud = new LinkedHashMap<>();
        }
        profile.builtin = false;
        return profile;
    }

    /** Imports a payload as a new custom profile. Returns the new id. */
    public static String importProfile(ProfileDocument document, String json) {
        Profile profile = parseExport(json);
        String id = uniqueId(document, profile.name);
        document.profiles.put(id, profile);
        ensureDefaults(document);
        return id;
    }
}
