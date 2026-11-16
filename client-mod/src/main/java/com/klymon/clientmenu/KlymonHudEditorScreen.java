package com.klymon.clientmenu;

import java.util.List;

import com.klymon.clientmenu.addon.Addon;
import com.klymon.clientmenu.addon.AddonManager;
import com.klymon.clientmenu.hud.HudAnchor;
import com.klymon.clientmenu.hud.HudElement;
import com.klymon.clientmenu.hud.HudManager;
import com.klymon.clientmenu.hud.HudManager.ElementState;
import com.klymon.clientmenu.hud.HudManager.Layout;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

/**
 * Visual HUD editor: every element renders live over the game, can be dragged
 * with the mouse (unless locked), nudged with the arrow keys, and tuned
 * (scale, opacity, anchor, visibility, lock) from the bottom bar.
 */
public final class KlymonHudEditorScreen extends Screen {
    private static final int BAR_HEIGHT = 64;
    private static final int MIN_HIT_WIDTH = 24;
    private static final int MIN_HIT_HEIGHT = 14;

    private final Screen parent;
    private String selected;
    private double grabDX;
    private double grabDY;
    private boolean dragging;

    public KlymonHudEditorScreen(Screen parent) {
        super(Text.translatable("klymon.editor.title"));
        this.parent = parent;
    }

    private static KlymonConfig config() {
        return KlymonConfig.get();
    }

