package com.klymon.clientmenu.thirdparty.sandbox;

import java.util.List;
import java.util.Set;

/**
 * Decides which classes a third-party addon may link against. The rule is an
 * allowlist with carve-outs, evaluated in order: exact forbidden classes,
 * then exact pinned-allowed classes (the {@code invokedynamic} machinery), then
 * forbidden packages, then allowed packages, and deny by default. Anything not
 * explicitly allowed — the game, the loader, the JDK
 * internals, I/O, networking, reflection — fails closed with
 * {@link ClassNotFoundException} at link time, before any addon bytecode that
 * touches it can run.
 *
 * <p>Names use internal form ({@code java/lang/String}); dotted binary names
 * and array descriptors are normalized first.
 */
public final class ClassPolicy {
    private ClassPolicy() {
    }

    /** Exact classes denied even though their package is allowed. */
    private static final Set<String> FORBIDDEN_CLASSES = Set.of(
            "java/lang/Runtime",
            "java/lang/Process",
            "java/lang/ProcessBuilder",
            "java/lang/ProcessHandle",
            "java/lang/System",
            "java/lang/Class",
            "java/lang/ClassLoader",
            "java/lang/Thread",
            "java/lang/ThreadGroup",
            "java/lang/Compiler",
            "java/lang/SecurityManager",
            "java/lang/StackWalker",
            "java/lang/invoke/MethodHandles",
            "java/lang/invoke/MethodHandleProxies",
            "java/lang/invoke/VarHandle",
            "java/util/ServiceLoader");

    /**
     * Exact classes allowed inside otherwise-forbidden packages. These exist
     * only so {@code invokedynamic} bytecode the compiler emits keeps working:
     * string concatenation bootstraps through {@code StringConcatFactory} and
     * lambdas through {@code LambdaMetafactory}, both with {@code Lookup},
     * {@code MethodType}, and {@code CallSite} references in the constant
     * pool. Each entry is inert or unobtainable on its own — a {@code Lookup}
     * cannot be minted without the still-forbidden {@code MethodHandles}
     * factory, and handles/types/callsites grant nothing without one — so
     * allowing the references does not open reflective escape.
     */
    private static final Set<String> PINNED_ALLOWED = Set.of(
            "java/lang/invoke/StringConcatFactory",
            "java/lang/invoke/LambdaMetafactory",
            "java/lang/invoke/MethodHandles$Lookup",
            "java/lang/invoke/MethodType",
            "java/lang/invoke/MethodHandle",
            "java/lang/invoke/CallSite");

    /** Packages denied even though a parent package is allowed. */
    private static final List<String> FORBIDDEN_PREFIXES = List.of(
            "java/lang/reflect/",
            "java/lang/invoke/",
            "java/lang/management/",
            "java/util/concurrent/",
            "java/util/zip/",
            "java/util/jar/",
            "java/util/prefs/",
            "java/util/logging/");

    /** Packages a third-party addon may link against. Nothing else is. */
    private static final List<String> ALLOWED_PREFIXES = List.of(
            "java/lang/",
            "java/util/",
            "java/time/",
            "java/math/",
            "com/klymon/clientmenu/thirdparty/api/");

    /**
     * References the static scan tolerates but the loader still refuses.
     * {@code javac} emits an {@code InnerClasses} outer-class entry for
     * {@code MethodHandles} in every class that uses string concatenation or
     * lambdas (both only touch the pinned {@code Lookup}), so rejecting the
     * mere reference would ban both language features. Tolerating it is safe:
     * any bytecode that actually links the class — a direct
     * {@code MethodHandles.lookup()} call — dies with {@code ClassNotFoundException}
     * at the loader gate, which disables the addon.
     */
    private static final Set<String> SCAN_TOLERATED = Set.of("java/lang/invoke/MethodHandles");

    /**
     * Returns whether an addon class may reference {@code name} at scan time.
     * Accepts internal names, dotted binary names, and array descriptors.
     */
    public static boolean isAllowed(String name) {
        return isAllowed(name, true);
    }

    /**
     * Returns whether the loader may define or delegate {@code name}. Same
     * rule as {@link #isAllowed(String)} minus the scan-tolerated phantom
     * references, which must never link.
     */
    public static boolean isLoadable(String name) {
        return isAllowed(name, false);
    }

    private static boolean isAllowed(String name, boolean scan) {
        if (name == null || name.isEmpty()) {
            return false;
        }
        String internal = name;
        while (internal.startsWith("[")) {
            internal = internal.substring(1);
        }
        if (internal.startsWith("L") && internal.endsWith(";")) {
            internal = internal.substring(1, internal.length() - 1);
        }
        if (isPrimitive(internal)) {
            return true;
        }
        internal = internal.replace('.', '/');
        if (FORBIDDEN_CLASSES.contains(internal)) {
            return scan && SCAN_TOLERATED.contains(internal);
        }
        if (PINNED_ALLOWED.contains(internal)) {
            return true;
        }
        for (String prefix : FORBIDDEN_PREFIXES) {
            if (internal.startsWith(prefix)) {
                return false;
            }
        }
        for (String prefix : ALLOWED_PREFIXES) {
            if (internal.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    private static boolean isPrimitive(String name) {
        return switch (name) {
            case "boolean", "byte", "char", "short", "int", "long", "float", "double", "void" -> true;
            default -> false;
        };
    }
}
