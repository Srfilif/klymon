package com.klymon.clientmenu.logic;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.BiConsumer;

/**
 * Smallest honest LRU: an access-ordered map capped at {@code maxSize},
 * eldest-first, with an eviction hook so owners can release what the value
 * holds (GPU textures). Not synchronized — owners confine it to one thread
 * or synchronize externally.
 */
public final class BoundedCache<K, V> extends LinkedHashMap<K, V> {
    private final int maxSize;
    private final BiConsumer<K, V> onEvict;

    public BoundedCache(int maxSize, BiConsumer<K, V> onEvict) {
        super(16, 0.75f, true);
        if (maxSize <= 0) {
            throw new IllegalArgumentException("maxSize must be positive");
        }
        this.maxSize = maxSize;
        this.onEvict = onEvict;
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        if (size() <= this.maxSize) {
            return false;
        }
        if (this.onEvict != null) {
            this.onEvict.accept(eldest.getKey(), eldest.getValue());
        }
        return true;
    }
}
