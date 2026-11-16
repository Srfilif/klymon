package com.klymon.clientmenu;

import java.util.List;

import com.klymon.clientmenu.addon.Addon;
import com.klymon.clientmenu.addon.AddonCategory;
import com.klymon.clientmenu.addon.ExternalModAddon;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.tooltip.Tooltip;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

/**
 * Addons screen with category tabs. Built-in modules can be toggled and
 * configured here; performance entries report the launcher-managed mods live
 * (installed version or missing) and are never toggled from the game.
 */
public final class KlymonAddonsScreen extends Screen {
    private static final int PANEL_WIDTH = 480;
    private static final int PANEL_HEIGHT = 264;
    private static final int ROW_HEIGHT = 22;

    private final Screen parent;
    private AddonCategory category;

    public KlymonAddonsScreen(Screen parent) {
        this(parent, AddonCategory.PVP);
    }

    public KlymonAddonsScreen(Screen parent, AddonCategory category) {
        super(Text.translatable("klymon.addons.title"));
        this.parent = parent;
        this.category = category;
    }

    @Override
    protected void init() {
        KlymonConfig config = KlymonConfig.get();
        int panelX = (this.width - PANEL_WIDTH) / 2;
        int panelY = (this.height - PANEL_HEIGHT) / 2;
        int left = panelX + 20;
        int contentWidth = PANEL_WIDTH - 40;

        // Category tabs.
        AddonCategory[] categories = AddonCategory.values();
        int tabWidth = (contentWidth - (categories.length - 1) * 4) / categories.length;
        for (int i = 0; i < categories.length; i++) {
            AddonCategory tab = categories[i];
            this.addDrawableChild(ButtonWidget.builder(
                            Text.translatable(tab.labelKey()),
                            button -> {
                                this.category = tab;
                                this.clearAndInit();
                            })
                    .dimensions(left + i * (tabWidth + 4), panelY + 46, tabWidth, 18)
                    .build());
        }

        // Addon rows.
        List<Addon> addons = config.addons().byCategory(this.category);
        int y = panelY + 70;
        for (Addon addon : addons) {
            if (y + 20 > panelY + PANEL_HEIGHT - 52) {
                break;
            }
            addRow(config, addon, left, y, contentWidth);
            y += ROW_HEIGHT;
        }

        // Bulk actions + back.
        int bulkY = panelY + PANEL_HEIGHT - 46;
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.addons.enableAll"),
                        button -> {
                            config.addons().setAllInternal(true);
                            config.save();
                            this.clearAndInit();
                        })
                .dimensions(left, bulkY, 140, 20)
                .build());
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.addons.disableAll"),
                        button -> {
                            config.addons().setAllInternal(false);
                            config.save();
                            this.clearAndInit();
                        })
                .dimensions(left + 144, bulkY, 140, 20)
                .build());
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.menu.back"),
                        button -> this.close())
                .dimensions(left + contentWidth - 140, bulkY, 140, 20)
                .build());
    }

    private void addRow(KlymonConfig config, Addon addon, int x, int y, int width) {
        Text name = Text.translatable(addon.nameKey());
        Text desc = Text.translatable(addon.descriptionKey());
        if (addon instanceof ExternalModAddon external) {
            boolean installed = external.installed();
            String version = external.installedVersion();
            Text status = installed
                    ? Text.translatable("klymon.addons.installed", version == null ? "?" : version)
                    : Text.translatable("klymon.addons.missing");
            this.addDrawableChild(ButtonWidget.builder(name.copy().append(" · ").append(status), button -> {
                    })
                    .dimensions(x, y, width, 20)
                    .tooltip(Tooltip.of(desc.copy().append("\n")
                            .append(Text.translatable("klymon.addons.modrinth", external.modrinthSlug()))))
                    .build());
            return;
        }
        Text state = Text.translatable(addon.enabled() ? "klymon.state.on" : "klymon.state.off");
        int toggleWidth = addon.configurable() ? width - 108 : width;
        this.addDrawableChild(ButtonWidget.builder(
                        name.copy().append(" · ").append(state),
                        button -> {
                            config.addons().setEnabled(addon.id(), !addon.enabled());
                            config.save();
                            this.clearAndInit();
                        })
                .dimensions(x, y, toggleWidth, 20)
                .tooltip(Tooltip.of(desc.copy().append("\n")
                        .append(Text.literal("v" + addon.version() + " · " + String.join(", ", addon.dependencies())))))
                .build());
        if (addon.configurable()) {
            this.addDrawableChild(ButtonWidget.builder(
                            Text.translatable("klymon.addons.configure"),
                            button -> this.client.setScreen(new KlymonAddonConfigScreen(this, addon)))
                    .dimensions(x + toggleWidth + 4, y, 104, 20)
                    .build());
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
                Text.translatable(this.category == AddonCategory.PERFORMANCE
                        ? "klymon.addons.subtitlePerf" : "klymon.addons.subtitle"),
                this.width / 2, panelY + 14);
        context.fill(panelX + 20, panelY + 40, panelX + PANEL_WIDTH - 20, panelY + 41,
                KlymonTheme.alpha(KlymonTheme.accent(), 0x50));

        // Active-tab underline.
        AddonCategory[] categories = AddonCategory.values();
        int contentWidth = PANEL_WIDTH - 40;
        int tabWidth = (contentWidth - (categories.length - 1) * 4) / categories.length;
        int tabX = panelX + 20 + this.category.ordinal() * (tabWidth + 4);
        context.fill(tabX, panelY + 65, tabX + tabWidth, panelY + 66, KlymonTheme.accent());

        KlymonTheme.footer(context, this.textRenderer,
                Text.translatable("klymon.addons.hint"), this.width / 2, panelY + PANEL_HEIGHT - 12);
    }

    @Override
    public void close() {
        this.client.setScreen(this.parent);
    }
}
