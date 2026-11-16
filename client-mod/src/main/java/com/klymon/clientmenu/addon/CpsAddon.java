package com.klymon.clientmenu.addon;

import com.klymon.clientmenu.KlymonTheme;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudElement;
import com.klymon.clientmenu.logic.CpsTracker;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.util.Util;

/**
 * Left/right clicks-per-second with a configurable measurement window and an
 * optional session maximum.
 */
public final class CpsAddon extends Addon implements HudElement, Tickable {
    public static final String ID = "cps-counter";

    private final Setting<Boolean> showLeft = setting(Setting.bool(ID, "showLeft", true));
    private final Setting<Boolean> showRight = setting(Setting.bool(ID, "showRight", true));
    private final Setting<Boolean> showMax = setting(Setting.bool(ID, "showMax", false));
    private final Setting<Boolean> showLabel = setting(Setting.bool(ID, "showLabel", true));
    private final Setting<Integer> windowMs = setting(Setting.integer(ID, "windowMs", 1000, 250, 2000, 250));
    private final Setting<Integer> maxResetSec = setting(Setting.integer(ID, "maxResetSec", 0, 0, 300, 10));
    private final Setting<Integer> textColor = setting(Setting.color(ID, "textColor", 0xFFD7E2F0,
            0xFFD7E2F0, 0xFFFFFFFF, 0xFF5BE0C8, 0xFFFFC857));
    private final Setting<Boolean> background = setting(Setting.bool(ID, "background", false));
    private final Setting<Integer> backgroundColor = setting(Setting.color(ID, "backgroundColor", 0x50101826,
            0x50101826, 0x50000000, 0x80000000));

    private final CpsTracker left = new CpsTracker();
    private final CpsTracker right = new CpsTracker();
    private boolean attackDown;
    private boolean useDown;
    private long maxWindowStart;

    public CpsAddon() {
        super(ID, AddonCategory.PVP, "1.2.0", true);
    }

    @Override
    public void tick(MinecraftClient client) {
        this.left.setWindowMs(this.windowMs.getInt());
        this.right.setWindowMs(this.windowMs.getInt());
        if (!enabled() || client.player == null) {
            this.attackDown = false;
            this.useDown = false;
            return;
        }
        long now = Util.getMeasuringTimeMs();
        boolean attack = client.options.attackKey.isPressed();
        if (attack && !this.attackDown) {
            this.left.record(now);
        }
        this.attackDown = attack;
        boolean use = client.options.useKey.isPressed();
        if (use && !this.useDown) {
            this.right.record(now);
        }
        this.useDown = use;
        int resetSec = this.maxResetSec.getInt();
        if (resetSec > 0) {
            if (this.maxWindowStart == 0) {
                this.maxWindowStart = now;
            } else if (now - this.maxWindowStart > resetSec * 1000L) {
                this.left.resetMax();
                this.right.resetMax();
                this.maxWindowStart = now;
            }
        } else {
            this.maxWindowStart = 0;
        }
    }

    private String text(long now) {
        StringBuilder line = new StringBuilder();
        if (this.showLabel.getBoolean()) {
            line.append("CPS ");
        }
        boolean joined = false;
        if (this.showLeft.getBoolean()) {
            line.append(this.left.count(now));
            if (this.showMax.getBoolean()) {
                line.append(" (").append(this.left.max()).append(')');
            }
            joined = true;
        }
        if (this.showRight.getBoolean()) {
            if (joined) {
                line.append(" | ");
            }
            line.append(this.right.count(now));
            if (this.showMax.getBoolean()) {
                line.append(" (").append(this.right.max()).append(')');
            }
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
        return HudAnchor.TOP_LEFT;
    }

    @Override
    public int defaultX() {
        return 3;
    }

    @Override
    public int defaultY() {
        return 13;
    }

    @Override
    public int measureWidth(MinecraftClient client) {
        return client.textRenderer.getWidth(text(Util.getMeasuringTimeMs())) + (this.background.getBoolean() ? 6 : 0);
    }

    @Override
    public int measureHeight(MinecraftClient client) {
        return 10;
    }

    @Override
    public void render(DrawContext context, MinecraftClient client, float opacity) {
        TextRenderer font = client.textRenderer;
        String line = text(Util.getMeasuringTimeMs());
        if (this.background.getBoolean()) {
            context.fill(0, 0, font.getWidth(line) + 6, 10,
                    KlymonTheme.withOpacity(this.backgroundColor.getInt(), opacity));
            context.drawTextWithShadow(font, line, 3, 1, KlymonTheme.withOpacity(this.textColor.getInt(), opacity));
        } else {
            context.drawTextWithShadow(font, line, 0, 1, KlymonTheme.withOpacity(this.textColor.getInt(), opacity));
        }
    }
}
