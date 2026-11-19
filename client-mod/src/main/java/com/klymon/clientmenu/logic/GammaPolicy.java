package com.klymon.clientmenu.logic;

/**
 * Decides which gamma value fullbright must restore on disable.
 *
 * <p>The game persists {@code options.txt} while fullbright holds gamma at
 * {@link #FULLBRIGHT}, so after a restart the live value can be our own
 * residue instead of the player's real setting. A captured value that equals
 * {@link #FULLBRIGHT} is therefore treated as residue and replaced by the
 * persisted value (or the vanilla default when that is implausible too).</p>
 */
public final class GammaPolicy {
    /** Gamma while fullbright is active. Never a legitimate restore target. */
    public static final double FULLBRIGHT = 10.0;
    /** Vanilla default, used when no plausible previous value exists. */
    public static final double VANILLA_DEFAULT = 1.0;

    private GammaPolicy() {
    }

    /**
     * Resolves the value to restore later: the captured live value, unless it
     * is fullbright residue — then the persisted value, unless that is
     * implausible too — then {@link #VANILLA_DEFAULT}.
     */
    public static double resolvePrevious(double captured, double persisted) {
        if (captured != FULLBRIGHT) {
            return captured;
        }
        return isPlausible(persisted) ? persisted : VANILLA_DEFAULT;
    }

    /** A previous value is restorable when it is finite, non-negative and not our own residue. */
    public static boolean isPlausible(double value) {
        return Double.isFinite(value) && value >= 0.0 && value != FULLBRIGHT;
    }
}
