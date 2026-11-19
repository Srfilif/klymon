package com.klymon.clientmenu.addon;

import com.klymon.clientmenu.KlymonTheme;
import com.klymon.clientmenu.cosmetic.KlymonBridge;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudElement;
import com.klymon.clientmenu.logic.LevelCurve;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;

/** Klymon progression HUD: level, points balance and the level progress bar. */
public final class LevelAddon extends Addon implements HudElement {
    public static final String ID = "level-progress";

    private final Setting<Boolean> showPoints = setting(Setting.bool(ID, "showPoints", true));
    private final Setting<Boolean> showBar = setting(Setting.bool(ID, "showBar", true));

    public LevelAddon() {
        super(ID, AddonCategory.HUD, "1.3.0", true);
    }

    private String text() {
        KlymonBridge bridge = KlymonBridge.get();
        String shortLevel = Text.translatable("klymon.level.short").getString();
        return this.showPoints.getBoolean()
                ? shortLevel + " " + bridge.level() + " · " + bridge.balance() + " "
                        + Text.translatable("klymon.hud.pointsShort").getString()
                : Text.translatable("klymon.profile.level").getString() + " " + bridge.level();
    }

    @Override
    public String elementId() {
        return ID;
    }

    @Override
    public HudAnchor defaultAnchor() {
        return HudAnchor.TOP_RIGHT;
    }

    @Override
    public int defaultX() {
        return 3;
    }

    @Override
    public int defaultY() {
        return 23;
    }

    @Override
    public int measureWidth(MinecraftClient client) {
        return Math.max(1, client.textRenderer.getWidth(text()));
    }

    @Override
    public int measureHeight(MinecraftClient client) {
        return this.showBar.getBoolean() ? 15 : 10;
    }

    @Override
    public void render(DrawContext context, MinecraftClient client, float opacity) {
        TextRenderer font = client.textRenderer;
        KlymonBridge bridge = KlymonBridge.get();
        context.drawTextWithShadow(font, text(), 0, 1, KlymonTheme.withOpacity(KlymonTheme.accent(), opacity));
        if (this.showBar.getBoolean()) {
            int width = measureWidth(client);
            float fraction = LevelCurve.progressFraction(bridge.lifetimePoints());
            context.fill(0, 11, width, 13, KlymonTheme.withOpacity(0xFF000000, opacity * 0.7f));
            context.fill(0, 11, (int) (width * fraction), 13, KlymonTheme.withOpacity(KlymonTheme.accent(), opacity));
        }
    }
}
