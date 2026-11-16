package com.klymon.clientmenu.addon;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.klymon.clientmenu.KlymonTheme;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudElement;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.item.ItemStack;

/**
 * Equipped armor with item icons, remaining durability and percentage, in a
 * horizontal or vertical layout.
 */
public final class ArmorStatusAddon extends Addon implements HudElement {
    public static final String ID = "armor-status";
    private static final int SLOT = 18;

    private final Setting<String> orientation = setting(Setting.enumeration(ID, "orientation", "vertical", "vertical", "horizontal"));
    private final Setting<Boolean> showIcons = setting(Setting.bool(ID, "showIcons", true));
    private final Setting<Boolean> showDurability = setting(Setting.bool(ID, "showDurability", true));
    private final Setting<Boolean> showPercent = setting(Setting.bool(ID, "showPercent", false));
    private final Setting<Boolean> showEmpty = setting(Setting.bool(ID, "showEmpty", false));

    public ArmorStatusAddon() {
        super(ID, AddonCategory.HUD, "1.2.0", true);
    }

    /** Armor head-first (inventory order is feet-first). */
    private List<ItemStack> pieces(MinecraftClient client) {
        List<ItemStack> pieces = new ArrayList<>();
        if (client.player == null) {
            return pieces;
        }
        List<ItemStack> armor = client.player.getInventory().armor;
        for (int slot = armor.size() - 1; slot >= 0; slot--) {
            ItemStack stack = armor.get(slot);
            if (!stack.isEmpty() || this.showEmpty.getBoolean()) {
                pieces.add(stack);
            }
        }
        return pieces;
    }

    private String labelFor(ItemStack stack) {
        if (stack.isEmpty()) {
            return "—";
        }
        int max = stack.getMaxDamage();
        if (max <= 0) {
            return stack.getCount() > 1 ? Integer.toString(stack.getCount()) : "";
        }
        int left = max - stack.getDamage();
        if (this.showDurability.getBoolean() && this.showPercent.getBoolean()) {
            return String.format(Locale.ROOT, "%d (%d%%)", left, Math.round(left * 100.0f / max));
        }
        if (this.showDurability.getBoolean()) {
            return Integer.toString(left);
        }
        if (this.showPercent.getBoolean()) {
            return Math.round(left * 100.0f / max) + "%";
        }
        return "";
    }

    private static int colorFor(ItemStack stack) {
        if (stack.isEmpty()) {
            return KlymonTheme.MUTED;
        }
        int max = stack.getMaxDamage();
        if (max <= 0) {
            return KlymonTheme.TEXT;
        }
        return KlymonTheme.colorForRatio((float) (max - stack.getDamage()) / (float) max);
    }

    private int textWidth(MinecraftClient client) {
        int width = 0;
        for (ItemStack stack : pieces(client)) {
            width = Math.max(width, client.textRenderer.getWidth(labelFor(stack)));
        }
        return width;
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
        return 3;
    }

    @Override
    public int measureWidth(MinecraftClient client) {
        List<ItemStack> pieces = pieces(client);
        if (pieces.isEmpty()) {
            return 1;
        }
        if (this.orientation.getEnum().equals("horizontal")) {
            int icons = this.showIcons.getBoolean() ? pieces.size() * SLOT : 0;
            int text = textWidth(client);
            return Math.max(1, icons + (text > 0 ? text * pieces.size() + pieces.size() * 3 : 0));
        }
        int icons = this.showIcons.getBoolean() ? SLOT : 0;
        return Math.max(1, icons + textWidth(client) + (textWidth(client) > 0 && this.showIcons.getBoolean() ? 2 : 0));
    }

    @Override
    public int measureHeight(MinecraftClient client) {
        List<ItemStack> pieces = pieces(client);
        if (pieces.isEmpty()) {
            return 1;
        }
        if (this.orientation.getEnum().equals("horizontal")) {
            return this.showIcons.getBoolean() ? SLOT + 9 : 10;
        }
        return pieces.size() * SLOT;
    }

    @Override
    public void render(DrawContext context, MinecraftClient client, float opacity) {
        TextRenderer font = client.textRenderer;
        List<ItemStack> pieces = pieces(client);
        boolean horizontal = this.orientation.getEnum().equals("horizontal");
        boolean icons = this.showIcons.getBoolean();
        int index = 0;
        for (ItemStack stack : pieces) {
            int x = horizontal ? index * (SLOT + Math.max(0, textWidth(client))) : 0;
            int y = horizontal ? 0 : index * SLOT;
            if (icons) {
                if (stack.isEmpty()) {
                    context.fill(x + 1, y + 1, x + 17, y + 17,
                            KlymonTheme.withOpacity(0x50101826, opacity));
                } else {
                    context.drawItem(stack, x + 1, y + 1);
                }
            }
            String label = labelFor(stack);
            if (!label.isEmpty()) {
                int color = KlymonTheme.withOpacity(colorFor(stack), opacity);
                if (horizontal && icons) {
                    context.drawTextWithShadow(font, label, x + 1, y + SLOT - 1, color);
                } else if (horizontal) {
                    context.drawTextWithShadow(font, label, x, y + 1, color);
                } else {
                    context.drawTextWithShadow(font, label, x + (icons ? SLOT + 2 : 0), y + 5, color);
                }
            }
            index++;
        }
    }
}
