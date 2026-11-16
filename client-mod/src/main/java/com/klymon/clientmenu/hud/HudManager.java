package com.klymon.clientmenu.hud;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.util.math.MatrixStack;

/**
 * Owns every {@link HudElement}'s on-screen state (anchor, offsets, scale,
 * opacity, visibility, lock) and renders them.
 *
 * <p>Position math is pure and unit-testable; only {@link #renderAll} and the
 * element callbacks touch Minecraft classes.</p>
 */
public final class HudManager {
    /** Mutable per-element state, persisted inside the active profile. */
    public static final class ElementState {
        public HudAnchor anchor;
        public int x;
        public int y;
        public float scale;
        public float opacity;
        public boolean visible;
        public boolean locked;

        public ElementState(HudAnchor anchor, int x, int y, float scale, float opacity, boolean visible, boolean locked) {
            this.anchor = anchor;
            this.x = x;
            this.y = y;
            this.scale = clampScale(scale);
            this.opacity = clampOpacity(opacity);
            this.visible = visible;
            this.locked = locked;
        }

        public ElementState copy() {
            return new ElementState(this.anchor, this.x, this.y, this.scale, this.opacity, this.visible, this.locked);
        }

        public static float clampScale(float scale) {
            if (Float.isNaN(scale) || Float.isInfinite(scale)) {
                return 1.0f;
            }
            return Math.max(0.5f, Math.min(3.0f, scale));
        }

        public static float clampOpacity(float opacity) {
            if (Float.isNaN(opacity) || Float.isInfinite(opacity)) {
                return 1.0f;
            }
            return Math.max(0.1f, Math.min(1.0f, opacity));
        }
    }

    /** Resolved layout of one element for a frame (or the editor). */
    public record Layout(String id, int x, int y, int width, int height) {
        public boolean contains(double mouseX, double mouseY) {
            return mouseX >= x && mouseX < x + width && mouseY >= y && mouseY < y + height;
        }
    }

    private final Map<String, HudElement> elements = new LinkedHashMap<>();
    private final Map<String, ElementState> states = new LinkedHashMap<>();

    public void register(HudElement element) {
        this.elements.put(element.elementId(), element);
        this.states.computeIfAbsent(element.elementId(), id -> defaultsFor(element));
    }

    public static ElementState defaultsFor(HudElement element) {
        return new ElementState(element.defaultAnchor(), element.defaultX(), element.defaultY(),
                element.defaultScale(), element.defaultOpacity(), true, element.defaultLocked());
    }

    public HudElement element(String id) {
        return this.elements.get(id);
    }

    public List<HudElement> elements() {
        return new ArrayList<>(this.elements.values());
    }

    public ElementState state(String id) {
        ElementState state = this.states.get(id);
        if (state == null) {
            HudElement element = this.elements.get(id);
            state = element == null
                    ? new ElementState(HudAnchor.TOP_LEFT, 3, 3, 1.0f, 1.0f, true, false)
                    : defaultsFor(element);
            this.states.put(id, state);
        }
        return state;
    }

    public void resetElement(String id) {
        HudElement element = this.elements.get(id);
        if (element != null) {
            this.states.put(id, defaultsFor(element));
        }
    }

    public void resetAll() {
        for (HudElement element : this.elements.values()) {
            this.states.put(element.elementId(), defaultsFor(element));
        }
    }

    /**
     * Lays out one element for the given screen size. Pure math, shared by the
     * renderer and the editor.
     */
    public static Layout layout(String id, ElementState state, int localWidth, int localHeight,
                                int screenWidth, int screenHeight, float masterScale) {
        float total = ElementState.clampScale(state.scale * masterScale);
        int width = Math.max(1, Math.round(localWidth * total));
        int height = Math.max(1, Math.round(localHeight * total));
        int x = state.anchor.resolveX(screenWidth, width, state.x);
        int y = state.anchor.resolveY(screenHeight, height, state.y);
        return new Layout(id, x, y, width, height);
    }

    /**
     * Converts a dragged top-left position into stored anchor offsets, clamped
     * so the element stays fully on screen. Pure math for the editor.
     */
    public static int[] dragToOffsets(ElementState state, int localWidth, int localHeight,
                                      int screenWidth, int screenHeight, float masterScale,
                                      double absoluteX, double absoluteY) {
        float total = ElementState.clampScale(state.scale * masterScale);
        int width = Math.max(1, Math.round(localWidth * total));
        int height = Math.max(1, Math.round(localHeight * total));
        int clampedX = (int) Math.round(Math.max(0, Math.min(Math.max(0, screenWidth - width), absoluteX)));
        int clampedY = (int) Math.round(Math.max(0, Math.min(Math.max(0, screenHeight - height), absoluteY)));
        return new int[]{
                state.anchor.toOffsetX(screenWidth, width, clampedX),
                state.anchor.toOffsetY(screenHeight, height, clampedY)};
    }

