package com.klymon.clientmenu.logic;

/**
 * Accumulates in-world playtime from consecutive tick timestamps. Only ticks
 * flagged as in-world advance the counter, so menus, loading screens and the
 * title idle time never count as playtime.
 *
 * <p>Minecraft-free on purpose: covered headlessly by {@code LogicTest}.</p>
 */
public final class SessionAccumulator {
    private long lastMs = -1L;
    private double seconds;

    /** Feeds one tick; {@code inWorld} must reflect world + player presence. */
    public void tick(long nowMs, boolean inWorld) {
        if (this.lastMs < 0L) {
            this.lastMs = nowMs;
            return;
        }
        long deltaMs = Math.max(0L, nowMs - this.lastMs);
        this.lastMs = nowMs;
        if (inWorld) {
            this.seconds += deltaMs / 1000.0;
        }
    }

    public long totalSeconds() {
        return (long) this.seconds;
    }

    public void reset() {
        this.lastMs = -1L;
        this.seconds = 0.0;
    }

    /** Minimal JSON payload, hand-built to keep this class dependency-free. */
    public static String heartbeatJson(String runId, long nowMs, long totalSeconds) {
        String safeRunId = runId == null ? "" : runId.replace("\\", "\\\\").replace("\"", "\\\"");
        if (safeRunId.length() > 64) {
            safeRunId = safeRunId.substring(0, 64);
        }
        return "{\"version\":1,\"runId\":\"" + safeRunId + "\",\"updatedAtMs\":" + nowMs
                + ",\"totalInWorldSeconds\":" + Math.max(0L, totalSeconds) + "}";
    }
}
