package com.klymon.clientmenu.addon;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * A single typed, validated, serializable addon option.
 *
 * <p>Settings have no Minecraft dependencies: they are plain data with
 * validation, so the config screen, the JSON persistence and the headless
 * logic tests all share the same code path.</p>
 *
 * @param <T> the value type ({@link Boolean}, {@link Integer},
 *            {@link Double}, {@link String} for enums, {@link Integer} ARGB for colors)
 */
public final class Setting<T> {
    public enum Type {
        BOOLEAN,
        INT,
        DOUBLE,
        ENUM,
        COLOR,
        STRING
    }

    private final String key;
    private final String addonId;
    private final Type type;
    private final T defaultValue;
    private T value;
    private final double min;
    private final double max;
    private final double step;
    private final List<String> options;
    private final int[] palette;

    private Setting(String addonId, String key, Type type, T defaultValue,
                    double min, double max, double step, List<String> options, int[] palette) {
        this.addonId = addonId;
        this.key = key;
        this.type = type;
        this.defaultValue = defaultValue;
        this.value = defaultValue;
        this.min = min;
        this.max = max;
        this.step = step;
        this.options = options == null ? List.of() : List.copyOf(options);
        this.palette = palette == null ? new int[0] : palette.clone();
    }

    public static Setting<Boolean> bool(String addonId, String key, boolean fallback) {
        return new Setting<>(addonId, key, Type.BOOLEAN, fallback, 0, 0, 0, null, null);
    }

    public static Setting<Integer> integer(String addonId, String key, int fallback, int min, int max, int step) {
        return new Setting<>(addonId, key, Type.INT, fallback, min, max, Math.max(1, step), null, null);
    }

    public static Setting<Double> decimal(String addonId, String key, double fallback, double min, double max, double step) {
        return new Setting<>(addonId, key, Type.DOUBLE, fallback, min, max, step, null, null);
    }

    public static Setting<String> enumeration(String addonId, String key, String fallback, String... options) {
        List<String> list = new ArrayList<>();
        Collections.addAll(list, options);
        if (!list.contains(fallback)) {
            list.add(0, fallback);
        }
        return new Setting<>(addonId, key, Type.ENUM, fallback, 0, 0, 0, list, null);
    }

    /** ARGB color with a preset palette used by the config screen cycling. */
    public static Setting<Integer> color(String addonId, String key, int fallback, int... palette) {
        return new Setting<>(addonId, key, Type.COLOR, fallback, 0, 0, 0, null, palette);
    }

    /** Free text (used for lists such as hidden effects). Never null. */
    public static Setting<String> text(String addonId, String key, String fallback) {
        return new Setting<>(addonId, key, Type.STRING, fallback == null ? "" : fallback, 0, 0, 0, null, null);
    }

    public String key() {
        return this.key;
    }

    public Type type() {
        return this.type;
    }

    public T get() {
        return this.value;
    }

    public T defaultValue() {
        return this.defaultValue;
    }

    public List<String> options() {
        return this.options;
    }

    public double min() {
        return this.min;
    }

    public double max() {
        return this.max;
    }

    public double step() {
        return this.step;
    }

    /** Translation key for the setting label: {@code klymon.setting.<addon>.<key>}. */
    public String labelKey() {
        return "klymon.setting." + this.addonId + "." + this.key;
    }

    /** Translation key for an enum option, resolved by the UI with a raw fallback. */
    public String optionKey(String option) {
        return "klymon.setting." + this.addonId + "." + this.key + "." + option;
    }

    public void set(T value) {
        if (value == null) {
            this.value = this.defaultValue;
            return;
        }
        this.value = validated(value);
    }

    public void reset() {
        this.value = this.defaultValue;
    }

    /** Re-validates the current value (used after profile import). */
    public void validate() {
        set(this.value);
    }

    @SuppressWarnings("unchecked")
    private T validated(T value) {
        return switch (this.type) {
            case BOOLEAN -> value;
            case INT -> (T) Integer.valueOf(clampInt(((Number) value).intValue()));
            case DOUBLE -> (T) Double.valueOf(clampDouble(((Number) value).doubleValue()));
            case ENUM -> (T) validatedOption(String.valueOf(value));
            case COLOR -> (T) Integer.valueOf(((Number) value).intValue());
            case STRING -> (T) String.valueOf(value);
        };
    }

    private int clampInt(int value) {
        return Math.max((int) this.min, Math.min((int) this.max, value));
    }

