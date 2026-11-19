package com.klymon.clientmenu.addon;

import com.klymon.clientmenu.KlymonTheme;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudElement;
import com.klymon.clientmenu.logic.ComboTracker;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.Util;
import net.minecraft.util.hit.HitResult;

/**
 * Consecutive hits landed on entities. Taking damage breaks the combo; any gap
 * longer than {@code resetMs} expires it.
 */
public final class ComboCounterAddon extends Addon implements HudElement, Tickable {
    public static final String ID = "combo-counter";

    private final Setting<Integer> resetMs = setting(Setting.integer(ID, "resetMs", 2000, 500, 5000, 100));
    private final Setting<Boolean> showBest = setting(Setting.bool(ID, "showBest", true));
    private final Setting<Boolean> showLabel = setting(Setting.bool(ID, "showLabel", true));
    private final Setting<Boolean> animation = setting(Setting.bool(ID, "animation", true));
    private final Setting<Integer> textColor = setting(Setting.color(ID, "textColor", 0xFFD7E2F0,
            0xFFD7E2F0, 0xFFFFFFFF, 0xFF5BE0C8, 0xFFFFC857));

    private final ComboTracker tracker = new ComboTracker();
    private boolean attackDown;
    private long lastHitRenderMs;

    public ComboCounterAddon() {
        super(ID, AddonCategory.PVP, "1.2.0", false);
    }

    @Override
    public void tick(MinecraftClient client) {
        if (!enabled() || client.player == null) {
            this.attackDown = false;
            return;
        }
        long now = Util.getMeasuringTimeMs();
        boolean attack = client.options.attackKey.isPressed();
        if (attack && !this.attackDown) {
            HitResult target = client.crosshairTarget;
            if (target != null && target.getType() == HitResult.Type.ENTITY) {
                this.tracker.recordHit(now);
                this.lastHitRenderMs = now;
            }
        }
        this.attackDown = attack;
        this.tracker.noteHurtTime(client.player.hurtTime);
        this.tracker.combo(now, this.resetMs.getInt());
    }

    private String text(long now) {
        int combo = this.tracker.combo(now, this.resetMs.getInt());
        StringBuilder line = new StringBuilder();
        if (this.showLabel.getBoolean()) {
            line.append("Combo ");
        }
        line.append(combo);
        if (this.showBest.getBoolean()) {
            line.append("  Best ").append(this.tracker.best());
        }
        return line.toString();
    }

    // ------------------------------------------------------------------ HudElement

    @Override
    public String elementId() {
        return ID;
    }

    @Override
    public HudAnchor defaultAnchor() {
        return HudAnchor.BOTTOM_RIGHT;
    }

    @Override
    public int defaultX() {
        return 4;
    }

    @Override
    public int defaultY() {
        return 70;
    }

    @Override
    public int measureWidth(MinecraftClient client) {
        return Math.max(1, client.textRenderer.getWidth(text(Util.getMeasuringTimeMs())));
    }

    @Override
    public int measureHeight(MinecraftClient client) {
        return 12;
    }

    @Override
    public void render(DrawContext context, MinecraftClient client, float opacity) {
        long now = Util.getMeasuringTimeMs();
        TextRenderer font = client.textRenderer;
        String line = text(now);
        float scale = 1.0f;
        if (this.animation.getBoolean()) {
            long age = now - this.lastHitRenderMs;
            if (age >= 0 && age < 150L) {
                scale = 1.0f + 0.35f * (1.0f - (float) age / 150.0f);
            }
        }
        MatrixStack matrices = context.getMatrices();
        matrices.push();
        matrices.scale(scale, scale, 1.0f);
        try {
            context.drawTextWithShadow(font, line, 0, 1, KlymonTheme.withOpacity(this.textColor.getInt(), opacity));
        } finally {
            matrices.pop();
        }
    }
}
