package com.klymon.clientmenu.platform;

import java.io.IOException;

/**
 * Links the game to the platform account: exchanges the launcher's bridge
 * handoff for a limited client session, then keeps it refreshed.
 *
 * <p>Thread-safe; the blocking calls run on {@link PlatformLink}'s worker,
 * never on the client thread. One code is exchanged at most once per run;
 * transient failures back off, rejections consume the code.</p>
 */
public final class HandoffExchange {
    public enum Outcome {
        LINKED,
        FAILED_TRANSIENT,
        FAILED_REJECTED
    }

    public static final long RETRY_COOLDOWN_MS = 30_000L;

    private final PlatformHttp http;
    private final PlatformSessionStore sessions;
    private String consumedCode;
    private long cooldownUntilMs;

    public HandoffExchange(PlatformHttp http, PlatformSessionStore sessions) {
        this.http = http;
        this.sessions = sessions;
    }

    public synchronized boolean shouldExchange(HandoffOffer offer, long nowMs) {
        if (sessions.linked() || offer == null || offer.expired(nowMs)) {
            return false;
        }
        if (consumedCode != null && offer.code().equals(consumedCode)) {
            return false;
        }
        return nowMs >= cooldownUntilMs;
    }

    /** Blocking network call. Returns the linked username on success, null otherwise. */
    public synchronized Outcome exchange(HandoffOffer offer, long nowMs) {
        String base = offer == null ? null : PlatformUrls.normalizeBase(offer.apiUrl());
        String url = base == null ? null : PlatformUrls.exchangeUrl(base);
        if (url == null || !PlatformUrls.allowed(url)) {
            cooldownUntilMs = nowMs + RETRY_COOLDOWN_MS;
            return Outcome.FAILED_REJECTED;
        }
        PlatformHttp.Result result;
        try {
            result = http.postJson(url, "{\"code\":\"" + escape(offer.code()) + "\"}", null);
        } catch (IOException failed) {
            cooldownUntilMs = nowMs + RETRY_COOLDOWN_MS;
            return Outcome.FAILED_TRANSIENT;
        }
        if (result.status() != 200 && result.status() != 201) {
            if (result.status() == 401 || result.status() == 400) {
                consumedCode = offer.code();
                return Outcome.FAILED_REJECTED;
            }
            cooldownUntilMs = nowMs + RETRY_COOLDOWN_MS;
            return Outcome.FAILED_TRANSIENT;
        }
        PlatformSession parsed = PlatformSession.parse(result.body(), null, nowMs);
        if (parsed == null) {
            consumedCode = offer.code();
            return Outcome.FAILED_REJECTED;
        }
        sessions.set(parsed, base);
        consumedCode = offer.code();
        return Outcome.LINKED;
    }

    /**
     * Blocking refresh when the access token ages out. True while the session
     * stays usable; false after the server rejects the refresh (unlinked).
     */
    public boolean refreshIfNeeded(long nowMs) {
        return sessions.refreshIfNeeded(http, nowMs);
    }

    public boolean linked() {
        return sessions.linked();
    }

    public String username() {
        return sessions.username();
    }

    public static String escape(String raw) {
        StringBuilder out = new StringBuilder(raw.length() + 2);
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            switch (c) {
                case '"':
                    out.append("\\\"");
                    break;
                case '\\':
                    out.append("\\\\");
                    break;
                case '\n':
                    out.append("\\n");
                    break;
                case '\r':
                    out.append("\\r");
                    break;
                case '\t':
                    out.append("\\t");
                    break;
                default:
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                    break;
            }
        }
        return out.toString();
    }
}
