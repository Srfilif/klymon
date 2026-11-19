package com.klymon.clientmenu.thirdparty.api;

/**
 * Third-party HUD capability. The addon fills {@code canvas} with draw
 * commands every frame; the platform flushes them to the screen. Rendering
 * code must be fast and side-effect free apart from canvas writes — any
 * exception disables the addon for the rest of the session.
 */
public interface HudAddon {
    void render(HudCanvas canvas, TickState state);
}
