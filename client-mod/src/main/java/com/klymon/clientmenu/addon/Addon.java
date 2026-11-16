package com.klymon.clientmenu.addon;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Base class for every Klymon addon: a unique id, a category, an enabled flag
 * and a list of validated {@link Setting}s.
 *
 * <p>Addons are plain data + behavior hooks; rendering lives in
 * {@code hud.HudElement} implementations and per-tick logic in
 * {@link Tickable}. Persistence is a string map per addon, stored inside the
 * active profile.</p>
 */
public abstract class Addon {
    private final String id;
    private final AddonCategory category;
    private final String version;
    private final List<String> dependencies;
    private final boolean defaultEnabled;
    private final List<Setting<?>> settings = new ArrayList<>();
    private boolean enabled;

    protected Addon(String id, AddonCategory category, String version, boolean defaultEnabled, String... dependencies) {
        this.id = id;
        this.category = category;
        this.version = version;
        this.defaultEnabled = defaultEnabled;
        this.enabled = defaultEnabled;
        this.dependencies = dependencies.length == 0 ? List.of("fabric-api") : List.of(dependencies);
    }

    protected <T> Setting<T> setting(Setting<T> setting) {
        this.settings.add(setting);
        return setting;
    }

    public final String id() {
        return this.id;
    }

    public final AddonCategory category() {
        return this.category;
    }

    public final String version() {
        return this.version;
    }

    /** Mod ids (or loader ids) this addon needs; shown in the UI. */
    public final List<String> dependencies() {
        return this.dependencies;
    }

    public final List<Setting<?>> settings() {
        return this.settings;
    }

    public final boolean enabled() {
        return this.enabled;
    }

    public final void setEnabled(boolean enabled) {
        boolean changed = this.enabled != enabled;
        this.enabled = enabled;
        if (changed) {
            onToggle(enabled);
        }
    }

    /** Hook for addons that must release state (pressed keys, listeners) on toggle. */
    protected void onToggle(boolean enabled) {
    }

    public final boolean configurable() {
        return !this.settings.isEmpty();
    }

    public final String nameKey() {
        return "klymon.addon." + this.id;
    }

    public final String descriptionKey() {
        return "klymon.addon." + this.id + ".desc";
    }

    public Setting<?> setting(String key) {
        for (Setting<?> candidate : this.settings) {
            if (candidate.key().equals(key)) {
                return candidate;
            }
        }
        return null;
    }

    /** Restores the default enabled flag and every default setting value. */
    public void resetToDefaults() {
        this.enabled = this.defaultEnabled;
        for (Setting<?> setting : this.settings) {
            setting.reset();
        }
        validate();
    }

    /** Re-validates every setting after an import. */
    public void validate() {
        for (Setting<?> setting : this.settings) {
            setting.validate();
        }
    }

    /** Exports the settings to the string map stored in the profile JSON. */
    public Map<String, String> exportSettings() {
        Map<String, String> exported = new LinkedHashMap<>();
        for (Setting<?> setting : this.settings) {
            exported.put(setting.key(), setting.serialize());
        }
        return exported;
    }

    /** Imports settings leniently: unknown keys are ignored, invalid values reset. */
    public void importSettings(Map<String, String> imported) {
        if (imported == null) {
            return;
        }
        for (Setting<?> setting : this.settings) {
            String raw = imported.get(setting.key());
            if (raw != null) {
                setting.deserialize(raw);
            }
        }
        validate();
    }
}
