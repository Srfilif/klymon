package com.klymon.clientmenu.cosmetic;

import java.util.Collections;
import java.util.Locale;
import java.util.Map;

import com.klymon.clientmenu.logic.BoundedCache;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.util.Identifier;

/**
 * Procedural cloth textures for capes and wings. The launcher catalog only
 * carries hex palettes, so the mod rasterizes tiny gradient/pattern images at
 * runtime and registers them with the texture manager — no art assets needed.
 *
 * <p>Must be touched on the render thread (feature renderers qualify).</p>
 */
public final class CosmeticTextures {
    /** Cap for procedural textures; hand-edited bridge files cannot grow it past this. */
    static final int MAX_TEXTURES = 64;

    private record Entry(Identifier id, boolean registered) {
    }

    private static final Map<String, Entry> CACHE = Collections.synchronizedMap(
            new BoundedCache<>(MAX_TEXTURES, (key, entry) -> {
                if (!entry.registered()) {
                    return;
                }
                try {
                    MinecraftClient.getInstance().getTextureManager().destroyTexture(entry.id());
                } catch (Exception ignored) {
                    // Best effort: evicted textures release GPU memory when possible.
                }
            }));

    private CosmeticTextures() {
    }

    /** Vertical gradient texture, cached per color pair. */
    public static Identifier gradient(String topHex, String bottomHex) {
        String key = "gradient/" + norm(topHex) + "/" + norm(bottomHex);
        return cached(key, (image, width, height) -> {
            int top = KlymonBridge.parseColor(topHex, 0xFF22D3EE);
            int bottom = KlymonBridge.parseColor(bottomHex, top);
            for (int y = 0; y < height; y++) {
                float t = height <= 1 ? 0.0f : (float) y / (float) (height - 1);
                int mixed = mix(top, bottom, t);
                for (int x = 0; x < width; x++) {
                    image.setColor(x, y, toAbgr(mixed));
                }
            }
        });
    }

    /** Solid texture, cached per color. */
    public static Identifier solid(String hex) {
        String key = "solid/" + norm(hex);
        return cached(key, (image, width, height) -> {
            int color = toAbgr(KlymonBridge.parseColor(hex, 0xFF22D3EE));
            for (int y = 0; y < height; y++) {
                for (int x = 0; x < width; x++) {
                    image.setColor(x, y, color);
                }
            }
        });
    }

    private static String norm(String hex) {
        if (hex == null) {
            return "default";
        }
        return hex.trim().toLowerCase(Locale.ROOT).replace("#", "");
    }

    private interface Painter {
        void paint(NativeImage image, int width, int height);
    }

    private static Identifier cached(String key, Painter painter) {
        return CACHE.computeIfAbsent(key, ignored -> register(key, painter)).id();
    }

    private static Entry register(String key, Painter painter) {
        Identifier id = Identifier.of("klymon-menu", "dynamic/" + key);
        try {
            MinecraftClient client = MinecraftClient.getInstance();
            int width = 8;
            int height = 16;
            NativeImage image = new NativeImage(NativeImage.Format.RGBA, width, height, false);
            painter.paint(image, width, height);
            NativeImageBackedTexture texture = new NativeImageBackedTexture(image);
            texture.upload();
            client.getTextureManager().registerTexture(id, texture);
            return new Entry(id, true);
        } catch (Exception ignored) {
            // Texture creation failed (headless test, closed client): callers
            // fall back to a solid debug layer when the id is unusable.
        }
        return new Entry(id, false);
    }

    private static int mix(int topArgb, int bottomArgb, float t) {
        int ta = (topArgb >>> 24) & 0xFF;
        int tr = (topArgb >>> 16) & 0xFF;
        int tg = (topArgb >>> 8) & 0xFF;
        int tb = topArgb & 0xFF;
        int br = (bottomArgb >>> 16) & 0xFF;
        int bg = (bottomArgb >>> 8) & 0xFF;
        int bb = bottomArgb & 0xFF;
        int r = (int) (tr + (br - tr) * t);
        int g = (int) (tg + (bg - tg) * t);
        int b = (int) (tb + (bb - tb) * t);
        return (ta << 24) | (r << 16) | (g << 8) | b;
    }

    /** {@code NativeImage#setColor} expects ABGR bytes. */
    static int toAbgr(int argb) {
        int a = (argb >>> 24) & 0xFF;
        int r = (argb >>> 16) & 0xFF;
        int g = (argb >>> 8) & 0xFF;
        int b = argb & 0xFF;
        return (a << 24) | (b << 16) | (g << 8) | r;
    }
}
