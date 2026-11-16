package com.klymon.clientmenu.hud;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;

/**
 * A draggable HUD element. Implementations draw in local coordinates (origin at
 * the element's top-left); {@link HudManager} owns the transform (anchor,
 * scale, opacity) and hit-testing, so the editor and the in-game renderer
 * share one code path.
 */
public interface HudElement {
    /** Stable id, shared with the owning addon. */
    String elementId();

    HudAnchor defaultAnchor();

    int defaultX();

    int defaultY();

    default float defaultScale() {
        return 1.0f;
    }

    default float defaultOpacity() {
        return 1.0f;
    }

    /** Locked elements cannot be dragged (e.g. the crosshair must stay centered). */
    default boolean defaultLocked() {
        return false;
    }

    /** Unscaled local width, used for layout and editor hit-testing. */
    int measureWidth(MinecraftClient client);

    /** Unscaled local height, used for layout and editor hit-testing. */
    int measureHeight(MinecraftClient client);

    /**
     * Draws the element at the current matrix origin in local coordinates.
     *
     * @param opacity the resolved 0..1 opacity (element setting × master fade)
     */
    void render(DrawContext context, MinecraftClient client, float opacity);
}
