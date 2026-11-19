package com.klymon.clientmenu.platform;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/**
 * The in-game platform session: tokens live in memory only, are never
 * logged (see {@link #redacted()}) and never touch the disk.
 */
public final class PlatformSession {
    /** Refresh ahead of the 15-minute access TTL (server default). */
    static final long REFRESH_AFTER_MS = 13 * 60 * 1000L;

    private String accessToken;
    private String refreshToken;
    private String username;
    private final long obtainedAtMs;

    public PlatformSession(String accessToken, String refreshToken, String username, long obtainedAtMs) {
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        this.username = username;
        this.obtainedAtMs = obtainedAtMs;
    }

    /**
     * Parses an exchange/refresh response ({@code accessToken},
     * {@code refreshToken}, {@code user.username}); null when unusable.
     * A missing username keeps the previous one (refresh responses).
     */
    public static PlatformSession parse(String json, String keepUsername, long nowMs) {
        try {
            JsonElement root = JsonParser.parseString(json);
            if (root == null || !root.isJsonObject()) {
                return null;
            }
            JsonObject body = root.getAsJsonObject();
            String access = text(body, "accessToken");
            String refresh = text(body, "refreshToken");
            if (access == null || access.isBlank() || refresh == null || refresh.isBlank()) {
                return null;
            }
            String username = keepUsername;
            JsonElement user = body.get("user");
            if (user != null && user.isJsonObject()) {
                String name = text(user.getAsJsonObject(), "username");
                if (name != null && !name.isBlank()) {
                    username = name;
                }
            }
            if (username == null || username.isBlank()) {
                return null;
            }
            return new PlatformSession(access, refresh, username, nowMs);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    public boolean needsRefresh(long nowMs) {
        return nowMs - obtainedAtMs >= REFRESH_AFTER_MS;
    }

    public String accessToken() {
        return accessToken;
    }

    public String refreshToken() {
        return refreshToken;
    }

    public String username() {
        return username;
    }

    /** Log-safe summary: usernames only, never tokens. */
    public String redacted() {
        return "PlatformSession(user=" + username + ")";
    }

    private static String text(JsonObject json, String key) {
        JsonElement element = json.get(key);
        if (element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isString()) {
            return element.getAsString();
        }
        return null;
    }
}
