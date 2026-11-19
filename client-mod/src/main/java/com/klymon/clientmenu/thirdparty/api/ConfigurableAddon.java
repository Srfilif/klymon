package com.klymon.clientmenu.thirdparty.api;

import java.util.Map;

/**
 * Third-party string-map configuration capability. The platform calls
 * {@link #defaultConfig} once at load, then delivers the values back through
 * {@link #configure} as an unmodifiable map. Keys and values are plain
 * strings; persistence across restarts is a platform follow-up, so v1
 * configuration is in-memory only.
 */
public interface ConfigurableAddon {
    /** Default configuration. Must not be null and must not contain nulls. */
    Map<String, String> defaultConfig();

    /** Receives the effective configuration as an unmodifiable map. */
    void configure(Map<String, String> values);
}
