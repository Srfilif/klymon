package com.klymon.clientmenu.logic;

/**
 * Level curve shared with the launcher ({@code @klymon/progression} economy):
 * cumulative lifetime points needed to <em>reach</em> a level, plus the
 * inverse mapping and the in-level progress fraction.
 *
 * <p>Minecraft-free on purpose: covered headlessly by {@code LogicTest}.</p>
 */
public final class LevelCurve {
    private LevelCurve() {
    }

    /** 50 * L * (L-1): L2=100, L5=1000, L10=4500, L20=19000. */
    public static long cumulativePointsForLevel(int level) {
        int safe = Math.max(1, level);
        if (safe <= 1) {
            return 0L;
        }
        return 50L * safe * (safe - 1);
    }

    /** Inverts the curve: {@code L = (1 + sqrt(1 + total/12.5)) / 2}. */
    public static int levelForPoints(long lifetimePoints) {
        long total = Math.max(0L, lifetimePoints);
        int level = (int) ((1.0 + Math.sqrt(1.0 + total / 12.5)) / 2.0);
        return Math.max(1, Math.min(level, 999));
    }

    /** 0..1 progress from the current level towards the next one. */
    public static float progressFraction(long lifetimePoints) {
        long total = Math.max(0L, lifetimePoints);
        int level = levelForPoints(total);
        long floor = cumulativePointsForLevel(level);
        long ceiling = cumulativePointsForLevel(level + 1);
        long span = Math.max(1L, ceiling - floor);
        return Math.min(1.0f, (float) (total - floor) / (float) span);
    }
}
