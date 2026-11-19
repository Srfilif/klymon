package com.klymon.clientmenu.platform;

import java.io.IOException;

/**
 * The game run's single platform session, shared by the launcher-handoff
 * and device-code flows: whichever links first wins, and refresh keeps
 * whichever session is held alive.
 */
public final class PlatformSessionStore {
    private PlatformSession session;
    private String apiBase;

    public synchronized void set(PlatformSession session, String apiBase) {
        this.session = session;
        this.apiBase = apiBase;
    }

    public synchronized boolean linked() {
        return session != null;
    }

    public synchronized String username() {
        return session == null ? null : session.username();
    }

    /**
     * Refreshes ahead of expiry. True while the session stays usable;
     * a rejected refresh unlinks.
     */
    public synchronized boolean refreshIfNeeded(PlatformHttp http, long nowMs) {
        if (session == null || apiBase == null || !session.needsRefresh(nowMs)) {
            return true;
        }
        String url = PlatformUrls.refreshUrl(apiBase);
        if (!PlatformUrls.allowed(url)) {
            return true;
        }
        PlatformHttp.Result result;
        try {
            result = http.postJson(url, "{\"refreshToken\":\"" + HandoffExchange.escape(session.refreshToken()) + "\"}", null);
        } catch (IOException failed) {
            return true;
        }
        if (result.status() != 200 && result.status() != 201) {
            if (result.status() == 401) {
                session = null;
                return false;
            }
            return true;
        }
        PlatformSession rotated = PlatformSession.parse(result.body(), session.username(), nowMs);
        if (rotated != null) {
            session = rotated;
        }
        return true;
    }
}
