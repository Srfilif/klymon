package com.klymon.clientmenu.addon;

import com.klymon.clientmenu.KlymonMenuClient;
import com.klymon.clientmenu.KlymonTheme;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudElement;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;

/** The "Klymon Client" watermark with an optional version suffix. */
public final class WatermarkAddon extends Addon implements HudElement {
    public static final String ID = "watermark";

    private final Setting<Boolean> showVersion = setting(Setting.bool(ID, "showVersion", true));
    private final Setting<String> colorMode = setting(Setting.enumeration(ID, "colorMode", "accent", "accent", "custom"));
    private final Setting<Integer> customColor = setting(Setting.color(ID, "customColor", 0xFFD7E2F0,
            0xFFD7E2F0, 0xFFFFFFFF, 0xFFFFC857));

    public WatermarkAddon() {
        super(ID, AddonCategory.HUD, "1.2.0", true);
    }

    private String text() {
        return this.showVersion.getBoolean()
                ? "Klymon Client " + KlymonMenuClient.modVersion()
                : "Klymon Client";
    }

    private int color() {
        return this.colorMode.getEnum().equals("custom") ? this.customColor.getInt() : KlymonTheme.accent();
    }

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
        return 23;
    }

    @Override
    public int measureWidth(MinecraftClient client) {
        return Math.max(1, client.textRenderer.getWidth(text()));
    }

    @Override
    public int measureHeight(MinecraftClient client) {
        return 10;
    }

    @Override
    public void render(DrawContext context, MinecraftClient client, float opacity) {
        TextRenderer font = client.textRenderer;
        context.drawTextWithShadow(font, text(), 0, 1, KlymonTheme.withOpacity(color(), opacity));
    }
}
