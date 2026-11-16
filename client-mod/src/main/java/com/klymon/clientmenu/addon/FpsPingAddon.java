package com.klymon.clientmenu.addon;

import java.util.ArrayList;
import java.util.List;

import com.klymon.clientmenu.KlymonTheme;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudElement;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.ClientPlayNetworkHandler;
import net.minecraft.client.network.PlayerListEntry;

/**
 * FPS and server ping with dynamic performance colors and single/multi-line layouts.
 */
public final class FpsPingAddon extends Addon implements HudElement {
    public static final String ID = "fps-ping";

    private final Setting<Boolean> showFps = setting(Setting.bool(ID, "showFps", true));
    private final Setting<Boolean> showPing = setting(Setting.bool(ID, "showPing", true));
    private final Setting<Boolean> dynamicColors = setting(Setting.bool(ID, "dynamicColors", true));
    private final Setting<String> layout = setting(Setting.enumeration(ID, "layout", "single", "single", "multi"));
    private final Setting<Integer> textColor = setting(Setting.color(ID, "textColor", 0xFFD7E2F0,
            0xFFD7E2F0, 0xFFFFFFFF, 0xFF5BE0C8));

    public FpsPingAddon() {
        super(ID, AddonCategory.HUD, "1.2.0", true);
    }

    private record Entry(String text, int color) {
    }

    private List<Entry> entries(MinecraftClient client) {
        List<Entry> entries = new ArrayList<>();
        int base = this.textColor.getInt();
        if (this.showFps.getBoolean()) {
            int fps = client.getCurrentFps();
            entries.add(new Entry("FPS " + fps, this.dynamicColors.getBoolean() ? fpsColor(fps) : base));
        }
        if (this.showPing.getBoolean()) {
            Integer latency = latency(client);
            if (latency != null) {
                entries.add(new Entry("Ping " + latency + " ms",
                        this.dynamicColors.getBoolean() ? pingColor(latency) : base));
            }
        }
        return entries;
    }

    private static Integer latency(MinecraftClient client) {
        if (client.player == null) {
            return null;
        }
        ClientPlayNetworkHandler handler = client.getNetworkHandler();
        if (handler == null) {
            return null;
        }
        PlayerListEntry entry = handler.getPlayerListEntry(client.player.getUuid());
        return entry == null ? null : entry.getLatency();
    }

    static int fpsColor(int fps) {
        if (fps >= 100) {
            return KlymonTheme.SUCCESS;
        }
        if (fps >= 50) {
            return KlymonTheme.TEXT;
        }
        if (fps >= 30) {
            return KlymonTheme.WARNING;
        }
        return KlymonTheme.DANGER;
    }

    static int pingColor(int latency) {
        if (latency < 80) {
            return KlymonTheme.SUCCESS;
        }
        if (latency < 180) {
            return KlymonTheme.WARNING;
        }
        return KlymonTheme.DANGER;
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
        return 3;
    }

    @Override
    public int measureWidth(MinecraftClient client) {
        TextRenderer font = client.textRenderer;
        List<Entry> entries = entries(client);
        if (entries.isEmpty()) {
            return 1;
        }
        if (this.layout.getEnum().equals("multi")) {
            int width = 1;
            for (Entry entry : entries) {
                width = Math.max(width, font.getWidth(entry.text()));
            }
            return width;
        }
        int width = 0;
        for (int i = 0; i < entries.size(); i++) {
            width += font.getWidth(entries.get(i).text());
            if (i < entries.size() - 1) {
                width += font.getWidth(" · ");
            }
        }
        return Math.max(1, width);
    }

    @Override
    public int measureHeight(MinecraftClient client) {
        int lines = entries(client).size();
        if (lines == 0) {
            return 1;
        }
        return this.layout.getEnum().equals("multi") ? lines * 10 : 10;
    }

    @Override
    public void render(DrawContext context, MinecraftClient client, float opacity) {
        TextRenderer font = client.textRenderer;
        List<Entry> entries = entries(client);
        if (this.layout.getEnum().equals("multi")) {
            int y = 1;
            for (Entry entry : entries) {
                context.drawTextWithShadow(font, entry.text(), 0, y, KlymonTheme.withOpacity(entry.color(), opacity));
                y += 10;
            }
            return;
        }
        int x = 0;
        for (int i = 0; i < entries.size(); i++) {
            Entry entry = entries.get(i);
            context.drawTextWithShadow(font, entry.text(), x, 1, KlymonTheme.withOpacity(entry.color(), opacity));
            x += font.getWidth(entry.text());
            if (i < entries.size() - 1) {
                String separator = " · ";
                context.drawTextWithShadow(font, separator, x, 1, KlymonTheme.withOpacity(KlymonTheme.MUTED, opacity));
                x += font.getWidth(separator);
            }
        }
    }
}
