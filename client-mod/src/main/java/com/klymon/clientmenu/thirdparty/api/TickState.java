package com.klymon.clientmenu.thirdparty.api;

/**
 * Immutable per-tick snapshot handed to third-party addons. Primitives and
 * Strings only: no game object ever crosses the sandbox boundary, so a
 * third-party addon cannot reach the client, the world, or the network
 * through this state.
 *
 * @param tick monotonically increasing client-tick counter for this session
 * @param fps current frames per second, as reported by the vanilla debug value
 * @param playerName local player name, or {@code null} before a world is joined
 * @param inWorld whether a world (single- or multiplayer) is currently loaded
 */
public record TickState(long tick, int fps, String playerName, boolean inWorld) {
    public TickState {
        if (tick < 0) {
            throw new IllegalArgumentException("tick must be >= 0");
        }
        if (fps < 0) {
            throw new IllegalArgumentException("fps must be >= 0");
        }
    }
}
