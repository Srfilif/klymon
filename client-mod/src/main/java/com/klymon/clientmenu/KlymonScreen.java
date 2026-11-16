package com.klymon.clientmenu;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;
import net.minecraft.util.Util;

/**
 * The Klymon Client screen: real actions only — opens the instance folder, its
 * logs and mods, copies a diagnostics block for bug reports, and reports what
 * the profile is running (Minecraft, loader, mods).
 */
public final class KlymonScreen extends Screen {
    private static final int PANEL_BACKGROUND = 0xD90B1220;
    private static final int PANEL_BORDER = 0x805BE0C8;
    private static final int ACCENT = 0xFF5BE0C8;
    private static final int TEXT = 0xFFB8C4D8;
    private static final int MUTED = 0xFF8A93A8;

    private static final int PANEL_WIDTH = 260;
    private static final int PANEL_HEIGHT = 190;

    private final Screen parent;
    private long copiedAt;

    public KlymonScreen(Screen parent) {
        super(Text.translatable("klymon.menu.title"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        int centerX = this.width / 2;
        int top = this.height / 2;
        File runDirectory = this.client != null ? this.client.runDirectory : new File(".");

        int left = centerX - 110;
        int right = centerX + 4;

        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.menu.folder"),
                        button -> open(runDirectory))
                .dimensions(left, top + 12, 106, 20)
                .build());

        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.menu.logs"),
                        button -> open(new File(runDirectory, "logs")))
                .dimensions(right, top + 12, 106, 20)
                .build());

        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.menu.mods"),
                        button -> open(new File(runDirectory, "mods")))
                .dimensions(left, top + 36, 106, 20)
                .build());

        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.menu.diagnostics"),
                        button -> copyDiagnostics())
                .dimensions(right, top + 36, 106, 20)
                .build());

        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.menu.back"),
                        button -> this.close())
                .dimensions(left, top + 66, 216, 20)
                .build());
    }

    private void open(File directory) {
        Util.getOperatingSystem().open(directory);
    }

    private void copyDiagnostics() {
        StringBuilder report = new StringBuilder();
        report.append("Klymon Client ").append(KlymonMenuClient.modVersion()).append('\n');
        report.append("Minecraft ").append(KlymonMenuClient.gameVersion()).append('\n');
        report.append("Fabric Loader ").append(KlymonMenuClient.loaderVersion()).append('\n');
        report.append("Java ").append(System.getProperty("java.version"))
                .append(" (").append(System.getProperty("java.vendor")).append(")\n");
        report.append("Memory ").append(maxMemoryMb()).append(" MB\n");
        report.append("Mods ").append(KlymonMenuClient.modCount()).append('\n');
        report.append("HUD ").append(KlymonConfig.get().hudEnabled ? "enabled" : "disabled")
                .append(", scale ").append(KlymonConfig.get().scaleLabel()).append('\n');
        report.append("Profile ").append(KlymonConfig.get().activeProfile().name)
                .append(" (").append(KlymonConfig.get().addons().all().size()).append(" addons)").append('\n');
        report.append("Settings ").append(KlymonConfig.file()).append('\n');
        for (String mod : modList()) {
            report.append("  - ").append(mod).append('\n');
        }

        if (this.client != null) {
            this.client.keyboard.setClipboard(report.toString());
        }
        this.copiedAt = Util.getMeasuringTimeMs();
        KlymonMenuClient.LOGGER.info("Klymon Client diagnostics copied to the clipboard");
    }

    /** Card and labels belong to the single background pass; {@code super.render} draws the buttons on top. */
    @Override
    public void renderBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        super.renderBackground(context, mouseX, mouseY, delta);

        int centerX = this.width / 2;
        int top = this.height / 2;
        int panelLeft = centerX - PANEL_WIDTH / 2;
        int panelTop = top - 78;

        // Panel first so the text and buttons read as a single branded card.
        context.fill(panelLeft, panelTop, panelLeft + PANEL_WIDTH, panelTop + PANEL_HEIGHT, PANEL_BACKGROUND);
        context.drawBorder(panelLeft, panelTop, PANEL_WIDTH, PANEL_HEIGHT, PANEL_BORDER);

        context.drawCenteredTextWithShadow(this.textRenderer, this.title, centerX, top - 64, ACCENT);
        context.drawCenteredTextWithShadow(
                this.textRenderer,
                Text.translatable("klymon.menu.versions", KlymonMenuClient.gameVersion(), KlymonMenuClient.loaderVersion(), KlymonMenuClient.modCount()),
                centerX,
                top - 46,
                TEXT);
        context.drawCenteredTextWithShadow(
                this.textRenderer,
                Text.translatable("klymon.menu.hint"),
                centerX,
                top - 32,
                MUTED);
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        super.render(context, mouseX, mouseY, delta);

        int centerX = this.width / 2;
        int top = this.height / 2;
        if (this.copiedAt > 0 && Util.getMeasuringTimeMs() - this.copiedAt < 2500) {
            context.drawCenteredTextWithShadow(
                    this.textRenderer,
                    Text.translatable("klymon.menu.copied"),
                    centerX,
                    top + 92,
                    ACCENT);
        } else {
            context.drawCenteredTextWithShadow(
                    this.textRenderer,
                    Text.translatable("klymon.menu.footer", KlymonMenuClient.modVersion()),
                    centerX,
                    top + 92,
                    MUTED);
        }
    }

    @Override
    public void close() {
        if (this.client != null) {
            this.client.setScreen(this.parent);
        }
    }

    private static long maxMemoryMb() {
        return Runtime.getRuntime().maxMemory() / (1024L * 1024L);
    }

    private static List<String> modList() {
        List<String> entries = new ArrayList<>();
        for (ModContainer mod : FabricLoader.getInstance().getAllMods()) {
            entries.add(mod.getMetadata().getName() + " " + mod.getMetadata().getVersion().getFriendlyString());
        }
        Collections.sort(entries);
        return entries;
    }
}
