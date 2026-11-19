package com.klymon.clientmenu.platform;

import java.net.URI;
import java.util.Locale;

/**
 * URL policy for platform calls (R4.1 allowlist, ADR-025).
 *
 * <ul>
 *   <li>Only the auth endpoints below are ever requested, built here from
 *   the launcher- or user-provided API base.</li>
 *   <li>HTTPS is required, except loopback HTTP for local development
 *   (the launcher defaults to {@code http://localhost:3001}). A hand-edited
 *   bridge pointing at {@code http://evil} is rejected, so a handoff code
 *   can never leak over cleartext to a non-local host.</li>
 * </ul>
 */
public final class PlatformUrls {
    public static final String EXCHANGE_PATH = "/v1/auth/handoff/exchange";
    public static final String REFRESH_PATH = "/v1/auth/refresh";
    public static final String DEVICE_CODE_PATH = "/v1/auth/device/code";
    public static final String DEVICE_TOKEN_PATH = "/v1/auth/device/token";

    private PlatformUrls() {
    }

    /** Normalizes a bridge-provided API base, or null when it is unusable. */
    public static String normalizeBase(String raw) {
        if (raw == null) {
            return null;
        }
        String trimmed = raw.trim();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        if (trimmed.isEmpty()) {
            return null;
        }
        URI uri;
        try {
            uri = new URI(trimmed);
        } catch (Exception ignored) {
            return null;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http")) {
            return null;
        }
        String host = uri.getHost();
        if (host == null || host.isEmpty() || uri.getUserInfo() != null) {
            return null;
        }
        int port = uri.getPort();
        return scheme + "://" + host.toLowerCase(Locale.ROOT) + (port == -1 ? "" : ":" + port);
    }

    public static String exchangeUrl(String apiBase) {
        return apiBase + EXCHANGE_PATH;
    }

    public static String refreshUrl(String apiBase) {
        return apiBase + REFRESH_PATH;
    }

    public static String deviceCodeUrl(String apiBase) {
        return apiBase + DEVICE_CODE_PATH;
    }

    public static String deviceTokenUrl(String apiBase) {
        return apiBase + DEVICE_TOKEN_PATH;
    }

    /** True when the URL may carry credentials: https, or http to loopback. */
    public static boolean allowed(String url) {
        URI uri;
        try {
            uri = new URI(url);
        } catch (Exception ignored) {
            return false;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (scheme.equals("https")) {
            return true;
        }
        if (!scheme.equals("http")) {
            return false;
        }
        return isLoopback(uri.getHost());
    }

    static boolean isLoopback(String host) {
        if (host == null) {
            return false;
        }
        String clean = host.strip().toLowerCase(Locale.ROOT);
        if (clean.startsWith("[") && clean.endsWith("]")) {
            clean = clean.substring(1, clean.length() - 1);
        }
        return clean.equals("localhost") || clean.equals("127.0.0.1") || clean.equals("::1");
    }
}