    @Override
    protected void init() {
        int barY = this.height - BAR_HEIGHT;
        int buttonY = barY + 34;
        int x = 8;
        int tiny = 62;
        int small = 76;
        int medium = 110;

        HudElement element = selectedElement();
        if (element != null) {
            this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.editor.scaleDown"),
                            button -> adjustScale(0.75f))
                    .dimensions(x, buttonY, tiny, 20).build());
            x += tiny + 4;
            this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.editor.scaleUp"),
                            button -> adjustScale(1.25f))
                    .dimensions(x, buttonY, tiny, 20).build());
            x += tiny + 4;
            this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.editor.opacityDown"),
                            button -> adjustOpacity(-0.1f))
                    .dimensions(x, buttonY, tiny, 20).build());
            x += tiny + 4;
            this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.editor.opacityUp"),
                            button -> adjustOpacity(0.1f))
                    .dimensions(x, buttonY, tiny, 20).build());
            x += tiny + 8;

            ElementState state = config().hud().state(element.elementId());
            this.addDrawableChild(ButtonWidget.builder(
                            Text.translatable("klymon.editor.anchor", Text.translatable(state.anchor.labelKey())),
                            button -> cycleAnchor())
                    .dimensions(x, buttonY, 120, 20).build());
            x += 124;
            Addon addon = config().addons().byId(element.elementId());
            String toggleKey = addon != null && addon.enabled() ? "klymon.editor.disable" : "klymon.editor.enable";
            this.addDrawableChild(ButtonWidget.builder(Text.translatable(toggleKey), button -> toggleSelected())
                    .dimensions(x, buttonY, small, 20).build());
            x += small + 4;
            this.addDrawableChild(ButtonWidget.builder(
                            Text.translatable(state.visible ? "klymon.editor.hide" : "klymon.editor.show"),
                            button -> toggleVisible())
                    .dimensions(x, buttonY, small, 20).build());
            x += small + 4;
            this.addDrawableChild(ButtonWidget.builder(
                            Text.translatable(state.locked ? "klymon.editor.unlock" : "klymon.editor.lock"),
                            button -> toggleLocked())
                    .dimensions(x, buttonY, small, 20).build());
            x += small + 4;
            this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.editor.reset"),
                            button -> resetSelected())
                    .dimensions(x, buttonY, small, 20).build());
        } else {
            this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.editor.resetAll"),
                            button -> {
                                config().hud().resetAll();
                                config().save();
                            })
                    .dimensions(x, buttonY, medium, 20).build());
        }

        int right = this.width - 8;
        this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.editor.done"), button -> this.close())
                .dimensions(right - medium, buttonY, medium, 20).build());
        if (element != null) {
            this.addDrawableChild(ButtonWidget.builder(Text.translatable("klymon.editor.resetAll"),
                            button -> {
                                config().hud().resetAll();
                                config().save();
                            })
                    .dimensions(right - medium * 2 - 4, buttonY, medium, 20).build());
        }
    }

    // ------------------------------------------------------------------ actions

    private HudElement selectedElement() {
        return this.selected == null ? null : config().hud().element(this.selected);
    }

    private void adjustScale(float factor) {
        HudElement element = selectedElement();
        if (element == null) {
            return;
        }
        ElementState state = config().hud().state(element.elementId());
        float stepped = Math.round(state.scale * factor * 4.0f) / 4.0f;
        state.scale = ElementState.clampScale(stepped == state.scale && factor > 1.0f ? state.scale + 0.25f
                : stepped == state.scale ? state.scale - 0.25f : stepped);
        config().save();
        this.clearAndInit();
    }

    private void adjustOpacity(float delta) {
        HudElement element = selectedElement();
        if (element == null) {
            return;
        }
        ElementState state = config().hud().state(element.elementId());
        state.opacity = ElementState.clampOpacity(Math.round((state.opacity + delta) * 10.0f) / 10.0f);
        config().save();
        this.clearAndInit();
    }

    private void cycleAnchor() {
        HudElement element = selectedElement();
        if (element == null) {
            return;
        }
        ElementState state = config().hud().state(element.elementId());
        HudAnchor[] anchors = HudAnchor.values();
        HudAnchor next = anchors[(state.anchor.ordinal() + 1) % anchors.length];
        // Keep the on-screen position stable across the anchor change.
        Layout before = layoutOf(element);
        state.anchor = next;
        int[] offsets = HudManager.dragToOffsets(state,
                element.measureWidth(this.client), element.measureHeight(this.client),
                this.width, this.height - BAR_HEIGHT, config().hudScale, before.x(), before.y());
        state.x = offsets[0];
        state.y = offsets[1];
        config().save();
        this.clearAndInit();
    }

    private void toggleSelected() {
        HudElement element = selectedElement();
        if (element == null) {
            return;
        }
        AddonManager addons = config().addons();
        addons.setEnabled(element.elementId(), !addons.enabled(element.elementId()));
        config().save();
        this.clearAndInit();
    }

    private void toggleVisible() {
        HudElement element = selectedElement();
        if (element == null) {
            return;
        }
        ElementState state = config().hud().state(element.elementId());
        state.visible = !state.visible;
        config().save();
        this.clearAndInit();
    }

    private void toggleLocked() {
        HudElement element = selectedElement();
        if (element == null) {
            return;
        }
        ElementState state = config().hud().state(element.elementId());
        state.locked = !state.locked;
        config().save();
        this.clearAndInit();
    }

    private void resetSelected() {
        if (this.selected != null) {
            config().hud().resetElement(this.selected);
            config().save();
            this.clearAndInit();
        }
    }

    // ------------------------------------------------------------------ layout helpers

    private int playHeight() {
        return this.height - BAR_HEIGHT;
    }

    private Layout layoutOf(HudElement element) {
        ElementState state = config().hud().state(element.elementId());
        return HudManager.layout(element.elementId(), state,
                element.measureWidth(this.client), element.measureHeight(this.client),
                this.width, playHeight(), config().hudScale);
    }

    private Layout hitLayout(Layout layout) {
        int width = Math.max(layout.width(), MIN_HIT_WIDTH);
        int height = Math.max(layout.height(), MIN_HIT_HEIGHT);
        return new Layout(layout.id(), layout.x(), layout.y(), width, height);
    }

    private void nudge(int dx, int dy) {
        HudElement element = selectedElement();
        if (element == null) {
            return;
        }
        ElementState state = config().hud().state(element.elementId());
        if (state.locked) {
            return;
        }
        Layout layout = layoutOf(element);
        int[] offsets = HudManager.dragToOffsets(state,
                element.measureWidth(this.client), element.measureHeight(this.client),
                this.width, playHeight(), config().hudScale, layout.x() + dx, layout.y() + dy);
        state.x = offsets[0];
        state.y = offsets[1];
        config().save();
    }

    // ------------------------------------------------------------------ input

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (super.mouseClicked(mouseX, mouseY, button)) {
            return true;
        }
        if (button != 0 || mouseY >= playHeight()) {
            return false;
        }
        List<HudElement> elements = config().hud().elements();
        for (int i = elements.size() - 1; i >= 0; i--) {
            HudElement element = elements.get(i);
            if (!config().hud().state(element.elementId()).visible) {
                continue;
            }
            Layout layout = hitLayout(layoutOf(element));
            if (layout.contains(mouseX, mouseY)) {
                this.selected = element.elementId();
                this.dragging = !config().hud().state(element.elementId()).locked;
                Layout exact = layoutOf(element);
                this.grabDX = mouseX - exact.x();
                this.grabDY = mouseY - exact.y();
                this.clearAndInit();
                return true;
            }
        }
        if (this.selected != null) {
            this.selected = null;
            this.clearAndInit();
        }
        return false;
    }

    @Override
    public boolean mouseDragged(double mouseX, double mouseY, int button, double deltaX, double deltaY) {
        if (super.mouseDragged(mouseX, mouseY, button, deltaX, deltaY)) {
            return true;
        }
        HudElement element = selectedElement();
        if (element == null || !this.dragging || button != 0) {
            return false;
        }
        ElementState state = config().hud().state(element.elementId());
        if (state.locked) {
            return false;
        }
        int[] offsets = HudManager.dragToOffsets(state,
                element.measureWidth(this.client), element.measureHeight(this.client),
                this.width, playHeight(), config().hudScale, mouseX - this.grabDX, mouseY - this.grabDY);
        state.x = offsets[0];
        state.y = offsets[1];
        return true;
    }

    @Override
    public boolean mouseReleased(double mouseX, double mouseY, int button) {
        boolean handled = super.mouseReleased(mouseX, mouseY, button);
        if (this.dragging && button == 0) {
            this.dragging = false;
            config().save();
            return true;
        }
        return handled;
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (this.selected != null) {
            int step = Screen.hasShiftDown() ? 10 : 1;
            switch (keyCode) {
                case 263 -> { // Left
                    nudge(-step, 0);
                    return true;
                }
                case 262 -> { // Right
                    nudge(step, 0);
                    return true;
                }
                case 265 -> { // Up
                    nudge(0, -step);
                    return true;
                }
                case 264 -> { // Down
                    nudge(0, step);
                    return true;
                }
                default -> {
                }
            }
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    // ------------------------------------------------------------------ rendering

    /** Light scrim only: the game and the live HUD must stay visible underneath. */
    @Override
    public void renderBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        context.fill(0, 0, this.width, this.height, 0x50000000);

        // Live HUD over the play area (all elements, so layout works blind).
        int playHeight = playHeight();
        context.enableScissor(0, 0, this.width, playHeight);
        try {
            config().hud().renderAllClipped(context, this.client, config().hudScale, playHeight, id -> true);
        } finally {
            context.disableScissor();
        }

        // Selection outlines + tags.
        for (HudElement element : config().hud().elements()) {
            ElementState state = config().hud().state(element.elementId());
            if (!state.visible) {
                continue;
            }
            Layout layout = layoutOf(element);
            boolean isSelected = element.elementId().equals(this.selected);
            int edge = isSelected ? KlymonTheme.accent() : KlymonTheme.alpha(KlymonTheme.MUTED, 0x90);
            Layout hit = hitLayout(layout);
            int outlineX = Math.min(layout.x(), hit.x());
            int outlineY = Math.min(layout.y(), hit.y());
            int outlineW = Math.max(layout.width(), hit.width());
            int outlineH = Math.max(layout.height(), hit.height());
            context.drawBorder(outlineX - 1, outlineY - 1, outlineW + 2, outlineH + 2, edge);
            if (isSelected || layout.contains(mouseX, mouseY)) {
                Addon addon = config().addons().byId(element.elementId());
                String name = addon == null ? element.elementId()
                        : Text.translatable(addon.nameKey()).getString();
                StringBuilder tag = new StringBuilder(name);
                if (addon != null && !addon.enabled()) {
                    tag.append(" · ").append(Text.translatable("klymon.state.off").getString());
                }
                if (state.locked) {
                    tag.append(" · ").append(Text.translatable("klymon.editor.locked").getString());
                }
                context.drawTextWithShadow(this.textRenderer, tag.toString(),
                        outlineX, Math.max(2, outlineY - 10), KlymonTheme.TEXT);
            }
        }

        // Bottom bar.
        int barY = playHeight;
        context.fill(0, barY, this.width, this.height, 0xE00B1220);
        context.fill(0, barY, this.width, barY + 1, KlymonTheme.alpha(KlymonTheme.accent(), 0x70));
        HudElement element = selectedElement();
        String status = element == null
                ? Text.translatable("klymon.editor.hint").getString()
                : describeSelection(element);
        context.drawTextWithShadow(this.textRenderer, status, 8, barY + 8, KlymonTheme.MUTED);
        context.drawCenteredTextWithShadow(this.textRenderer, this.title, this.width / 2, 6, KlymonTheme.accent());
    }

    private String describeSelection(HudElement element) {
        ElementState state = config().hud().state(element.elementId());
        Addon addon = config().addons().byId(element.elementId());
        String name = addon == null ? element.elementId() : Text.translatable(addon.nameKey()).getString();
        return name + " · ×" + state.scale + " · " + Math.round(state.opacity * 100) + "% · "
                + Text.translatable(state.anchor.labelKey()).getString();
    }

    @Override
    public void close() {
        config().save();
        this.client.setScreen(this.parent);
    }
}
