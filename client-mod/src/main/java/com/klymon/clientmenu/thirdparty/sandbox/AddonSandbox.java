package com.klymon.clientmenu.thirdparty.sandbox;

import com.klymon.clientmenu.thirdparty.api.ConfigurableAddon;
import com.klymon.clientmenu.thirdparty.api.HudAddon;
import com.klymon.clientmenu.thirdparty.api.TickAddon;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Loads one third-party addon jar into an isolated sandbox. Every stage can
 * reject the jar with {@link RejectedException}, and rejection always happens
 * before the addon's code runs: size caps, manifest validation, namespace
 * guards, a constant-pool policy scan of every class, and a capability check
 * that the declared manifest matches the implemented facade interfaces.
 *
 * <p>Fabric-free so the LogicTest harness compiles and exercises this class
 * without Minecraft.
 */
public final class AddonSandbox {
    private AddonSandbox() {
    }

    /** A jar was refused: malformed, over a cap, or outside the policy. */
    public static final class RejectedException extends Exception {
        public RejectedException(String message) {
            super(message);
        }

        public RejectedException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /** A loaded addon: its instance, manifest, and isolating loader. */
    public record Loaded(String id, Object instance, AddonManifest manifest, SandboxClassLoader loader) {
        public boolean hasCapability(String capability) {
            return manifest.capabilities().contains(capability);
        }

        public HudAddon asHud() {
            if (!(instance instanceof HudAddon hud)) {
                throw new IllegalStateException("addon '" + id + "' does not implement the hud capability");
            }
            return hud;
        }

        public TickAddon asTick() {
            if (!(instance instanceof TickAddon tick)) {
                throw new IllegalStateException("addon '" + id + "' does not implement the tick capability");
            }
            return tick;
        }

        public ConfigurableAddon asConfig() {
            if (!(instance instanceof ConfigurableAddon config)) {
                throw new IllegalStateException("addon '" + id + "' does not implement the config capability");
            }
            return config;
        }
    }

    /** Largest accepted jar file, in bytes. */
    public static final long MAX_JAR_BYTES = 8L * 1024 * 1024;

    /** Largest accepted uncompressed payload across all jar entries. */
    public static final long MAX_UNCOMPRESSED_BYTES = 32L * 1024 * 1024;

    /** Largest accepted single class file, in bytes. */
    public static final int MAX_CLASS_BYTES = 1024 * 1024;

    /** Most class files accepted in one jar. */
    public static final int MAX_CLASSES = 300;

    /** Largest accepted manifest document, in bytes. */
    public static final int MAX_MANIFEST_BYTES = 8 * 1024;

    /** Jar namespaces an addon must never ship (platform, facade, well-known libs). */
    private static final String[] RESERVED_PREFIXES = {
        "java/", "javax/", "jdk/", "sun/", "com/sun/",
        "com/klymon/", "net/", "org/", "io/", "kotlin/", "scala/",
    };

    /**
     * Loads {@code jarBytes} into a fresh isolated loader. Either returns a
     * wired addon or throws; a thrown load never runs addon code except the
     * no-arg constructor and — for the config capability — the
     * {@code defaultConfig}/{@code configure} pair, whose failure also
     * rejects the jar.
     */
    public static Loaded load(byte[] jarBytes) throws RejectedException {
        if (jarBytes == null || jarBytes.length == 0) {
            throw new RejectedException("addon jar is empty");
        }
        if (jarBytes.length > MAX_JAR_BYTES) {
            throw new RejectedException("addon jar exceeds the 8 MiB cap");
        }
        Map<String, byte[]> classes = new HashMap<>();
        String manifestJson = null;
        Set<String> seen = new HashSet<>();
        long uncompressed = 0;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(jarBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (entry.isDirectory() || name.isEmpty() || name.startsWith("/") || name.contains("..")) {
                    throw new RejectedException("addon jar has an invalid entry name: " + name);
                }
                if (!seen.add(name)) {
                    throw new RejectedException("addon jar has a duplicated entry: " + name);
                }
                if (AddonManifest.PATH.equals(name)) {
                    if (manifestJson != null) {
                        throw new RejectedException("addon jar has a duplicated manifest");
                    }
                    manifestJson = readText(zip, MAX_MANIFEST_BYTES, "addon manifest");
                    uncompressed += manifestJson.length();
                } else if (name.endsWith(".class")) {
                    if (classes.size() >= MAX_CLASSES) {
                        throw new RejectedException("addon jar exceeds the 300-class cap");
                    }
                    String internal = name.substring(0, name.length() - ".class".length());
                    rejectReserved(internal);
                    byte[] bytes = readBytes(zip, MAX_CLASS_BYTES, "class " + name);
                    classes.put(internal, bytes);
                    uncompressed += bytes.length;
                } else {
                    uncompressed += skip(zip);
                }
                if (uncompressed > MAX_UNCOMPRESSED_BYTES) {
                    throw new RejectedException("addon jar exceeds the 32 MiB uncompressed cap");
                }
                zip.closeEntry();
            }
        } catch (IOException e) {
            throw new RejectedException("addon jar is not a valid zip: " + e.getMessage(), e);
        }
        if (manifestJson == null) {
            throw new RejectedException("addon jar is missing " + AddonManifest.PATH);
        }
        AddonManifest manifest = AddonManifest.parse(manifestJson);
        String mainInternal = manifest.mainClass().replace('.', '/');
        if (!classes.containsKey(mainInternal)) {
            throw new RejectedException("addon main class is missing from the jar: " + manifest.mainClass());
        }
        scan(classes);
        SandboxClassLoader loader = new SandboxClassLoader(classes, AddonSandbox.class.getClassLoader());
        Object instance;
        try {
            Class<?> main = Class.forName(manifest.mainClass(), true, loader);
            instance = main.getConstructor().newInstance();
        } catch (ReflectiveOperationException | LinkageError e) {
            throw new RejectedException("addon main class cannot be instantiated (needs a public no-arg constructor)", e);
        } catch (RuntimeException e) {
            throw new RejectedException("addon constructor failed: " + e.getMessage(), e);
        }
        checkWiring(manifest, instance);
        if (manifest.capabilities().contains("config")) {
            wireConfig(manifest, (ConfigurableAddon) instance);
        }
        return new Loaded(manifest.id(), instance, manifest, loader);
    }

