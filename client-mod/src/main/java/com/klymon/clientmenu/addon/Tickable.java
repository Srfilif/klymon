package com.klymon.clientmenu.addon;

import net.minecraft.client.MinecraftClient;

/** Addons that need a per-tick update (trackers, key latches, watchers). */
public interface Tickable {
    void tick(MinecraftClient client);
}
