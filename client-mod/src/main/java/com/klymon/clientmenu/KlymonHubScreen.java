package com.klymon.clientmenu;

import com.klymon.clientmenu.cosmetic.KlymonBridge;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

/**
 * In-game Klymon menu, opened with Right Shift: the same entry points as the
 * title screen, without leaving the world.
 */
public final class KlymonHubScreen extends Screen {
    private static final int PANEL_WIDTH = 340;
    private static final int PANEL_HEIGHT = 254;

    public KlymonHubScreen() {
        super(Text.translatable("klymon.hub.title"));
    }

    @Override
    protected void init() {
        int x = (this.width - PANEL_WIDTH) / 2 + 22;
        int y = (this.height - PANEL_HEIGHT) / 2 + 58;
        int width = PANEL_WIDTH - 44;

        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.hub.settings"),
                        button -> this.client.setScreen(new KlymonSettingsScreen(this)))
                .dimensions(x, y, width, 20)
                .build());
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.hub.addons"),
                        button -> this.client.setScreen(new KlymonAddonsScreen(this)))
                .dimensions(x, y + 24, width, 20)
                .build());
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.hub.editor"),
                        button -> this.client.setScreen(new KlymonHudEditorScreen(this)))
                .dimensions(x, y + 48, width, 20)
                .build());
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.hub.profiles"),
                        button -> this.client.setScreen(new KlymonProfilesScreen(this)))
                .dimensions(x, y + 72, width, 20)
                .build());
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.hub.diagnostics"),
                        button -> this.client.setScreen(new KlymonScreen(this)))
                .dimensions(x, y + 96, width, 20)
                .build());
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.hub.resume"),
                        button -> this.close())
                .dimensions(x, y + 124, width, 20)
                .build());
    }

    /** Drawn as part of the single background pass so {@code super.render} cannot blur it away. */
    @Override
    public void renderBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        super.renderBackground(context, mouseX, mouseY, delta);

        int panelX = (this.width - PANEL_WIDTH) / 2;
        int panelY = (this.height - PANEL_HEIGHT) / 2;
        KlymonTheme.panel(context, panelX, panelY, PANEL_WIDTH, PANEL_HEIGHT);
        KlymonTheme.header(context, this.textRenderer, this.title,
                Text.translatable("klymon.hub.subtitle"), this.width / 2, panelY + 16);
        context.fill(panelX + 22, panelY + 46, panelX + PANEL_WIDTH - 22, panelY + 47,
                KlymonTheme.alpha(KlymonTheme.accent(), 0x50));

        String sessionName = this.client != null ? this.client.getSession().getUsername() : "?";
        KlymonBridge identity = KlymonBridge.get();
        KlymonTheme.labeledValue(context, this.textRenderer, identity.displayName(sessionName),
                Text.translatable("klymon.level.short").getString() + " " + identity.level()
                        + " · " + KlymonMenuClient.modVersion(),
                panelX + 22, panelY + 230, PANEL_WIDTH - 44);
    }

    @Override
    public void close() {
        this.client.setScreen(null);
    }
}
