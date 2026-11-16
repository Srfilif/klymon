package com.klymon.clientmenu.addon;

import net.minecraft.client.MinecraftClient;

/**
 * Fullbright: raises gamma while enabled and restores the player's previous
 * value on disable (never a hardcoded guess).
 */
public final class FullbrightAddon extends Addon implements Tickable {
    public static final String ID = "fullbright";

    private boolean applied;
    private double previous = 0.5;

    public FullbrightAddon() {
        super(ID, AddonCategory.UTILITY, "1.2.0", false);
    }

    @Override
    public void tick(MinecraftClient client) {
        if (enabled()) {
            if (!this.applied) {
                this.previous = client.options.getGamma().getValue();
                this.applied = true;
            }
            if (client.options.getGamma().getValue() != 10.0) {
                client.options.getGamma().setValue(10.0);
            }
            return;
        }
        if (this.applied) {
            this.applied = false;
            client.options.getGamma().setValue(this.previous);
        }
    }
}
