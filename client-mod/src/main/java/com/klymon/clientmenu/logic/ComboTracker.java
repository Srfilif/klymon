package com.klymon.clientmenu.logic;

/**
 * Consecutive-hit counter for the combo addon. A hit extends the combo, any
 * gap longer than the reset window drops it back to zero. Pure logic shared
 * with the headless tests.
 */
public final class ComboTracker {
    private int hits;
    private long lastHitMs = -1L;
    private int best;
    private final HurtEdge hurtEdge = new HurtEdge();

    public void recordHit(long nowMs) {
        this.hits++;
        this.lastHitMs = nowMs;
        if (this.hits > this.best) {
            this.best = this.hits;
        }
    }

    /** Current combo, resetting first when the window expired. */
    public int combo(long nowMs, long resetMs) {
        if (this.lastHitMs < 0 || nowMs - this.lastHitMs > resetMs) {
            this.hits = 0;
        }
        return this.hits;
    }

    /** Milliseconds since the last hit, or -1 when no hit was recorded yet. */
    public long ageMs(long nowMs) {
        return this.lastHitMs < 0 ? -1L : nowMs - this.lastHitMs;
    }

    /** Best combo since the last reset. */
    public int best() {
        return this.best;
    }

    /** Drops the running combo (an interruption) without touching the best. */
    public void breakCombo() {
        this.hits = 0;
        this.lastHitMs = -1L;
    }

    /**
     * Feeds the player's {@code hurtTime}. Any rise means fresh damage and
     * breaks the combo — unlike sampling the exact peak frame, a rise cannot
     * be missed between ticks. Returns true when the combo broke.
     */
    public boolean noteHurtTime(int hurtTime) {
        boolean rose = this.hurtEdge.rose(hurtTime);
        if (rose) {
            breakCombo();
        }
        return rose;
    }

    public void reset() {
        this.hits = 0;
        this.lastHitMs = -1L;
        this.best = 0;
        this.hurtEdge.reset();
    }
}
