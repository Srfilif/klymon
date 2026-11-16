package com.klymon.clientmenu;

import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Properties;

import com.klymon.clientmenu.addon.AddonManager;
import com.klymon.clientmenu.config.ProfileDocument;
import com.klymon.clientmenu.config.ProfileManager;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudManager;
import com.google.gson.JsonSyntaxException;

import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ServerInfo;

/**
 * Persistence root for Klymon Client, stored as JSON in
 * {@code config/klymon-client.json} (migrated from the legacy
 * {@code klymon-client.properties} on first run).
 *
 * <p>Holds the global theme (accent, master HUD switch and scale), the active
 * profile, the server bindings and the manager wiring (addons + HUD).</p>
 */
public final class KlymonConfig {
    public enum Accent {
        TEAL(0xFF5BE0C8),
        BLUE(0xFF6EA8FF),
        PURPLE(0xFFB08BFF),
        PINK(0xFFFF7BC8),
        GOLD(0xFFFFC857);

        private final int color;

        Accent(int color) {
            this.color = color;
        }

        public int color() {
            return this.color;
        }

        public Accent next() {
            return values()[(ordinal() + 1) % values().length];
        }

        public String labelKey() {
            return "klymon.accent." + name().toLowerCase(Locale.ROOT);
        }
    }

    /** Master-scale steps offered by the settings screen. */
    public static final float[] SCALES = {0.75f, 1.0f, 1.25f, 1.5f};

    private static final Path FILE = FabricLoader.getInstance().getConfigDir().resolve("klymon-client.json");
    private static final Path LEGACY = FabricLoader.getInstance().getConfigDir().resolve("klymon-client.properties");
    private static final Path EXPORT_DIR = FabricLoader.getInstance().getConfigDir().resolve("klymon-exports");
    private static KlymonConfig instance;

    public boolean hudEnabled = true;
    public float hudScale = 1.0f;
    public Accent accent = Accent.TEAL;

    private final ProfileDocument document;
    private final AddonManager addons;
    private final HudManager hud;
    private String lastServerAddress = "";

    private KlymonConfig(ProfileDocument document) {
        this.document = document;
        this.hud = new HudManager();
        this.addons = AddonManager.createDefault(this.hud);
        ProfileDocument.Profile active = activeProfile();
        this.addons.importFrom(active);
        this.hud.importStates(active.hud);
    }

    public static synchronized KlymonConfig get() {
        if (instance == null) {
            instance = load();
        }
        return instance;
    }

    public AddonManager addons() {
        return this.addons;
    }

    public HudManager hud() {
        return this.hud;
    }

    public ProfileDocument document() {
        return this.document;
    }

    public String activeProfileId() {
        return this.document.activeProfile;
    }

    public ProfileDocument.Profile activeProfile() {
        ProfileDocument.Profile profile = this.document.profiles.get(this.document.activeProfile);
        if (profile == null) {
            this.document.activeProfile = ProfileManager.DEFAULT_PROFILE;
            profile = this.document.profiles.get(this.document.activeProfile);
        }
        return profile;
    }

    public static Path file() {
        return FILE;
    }

    public static Path exportDir() {
        return EXPORT_DIR;
    }

    // ------------------------------------------------------------------ profiles

    /** Switches profile, persisting the old one first. Returns false when unknown. */
    public boolean switchProfile(String id) {
        if (id == null || !this.document.profiles.containsKey(id) || id.equals(this.document.activeProfile)) {
            return id != null && this.document.profiles.containsKey(id);
        }
        syncToDocument();
        this.document.activeProfile = id;
        ProfileDocument.Profile profile = activeProfile();
        this.addons.importFrom(profile);
        this.hud.importStates(profile.hud);
        save();
        KlymonMenuClient.LOGGER.info("Klymon Client profile switched to '{}'", profile.name);
        return true;
    }

    public void bindServer(String address, String profileId) {
        String normalized = ProfileDocument.normalizeAddress(address);
        if (!normalized.isEmpty() && profileId != null && this.document.profiles.containsKey(profileId)) {
            this.document.serverBindings.put(normalized, profileId);
            save();
        }
    }