    private double clampDouble(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            return ((Number) this.defaultValue).doubleValue();
        }
        return Math.max(this.min, Math.min(this.max, value));
    }

    private String validatedOption(String value) {
        return this.options.contains(value) ? value : String.valueOf(this.defaultValue);
    }

    /**
     * Moves the value one step: booleans toggle, numbers step, enums and colors
     * cycle through their lists. Powers the generic config screen buttons.
     */
    public void cycle(int direction) {
        switch (this.type) {
            case BOOLEAN -> setBoolean(!getBoolean());
            case INT -> setInt(getInt() + (int) this.step * direction);
            case DOUBLE -> {
                double next = Math.round((getDouble() + this.step * direction) * 1000.0) / 1000.0;
                setDouble(next);
            }
            case ENUM -> {
                int index = this.options.indexOf(String.valueOf(this.value));
                int next = Math.floorMod(index + direction, this.options.size());
                setEnum(this.options.get(next));
            }
            case COLOR -> {
                if (this.palette.length == 0) {
                    break;
                }
                int index = 0;
                for (int i = 0; i < this.palette.length; i++) {
                    if (this.palette[i] == getInt()) {
                        index = i;
                        break;
                    }
                }
                setInt(this.palette[Math.floorMod(index + direction, this.palette.length)]);
            }
            case STRING -> {
                // Free text is edited through a text field, not by cycling.
            }
        }
    }

    public boolean getBoolean() {
        return (Boolean) this.value;
    }

    public void setBoolean(boolean value) {
        set(cast(value));
    }

    public int getInt() {
        return ((Number) this.value).intValue();
    }

    public void setInt(int value) {
        set(cast(value));
    }

    public double getDouble() {
        return ((Number) this.value).doubleValue();
    }

    public void setDouble(double value) {
        set(cast(value));
    }

    public String getEnum() {
        return String.valueOf(this.value);
    }

    public void setEnum(String value) {
        set(cast(value));
    }

    public String getString() {
        return String.valueOf(this.value);
    }

    public void setString(String value) {
        set(cast(value == null ? "" : value));
    }

    @SuppressWarnings("unchecked")
    private T cast(Object value) {
        return (T) value;
    }

    /** Serializes to the string stored in the profile JSON. Never returns null. */
    public String serialize() {
        return switch (this.type) {
            case BOOLEAN -> Boolean.toString(getBoolean());
            case INT -> Integer.toString(getInt());
            case DOUBLE -> Double.toString(getDouble());
            case ENUM -> getEnum();
            case COLOR -> String.format(Locale.ROOT, "#%08X", getInt());
            case STRING -> getString();
        };
    }

    /** Lenient parse: invalid input restores the default instead of failing. */
    public void deserialize(String raw) {
        if (raw == null) {
            reset();
            return;
        }
        try {
            switch (this.type) {
                case BOOLEAN -> setBoolean(parseBoolean(raw));
                case INT -> setInt(Integer.parseInt(raw.trim()));
                case DOUBLE -> setDouble(Double.parseDouble(raw.trim()));
                case ENUM -> setEnum(validatedOption(raw.trim()));
                case COLOR -> setInt(parseColor(raw));
                case STRING -> setString(raw);
            }
        } catch (RuntimeException ignored) {
            reset();
        }
        validate();
    }

    private static boolean parseBoolean(String raw) {
        String value = raw.trim().toLowerCase(Locale.ROOT);
        return value.equals("true") || value.equals("1") || value.equals("yes") || value.equals("on");
    }

    /** Accepts {@code #AARRGGBB}, {@code #RRGGBB} and plain integers. */
    public static int parseColor(String raw) {
        String value = raw.trim();
        if (value.startsWith("#")) {
            long parsed = Long.parseLong(value.substring(1), 16);
            if (value.length() == 7) {
                parsed |= 0xFF000000L;
            }
            return (int) parsed;
        }
        if (value.startsWith("0x") || value.startsWith("0X")) {
            return (int) Long.parseLong(value.substring(2), 16);
        }
        return Integer.parseInt(value);
    }

    /** Short human-readable value for config buttons (the UI adds the label). */
    public String displayValue() {
        return switch (this.type) {
            case BOOLEAN -> getBoolean() ? "On" : "Off";
            case INT -> Integer.toString(getInt());
            case DOUBLE -> {
                double v = getDouble();
                yield v == Math.rint(v) ? Long.toString(Math.round(v)) : Double.toString(v);
            }
            case ENUM -> getEnum();
            case COLOR -> String.format(Locale.ROOT, "#%06X", getInt() & 0xFFFFFF);
            case STRING -> {
                String text = getString();
                yield text.length() > 18 ? text.substring(0, 17) + "…" : text;
            }
        };
    }
}
