package com.klymon.clientmenu.addon;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.klymon.clientmenu.config.ProfileDocument;
import com.klymon.clientmenu.hud.HudElement;
import com.klymon.clientmenu.hud.HudManager;

import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;

/**
 * Registry for every addon: built-in modules plus external performance mods
 * (detected live, managed by the launcher). Applies profiles, ticks modules
 * and renders the HUD through the {@link HudManager}.
 */
public final class AddonManager {
    private final Map<String, Addon> addons = new LinkedHashMap<>();
    private final HudManager hud;

    public AddonManager(HudManager hud) {
        this.hud = hud;
    }

    /** Registers every built-in addon plus the launcher-managed performance mods. */
    public static AddonManager createDefault(HudManager hud) {
        AddonManager manager = new AddonManager(hud);
        // PvP (order = UI order)
        manager.register(new KeystrokesAddon());
        manager.register(new CpsAddon());
        manager.register(new ComboCounterAddon());
        manager.register(new HitIndicatorsAddon());
        manager.register(new BlockOverlayAddon());
        // HUD
        manager.register(new FpsPingAddon());
        manager.register(new ArmorStatusAddon());
        manager.register(new PotionEffectsAddon());
        manager.register(new WatermarkAddon());
        manager.register(new CoordinatesAddon());
        manager.register(new LevelAddon());
        // Visual
        manager.register(new CustomCrosshairAddon());
        // Utility
        manager.register(new ToggleSprintSneakAddon());
        manager.register(new FullbrightAddon());
        // Performance (external, detected live; installed by the launcher)
        manager.register(new ExternalModAddon("sodium", "sodium", "sodium"));
        manager.register(new ExternalModAddon("lithium", "lithium", "lithium"));
        manager.register(new ExternalModAddon("ferrite-core", "ferritecore", "ferrite-core"));
        manager.register(new ExternalModAddon("immediatelyfast", "immediatelyfast", "immediatelyfast"));
        manager.register(new ExternalModAddon("entityculling", "entityculling", "entityculling"));
        manager.register(new ExternalModAddon("moreculling", "moreculling", "moreculling"));
        manager.register(new ExternalModAddon("dynamic-fps", "dynamicfps", "dynamic-fps"));
        manager.register(new ExternalModAddon("modernfix", "modernfix", "modernfix"));
        return manager;
    }

    public void register(Addon addon) {
        this.addons.put(addon.id(), addon);
        if (addon instanceof HudElement element) {
            this.hud.register(element);
        }
    }

    public Addon byId(String id) {
        return this.addons.get(id);
    }

    public List<Addon> all() {
        return new ArrayList<>(this.addons.values());
    }

    public List<Addon> byCategory(AddonCategory category) {
        List<Addon> result = new ArrayList<>();
        for (Addon addon : this.addons.values()) {
            if (addon.category() == category) {
                result.add(addon);
            }
        }
        return result;
    }

    public boolean enabled(String id) {
        Addon addon = this.addons.get(id);
        return addon != null && addon.enabled();
    }

    public void setEnabled(String id, boolean enabled) {
        Addon addon = this.addons.get(id);
        if (addon != null && !(addon instanceof ExternalModAddon)) {
            addon.setEnabled(enabled);
        }
    }

    public void setAllInternal(boolean enabled) {
        for (Addon addon : this.addons.values()) {
            if (!(addon instanceof ExternalModAddon)) {
                addon.setEnabled(enabled);
            }
        }
    }

    public void resetAllInternal() {
        for (Addon addon : this.addons.values()) {
            if (!(addon instanceof ExternalModAddon)) {
                addon.resetToDefaults();
            }
        }
    }

    /**
     * Per-tick update for every {@link Tickable} addon, enabled or not, so a
     * just-disabled addon can release its state (pressed keys, trackers) on the
     * next tick. Each addon decides what to do while disabled.
     */
    public void tick(MinecraftClient client) {
        for (Addon addon : this.addons.values()) {
            if (addon instanceof Tickable tickable) {
                tickable.tick(client);
            }
        }
    }

    /** Renders the HUD elements of every enabled addon. */
    public void renderHud(DrawContext context, MinecraftClient client, float masterScale) {
        this.hud.renderAll(context, client, masterScale, this::enabled);
    }

    // ------------------------------------------------------------- profiles

    /** Writes the current addon states into the given profile. */
    public void exportTo(ProfileDocument.Profile profile) {
        for (Addon addon : this.addons.values()) {
            if (addon instanceof ExternalModAddon) {
                continue;
            }
            profile.addons.put(addon.id(), new ProfileDocument.AddonState(addon.enabled(), addon.exportSettings()));
        }
    }

    /**
     * Applies a profile: known addons take the stored flag + settings, addons
     * missing from the profile keep their current state (forward/backward
     * compatibility for hand-edited files).
     */
    public void importFrom(ProfileDocument.Profile profile) {
        if (profile == null) {
            return;
        }
        for (Addon addon : this.addons.values()) {
            if (addon instanceof ExternalModAddon) {
                continue;
            }
            ProfileDocument.AddonState state = profile.addons.get(addon.id());
            if (state == null) {
                continue;
            }
            addon.setEnabled(state.enabled);
            addon.importSettings(state.settings);
        }
    }

    /** Live detection for the Performance tab (mods installed by the launcher). */
    public static boolean modLoaded(String modId) {
        try {
            return FabricLoader.getInstance().isModLoaded(modId);
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    public static String modVersion(String modId) {
        try {
            return FabricLoader.getInstance().getModContainer(modId)
                    .map(container -> container.getMetadata().getVersion().getFriendlyString())
                    .orElse(null);
        } catch (RuntimeException ignored) {
            return null;
        }
    }
}
