package com.klymon.clientmenu.addon;

import java.util.ArrayList;
import java.util.List;

import com.klymon.clientmenu.KlymonTheme;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudElement;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.util.Util;

/**
 * On-screen WASD + Space + mouse buttons with press animations. Every key can
 * be hidden individually; colors, key size and animation are configurable.
 */
public final class KeystrokesAddon extends Addon implements HudElement, Tickable {
    public static final String ID = "keystrokes";
    private static final long ANIMATION_MS = 140L;
    private static final int GAP = 2;

    private final Setting<Boolean> showW = setting(Setting.bool(ID, "showW", true));
    private final Setting<Boolean> showA = setting(Setting.bool(ID, "showA", true));
    private final Setting<Boolean> showS = setting(Setting.bool(ID, "showS", true));
    private final Setting<Boolean> showD = setting(Setting.bool(ID, "showD", true));
    private final Setting<Boolean> showSpace = setting(Setting.bool(ID, "showSpace", true));
    private final Setting<Boolean> showMouse = setting(Setting.bool(ID, "showMouse", true));
    private final Setting<Integer> keySize = setting(Setting.integer(ID, "keySize", 16, 12, 26, 1));
    private final Setting<Integer> background = setting(Setting.color(ID, "background", 0x50101826,
            0x50101826, 0x50000000, 0x80000000, 0x00000000));
    private final Setting<Integer> border = setting(Setting.color(ID, "border", 0x808996AC,
            0x808996AC, 0x80FFFFFF, 0xFF5BE0C8, 0xFF6EA8FF));
    private final Setting<Integer> pressedFill = setting(Setting.color(ID, "pressedFill", 0x705BE0C8,
            0x705BE0C8, 0x706EA8FF, 0x70FFFFFF, 0x70FFC857));
    private final Setting<Integer> pressedBorder = setting(Setting.color(ID, "pressedBorder", 0xFF5BE0C8,
            0xFF5BE0C8, 0xFF6EA8FF, 0xFFFFFFFF, 0xFFFFC857));
    private final Setting<Integer> textColor = setting(Setting.color(ID, "textColor", 0xFFD7E2F0,
            0xFFD7E2F0, 0xFFFFFFFF, 0xFF8996AC));
    private final Setting<Boolean> animation = setting(Setting.bool(ID, "animation", true));

    private final long[] pressedAt = new long[7];
    private final boolean[] wasDown = new boolean[7];

    public KeystrokesAddon() {
        super(ID, AddonCategory.PVP, "1.2.0", true);
    }

    // ------------------------------------------------------------------ state

    private boolean[] currentDown(MinecraftClient client) {
        return new boolean[]{
                client.options.forwardKey.isPressed(),
                client.options.leftKey.isPressed(),
                client.options.backKey.isPressed(),
                client.options.rightKey.isPressed(),
                client.options.jumpKey.isPressed(),
                client.options.attackKey.isPressed(),
                client.options.useKey.isPressed()};
    }

    @Override
    public void tick(MinecraftClient client) {
        if (!enabled() || client.player == null) {
            return;
        }
        boolean[] down = currentDown(client);
        long now = Util.getMeasuringTimeMs();
        for (int i = 0; i < down.length; i++) {
            if (down[i] && !this.wasDown[i]) {
                this.pressedAt[i] = now;
            }
            this.wasDown[i] = down[i];
        }
    }

    // ------------------------------------------------------------------ layout

    private record Cell(int key, int x, int y, int width, String label) {
    }

    private List<Cell> cells() {
        int size = this.keySize.getInt();
        int fullWidth = size * 3 + GAP * 2;
        List<Cell> cells = new ArrayList<>();
        int y = 0;
        if (this.showW.getBoolean()) {
            cells.add(new Cell(0, size + GAP, y, size, "W"));
            y += size + GAP;
        }
        if (this.showA.getBoolean() || this.showS.getBoolean() || this.showD.getBoolean()) {
            if (this.showA.getBoolean()) {
                cells.add(new Cell(1, 0, y, size, "A"));
            }
            if (this.showS.getBoolean()) {
                cells.add(new Cell(2, size + GAP, y, size, "S"));
            }
            if (this.showD.getBoolean()) {
                cells.add(new Cell(3, (size + GAP) * 2, y, size, "D"));
            }
            y += size + GAP;
        }
        if (this.showSpace.getBoolean()) {
            cells.add(new Cell(4, 0, y, fullWidth, "SPACE"));
            y += size + GAP;
        }
        if (this.showMouse.getBoolean()) {
            int half = (fullWidth - GAP) / 2;
            cells.add(new Cell(5, 0, y, half, "LMB"));
            cells.add(new Cell(6, half + GAP, y, fullWidth - half - GAP, "RMB"));
            y += size + GAP;
        }
        this.cachedHeight = cells.isEmpty() ? 0 : y - GAP;
        return cells;
    }

    private int cachedHeight;

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
        return 4;
    }

    @Override
    public int measureWidth(MinecraftClient client) {
        int size = this.keySize.getInt();
        return size * 3 + GAP * 2;
    }

    @Override
    public int measureHeight(MinecraftClient client) {
        cells();
        return Math.max(1, this.cachedHeight);
    }

    @Override
    public void render(DrawContext context, MinecraftClient client, float opacity) {
        boolean[] down = currentDown(client);
        long now = Util.getMeasuringTimeMs();
        TextRenderer font = client.textRenderer;
        for (Cell cell : cells()) {
            boolean pressed = down[cell.key()];
            float pop = 0.0f;
            if (this.animation.getBoolean() && this.pressedAt[cell.key()] > 0) {
                long age = now - this.pressedAt[cell.key()];
                if (age < ANIMATION_MS) {
                    pop = 1.0f - (float) age / (float) ANIMATION_MS;
                }
            }
            int size = this.keySize.getInt();
            int grow = Math.round(pop * 2.0f);
            int x = cell.x() - grow;
            int y = cell.y() - grow;
            int width = cell.width() + grow * 2;
            int height = size + grow * 2;
            int fill = KlymonTheme.withOpacity(pressed ? this.pressedFill.getInt() : this.background.getInt(), opacity);
            int edge = KlymonTheme.withOpacity(pressed ? this.pressedBorder.getInt() : this.border.getInt(), opacity);
            context.fill(x, y, x + width, y + height, fill);
            context.drawBorder(x, y, width, height, edge);
            int color = KlymonTheme.withOpacity(pressed ? 0xFFFFFFFF : this.textColor.getInt(), opacity);
            String label = cell.label();
            int textX = x + (width - font.getWidth(label)) / 2;
            context.drawTextWithShadow(font, label, textX, y + (height - 8) / 2, color);
        }
    }
}
