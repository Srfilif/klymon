package com.klymon.clientmenu.platform;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/**
 * The mod's own API base URL, for games launched without the Klymon
 * launcher (third-party launchers never write a bridge handoff).
 *
 * <p>Stored as {@code {"apiUrl": "..."}} in {@code config/klymon-platform.json},
 * a file this package owns alone — never inside {@code klymon-client.json},
 * which {@code KlymonConfig} rewrites wholesale. Missing or corrupt files
 * read as null; the Connect screen falls back to the default.</p>
 */
public final class ApiBaseStore {
    public static final String DEFAULT_API_BASE = "https://api.klymon.example";
    static final String FILE_NAME = "klymon-platform.json";

    private ApiBaseStore() {
    }

    public static String read(Path configDir) {
        try {
            Path file = configDir.resolve(FILE_NAME);
            if (!Files.isRegularFile(file)) {
                return null;
            }
            JsonElement root = JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8));
            if (root == null || !root.isJsonObject()) {
                return null;
            }
            JsonElement apiUrl = root.getAsJsonObject().get("apiUrl");
            if (apiUrl == null || !apiUrl.isJsonPrimitive() || !apiUrl.getAsJsonPrimitive().isString()) {
                return null;
            }
            String value = apiUrl.getAsString();
            return value.isBlank() ? null : value;
        } catch (RuntimeException | IOException ignored) {
            return null;
        }
    }

    public static void write(Path configDir, String apiUrl) throws IOException {
        Files.createDirectories(configDir);
        JsonObject json = new JsonObject();
        json.addProperty("apiUrl", apiUrl);
        Files.writeString(configDir.resolve(FILE_NAME), json.toString(), StandardCharsets.UTF_8);
    }
}
