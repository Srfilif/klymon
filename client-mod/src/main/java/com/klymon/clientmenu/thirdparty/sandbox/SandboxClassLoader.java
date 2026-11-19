package com.klymon.clientmenu.thirdparty.sandbox;

import java.util.Map;

/**
 * Child-first loader that isolates one third-party addon. Classes shipped in
 * the addon jar are defined from their jar bytes; everything else goes to
 * the parent loader only when {@link ClassPolicy} allows it, otherwise
 * linking fails with {@link ClassNotFoundException}. Each addon gets its own
 * loader instance, so addon classes (including statics) are never shared
 * between addons or with the platform — except the facade interfaces, which
 * resolve to the single platform-loaded copy so {@code instanceof} checks
 * work across the boundary.
 */
public final class SandboxClassLoader extends ClassLoader {
    private final Map<String, byte[]> classes;

    /**
     * @param classes jar classes by internal name ({@code com/example/Foo})
     * @param parent platform loader that provides the JDK and the facade
     */
    public SandboxClassLoader(Map<String, byte[]> classes, ClassLoader parent) {
        super(parent);
        this.classes = Map.copyOf(classes);
    }

    @Override
    protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
        synchronized (getClassLoadingLock(name)) {
            Class<?> loaded = findLoadedClass(name);
            if (loaded == null) {
                String internal = name.replace('.', '/');
                byte[] bytes = classes.get(internal);
                if (bytes != null) {
                    loaded = defineClass(name, bytes, 0, bytes.length);
                } else {
                    if (!ClassPolicy.isLoadable(internal)) {
                        throw new ClassNotFoundException("blocked by the addon sandbox policy: " + name);
                    }
                    loaded = super.loadClass(name, false);
                }
            }
            if (resolve) {
                resolveClass(loaded);
            }
            return loaded;
        }
    }
}
