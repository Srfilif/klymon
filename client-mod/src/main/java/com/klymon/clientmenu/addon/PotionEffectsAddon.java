package com.klymon.clientmenu.addon;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import com.klymon.clientmenu.KlymonTheme;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudElement;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.texture.Sprite;
import net.minecraft.entity.effect.StatusEffectInstance;

/**
 * Active potion effects with icons, level and remaining time. Effects listed
 * in {@code hidden} (comma-separated ids such as {@code speed,night_vision})
 * are skipped.
 */
public final class PotionEffectsAddon extends Addon implements HudElement {
    public static final String ID = "potion-effects";
    private static final int ROW = 20;

    private final Setting<Boolean> showDuration = setting(Setting.bool(ID, "showDuration", true));
    private final Setting<Boolean> showLevel = setting(Setting.bool(ID, "showLevel", true));
    private final Setting<Boolean> showIcons = setting(Setting.bool(ID, "showIcons", true));
    private final Setting<Integer> maxShown = setting(Setting.integer(ID, "maxShown", 4, 1, 8, 1));
    private final Setting<String> hidden = setting(Setting.text(ID, "hidden", ""));
    private final Setting<Integer> textColor = setting(Setting.color(ID, "textColor", 0xFFD7E2F0,
            0xFFD7E2F0, 0xFFFFFFFF, 0xFF8996AC));

    public PotionEffectsAddon() {
        super(ID, AddonCategory.HUD, "1.2.0", false);
    }

    private Set<String> hiddenIds() {
        Set<String> ids = new HashSet<>();
        for (String part : this.hidden.getString().split(",")) {
            String id = part.trim().toLowerCase(Locale.ROOT);
            if (id.startsWith("minecraft:")) {
                id = id.substring("minecraft:".length());
            }
            if (!id.isEmpty()) {
                ids.add(id);
            }
        }
        return ids;
    }

    static String effectId(StatusEffectInstance effect) {
        return effect.getEffectType().getKey()
                .map(key -> key.getValue().getPath().toLowerCase(Locale.ROOT))
                .orElseGet(() -> effect.getEffectType().value().getName().getString().toLowerCase(Locale.ROOT));
    }

    private List<StatusEffectInstance> visible(MinecraftClient client) {
        List<StatusEffectInstance> result = new ArrayList<>();
        if (client.player == null) {
            return result;
        }
        Set<String> skipped = hiddenIds();
        for (StatusEffectInstance effect : client.player.getStatusEffects()) {
            if (result.size() >= this.maxShown.getInt()) {
                break;
            }
            if (skipped.contains(effectId(effect))) {
                continue;
            }
            result.add(effect);
        }
        return result;
    }

    private String labelFor(StatusEffectInstance effect) {
        StringBuilder label = new StringBuilder(effect.getEffectType().value().getName().getString());
        if (this.showLevel.getBoolean() && effect.getAmplifier() > 0) {
            label.append(' ').append(roman(effect.getAmplifier() + 1));
        }
        if (this.showDuration.getBoolean()) {
            label.append(' ').append(formatDuration(effect.getDuration()));
        }
        return label.toString();
    }

    static String formatDuration(int ticks) {
        if (ticks < 0) {
            return "**:**";
        }
        int seconds = ticks / 20;
        return String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60);
    }

    static String roman(int value) {
        return switch (value) {
            case 1 -> "I";
            case 2 -> "II";
            case 3 -> "III";
            case 4 -> "IV";
            case 5 -> "V";
            case 6 -> "VI";
            case 7 -> "VII";
            case 8 -> "VIII";
            case 9 -> "IX";
            case 10 -> "X";
            default -> Integer.toString(value);
        };
    }

    // ------------------------------------------------------------------ HudElement

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
        return 3;
    }

    @Override
    public int measureWidth(MinecraftClient client) {
        int width = 1;
        for (StatusEffectInstance effect : visible(client)) {
            int row = client.textRenderer.getWidth(labelFor(effect)) + (this.showIcons.getBoolean() ? ROW + 2 : 0);
            width = Math.max(width, row);
        }
        return width;
    }

    @Override
    public int measureHeight(MinecraftClient client) {
        int rows = visible(client).size();
        return Math.max(1, rows * ROW);
    }

    @Override
    public void render(DrawContext context, MinecraftClient client, float opacity) {
        TextRenderer font = client.textRenderer;
        boolean icons = this.showIcons.getBoolean();
        int y = 0;
        for (StatusEffectInstance effect : visible(client)) {
            if (icons) {
                try {
                    Sprite sprite = client.getStatusEffectSpriteManager().getSprite(effect.getEffectType());
                    context.drawSprite(0, y + 1, 0, 18, 18, sprite, 1.0f, 1.0f, 1.0f, opacity);
                } catch (RuntimeException ignored) {
                    int fallback = effect.getEffectType().value().getColor();
                    context.fill(0, y + 1, 18, y + 19, KlymonTheme.withOpacity(0xFF000000 | fallback, opacity));
                }
            }
            context.drawTextWithShadow(font, labelFor(effect), icons ? ROW + 2 : 0, y + 6,
                    KlymonTheme.withOpacity(this.textColor.getInt(), opacity));
            y += ROW;
        }
    }
}
