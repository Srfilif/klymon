package com.klymon.clientmenu.addon;

import java.util.ArrayList;
import java.util.List;

import com.klymon.clientmenu.KlymonTheme;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudElement;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;

/**
 * Toggle sprint and toggle sneak with independent options and on-screen state
 * indicators. It only drives the vanilla key states client-side (the same keys
 * the player could hold), sends no packets and releases everything when
 * disabled, flying-guarded or unloaded — server-safe by construction.
 */
public final class ToggleSprintSneakAddon extends Addon implements HudElement, Tickable {
    public static final String ID = "toggle-sprint-sneak";

    private final Setting<Boolean> sprintEnabled = setting(Setting.bool(ID, "sprintEnabled", true));
    private final Setting<Boolean> sneakEnabled = setting(Setting.bool(ID, "sneakEnabled", false));
    private final Setting<Boolean> showIndicators = setting(Setting.bool(ID, "showIndicators", true));
    private final Setting<Boolean> requireForward = setting(Setting.bool(ID, "requireForward", true));
    private final Setting<Boolean> disableWhileFlying = setting(Setting.bool(ID, "disableWhileFlying", true));
    private final Setting<Integer> indicatorColor = setting(Setting.color(ID, "indicatorColor", 0xFF5BE0C8,
            0xFF5BE0C8, 0xFF6EA8FF, 0xFFFFFFFF, 0xFFD7E2F0, 0xFFFFC857));

    private boolean sneakLatch;
    private boolean sprintForced;

    public ToggleSprintSneakAddon() {
        super(ID, AddonCategory.UTILITY, "1.2.0", true);
    }

    public boolean sneakLatched() {
        return this.sneakLatch;
    }

    public boolean sprintActive(MinecraftClient client) {
        return this.sprintForced && client.options.sprintKey.isPressed();
    }

    @Override
    public void tick(MinecraftClient client) {
        if (!enabled()) {
            release(client);
            return;
        }
        if (client.player == null) {
            release(client);
            return;
        }
        boolean flyingGuard = this.disableWhileFlying.getBoolean() && client.player.getAbilities().flying;
        tickSneak(client, flyingGuard);
        tickSprint(client, flyingGuard);
    }

    private void tickSneak(MinecraftClient client, boolean flyingGuard) {
        if (!this.sneakEnabled.getBoolean() || flyingGuard) {
            if (this.sneakLatch) {
                this.sneakLatch = false;
                client.options.sneakKey.setPressed(false);
            }
            return;
        }
        if (client.options.sneakKey.wasPressed()) {
            this.sneakLatch = !this.sneakLatch;
        }
        client.options.sneakKey.setPressed(this.sneakLatch);
    }

    private void tickSprint(MinecraftClient client, boolean flyingGuard) {
        boolean want = this.sprintEnabled.getBoolean() && !flyingGuard && !client.player.isSneaking();
        if (want && this.requireForward.getBoolean()) {
            want = client.options.forwardKey.isPressed();
        }
        if (want) {
            client.options.sprintKey.setPressed(true);
            this.sprintForced = true;
        } else if (this.sprintForced) {
            this.sprintForced = false;
            client.options.sprintKey.setPressed(false);
        }
    }

    private void release(MinecraftClient client) {
        if (this.sneakLatch) {
            this.sneakLatch = false;
            client.options.sneakKey.setPressed(false);
        }
        if (this.sprintForced) {
            this.sprintForced = false;
            client.options.sprintKey.setPressed(false);
        }
    }

    private List<String> lines(MinecraftClient client) {
        List<String> lines = new ArrayList<>();
        if (!this.showIndicators.getBoolean() || client.player == null) {
            return lines;
        }
        if (this.sneakLatch) {
            lines.add("Sneak ON");
        }
        if (sprintActive(client) && client.options.forwardKey.isPressed()) {
            lines.add("Sprint ON");
        }
        return lines;
    }

    // ------------------------------------------------------------------ HudElement

    @Override
    public String elementId() {
        return ID;
    }

    @Override
    public HudAnchor defaultAnchor() {
        return HudAnchor.BOTTOM_LEFT;
    }

    @Override
    public int defaultX() {
        return 3;
    }

    @Override
    public int defaultY() {
        return 80;
    }

    @Override
    public int measureWidth(MinecraftClient client) {
        int width = 1;
        for (String line : lines(client)) {
            width = Math.max(width, client.textRenderer.getWidth(line));
        }
        return width;
    }

    @Override
    public int measureHeight(MinecraftClient client) {
        return Math.max(1, lines(client).size() * 10);
    }

    @Override
    public void render(DrawContext context, MinecraftClient client, float opacity) {
        TextRenderer font = client.textRenderer;
        int y = 1;
        for (String line : lines(client)) {
            context.drawTextWithShadow(font, line, 0, y, KlymonTheme.withOpacity(this.indicatorColor.getInt(), opacity));
            y += 10;
        }
    }
}
