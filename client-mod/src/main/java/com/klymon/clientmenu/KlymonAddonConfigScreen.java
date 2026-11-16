package com.klymon.clientmenu;

import java.util.List;

import com.klymon.clientmenu.addon.Addon;
import com.klymon.clientmenu.addon.CustomCrosshairAddon;
import com.klymon.clientmenu.addon.Setting;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.tooltip.Tooltip;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;

/**
 * Generic per-addon settings editor: every {@link Setting} type renders a
 * real widget (toggles, steppers, cyclers, text fields). The crosshair addon
 * additionally gets a live preview running its own draw code.
 */
public final class KlymonAddonConfigScreen extends Screen {
    private static final int PANEL_WIDTH = 470;
    private static final int ROW_HEIGHT = 24;
    private static final int HEADER = 52;
    private static final int FOOTER = 52;

    private final Screen parent;
    private final Addon addon;

    public KlymonAddonConfigScreen(Screen parent, Addon addon) {
        super(Text.translatable(addon.nameKey()));
        this.parent = parent;
        this.addon = addon;
    }

    @Override
    protected void init() {
        List<Setting<?>> settings = this.addon.settings();
        int panelHeight = panelHeight();
        int panelX = (this.width - PANEL_WIDTH) / 2;
        int panelY = (this.height - panelHeight) / 2;
        int left = panelX + 20;
        int widgetWidth = PANEL_WIDTH - 40;

        int y = panelY + HEADER;
        for (Setting<?> setting : settings) {
            addSettingRow(setting, left, y, widgetWidth);
            y += ROW_HEIGHT;
        }

        boolean preview = this.addon instanceof CustomCrosshairAddon;
        if (preview) {
            y += 76;
        }

        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.config.reset"),
                        button -> {
                            this.addon.resetToDefaults();
                            KlymonConfig.get().save();
                            this.clearAndInit();
                        })
                .dimensions(left, y, (widgetWidth - 8) / 2, 20)
                .tooltip(Tooltip.of(Text.translatable("klymon.config.resetHint")))
                .build());
        this.addDrawableChild(ButtonWidget.builder(
                        Text.translatable("klymon.menu.back"),
                        button -> this.close())
                .dimensions(left + (widgetWidth - 8) / 2 + 8, y, (widgetWidth - 8) / 2, 20)
                .build());
    }

    private int panelHeight() {
        int height = HEADER + this.addon.settings().size() * ROW_HEIGHT + FOOTER;
        if (this.addon instanceof CustomCrosshairAddon) {
            height += 76;
        }
        return Math.min(height, this.height - 8);
    }

    @SuppressWarnings("unchecked")
    private void addSettingRow(Setting<?> setting, int x, int y, int width) {
        Text label = Text.translatable(setting.labelKey());
        switch (setting.type()) {
            case BOOLEAN -> this.addDrawableChild(ButtonWidget.builder(
                            label.copy().append(": ").append(onOff(((Setting<Boolean>) setting).getBoolean())),
                            button -> {
                                ((Setting<Boolean>) setting).cycle(1);
                                changed();
                            })
                    .dimensions(x, y, width, 20)
                    .build());
            case INT, DOUBLE -> {
                this.addDrawableChild(ButtonWidget.builder(
                                label.copy().append(": ").append(Text.literal(setting.displayValue())), button -> {
                                    setting.cycle(Screen.hasShiftDown() ? -1 : 1);
                                    changed();
                                })
                        .dimensions(x, y, width - 68, 20)
                        .tooltip(Tooltip.of(Text.translatable("klymon.config.stepHint")))
                        .build());
                this.addDrawableChild(ButtonWidget.builder(Text.literal("−"), button -> {
                            setting.cycle(-1);
                            changed();
                        })
                        .dimensions(x + width - 64, y, 30, 20)
                        .build());
                this.addDrawableChild(ButtonWidget.builder(Text.literal("+"), button -> {
                            setting.cycle(1);
                            changed();
                        })
                        .dimensions(x + width - 30, y, 30, 20)
                        .build());
            }
            case ENUM, COLOR -> this.addDrawableChild(ButtonWidget.builder(
                            label.copy().append(": ").append(Text.literal(displayOption(setting))),
                            button -> {
                                setting.cycle(Screen.hasShiftDown() ? -1 : 1);
                                changed();
                            })
                    .dimensions(x, y, width, 20)
                    .tooltip(Tooltip.of(Text.translatable("klymon.config.cycleHint")))
                    .build());
            case STRING -> {
                TextFieldWidget field = new TextFieldWidget(this.textRenderer, x + 150, y, width - 150, 20,
                        Text.translatable("klymon.config.textHint"));
                field.setMaxLength(200);
                field.setText(((Setting<String>) setting).getString());
                field.setChangedListener(text -> {
                    ((Setting<String>) setting).setString(text);
                    this.addon.validate();
                    KlymonConfig.get().save();
                });
                this.addDrawableChild(field);
            }
        }
    }

    private static Text onOff(boolean value) {
        return Text.translatable(value ? "klymon.state.on" : "klymon.state.off");
    }

    @SuppressWarnings("unchecked")
    private String displayOption(Setting<?> setting) {
        if (setting.type() == Setting.Type.ENUM) {
            String option = ((Setting<String>) setting).getEnum();
            String key = setting.optionKey(option);
            // Prefer a translation when one exists, otherwise show the raw id.
            if (net.minecraft.client.resource.language.I18n.hasTranslation(key)) {
                return Text.translatable(key).getString();
            }
            return option;
        }
        return setting.displayValue();
    }

    private void changed() {
        this.addon.validate();
        KlymonConfig.get().save();
        this.clearAndInit();
    }

    @Override
    @SuppressWarnings("unchecked")
    public void renderBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        super.renderBackground(context, mouseX, mouseY, delta);

        int panelHeight = panelHeight();
        int panelX = (this.width - PANEL_WIDTH) / 2;
        int panelY = (this.height - panelHeight) / 2;
        KlymonTheme.panel(context, panelX, panelY, PANEL_WIDTH, panelHeight);
        KlymonTheme.header(context, this.textRenderer, this.title,
                Text.translatable(this.addon.descriptionKey()), this.width / 2, panelY + 14);
        context.fill(panelX + 20, panelY + 42, panelX + PANEL_WIDTH - 20, panelY + 43,
                KlymonTheme.alpha(KlymonTheme.accent(), 0x50));

        // Labels for the text-field rows + color swatches, aligned with the widgets.
        int y = panelY + HEADER;
        for (Setting<?> setting : this.addon.settings()) {
            if (setting.type() == Setting.Type.STRING) {
                context.drawTextWithShadow(this.textRenderer, Text.translatable(setting.labelKey()),
                        panelX + 20, y + 6, KlymonTheme.TEXT);
            } else if (setting.type() == Setting.Type.COLOR) {
                int swatch = ((Setting<Integer>) setting).getInt() | 0xFF000000;
                int sx = panelX + PANEL_WIDTH - 34;
                context.fill(sx, y + 4, sx + 12, y + 16, swatch);
                context.drawBorder(sx, y + 4, 12, 12, 0xFFFFFFFF);
            }
            y += ROW_HEIGHT;
        }

        // Version + dependencies footer line.
        String meta = "v" + this.addon.version() + " · " + String.join(", ", this.addon.dependencies());
        KlymonTheme.footer(context, this.textRenderer, Text.literal(meta), this.width / 2, panelY + panelHeight - 12);

        if (this.addon instanceof CustomCrosshairAddon crosshair) {
            int boxX = panelX + 20;
            int boxW = PANEL_WIDTH - 40;
            int boxY = y + 4;
            int boxH = 68;
            context.fill(boxX, boxY, boxX + boxW, boxY + boxH, 0xFF2A3444);
            context.drawBorder(boxX, boxY, boxW, boxH, KlymonTheme.alpha(KlymonTheme.MUTED, 0x80));
            crosshair.draw(context, boxX + boxW / 2, boxY + boxH / 2, 1.0f);
        }
    }

    @Override
    public void close() {
        KlymonConfig.get().save();
        this.client.setScreen(this.parent);
    }
}
