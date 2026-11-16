package com.klymon.clientmenu.addon;

import java.util.Locale;

import com.klymon.clientmenu.KlymonTheme;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudElement;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;

/** Player coordinates with optional axis labels and facing direction. */
public final class CoordinatesAddon extends Addon implements HudElement {
    public static final String ID = "coordinates";

    private final Setting<Boolean> showLabels = setting(Setting.bool(ID, "showLabels", true));
    private final Setting<Boolean> showFacing = setting(Setting.bool(ID, "showFacing", false));
    private final Setting<Integer> textColor = setting(Setting.color(ID, "textColor", 0xFFD7E2F0,
            0xFFD7E2F0, 0xFFFFFFFF, 0xFF5BE0C8));

    public CoordinatesAddon() {
        super(ID, AddonCategory.HUD, "1.2.0", false);
    }

    private String text(MinecraftClient client) {
        if (client.player == null) {
            return "";
        }
        long x = Math.round(client.player.getX());
        long y = Math.round(client.player.getY());
        long z = Math.round(client.player.getZ());
        StringBuilder line = new StringBuilder();
        if (this.showLabels.getBoolean()) {
            line.append(String.format(Locale.ROOT, "XYZ %d %d %d", x, y, z));
        } else {
            line.append(String.format(Locale.ROOT, "%d %d %d", x, y, z));
        }
        if (this.showFacing.getBoolean()) {
            line.append(' ').append(facing(client.player.getYaw()));
        }
        return line.toString();
    }

    static String facing(float yaw) {
        float normalized = ((yaw % 360.0f) + 360.0f) % 360.0f;
        if (normalized < 45.0f || normalized >= 315.0f) {
            return "S";
        }
        if (normalized < 135.0f) {
            return "W";
        }
        if (normalized < 225.0f) {
            return "N";
        }
        return "E";
    }

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
        return 14;
    }

    @Override
    public int measureWidth(MinecraftClient client) {
        return Math.max(1, client.textRenderer.getWidth(text(client)));
    }

    @Override
    public int measureHeight(MinecraftClient client) {
        return 10;
    }

    @Override
    public void render(DrawContext context, MinecraftClient client, float opacity) {
        TextRenderer font = client.textRenderer;
        context.drawTextWithShadow(font, text(client), 0, 1, KlymonTheme.withOpacity(this.textColor.getInt(), opacity));
    }
}
