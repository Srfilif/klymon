package com.klymon.clientmenu.thirdparty;

import com.klymon.clientmenu.thirdparty.api.HudCanvas;
import com.klymon.clientmenu.thirdparty.api.TickState;
import com.klymon.clientmenu.thirdparty.sandbox.AddonSandbox;
import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Game-side wiring for third-party addons. Jars dropped into
 * {@code config/klymon/addons} are loaded once at startup through
 * {@link AddonSandbox}; rejected jars log a warning and are skipped, never
 * retried. Each frame, HUD addons fill a fresh {@link HudCanvas} that is
 * flushed to the real draw context, and tick addons receive an immutable
 * snapshot. Any throwable escaping an addon disables that addon for the rest
 * of the session, so one bad jar can neither crash the game nor spam the log.
 */
public final class ThirdPartyAddons {
    private static final Logger LOGGER = LoggerFactory.getLogger("klymon-menu");

    private ThirdPartyAddons() {
    }

    private record Entry(AddonSandbox.Loaded loaded, String file) {
    }

    private static final List<Entry> LOADED = new ArrayList<>();
    private static final Set<String> DISABLED = new HashSet<>();
    private static long tickCounter;

    /** Loads every {@code *.jar} in {@code config/klymon/addons}. */
    public static void init() {
        Path dir = FabricLoader.getInstance().getConfigDir().resolve("klymon/addons");
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            LOGGER.warn("Klymon third-party addons disabled: cannot create {}", dir, e);
            return;
        }
        List<Path> jars = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.jar")) {
            for (Path jar : stream) {
                if (Files.isRegularFile(jar)) {
                    jars.add(jar);
                }
            }
        } catch (IOException e) {
            LOGGER.warn("Klymon third-party addons disabled: cannot list {}", dir, e);
            return;
        }
        jars.sort((left, right) -> left.getFileName().toString()
                .compareToIgnoreCase(right.getFileName().toString()));
        for (Path jar : jars) {
            String file = jar.getFileName().toString();
            try {
                if (Files.size(jar) > AddonSandbox.MAX_JAR_BYTES) {
                    LOGGER.warn("Klymon third-party addon rejected ({}): jar exceeds the 8 MiB cap", file);
                    continue;
                }
                AddonSandbox.Loaded loaded = AddonSandbox.load(Files.readAllBytes(jar));
                LOADED.add(new Entry(loaded, file));
                LOGGER.info("Klymon third-party addon loaded: {} v{} ({})",
                        loaded.manifest().id(), loaded.manifest().version(), file);
            } catch (IOException e) {
                LOGGER.warn("Klymon third-party addon rejected ({}): cannot read the jar", file, e);
            } catch (AddonSandbox.RejectedException e) {
                LOGGER.warn("Klymon third-party addon rejected ({}): {}", file, e.getMessage());
            }
        }
        LOGGER.info("Klymon third-party addons ready: {} loaded", LOADED.size());
    }

    /** Ticks every enabled tick addon with a fresh immutable snapshot. */
    public static void tick(MinecraftClient client) {
        if (LOADED.isEmpty()) {
            return;
        }
        tickCounter++;
        TickState state = snapshot(client);
        for (Entry entry : LOADED) {
            String id = entry.loaded().id();
            if (DISABLED.contains(id) || !entry.loaded().hasCapability("tick")) {
                continue;
            }
            try {
                entry.loaded().asTick().tick(state);
            } catch (Throwable t) {
                disable(id, entry.file(), t);
            }
        }
    }

    /** Renders every enabled HUD addon through a per-addon canvas. */
    public static void render(DrawContext context) {
        if (LOADED.isEmpty()) {
            return;
        }
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null || client.world == null || client.options.hudHidden) {
            return;
        }
        TickState state = snapshot(client);
        for (Entry entry : LOADED) {
            String id = entry.loaded().id();
            if (DISABLED.contains(id) || !entry.loaded().hasCapability("hud")) {
                continue;
            }
            HudCanvas canvas = new HudCanvas();
            try {
                entry.loaded().asHud().render(canvas, state);
            } catch (Throwable t) {
                disable(id, entry.file(), t);
                continue;
            }
            flush(context, client, canvas);
        }
    }

    private static TickState snapshot(MinecraftClient client) {
        String playerName = client.player == null ? null : client.player.getName().getString();
        return new TickState(tickCounter, client.getCurrentFps(), playerName, client.world != null);
    }

    private static void flush(DrawContext context, MinecraftClient client, HudCanvas canvas) {
        for (HudCanvas.Rect rect : canvas.rects()) {
            context.fill(rect.x(), rect.y(), rect.x() + rect.width(), rect.y() + rect.height(), rect.color());
        }
        for (HudCanvas.Text text : canvas.texts()) {
            context.drawText(client.textRenderer, text.text(), text.x(), text.y(), text.color(), false);
        }
    }

    private static void disable(String id, String file, Throwable cause) {
        DISABLED.add(id);
        LOGGER.warn("Klymon third-party addon disabled for this session ({} from {}): {}",
                id, file, String.valueOf(cause).toLowerCase(Locale.ROOT));
    }
}
