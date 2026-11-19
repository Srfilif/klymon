package com.klymon.clientmenu.thirdparty.sandbox;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Parsed {@code klymon-addon.json} manifest. The manifest declares the addon
 * identity, entry point, and requested capabilities; the loader refuses jars
 * whose code implements a capability the manifest does not declare, and vice
 * versa. Gson is used because Minecraft always ships it at runtime.
 */
public record AddonManifest(String id, String version, String mainClass, List<String> capabilities) {
    /** Manifest path inside the addon jar. */
    public static final String PATH = "klymon-addon.json";

    /** Capabilities the v1 runtime knows how to wire. */
    public static final Set<String> KNOWN_CAPABILITIES = Set.of("hud", "tick", "config");

    /**
     * Parses and validates a manifest document. Every malformed manifest is a
     * rejection, never a default.
     */
    public static AddonManifest parse(String json) throws AddonSandbox.RejectedException {
        JsonObject root;
        try {
            JsonElement parsed = JsonParser.parseString(json);
            if (!parsed.isJsonObject()) {
                throw new AddonSandbox.RejectedException("addon manifest must be a JSON object");
            }
            root = parsed.getAsJsonObject();
        } catch (JsonParseException | IllegalStateException e) {
            throw new AddonSandbox.RejectedException("addon manifest is not valid JSON: " + e.getMessage());
        }
        String id = text(root, "id");
        String version = text(root, "version");
        String mainClass = text(root, "mainClass");
        if (id == null || !id.matches("[a-z0-9][a-z0-9._-]{0,63}")) {
            throw new AddonSandbox.RejectedException("addon manifest needs an id like 'my-addon'");
        }
        if (version == null || version.isEmpty() || version.length() > 32) {
            throw new AddonSandbox.RejectedException("addon manifest needs a version of 1-32 chars");
        }
        if (mainClass == null || !mainClass.matches("[A-Za-z_$][\\w$]*(\\.[A-Za-z_$][\\w$]*)+")) {
            throw new AddonSandbox.RejectedException("addon manifest needs a dotted mainClass binary name");
        }
        JsonElement caps = root.get("capabilities");
        if (caps == null || !caps.isJsonArray()) {
            throw new AddonSandbox.RejectedException("addon manifest needs a capabilities array");
        }
        JsonArray array = caps.getAsJsonArray();
        if (array.isEmpty()) {
            throw new AddonSandbox.RejectedException("addon manifest must declare at least one capability");
        }
        Set<String> capabilities = new LinkedHashSet<>();
        for (JsonElement entry : array) {
            if (!entry.isJsonPrimitive() || !entry.getAsJsonPrimitive().isString()) {
                throw new AddonSandbox.RejectedException("addon capabilities must be strings");
            }
            String capability = entry.getAsString();
            if (!KNOWN_CAPABILITIES.contains(capability)) {
                throw new AddonSandbox.RejectedException("unknown addon capability: " + capability);
            }
            capabilities.add(capability);
        }
        return new AddonManifest(id, version, mainClass, List.copyOf(capabilities));
    }

    private static String text(JsonObject root, String member) {
        JsonElement value = root.get(member);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
            return null;
        }
        return value.getAsString();
    }

    /** Returns a defensive copy; records expose the list directly otherwise. */
    @Override
    public List<String> capabilities() {
        return new ArrayList<>(capabilities);
    }
}
