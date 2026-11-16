package com.klymon.clientmenu;

import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;

/** Colours and small drawing helpers shared by every Klymon screen. */
public final class KlymonTheme {
    public static final int PANEL = 0xE00B1220;
    public static final int PANEL_SOFT = 0xA8121C2C;
    public static final int TEXT = 0xFFD7E2F0;
    public static final int MUTED = 0xFF8996AC;
    public static final int SUCCESS = 0xFF6BE38A;
    public static final int WARNING = 0xFFFFC857;
    public static final int DANGER = 0xFFFF6B6B;

    private KlymonTheme() {
    }

    public static int accent() {
        return KlymonConfig.get().accent.color();
    }

    public static int alpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (alpha << 24);
    }

    /** Multiplies the color's own alpha channel by {@code opacity} (0..1). */
    public static int withOpacity(int color, float opacity) {
        float clamped = Math.max(0.0f, Math.min(1.0f, opacity));
        int base = (color >>> 24) & 0xFF;
        return (color & 0x00FFFFFF) | (Math.round(base * clamped) << 24);
    }

    /** Card with an accent stripe on the left edge. */
    public static void panel(DrawContext context, int x, int y, int width, int height) {
        context.fill(x, y, x + width, y + height, PANEL);
        context.drawBorder(x, y, width, height, alpha(accent(), 0x70));
        context.fill(x, y, x + 2, y + height, accent());
    }

    /** Slim row used for the addon list and info lines. */
    public static void row(DrawContext context, int x, int y, int width, int height, boolean highlighted) {
        context.fill(x, y, x + width, y + height, highlighted ? alpha(accent(), 0x28) : PANEL_SOFT);
    }

    public static void header(DrawContext context, TextRenderer font, Text title, Text subtitle, int centerX, int y) {
        context.drawCenteredTextWithShadow(font, title, centerX, y, accent());
        if (subtitle != null) {
            context.drawCenteredTextWithShadow(font, subtitle, centerX, y + 13, MUTED);
        }
    }

    public static void footer(DrawContext context, TextRenderer font, Text text, int centerX, int y) {
        context.drawCenteredTextWithShadow(font, text, centerX, y, MUTED);
    }

    public static int colorForRatio(float ratio) {
        if (ratio < 0.2f) {
            return DANGER;
        }
        if (ratio < 0.5f) {
            return WARNING;
        }
        return TEXT;
    }

    /** Draws a left-aligned label with its value right-aligned in the same row. */
    public static void labeledValue(DrawContext context, TextRenderer font, String label, String value, int x, int y, int width) {
        context.drawTextWithShadow(font, label, x, y, MUTED);
        context.drawTextWithShadow(font, value, x + width - font.getWidth(value), y, TEXT);
    }
}
