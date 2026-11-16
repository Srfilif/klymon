package com.klymon.clientmenu.addon;

import com.klymon.clientmenu.KlymonTheme;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudElement;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.util.Util;

/**
 * Directional flashes around the crosshair when dealing or taking damage, with
 * optional crit particles. Damage is read from hurt-time edges, never guessed.
 */
public final class HitIndicatorsAddon extends Addon implements HudElement, Tickable {
    public static final String ID = "hit-indicators";
    private static final int SIZE = 56;

    private final Setting<Boolean> showDealt = setting(Setting.bool(ID, "showDealt", true));
    private final Setting<Boolean> showTaken = setting(Setting.bool(ID, "showTaken", true));
    private final Setting<Integer> durationMs = setting(Setting.integer(ID, "durationMs", 600, 200, 2000, 50));
    private final Setting<String> style = setting(Setting.enumeration(ID, "style", "ring", "ring", "bars"));
    private final Setting<Integer> dealtColor = setting(Setting.color(ID, "dealtColor", 0xFFFFC857,
            0xFFFFC857, 0xFFFFFFFF, 0xFF5BE0C8, 0xFFFF6B6B));
    private final Setting<Integer> takenColor = setting(Setting.color(ID, "takenColor", 0xFFFF6B6B,
            0xFFFF6B6B, 0xFFFFC857, 0xFFFFFFFF));
    private final Setting<Boolean> particles = setting(Setting.bool(ID, "particles", false));
    private final Setting<Integer> intensity = setting(Setting.integer(ID, "intensity", 8, 2, 24, 1));

    private long lastDealtMs = -1L;
    private long lastTakenMs = -1L;
    private int lastPlayerHurt;
    private int lastTargetHurt;
    private Entity lastTarget;

    public HitIndicatorsAddon() {
        super(ID, AddonCategory.PVP, "1.2.0", true);
    }

    @Override
    public void tick(MinecraftClient client) {
        if (!enabled() || client.player == null || client.world == null) {
            this.lastPlayerHurt = 0;
            this.lastTargetHurt = 0;
            this.lastTarget = null;
            return;
        }
        long now = Util.getMeasuringTimeMs();
        int playerHurt = client.player.hurtTime;
        if (playerHurt > this.lastPlayerHurt && playerHurt >= client.player.maxHurtTime - 1) {
            this.lastTakenMs = now;
            if (this.particles.getBoolean()) {
                burst(client, client.player.getX(), client.player.getY() + 1.0, client.player.getZ(), true);
            }
        }
        this.lastPlayerHurt = playerHurt;

        Entity target = client.targetedEntity;
        if (target != this.lastTarget) {
            this.lastTarget = target;
            this.lastTargetHurt = target instanceof LivingEntity living ? living.hurtTime : 0;
        } else if (target instanceof LivingEntity living) {
            int hurt = living.hurtTime;
            if (hurt > this.lastTargetHurt && hurt >= living.maxHurtTime - 1) {
                this.lastDealtMs = now;
                if (this.particles.getBoolean()) {
                    burst(client, target.getX(), target.getY() + target.getHeight() / 2.0, target.getZ(), false);
                }
            }
            this.lastTargetHurt = hurt;
        }
    }

    private void burst(MinecraftClient client, double x, double y, double z, boolean taken) {
        int count = this.intensity.getInt();
        for (int i = 0; i < count; i++) {
            double angle = (Math.PI * 2.0 * i) / count;
            double speed = 0.25 + Math.random() * 0.35;
            client.world.addParticle(taken ? ParticleTypes.DAMAGE_INDICATOR : ParticleTypes.CRIT,
                    x, y, z, Math.cos(angle) * speed, 0.15 + Math.random() * 0.3, Math.sin(angle) * speed);
        }
    }

    private float strength(long eventMs, long now) {
        if (eventMs < 0) {
            return 0.0f;
        }
        long age = now - eventMs;
        if (age < 0 || age > this.durationMs.getInt()) {
            return 0.0f;
        }
        return 1.0f - (float) age / (float) this.durationMs.getInt();
    }

    // ------------------------------------------------------------------ HudElement

    @Override
    public String elementId() {
        return ID;
    }

    @Override
    public HudAnchor defaultAnchor() {
        return HudAnchor.CENTER;
    }

    @Override
    public int defaultX() {
        return 0;
    }

    @Override
    public int defaultY() {
        return 0;
    }

    @Override
    public int measureWidth(MinecraftClient client) {
        return SIZE;
    }

    @Override
    public int measureHeight(MinecraftClient client) {
        return SIZE;
    }

    @Override
    public void render(DrawContext context, MinecraftClient client, float opacity) {
        if (client.currentScreen != null && !(client.currentScreen instanceof com.klymon.clientmenu.KlymonHudEditorScreen)) {
            return;
        }
        long now = Util.getMeasuringTimeMs();
        float dealt = this.showDealt.getBoolean() ? strength(this.lastDealtMs, now) : 0.0f;
        float taken = this.showTaken.getBoolean() ? strength(this.lastTakenMs, now) : 0.0f;
        if (dealt <= 0.0f && taken <= 0.0f) {
            return;
        }
        boolean bars = this.style.getEnum().equals("bars");
        if (dealt > 0.0f) {
            draw(context, dealt * opacity, this.dealtColor.getInt(), true, bars);
        }
        if (taken > 0.0f) {
            draw(context, taken * opacity, this.takenColor.getInt(), false, bars);
        }
    }

    private static void draw(DrawContext context, float alpha, int color, boolean dealt, boolean bars) {
        int argb = KlymonTheme.withOpacity(color, Math.max(0.0f, Math.min(1.0f, alpha)));
        if (bars) {
            int center = SIZE / 2;
            int length = (int) (20.0f * alpha) + 4;
            if (dealt) {
                context.fill(center - 1, center - 10 - length, center + 1, center - 10, argb);
                context.fill(center - 1, center + 10, center + 1, center + 10 + length, argb);
            } else {
                context.fill(center - 10 - length, center - 1, center - 10, center + 1, argb);
                context.fill(center + 10, center - 1, center + 10 + length, center + 1, argb);
            }
            return;
        }
        int center = SIZE / 2;
        int radius = dealt ? 6 + Math.round(10.0f * (1.0f - alpha)) : 14 - Math.round(6.0f * (1.0f - alpha));
        int thickness = dealt ? 2 : 3;
        context.drawBorder(center - radius, center - radius, radius * 2, radius * 2, argb);
        if (thickness > 1) {
            context.drawBorder(center - radius + 1, center - radius + 1, radius * 2 - 2, radius * 2 - 2, argb);
        }
    }
}