    public void unbindServer(String address) {
        if (this.document.serverBindings.remove(ProfileDocument.normalizeAddress(address)) != null) {
            save();
        }
    }

    /** Resets a built-in preset to factory flags, re-applying it when active. */
    public void resetBuiltinPreset(String id) {
        ProfileManager.resetBuiltin(this.document, id);
        if (id.equals(this.document.activeProfile)) {
            this.addons.importFrom(activeProfile());
            this.hud.resetAll();
            this.hud.importStates(activeProfile().hud);
        }
        save();
    }

    /** Auto-loads the bound profile when the server changes. Never runs commands. */
    public void tickServerWatcher(MinecraftClient client) {
        String address = "";
        if (client.world != null && !client.isInSingleplayer()) {
            ServerInfo entry = client.getCurrentServerEntry();
            if (entry != null) {
                address = ProfileDocument.normalizeAddress(entry.address);
            }
        }
        if (address.equals(this.lastServerAddress)) {
            return;
        }
        this.lastServerAddress = address;
        if (address.isEmpty()) {
            return;
        }
        String bound = ProfileDocument.matchBinding(this.document.serverBindings, address);
        if (bound != null && !bound.equals(this.document.activeProfile)
                && this.document.profiles.containsKey(bound)) {
            ProfileDocument.Profile profile = this.document.profiles.get(bound);
            if (switchProfile(bound) && client.player != null) {
                KlymonMenuClient.LOGGER.info("Auto-loaded profile '{}' for server {}", profile.name, address);
            }
        }
    }

    // ------------------------------------------------------------------ scale

    public void cycleScale(int direction) {
        int index = 0;
        for (int i = 0; i < SCALES.length; i++) {
            if (Math.abs(SCALES[i] - this.hudScale) < 0.01f) {
                index = i;
                break;
            }
        }
        this.hudScale = SCALES[Math.floorMod(index + direction, SCALES.length)];
    }

    public String scaleLabel() {
        return Math.round(this.hudScale * 100.0f) + "%";
    }

    // ------------------------------------------------------------------ persistence

    private void syncToDocument() {
        this.document.accent = this.accent.name();
        this.document.hudEnabled = this.hudEnabled;
        this.document.hudScale = this.hudScale;
        ProfileDocument.Profile active = activeProfile();
        this.addons.exportTo(active);
        active.hud = this.hud.exportStates();
    }

    public synchronized void save() {
        syncToDocument();
        try {
            Files.createDirectories(FILE.getParent());
            try (Writer writer = Files.newBufferedWriter(FILE, StandardCharsets.UTF_8)) {
                ProfileManager.gson().toJson(this.document, writer);
            }
        } catch (Exception error) {
            KlymonMenuClient.LOGGER.warn("Could not write {}: {}", FILE, error.getMessage());
        }
    }

    private static KlymonConfig load() {
        ProfileDocument document = readJson();
        if (document == null) {
            document = new ProfileDocument();
            if (Files.exists(LEGACY)) {
                migrateLegacy(document);
            }
        }
        ProfileManager.ensureDefaults(document);
        KlymonConfig config = new KlymonConfig(document);
        config.accent = parseEnum(Accent.class, document.accent, Accent.TEAL);
        config.hudEnabled = document.hudEnabled;
        config.hudScale = clampScale(document.hudScale);
        if (!Files.exists(FILE)) {
            config.save();
        }
        return config;
    }

    private static ProfileDocument readJson() {
        if (!Files.exists(FILE)) {
            return null;
        }
        try (Reader reader = Files.newBufferedReader(FILE, StandardCharsets.UTF_8)) {
            ProfileDocument document = ProfileManager.gson().fromJson(reader, ProfileDocument.class);
            if (document == null || document.profiles == null) {
                throw new JsonSyntaxException("empty document");
            }
            return document;
        } catch (Exception error) {
            KlymonMenuClient.LOGGER.warn("Could not read {} (starting fresh): {}", FILE, error.getMessage());
            try {
                Path backup = FILE.resolveSibling("klymon-client.json.corrupt-" + System.currentTimeMillis());
                Files.move(FILE, backup);
                KlymonMenuClient.LOGGER.warn("Moved the corrupt config to {}", backup.getFileName());
            } catch (Exception ignored) {
                // Best effort only.
            }
            return null;
        }
    }

