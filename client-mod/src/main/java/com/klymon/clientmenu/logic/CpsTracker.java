package com.klymon.clientmenu.logic;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Windowed click counter shared by the CPS addon. Pure logic without Minecraft
 * dependencies so the headless tests exercise the real code.
 */
public final class CpsTracker {
    private final Deque<Long> clicks = new ArrayDeque<>();
    private int max;

    /** Records a click press at {@code nowMs} (see {@code Util.getMeasuringTimeMs}). */
    public void record(long nowMs) {
        this.clicks.addLast(nowMs);
        prune(nowMs, windowMs());
        int current = count(nowMs, windowMs());
        if (current > this.max) {
            this.max = current;
        }
    }

    private long windowMs = 1000L;

    public void setWindowMs(long windowMs) {
        this.windowMs = Math.max(250L, Math.min(5000L, windowMs));
    }

    public long windowMs() {
        return this.windowMs;
    }

    /** Clicks inside the trailing window ending at {@code nowMs}. */
    public int count(long nowMs, long windowMs) {
        prune(nowMs, windowMs);
        int total = 0;
        for (long click : this.clicks) {
            if (nowMs - click <= windowMs) {
                total++;
            }
        }
        return total;
    }

    public int count(long nowMs) {
        return count(nowMs, this.windowMs);
    }

    /** Highest per-window count seen since the last reset. */
    public int max() {
        return this.max;
    }

    public void resetMax() {
        this.max = count(lastNow(), this.windowMs);
    }

    public void clear() {
        this.clicks.clear();
        this.max = 0;
    }

    private long lastNow() {
        Long last = this.clicks.peekLast();
        return last == null ? 0L : last;
    }

    private void prune(long nowMs, long windowMs) {
        while (!this.clicks.isEmpty() && nowMs - this.clicks.peekFirst() > windowMs) {
            this.clicks.removeFirst();
        }
    }
}
