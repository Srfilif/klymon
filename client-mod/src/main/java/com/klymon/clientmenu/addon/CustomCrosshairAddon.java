package com.klymon.clientmenu.addon;

import com.klymon.clientmenu.KlymonHudEditorScreen;
import com.klymon.clientmenu.KlymonTheme;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudElement;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;

/**
 * Custom crosshair drawn at the screen center. Shapes, size, gap, thickness,
 * colors and outline are configurable, with a live preview in its settings
 * screen that runs this same draw code.
 *
 * <p>The element is locked to the center by default: a crosshair anywhere else
 * would not match the aim point. Vanilla's own crosshair cannot be suppressed
 * without mixins, so this addon draws on top of it; the presets are designed
 * to read well overlaid.</p>
 */
public final class CustomCrosshairAddon extends Addon implements HudElement {
    public static final String ID = "custom-crosshair";

    private final Setting<String> preset = setting(Setting.enumeration(ID, "preset", "cross", "cross", "plus", "dot", "ring", "custom"));
    private final Setting<Integer> size = setting(Setting.integer(ID, "size", 6, 2, 24, 1));
    private final Setting<Integer> gap = setting(Setting.integer(ID, "gap", 3, 0, 10, 1));
    private final Setting<Integer> thickness = setting(Setting.integer(ID, "thickness", 2, 1, 4, 1));
    private final Setting<Boolean> dot = setting(Setting.bool(ID, "dot", true));
    private final Setting<Integer> color = setting(Setting.color(ID, "color", 0xFFFFFFFF,
            0xFFFFFFFF, 0xFF5BE0C8, 0xFF6EA8FF, 0xFFFFC857, 0xFFFF6B6B, 0xFF000000));
    private final Setting<Boolean> outline = setting(Setting.bool(ID, "outline", true));
    private final Setting<Integer> outlineColor = setting(Setting.color(ID, "outlineColor", 0x90000000,
            0x90000000, 0xFF000000, 0xFFFFFFFF));

    private String appliedPreset = "cross";

    public CustomCrosshairAddon() {
        super(ID, AddonCategory.VISUAL, "1.2.0", false);
    }

    /** Applies a preset bundle the first time it is selected. */
    @Override
    public void validate() {
        super.validate();
        String selected = this.preset.getEnum();
        if (!selected.equals(this.appliedPreset) && !selected.equals("custom")) {
            applyPreset(selected);
            this.appliedPreset = selected;
        } else if (selected.equals("custom")) {
            this.appliedPreset = selected;
        }
    }

    private void applyPreset(String name) {
        switch (name) {
            case "plus" -> {
                this.size.setInt(7);
                this.gap.setInt(0);
                this.thickness.setInt(2);
                this.dot.setBoolean(false);
            }
            case "dot" -> {
                this.size.setInt(2);
                this.gap.setInt(0);
                this.thickness.setInt(2);
                this.dot.setBoolean(true);
            }
            case "ring" -> {
                this.size.setInt(6);
                this.gap.setInt(4);
                this.thickness.setInt(1);
                this.dot.setBoolean(false);
            }
            default -> { // "cross"
                this.size.setInt(6);
                this.gap.setInt(3);
                this.thickness.setInt(2);
                this.dot.setBoolean(true);
            }
        }
    }

    private boolean ring() {
        return this.preset.getEnum().equals("ring");
    }

    private int extent() {
        if (ring()) {
            return this.size.getInt() + 2;
        }
        if (this.preset.getEnum().equals("dot") && !this.dot.getBoolean()) {
            return this.thickness.getInt();
        }
        return this.gap.getInt() + this.size.getInt() + 2;
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
    public boolean defaultLocked() {
        return true;
    }

    @Override
    public int measureWidth(MinecraftClient client) {
        return extent() * 2 + 1;
    }

    @Override
    public int measureHeight(MinecraftClient client) {
        return extent() * 2 + 1;
    }

    @Override
    public void render(DrawContext context, MinecraftClient client, float opacity) {
        if (client.player == null || client.player.isSpectator()) {
            return;
        }
        if (client.getDebugHud().shouldShowDebugHud()) {
            return;
        }
        if (client.currentScreen != null && !(client.currentScreen instanceof KlymonHudEditorScreen)
                && !(client.currentScreen instanceof com.klymon.clientmenu.KlymonAddonConfigScreen)) {
            return;
        }
        int center = extent();
        draw(context, center, center, opacity);
    }

    /** Draws the crosshair centered on {@code (cx, cy)} in local coordinates. */
    public void draw(DrawContext context, int cx, int cy, float opacity) {
        int size = this.size.getInt();
        int gap = this.gap.getInt();
        int thickness = this.thickness.getInt();
        int argb = KlymonTheme.withOpacity(this.color.getInt(), opacity);
        int edge = KlymonTheme.withOpacity(this.outlineColor.getInt(), opacity);
        boolean outlined = this.outline.getBoolean();

        if (ring()) {
            int radius = size;
            if (outlined) {
                context.drawBorder(cx - radius - 1, cy - radius - 1, radius * 2 + 3, radius * 2 + 3, edge);
            }
            context.drawBorder(cx - radius, cy - radius, radius * 2 + 1, radius * 2 + 1, argb);
            if (this.dot.getBoolean()) {
                dot(context, cx, cy, 2, argb, edge, outlined);
            }
            return;
        }
        if (!(this.preset.getEnum().equals("dot") && size <= 2 && gap == 0)) {
            int origin = -thickness / 2;
            // Four lines: up, down, left, right.
            line(context, cx + origin, cy - gap - size, thickness, size, argb, edge, outlined);
            line(context, cx + origin, cy + gap + 1, thickness, size, argb, edge, outlined);
            line(context, cx - gap - size, cy + origin, size, thickness, argb, edge, outlined);
            line(context, cx + gap + 1, cy + origin, size, thickness, argb, edge, outlined);
        }
        if (this.dot.getBoolean()) {
            dot(context, cx, cy, thickness, argb, edge, outlined);
        }
    }

    private static void line(DrawContext context, int x, int y, int width, int height,
                             int color, int edge, boolean outlined) {
        if (outlined) {
            context.fill(x - 1, y - 1, x + width + 1, y + height + 1, edge);
        }
        context.fill(x, y, x + width, y + height, color);
    }

    private static void dot(DrawContext context, int cx, int cy, int side,
                            int color, int edge, boolean outlined) {
        line(context, cx - side / 2, cy - side / 2, side, side, color, edge, outlined);
    }
}
