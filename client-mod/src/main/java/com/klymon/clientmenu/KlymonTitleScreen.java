package com.klymon.clientmenu;

import com.klymon.clientmenu.cosmetic.KlymonBridge;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.multiplayer.MultiplayerScreen;
import net.minecraft.client.gui.screen.option.OptionsScreen;
import net.minecraft.client.gui.screen.world.SelectWorldScreen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.text.Text;

/**
 * Klymon's own main menu. It replaces the vanilla title screen so the client has
 * a distinct identity: a branded card with the game modes, the client settings,
 * the addon list and an explicit route to the untouched vanilla options.
 *
 * <p>The card size adapts to the scaled GUI height, because auto GUI scale can
 * leave as little as ~240 scaled pixels on a 1080p display.</p>
 */
public final class KlymonTitleScreen extends Screen {
    private static final int MAX_PANEL_WIDTH = 268;
    private static final int HEADER_HEIGHT = 74;
    private static final int FOOTER_TALL = 40;
    private static final int FOOTER_COMPACT = 22;
    private static final int BUTTON_HEIGHT = 20;
    private static final int BUTTONS = 6;

    private int panelX;
    private int panelY;
    private int panelWidth;
    private int panelHeight;
    private int buttonStep;
    private boolean compactFooter;

    public KlymonTitleScreen() {
        super(Text.translatable("klymon.title.title"));
    }

    @Override
    protected void init() {
        int gap = 4;
        int footer = FOOTER_TALL;
        int panelHeight = HEADER_HEIGHT + BUTTONS * BUTTON_HEIGHT + (BUTTONS - 1) * gap + footer;
        if (panelHeight > this.height - 10) {
            gap = 2;
            panelHeight = HEADER_HEIGHT + BUTTONS * BUTTON_HEIGHT + (BUTTONS - 1) * gap + footer;
        }
        if (panelHeight > this.height - 10) {
            gap = 0;
            footer = FOOTER_COMPACT;
            panelHeight = HEADER_HEIGHT + BUTTONS * BUTTON_HEIGHT + footer;
        }

        this.compactFooter = footer == FOOTER_COMPACT;
        this.buttonStep = BUTTON_HEIGHT + gap;
        this.panelWidth = Math.min(MAX_PANEL_WIDTH, this.width - 24);
        this.panelHeight = Math.min(panelHeight, this.height - 10);
        this.panelX = 28;
        this.panelY = (this.height - this.panelHeight) / 2;

        int y = this.panelY + HEADER_HEIGHT;

        this.addDrawableChild(button("klymon.title.singleplayer", y,
                button -> this.client.setScreen(new SelectWorldScreen(this))));
        y += this.buttonStep;
        this.addDrawableChild(button("klymon.title.multiplayer", y,
                button -> this.client.setScreen(new MultiplayerScreen(this))));
        y += this.buttonStep;
        this.addDrawableChild(button("klymon.title.settings", y,
                button -> this.client.setScreen(new KlymonSettingsScreen(this))));
        y += this.buttonStep;
        this.addDrawableChild(button("klymon.title.addons", y,
                button -> this.client.setScreen(new KlymonAddonsScreen(this))));
        y += this.buttonStep;
        this.addDrawableChild(button("klymon.title.vanillaOptions", y,
                button -> this.client.setScreen(new OptionsScreen(this, this.client.options))));
        y += this.buttonStep;
        this.addDrawableChild(button("klymon.title.quit", y,
                button -> this.client.scheduleStop()));
    }

    private ButtonWidget button(String key, int y, ButtonWidget.PressAction action) {
        return ButtonWidget.builder(Text.translatable(key), action)
                .dimensions(this.panelX + 22, y, this.panelWidth - 44, BUTTON_HEIGHT)
                .build();
    }

    /**
     * The card is part of the background layer on purpose: {@link Screen#render}
     * already calls {@code renderBackground} once, so drawing it here keeps the
     * order background → card → widgets and avoids painting the blurred snapshot
     * over the panel (which happens when a screen calls {@code renderBackground}
     * itself and still delegates to {@code super.render}).
     */
    @Override
    public void renderBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        super.renderBackground(context, mouseX, mouseY, delta);

