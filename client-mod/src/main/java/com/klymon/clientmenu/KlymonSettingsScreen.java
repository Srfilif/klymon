package com.klymon.clientmenu;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;
import net.minecraft.util.Util;

/**
 * Client settings: master HUD switch, global scale and accent, plus the entry
 * points to addons, the HUD editor, profiles and diagnostics. Per-module
 * toggles moved to the addons screen; everything still saves immediately.
 */
public final class KlymonSettingsScreen extends Screen {
    private static final int PANEL_WIDTH = 430;
    private static final int PANEL_HEIGHT = 238;
    private static final int COLUMN_WIDTH = 190;

    private final Screen parent;

    public KlymonSettingsScreen(Screen parent) {
        super(Text.translatable("klymon.settings.title"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        KlymonConfig config = KlymonConfig.get();
        int panelX = (this.width - PANEL_WIDTH) / 2;
        int panelY = (this.height - PANEL_HEIGHT) / 2;
        int left = panelX + 20;
        int right = left + COLUMN_WIDTH + 10;
        int row = panelY + 56;

        this.addDrawableChild(ButtonWidget.builder(
                        toggle("klymon.settings.hud", config.hudEnabled),
                        button -> {
                            config.hudEnabled = !config.hudEnabled;
                            config.save();
                            this.clearAndInit();
                        })
                .dimensions(left, row, COLUMN_WIDTH, 20)
                .build());

        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.settings.scale", config.scaleLabel()),
                        button -> {
                            config.cycleScale(1);
                            config.save();
                            this.clearAndInit();
                        })
                .dimensions(right, row, COLUMN_WIDTH, 20)
                .build());

        row += 24;
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.settings.accent", Text.translatable(config.accent.labelKey())),
                        button -> {
                            config.accent = config.accent.next();
                            config.save();
                            this.clearAndInit();
                        })
                .dimensions(left, row, COLUMN_WIDTH, 20)
                .build());

        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.settings.profile", config.activeProfile().name),
                        button -> this.client.setScreen(new KlymonProfilesScreen(this)))
                .dimensions(right, row, COLUMN_WIDTH, 20)
                .build());

        row += 24;
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.settings.addons"),
                        button -> this.client.setScreen(new KlymonAddonsScreen(this)))
                .dimensions(left, row, COLUMN_WIDTH, 20)
                .build());

        boolean inGame = this.client.world != null;
        ButtonWidget.Builder editor = ButtonWidget.builder(
                        Text.translatable("klymon.settings.editor"),
                        button -> {
                            if (inGame) {
                                this.client.setScreen(new KlymonHudEditorScreen(this));
                            }
                        })
                .dimensions(right, row, COLUMN_WIDTH, 20);
        if (!inGame) {
            editor.tooltip(net.minecraft.client.gui.tooltip.Tooltip.of(
                    Text.translatable("klymon.settings.editorHint")));
        }
        this.addDrawableChild(editor.build());

        row += 24;
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.settings.playerProfile"),
                        button -> this.client.setScreen(new KlymonPlayerProfileScreen(this)))
                .dimensions(left, row, COLUMN_WIDTH, 20)
                .build());

        row += 32;
        int navWidth = 126;
        int navStep = 132;
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.settings.diagnostics"),
                        button -> this.client.setScreen(new KlymonScreen(this)))
                .dimensions(left, row, navWidth, 20)
                .build());
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.settings.folder"),
                        button -> openFolder())
                .dimensions(left + navStep, row, navWidth, 20)
                .build());
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.menu.back"),
                        button -> this.close())
                .dimensions(left + navStep * 2, row, navWidth, 20)
                .build());
    }

    private static Text toggle(String key, boolean value) {
        return Text.translatable(key)
                .append(": ")
                .append(Text.translatable(value ? "klymon.state.on" : "klymon.state.off"));
    }

    private void openFolder() {
        if (this.client != null) {
            Util.getOperatingSystem().open(this.client.runDirectory);
        }
    }

    /** Drawn as part of the single background pass so {@code super.render} cannot blur it away. */
    @Override
    public void renderBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        super.renderBackground(context, mouseX, mouseY, delta);

        int panelX = (this.width - PANEL_WIDTH) / 2;
        int panelY = (this.height - PANEL_HEIGHT) / 2;
        KlymonTheme.panel(context, panelX, panelY, PANEL_WIDTH, PANEL_HEIGHT);
        KlymonTheme.header(context, this.textRenderer, this.title,
                Text.translatable("klymon.settings.subtitle"), this.width / 2, panelY + 16);
        context.fill(panelX + 20, panelY + 46, panelX + PANEL_WIDTH - 20, panelY + 47,
                KlymonTheme.alpha(KlymonTheme.accent(), 0x50));

        KlymonTheme.footer(context, this.textRenderer,
                Text.translatable("klymon.settings.configHint", KlymonConfig.file().getFileName().toString()),
                this.width / 2, panelY + 214);
        KlymonTheme.footer(context, this.textRenderer,
                Text.literal("Klymon Client " + KlymonMenuClient.modVersion()),
                this.width / 2, panelY + 226);
    }

    @Override
    public void close() {
        this.client.setScreen(this.parent);
    }
}
