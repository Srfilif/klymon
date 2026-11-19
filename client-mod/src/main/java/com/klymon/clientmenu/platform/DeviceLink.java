package com.klymon.clientmenu.platform;

import java.io.IOException;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/**
 * Device authorization flow for games launched without the Klymon launcher
 * (§6 third-party path): request a user code, show it for approval on
 * another device, poll until the server issues the limited session.
 *
 * <p>Thread-safe; the blocking calls run on a worker, never on the client
 * thread. Shares the run's {@link PlatformSessionStore} with the handoff
 * flow: whichever links first wins.</p>
 */
public final class DeviceLink {
    public enum State {
        IDLE,
        AWAITING,
        LINKED,
        FAILED
    }

    /**
     * E2E-only autostart switch ({@code -Dklymon.e2e.autolink=true}): lets the
     * scheduled launch suite drive the device flow headlessly. Never set in
     * production; normal third-party launches always start from the Connect
     * screen, and launcher handoffs take precedence.
     */
    static final String AUTOLINK_PROPERTY = "klymon.e2e.autolink";

    public static boolean autostartRequested(boolean linked, boolean handoffPresent) {
        return !linked && !handoffPresent && Boolean.getBoolean(AUTOLINK_PROPERTY);
    }

    private final PlatformHttp http;
    private final PlatformSessionStore sessions;
    private State state = State.IDLE;
    private String apiBase;
    private String deviceCode;
    private String userCode;
    private String verificationUri;
    private long expiresAtMs;
    private long nextPollMs;
    private long intervalMs = 5_000L;

    public DeviceLink(PlatformHttp http, PlatformSessionStore sessions) {
        this.http = http;
        this.sessions = sessions;
    }

    /**
     * Blocking: requests a user code. True when the code is ready to
     * display (state {@code AWAITING}).
     */
    public synchronized boolean start(String apiBaseRaw, String clientName, long nowMs) {
        reset();
        String base = apiBaseRaw == null ? null : PlatformUrls.normalizeBase(apiBaseRaw);
        String url = base == null ? null : PlatformUrls.deviceCodeUrl(base);
        if (url == null || !PlatformUrls.allowed(url)) {
            state = State.FAILED;
            return false;
        }
        PlatformHttp.Result result;
        try {
            String body = clientName == null || clientName.isBlank()
                    ? "{}"
                    : "{\"clientName\":\"" + HandoffExchange.escape(clientName) + "\"}";
            result = http.postJson(url, body, null);
        } catch (IOException failed) {
            state = State.FAILED;
            return false;
        }
        if (result.status() != 200 && result.status() != 201) {
            state = State.FAILED;
            return false;
        }
        if (!adoptCode(result.body(), base, nowMs)) {
            state = State.FAILED;
            return false;
        }
        state = State.AWAITING;
        return true;
    }

    public synchronized boolean pollDue(long nowMs) {
        return state == State.AWAITING && nowMs >= nextPollMs;
    }

    /** Blocking: one token poll. No-op unless awaiting. */
    public synchronized void poll(long nowMs) {
        if (state != State.AWAITING) {
            return;
        }
        if (nowMs >= expiresAtMs) {
            state = State.FAILED;
            return;
        }
        String url = PlatformUrls.deviceTokenUrl(apiBase);
        if (!PlatformUrls.allowed(url)) {
            state = State.FAILED;
            return;
        }
        PlatformHttp.Result result;
        try {
            result = http.postJson(url, "{\"deviceCode\":\"" + HandoffExchange.escape(deviceCode) + "\"}", null);
        } catch (IOException failed) {
            nextPollMs = nowMs + intervalMs;
            return;
        }
        if (result.status() == 202) {
            nextPollMs = nowMs + intervalMs;
            return;
        }
        if (result.status() == 429) {
            nextPollMs = nowMs + intervalMs * 2L;
            return;
        }
        if (result.status() != 200 && result.status() != 201) {
            state = State.FAILED;
            return;
        }
        PlatformSession parsed = PlatformSession.parse(result.body(), null, nowMs);
        if (parsed == null) {
            state = State.FAILED;
            return;
        }
        sessions.set(parsed, apiBase);
        state = State.LINKED;
    }

    public synchronized void cancel() {
        if (state == State.AWAITING || state == State.FAILED) {
            reset();
        }
    }

    public synchronized State state() {
        return state;
    }

    public synchronized String userCode() {
        return userCode;
    }

    public synchronized String verificationUri() {
        return verificationUri;
    }

    private void reset() {
        state = State.IDLE;
        apiBase = null;
        deviceCode = null;
        userCode = null;
        verificationUri = null;
        expiresAtMs = 0L;
        nextPollMs = 0L;
        intervalMs = 5_000L;
    }

    private boolean adoptCode(String json, String base, long nowMs) {
        try {
            JsonElement root = JsonParser.parseString(json);
            if (root == null || !root.isJsonObject()) {
                return false;
            }
            JsonObject body = root.getAsJsonObject();
            String device = text(body, "deviceCode");
            String user = text(body, "userCode");
            String uri = text(body, "verificationUri");
            if (device == null || device.isBlank() || user == null || user.isBlank() || uri == null || uri.isBlank()) {
                return false;
            }
            long expiresIn = number(body, "expiresIn", 600L);
            long interval = number(body, "interval", 5L);
            this.apiBase = base;
            this.deviceCode = device;
            this.userCode = user;
            this.verificationUri = uri;
            this.expiresAtMs = nowMs + Math.clamp(expiresIn, 30L, 3_600L) * 1_000L;
            this.intervalMs = Math.clamp(interval, 1L, 60L) * 1_000L;
            this.nextPollMs = nowMs + this.intervalMs;
            return true;
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static String text(JsonObject json, String key) {
        JsonElement element = json.get(key);
        if (element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isString()) {
            return element.getAsString();
        }
        return null;
    }

    private static long number(JsonObject json, String key, long fallback) {
        try {
            JsonElement element = json.get(key);
            if (element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isNumber()) {
                return element.getAsLong();
            }
        } catch (RuntimeException ignored) {
            // Fall through to the default.
        }
        return fallback;
    }
}