    /** Functional check used by the renderer to skip disabled addons. */
    public interface Visibility {
        boolean visible(String elementId);
    }

    /**
     * Renders every visible element. Elements whose addon is disabled are
     * skipped via {@code visibility}.
     */
    public void renderAll(DrawContext context, MinecraftClient client, float masterScale, Visibility visibility) {
        renderAllClipped(context, client, masterScale, context.getScaledWindowHeight(), visibility);
    }

    /**
     * Same as {@link #renderAll} but lays out against {@code screenHeight}
     * instead of the full window, so the HUD editor can reserve its bar.
     */
    public void renderAllClipped(DrawContext context, MinecraftClient client, float masterScale,
                                 int screenHeight, Visibility visibility) {
        int screenWidth = context.getScaledWindowWidth();
        for (HudElement element : this.elements.values()) {
            ElementState state = state(element.elementId());
            if (!state.visible || !visibility.visible(element.elementId())) {
                continue;
            }
            float total = ElementState.clampScale(state.scale * masterScale);
            int localWidth = element.measureWidth(client);
            int localHeight = element.measureHeight(client);
            Layout layout = layout(element.elementId(), state, localWidth, localHeight, screenWidth, screenHeight, masterScale);
            MatrixStack matrices = context.getMatrices();
            matrices.push();
            matrices.translate(layout.x(), layout.y(), 0.0f);
            matrices.scale(total, total, 1.0f);
            try {
                element.render(context, client, ElementState.clampOpacity(state.opacity));
            } finally {
                matrices.pop();
            }
        }
    }

    // ------------------------------------------------------------- persistence

    /** Exports states to the plain maps stored in the profile JSON. */
    public Map<String, Map<String, String>> exportStates() {
        Map<String, Map<String, String>> exported = new LinkedHashMap<>();
        for (Map.Entry<String, ElementState> entry : this.states.entrySet()) {
            ElementState state = entry.getValue();
            Map<String, String> map = new LinkedHashMap<>();
            map.put("anchor", state.anchor.name());
            map.put("x", Integer.toString(state.x));
            map.put("y", Integer.toString(state.y));
            map.put("scale", Float.toString(state.scale));
            map.put("opacity", Float.toString(state.opacity));
            map.put("visible", Boolean.toString(state.visible));
            map.put("locked", Boolean.toString(state.locked));
            exported.put(entry.getKey(), map);
        }
        return exported;
    }

    /** Imports states leniently: unknown ids are kept, corrupt values reset. */
    public void importStates(Map<String, Map<String, String>> imported) {
        if (imported == null) {
            return;
        }
        for (Map.Entry<String, Map<String, String>> entry : imported.entrySet()) {
            HudElement element = this.elements.get(entry.getKey());
            ElementState fallback = element == null
                    ? new ElementState(HudAnchor.TOP_LEFT, 3, 3, 1.0f, 1.0f, true, false)
                    : defaultsFor(element);
            Map<String, String> map = entry.getValue();
            if (map == null) {
                this.states.put(entry.getKey(), fallback);
                continue;
            }
            ElementState state = new ElementState(
                    HudAnchor.parse(map.get("anchor"), fallback.anchor),
                    parseInt(map.get("x"), fallback.x),
                    parseInt(map.get("y"), fallback.y),
                    ElementState.clampScale(parseFloat(map.get("scale"), fallback.scale)),
                    ElementState.clampOpacity(parseFloat(map.get("opacity"), fallback.opacity)),
                    parseBoolean(map.get("visible"), fallback.visible),
                    parseBoolean(map.get("locked"), fallback.locked));
            this.states.put(entry.getKey(), state);
        }
    }

    private static int parseInt(String raw, int fallback) {
        try {
            return raw == null ? fallback : Integer.parseInt(raw.trim());
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private static float parseFloat(String raw, float fallback) {
        try {
            return raw == null ? fallback : Float.parseFloat(raw.trim());
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private static boolean parseBoolean(String raw, boolean fallback) {
        if (raw == null) {
            return fallback;
        }
        String value = raw.trim().toLowerCase(java.util.Locale.ROOT);
        if (value.equals("true") || value.equals("1")) {
            return true;
        }
        if (value.equals("false") || value.equals("0")) {
            return false;
        }
        return fallback;
    }
}