    /** One-way migration from the 1.1 properties file into the Default profile. */
    private static void migrateLegacy(ProfileDocument document) {
        Properties properties = new Properties();
        try (Reader reader = Files.newBufferedReader(LEGACY, StandardCharsets.UTF_8)) {
            properties.load(reader);
        } catch (Exception error) {
            KlymonMenuClient.LOGGER.warn("Could not migrate {}: {}", LEGACY, error.getMessage());
            return;
        }
        document.hudEnabled = Boolean.parseBoolean(properties.getProperty("hud.enabled", "true"));
        document.hudScale = parseFloat(properties.getProperty("hud.scale"), 1.0f);
        document.accent = properties.getProperty("theme.accent", "TEAL");
        ProfileManager.ensureDefaults(document);
        ProfileDocument.Profile preset = document.profiles.get(ProfileManager.DEFAULT_PROFILE);

        boolean fps = enabled(properties, "fps", true);
        boolean ping = enabled(properties, "ping", false);
        put(preset, "fps-ping", fps || ping, "showFps", Boolean.toString(fps), "showPing", Boolean.toString(ping));
        put(preset, "cps-counter", enabled(properties, "cps", true));
        put(preset, "keystrokes", enabled(properties, "keystrokes", true));
        put(preset, "armor-status", enabled(properties, "armor", true));
        put(preset, "potion-effects", enabled(properties, "potions", false));
        put(preset, "watermark", enabled(properties, "watermark", true));
        put(preset, "coordinates", enabled(properties, "coordinates", false));
        boolean toggleSprint = Boolean.parseBoolean(properties.getProperty("tweaks.toggleSprint", "false"));
        boolean toggleSneak = Boolean.parseBoolean(properties.getProperty("tweaks.toggleSneak", "false"));
        boolean indicators = enabled(properties, "toggle", true);
        put(preset, "toggle-sprint-sneak", toggleSprint || toggleSneak || indicators,
                "sprintEnabled", Boolean.toString(toggleSprint || !properties.containsKey("tweaks.toggleSprint")),
                "sneakEnabled", Boolean.toString(toggleSneak),
                "showIndicators", Boolean.toString(indicators));
        put(preset, "fullbright", Boolean.parseBoolean(properties.getProperty("tweaks.fullbright", "false")));

        HudAnchor corner = parseEnum(HudAnchor.class, properties.getProperty("hud.corner"), null);
        if (corner != null && corner != HudAnchor.CENTER) {
            for (String id : preset.hud.keySet()) {
                preset.hud.get(id).put("anchor", corner.name());
            }
        }
        KlymonMenuClient.LOGGER.info("Migrated legacy {} into the Default profile", LEGACY.getFileName());
    }

    private static boolean enabled(Properties properties, String key, boolean fallback) {
        return Boolean.parseBoolean(properties.getProperty("addon." + key, Boolean.toString(fallback)));
    }

    private static void put(ProfileDocument.Profile preset, String id, boolean enabled, String... pairs) {
        ProfileDocument.AddonState state = preset.addons.computeIfAbsent(id, key -> new ProfileDocument.AddonState());
        state.enabled = enabled;
        for (int i = 0; i + 1 < pairs.length; i += 2) {
            state.settings.put(pairs[i], pairs[i + 1]);
        }
    }

    private static float clampScale(float value) {
        for (float scale : SCALES) {
            if (Math.abs(scale - value) < 0.01f) {
                return scale;
            }
        }
        return 1.0f;
    }

    private static float parseFloat(String value, float fallback) {
        try {
            return value == null ? fallback : Float.parseFloat(value);
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private static <E extends Enum<E>> E parseEnum(Class<E> type, String value, E fallback) {
        if (value == null) {
            return fallback;
        }
        try {
            return Enum.valueOf(type, value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ignored) {
            return fallback;
        }
    }
}
