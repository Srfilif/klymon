package com.klymon.clientmenu.hud;

import java.util.Locale;

/**
 * Screen anchors for HUD elements. Positions are stored as pixel offsets from
 * the anchor so layouts survive resolution and GUI-scale changes.
 */
public enum HudAnchor {
    TOP_LEFT,
    TOP_RIGHT,
    BOTTOM_LEFT,
    BOTTOM_RIGHT,
    CENTER;

    public String labelKey() {
        return "klymon.anchor." + name().toLowerCase(Locale.ROOT);
    }

    public boolean right() {
        return this == TOP_RIGHT || this == BOTTOM_RIGHT;
    }

    public boolean bottom() {
        return this == BOTTOM_LEFT || this == BOTTOM_RIGHT;
    }

    public boolean center() {
        return this == CENTER;
    }

    /** Resolves the element's top-left X from its stored offset. */
    public int resolveX(int screenWidth, int elementWidth, int offsetX) {
        if (center()) {
            return (screenWidth - elementWidth) / 2 + offsetX;
        }
        return right() ? screenWidth - elementWidth - offsetX : offsetX;
    }

    /** Resolves the element's top-left Y from its stored offset. */
    public int resolveY(int screenHeight, int elementHeight, int offsetY) {
        if (center()) {
            return (screenHeight - elementHeight) / 2 + offsetY;
        }
        return bottom() ? screenHeight - elementHeight - offsetY : offsetY;
    }

    /**
     * Converts an absolute top-left position back to a stored offset, used by
     * the HUD editor while dragging.
     */
    public int toOffsetX(int screenWidth, int elementWidth, int absoluteX) {
        if (center()) {
            return absoluteX - (screenWidth - elementWidth) / 2;
        }
        return right() ? screenWidth - elementWidth - absoluteX : absoluteX;
    }

    public int toOffsetY(int screenHeight, int elementHeight, int absoluteY) {
        if (center()) {
            return absoluteY - (screenHeight - elementHeight) / 2;
        }
        return bottom() ? screenHeight - elementHeight - absoluteY : absoluteY;
    }

    public static HudAnchor parse(String raw, HudAnchor fallback) {
        if (raw == null) {
            return fallback;
        }
        try {
            return valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ignored) {
            return fallback;
        }
    }
}
