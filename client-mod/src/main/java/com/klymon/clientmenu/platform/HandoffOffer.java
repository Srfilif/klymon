package com.klymon.clientmenu.platform;

import java.time.Instant;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

/**
 * A launcher-issued login handoff read from {@code klymon-bridge.json}.
 *
 * <p>Lenient by design: anything malformed (missing keys, wrong types,
 * unparseable timestamp) yields no offer instead of breaking the game.
 * Unknown timestamps fail closed — treated as expired.</p>
 */
public record HandoffOffer(String code, String apiUrl, String expiresAt, long expiresAtMs) {
    public static HandoffOffer parse(JsonObject bridge) {
        if (bridge == null) {
            return null;
        }
        JsonElement offer = bridge.get("handoff");
        if (offer == null || !offer.isJsonObject()) {
            return null;
        }
        JsonObject json = offer.getAsJsonObject();
        String code = text(json, "code");
        String apiUrl = text(json, "apiUrl");
        if (code == null || code.isBlank() || apiUrl == null || apiUrl.isBlank()) {
            return null;
        }
        String expiresAt = text(json, "expiresAt");
        long expiresAtMs = -1L;
        if (expiresAt != null) {
            try {
                expiresAtMs = Instant.parse(expiresAt.trim()).toEpochMilli();
            } catch (RuntimeException ignored) {
                expiresAtMs = -1L;
            }
        }
        return new HandoffOffer(code, apiUrl, expiresAt, expiresAtMs);
    }

    public boolean expired(long nowMs) {
        return expiresAtMs < 0L || nowMs >= expiresAtMs;
    }

    private static String text(JsonObject json, String key) {
        JsonElement element = json.get(key);
        if (element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isString()) {
            return element.getAsString();
        }
        return null;
    }
}
