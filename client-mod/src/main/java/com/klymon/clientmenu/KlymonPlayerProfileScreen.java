package com.klymon.clientmenu;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.klymon.clientmenu.cosmetic.KlymonBridge;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

/**
 * In-game Klymon profile: identity (prefix, title), level, points, playtime
 * and the equipped cosmetics, all read from the launcher bridge. Read-only —
 * points are earned by playing and cosmetics are managed in the launcher.
 */
public final class KlymonPlayerProfileScreen extends Screen {
    private static final int PANEL_WIDTH = 360;
    private static final int ROW_HEIGHT = 13;

    private final Screen parent;

    public KlymonPlayerProfileScreen(Screen parent) {
        super(Text.translatable("klymon.profile.title"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        KlymonBridge.invalidate();
        int panelX = (this.width - PANEL_WIDTH) / 2;
        int panelY = (this.height - panelHeight()) / 2;
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.menu.back"),
                        button -> this.close())
                .dimensions(panelX + 22, panelY + panelHeight() - 32, PANEL_WIDTH - 44, 20)
                .build());
    }

    private int panelHeight() {
        return 66 + rows().size() * ROW_HEIGHT + 44;
    }

    private List<String[]> rows() {
        KlymonBridge bridge = KlymonBridge.get();
        String session = this.client != null ? this.client.getSession().getUsername() : "?";
        List<String[]> rows = new ArrayList<>();
        rows.add(new String[] {Text.translatable("klymon.profile.player").getString(), bridge.displayName(session)});
        rows.add(new String[] {Text.translatable("klymon.profile.rank").getString(), bridge.rankPrefix()});
        if (bridge.title() != null) {
            rows.add(new String[] {Text.translatable("klymon.profile.playerTitle").getString(), bridge.title()});
        }
        rows.add(new String[] {Text.translatable("klymon.profile.level").getString(), String.valueOf(bridge.level())});
        rows.add(new String[] {Text.translatable("klymon.profile.points").getString(),
                bridge.balance() + " (" + bridge.lifetimePoints() + ")"});
        rows.add(new String[] {Text.translatable("klymon.profile.playtime").getString(), formatDuration(bridge.playSeconds())});
        rows.add(new String[] {Text.translatable("klymon.profile.sessions").getString(), String.valueOf(bridge.sessions())});
        if (bridge.loadout().isEmpty()) {
            rows.add(new String[] {Text.translatable("klymon.profile.cosmetics").getString(), "—"});
        } else {
            for (KlymonBridge.Equipped equipped : bridge.loadout().values()) {
                rows.add(new String[] {"  " + equipped.slot(), equipped.id()});
            }
        }
        return rows;
    }

    private static String formatDuration(long seconds) {
        long hours = seconds / 3600L;
        long minutes = (seconds % 3600L) / 60L;
        if (hours > 0) {
            return String.format(Locale.ROOT, "%dh %02dm", hours, minutes);
        }
        return String.format(Locale.ROOT, "%dm", minutes);
    }

    /** Drawn as part of the single background pass so {@code super.render} cannot blur it away. */
    @Override
    public void renderBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        super.renderBackground(context, mouseX, mouseY, delta);

        int panelX = (this.width - PANEL_WIDTH) / 2;
        int panelY = (this.height - panelHeight()) / 2;
        KlymonTheme.panel(context, panelX, panelY, PANEL_WIDTH, panelHeight());
        KlymonTheme.header(context, this.textRenderer, this.title,
                Text.translatable("klymon.profile.subtitle"), this.width / 2, panelY + 16);
        context.fill(panelX + 22, panelY + 46, panelX + PANEL_WIDTH - 22, panelY + 47,
                KlymonTheme.alpha(KlymonTheme.accent(), 0x50));

        int y = panelY + 54;
        for (String[] row : rows()) {
            KlymonTheme.labeledValue(context, this.textRenderer, row[0], row[1],
                    panelX + 22, y, PANEL_WIDTH - 44);
            y += ROW_HEIGHT;
        }
        KlymonTheme.footer(context, this.textRenderer,
                Text.translatable(bridgeFootnoteKey()), this.width / 2, panelY + panelHeight() - 44);
    }

    private static String bridgeFootnoteKey() {
        return KlymonBridge.get().fresh() ? "klymon.profile.synced" : "klymon.profile.local";
    }

    @Override
    public void close() {
        this.client.setScreen(this.parent);
    }
}
