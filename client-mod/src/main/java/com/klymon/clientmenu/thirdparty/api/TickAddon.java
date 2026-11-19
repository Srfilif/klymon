package com.klymon.clientmenu.thirdparty.api;

/**
 * Third-party per-tick capability. Called once per client tick with an
 * immutable snapshot; the addon keeps its own state in instance fields.
 * Any exception disables the addon for the rest of the session.
 */
public interface TickAddon {
    void tick(TickState state);
}
