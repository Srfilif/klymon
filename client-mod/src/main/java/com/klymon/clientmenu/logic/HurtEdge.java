package com.klymon.clientmenu.logic;

/**
 * Rising-edge detector for {@code hurtTime} (player or entity). Any rise means
 * fresh damage — unlike sampling the exact peak frame, a rise cannot be missed
 * between ticks. Shared by the combo counter and the hit indicators.
 */
public final class HurtEdge {
    private int last;

    /**
     * Feeds the current {@code hurtTime}. Returns true exactly when it rose
     * since the previous sample (fresh damage).
     */
    public boolean rose(int hurtTime) {
        boolean rose = hurtTime > this.last;
        this.last = hurtTime;
        return rose;
    }

    /** Silently adopts a baseline (target switches) without reporting an edge. */
    public void observe(int hurtTime) {
        this.last = hurtTime;
    }

    /** Forgets the baseline (disable, world change). */
    public void reset() {
        this.last = 0;
    }
}
