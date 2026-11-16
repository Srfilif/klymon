package com.klymon.clientmenu;

import net.minecraft.client.gui.Element;
import net.minecraft.client.gui.screen.GameMenuScreen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

/**
 * The vanilla pause menu with two Klymon shortcuts appended below its own
 * buttons. It subclasses {@link GameMenuScreen} so every vanilla behavior
 * (singleplayer/multiplayer variants, disconnect flow, feedback buttons) is
 * preserved untouched; only the button row is ours.
 */
public final class KlymonPauseScreen extends GameMenuScreen {
    private static final int BUTTON_WIDTH = 100;
    private static final int BUTTON_HEIGHT = 20;
    private static final int GAP = 4;

    public KlymonPauseScreen(boolean showMenu) {
        super(showMenu);
    }

    @Override
    protected void init() {
        super.init();

        // Anchor below the lowest vanilla button: singleplayer and multiplayer
        // pauses have different button sets, so this is computed, not hardcoded.
        int bottom = 0;
        for (Element child : this.children()) {
            if (child instanceof ButtonWidget button) {
                bottom = Math.max(bottom, button.getY() + button.getHeight());
            }
        }
        int rowY = bottom > 0 ? bottom + GAP + 2 : this.height - BUTTON_HEIGHT - 8;
        int leftX = this.width / 2 - BUTTON_WIDTH - GAP / 2;

        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.hub.settings"),
                        button -> this.client.setScreen(new KlymonSettingsScreen(this)))
                .dimensions(leftX, rowY, BUTTON_WIDTH, BUTTON_HEIGHT)
                .build());
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.hub.addons"),
                        button -> this.client.setScreen(new KlymonAddonsScreen(this)))
                .dimensions(leftX + BUTTON_WIDTH + GAP, rowY, BUTTON_WIDTH, BUTTON_HEIGHT)
                .build());
    }
}
