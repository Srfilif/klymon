package com.klymon.clientmenu.config;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * The JSON document persisted as {@code config/klymon-client.json}. Plain Gson
 * POJOs without Minecraft dependencies so imports, exports and validation can
 * be tested headlessly.
 *
 * <pre>{@code
 * {
 *   "version": 2,
 *   "accent": "TEAL",
 *   "hudEnabled": true,
 *   "hudScale": 1.0,
 *   "activeProfile": "default",
 *   "serverBindings": { "hypixel.net": "bedwars" },
 *   "profiles": {
 *     "default": {
 *       "name": "Default",
 *       "builtin": true,
 *       "addons": { "keystrokes": { "enabled": true, "settings": { ... } } },
 *       "hud": { "keystrokes": { "anchor": "BOTTOM_RIGHT", "x": 3, ... } }
 *     }
 *   }
 * }
 * }</pre>
 */
public final class ProfileDocument {
    public static final int CURRENT_VERSION = 2;

    public int version = CURRENT_VERSION;
    public String accent = "TEAL";
    public boolean hudEnabled = true;
    public float hudScale = 1.0f;
    public String activeProfile = "default";
    public Map<String, String> serverBindings = new LinkedHashMap<>();
    public Map<String, Profile> profiles = new LinkedHashMap<>();

    public static final class Profile {
        public String name = "Profile";
        public boolean builtin = false;
        public Map<String, AddonState> addons = new LinkedHashMap<>();
        public Map<String, Map<String, String>> hud = new LinkedHashMap<>();
    }

    public static final class AddonState {
        public boolean enabled;
        public Map<String, String> settings = new LinkedHashMap<>();

        public AddonState() {
        }

        public AddonState(boolean enabled, Map<String, String> settings) {
            this.enabled = enabled;
            this.settings = settings == null ? new LinkedHashMap<>() : new LinkedHashMap<>(settings);
        }
    }

    /** Normalizes a server address for binding lookups (case/whitespace only). */
    public static String normalizeAddress(String address) {
        return address == null ? "" : address.trim().toLowerCase(Locale.ROOT);
    }

    /** Strips the port suffix when present ({@code host:25565} → {@code host}). */
    public static String stripPort(String normalized) {
        int colon = normalized.lastIndexOf(':');
        if (colon <= 0 || normalized.indexOf(':') != colon) {
            return normalized;
        }
        String port = normalized.substring(colon + 1);
        for (int i = 0; i < port.length(); i++) {
            if (!Character.isDigit(port.charAt(i))) {
                return normalized;
            }
        }
        return normalized.substring(0, colon);
    }

    /**
     * Finds the bound profile for a server address: exact match first, then the
     * host without port. Returns null when nothing matches.
     */
    public static String matchBinding(Map<String, String> bindings, String address) {
        if (bindings == null || bindings.isEmpty()) {
            return null;
        }
        String normalized = normalizeAddress(address);
        if (normalized.isEmpty()) {
            return null;
        }
        String exact = bindings.get(normalized);
        if (exact != null) {
            return exact;
        }
        return bindings.get(stripPort(normalized));
    }

    /** Sanitizes a profile id for file names and map keys. */
    public static String sanitizeId(String raw) {
        if (raw == null) {
            return "profile";
        }
        String slug = raw.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9-_]+", "-");
        slug = slug.replaceAll("^-+|-+$", "");
        return slug.isEmpty() ? "profile" : slug;
    }
}