        int panelRight = this.panelX + this.panelWidth;

        // Readability scrim over the panorama, plus two faint accent ribbons.
        context.fillGradient(0, 0, panelRight + 80, this.height, 0xB0081018, 0x15081018);
        context.fillGradient(0, this.height / 3, this.width, this.height / 3 + 70,
                KlymonTheme.alpha(KlymonTheme.accent(), 0x18), KlymonTheme.alpha(KlymonTheme.accent(), 0x00));
        context.fillGradient(0, this.height - 120, this.width, this.height,
                KlymonTheme.alpha(KlymonTheme.accent(), 0x10), KlymonTheme.alpha(KlymonTheme.accent(), 0x00));

        KlymonTheme.panel(context, this.panelX, this.panelY, this.panelWidth, this.panelHeight);

        MatrixStack matrices = context.getMatrices();
        matrices.push();
        matrices.translate(this.panelX + 22, this.panelY + 18, 0.0f);
        matrices.scale(2.0f, 2.0f, 1.0f);
        context.drawTextWithShadow(this.textRenderer, "KLYMON", 0, 0, KlymonTheme.accent());
        matrices.pop();

        Text client = Text.translatable("klymon.title.client");
        context.drawTextWithShadow(this.textRenderer, client, this.panelX + 23, this.panelY + 42, KlymonTheme.MUTED);
        context.drawTextWithShadow(this.textRenderer, Text.literal("v" + KlymonMenuClient.modVersion()),
                this.panelX + 23 + this.textRenderer.getWidth(client) + 6, this.panelY + 42,
                KlymonTheme.alpha(KlymonTheme.MUTED, 0xB0));

        context.fill(this.panelX + 22, this.panelY + HEADER_HEIGHT - 8, panelRight - 22, this.panelY + HEADER_HEIGHT - 7,
                KlymonTheme.alpha(KlymonTheme.accent(), 0x50));

        int footerY = this.panelY + this.panelHeight - (this.compactFooter ? 16 : 34);
        String sessionName = this.client != null ? this.client.getSession().getUsername() : "?";
        KlymonBridge identity = KlymonBridge.get();
        String username = identity.displayName(sessionName);
        if (this.compactFooter) {
            context.drawTextWithShadow(this.textRenderer,
                    Text.translatable("klymon.title.footerCompact", username,
                            KlymonMenuClient.gameVersion(), KlymonMenuClient.loaderVersion()),
                    this.panelX + 22, footerY, KlymonTheme.alpha(KlymonTheme.MUTED, 0xC0));
        } else {
            KlymonTheme.labeledValue(context, this.textRenderer, Text.translatable("klymon.title.session").getString(),
                    username + "  ·  " + Text.translatable("klymon.level.short").getString() + " " + identity.level(),
                    this.panelX + 22, footerY, this.panelWidth - 44);
            context.drawTextWithShadow(this.textRenderer,
                    Text.translatable("klymon.title.footer", KlymonMenuClient.gameVersion(), KlymonMenuClient.loaderVersion()),
                    this.panelX + 22, footerY + 12, KlymonTheme.alpha(KlymonTheme.MUTED, 0xB0));
        }
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        super.render(context, mouseX, mouseY, delta);

        String hint = Text.translatable("klymon.title.hint").getString();
        context.drawTextWithShadow(this.textRenderer, hint,
                this.width - this.textRenderer.getWidth(hint) - 6, this.height - 12,
                KlymonTheme.alpha(KlymonTheme.MUTED, 0xC0));
        String credit = "Klymon Client " + KlymonMenuClient.modVersion();
        context.drawTextWithShadow(this.textRenderer, credit,
                this.width - this.textRenderer.getWidth(credit) - 6, 6,
                KlymonTheme.alpha(KlymonTheme.MUTED, 0xC0));
    }

    @Override
    public boolean shouldCloseOnEsc() {
        return false;
    }
}
