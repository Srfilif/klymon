package com.klymon.clientmenu.addon;

/**
 * The categories shown as tabs in the addons screen. Every addon belongs to
 * exactly one category.
 */
public enum AddonCategory {
    PVP("klymon.category.pvp"),
    PERFORMANCE("klymon.category.performance"),
    HUD("klymon.category.hud"),
    VISUAL("klymon.category.visual"),
    UTILITY("klymon.category.utility");

    private final String labelKey;

    AddonCategory(String labelKey) {
        this.labelKey = labelKey;
    }

    public String labelKey() {
        return this.labelKey;
    }
}