    private static void rejectReserved(String internal) throws RejectedException {
        for (String prefix : RESERVED_PREFIXES) {
            if (internal.startsWith(prefix)) {
                throw new RejectedException("addon jar must not ship classes under " + prefix + ": " + internal);
            }
        }
        if (!internal.contains("/")) {
            throw new RejectedException("addon classes must live in a package: " + internal);
        }
    }

    /**
     * Verifies every class only references its own jar, the facade, or
     * policy-allowed JDK classes. Runs before any addon class is defined.
     */
    private static void scan(Map<String, byte[]> classes) throws RejectedException {
        for (Map.Entry<String, byte[]> entry : classes.entrySet()) {
            Set<String> referenced;
            try {
                referenced = ConstantPool.referencedClasses(entry.getValue());
            } catch (IllegalArgumentException e) {
                throw new RejectedException("addon class is malformed: " + entry.getKey(), e);
            }
            for (String name : referenced) {
                if (classes.containsKey(name) || ClassPolicy.isAllowed(name)) {
                    continue;
                }
                throw new RejectedException(
                        "addon class " + entry.getKey() + " references forbidden " + name + " (sandbox policy)");
            }
        }
    }

    /** The manifest and the implemented interfaces must match both ways. */
    private static void checkWiring(AddonManifest manifest, Object instance) throws RejectedException {
        checkCapability(manifest, instance instanceof HudAddon, "hud");
        checkCapability(manifest, instance instanceof TickAddon, "tick");
        checkCapability(manifest, instance instanceof ConfigurableAddon, "config");
    }

    private static void checkCapability(AddonManifest manifest, boolean implemented, String capability)
            throws RejectedException {
        boolean declared = manifest.capabilities().contains(capability);
        if (implemented && !declared) {
            throw new RejectedException("addon implements '" + capability + "' without declaring it in the manifest");
        }
        if (declared && !implemented) {
            throw new RejectedException("addon declares '" + capability + "' without implementing it");
        }
    }

    /** Delivers the default config back as an unmodifiable map at load time. */
    private static void wireConfig(AddonManifest manifest, ConfigurableAddon addon) throws RejectedException {
        Map<String, String> defaults;
        try {
            defaults = addon.defaultConfig();
        } catch (RuntimeException | LinkageError e) {
            throw new RejectedException("addon '" + manifest.id() + "' defaultConfig failed", e);
        }
        if (defaults == null) {
            throw new RejectedException("addon '" + manifest.id() + "' returned a null default config");
        }
        for (Map.Entry<String, String> entry : defaults.entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null) {
                throw new RejectedException("addon '" + manifest.id() + "' default config must not contain nulls");
            }
        }
        try {
            addon.configure(Map.copyOf(defaults));
        } catch (RuntimeException | LinkageError e) {
            throw new RejectedException("addon '" + manifest.id() + "' configure failed", e);
        }
    }

    private static byte[] readBytes(ZipInputStream zip, int max, String what) throws RejectedException, IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = zip.read(buffer)) != -1) {
            if (out.size() + read > max) {
                throw new RejectedException("addon " + what + " exceeds its size cap");
            }
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    private static String readText(ZipInputStream zip, int max, String what) throws RejectedException, IOException {
        return new String(readBytes(zip, max, what), StandardCharsets.UTF_8);
    }

    private static long skip(ZipInputStream zip) throws IOException {
        long total = 0;
        byte[] buffer = new byte[8192];
        int read;
        while ((read = zip.read(buffer)) != -1) {
            total += read;
        }
        return total;
    }
}
