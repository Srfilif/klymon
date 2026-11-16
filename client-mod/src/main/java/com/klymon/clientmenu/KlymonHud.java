package com.klymon.clientmenu;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;

/**
 * Thin dispatcher between Fabric's callbacks and the addon system: per-tick
 * updates go to {@code AddonManager.tick}, HUD rendering to
 * {@code AddonManager.renderHud}, and server changes to the profile watcher.
 */
public final class KlymonHud {
    private KlymonHud() {
    }

    public static void onTick(MinecraftClient client) {
        if (client.options == null) {
            // Ticks during client construction run before the options field is
            // assigned; addons only read live state, so there is nothing to do yet.
            return;
        }
        KlymonConfig config = KlymonConfig.get();
        config.addons().tick(client);
        config.tickServerWatcher(client);
    }

    public static void render(DrawContext context) {
        MinecraftClient client = MinecraftClient.getInstance();
        KlymonConfig config = KlymonConfig.get();
        if (!config.hudEnabled || client.player == null || client.world == null || client.options.hudHidden) {
            return;
        }
        config.addons().renderHud(context, client, config.hudScale);
    }
}
