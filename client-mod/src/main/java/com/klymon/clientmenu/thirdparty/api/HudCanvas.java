package com.klymon.clientmenu.thirdparty.api;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Draw-command buffer a third-party HUD addon fills during
 * {@link HudAddon#render}. The platform flushes the recorded commands to the
 * real draw context afterwards; addons never touch rendering classes
 * directly, so a buggy addon can at worst waste its own per-frame budget.
 *
 * <p>Not thread-safe: one canvas is created, filled, and flushed on the
 * render thread for every frame.
 */
public final class HudCanvas {
    /** Drawn text: screen position, content, and packed ARGB color. */
    public record Text(int x, int y, String text, int color) {
    }

    /** Filled rectangle: screen position, size, and packed ARGB color. */
    public record Rect(int x, int y, int width, int height, int color) {
    }

    /** Default per-frame command budget before further commands are dropped. */
    public static final int DEFAULT_MAX_OPS = 64;

    /** Longest single text command; longer text is truncated. */
    public static final int MAX_TEXT_LENGTH = 256;

    private final List<Text> texts = new ArrayList<>();
    private final List<Rect> rects = new ArrayList<>();
    private final int maxOps;
    private int dropped;

    public HudCanvas() {
        this(DEFAULT_MAX_OPS);
    }

    public HudCanvas(int maxOps) {
        if (maxOps <= 0) {
            throw new IllegalArgumentException("maxOps must be > 0");
        }
        this.maxOps = maxOps;
    }

    /** Queues a text command. Null text fails fast; over-budget commands drop. */
    public void text(String text, int x, int y, int color) {
        Objects.requireNonNull(text, "text");
        if (size() >= maxOps) {
            dropped++;
            return;
        }
        String clipped = text.length() > MAX_TEXT_LENGTH ? text.substring(0, MAX_TEXT_LENGTH) : text;
        texts.add(new Text(x, y, clipped, color));
    }

    /** Queues a rectangle command. Degenerate or over-budget rects drop. */
    public void rect(int x, int y, int width, int height, int color) {
        if (width <= 0 || height <= 0) {
            dropped++;
            return;
        }
        if (size() >= maxOps) {
            dropped++;
            return;
        }
        rects.add(new Rect(x, y, width, height, color));
    }

    public List<Text> texts() {
        return List.copyOf(texts);
    }

    public List<Rect> rects() {
        return List.copyOf(rects);
    }

    /** How many commands were dropped on this canvas so far. */
    public int dropped() {
        return dropped;
    }

    /** Clears every recorded command and resets the drop counter. */
    public void clear() {
        texts.clear();
        rects.clear();
        dropped = 0;
    }

    private int size() {
        return texts.size() + rects.size();
    }
}
