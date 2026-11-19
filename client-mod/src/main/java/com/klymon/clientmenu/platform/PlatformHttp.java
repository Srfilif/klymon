package com.klymon.clientmenu.platform;

import java.io.IOException;

/** Minimal JSON-over-HTTP transport, so tests can stub the network. */
public interface PlatformHttp {
    record Result(int status, String body) {
    }

    Result postJson(String url, String json, String bearerOrNull) throws IOException;
}
