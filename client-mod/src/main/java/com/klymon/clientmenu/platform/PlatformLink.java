package com.klymon.clientmenu.platform;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicBoolean;

import com.klymon.clientmenu.KlymonMenuClient;
import com.klymon.clientmenu.cosmetic.KlymonBridge;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Links the running game to the platform account (§6): watches the bridge
 * handoff the launcher exports at launch, exchanges it on a worker thread,
 * and refreshes the session while the game runs. Best-effort throughout —
 * an unlinked game plays exactly like before.
 */
public final class PlatformLink {
    private static final Logger LOGGER = LoggerFactory.getLogger("klymon-menu");
    private static final long POLL_INTERVAL_MS = 2_000L;

    private static final AtomicBoolean BUSY = new AtomicBoolean(false);
    private static volatile PlatformHttp http;
    private static volatile PlatformSessionStore sessions;
    private static volatile HandoffExchange exchange;
    private static volatile DeviceLink deviceLink;
    private static volatile long lastPollMs;

    private PlatformLink() {
    }

    public static void init() {
        http = new JdkPlatformHttp("Klymon-Client/" + KlymonMenuClient.modVersion());
        sessions = new PlatformSessionStore();
        exchange = new HandoffExchange(http, sessions);
        deviceLink = new DeviceLink(http, sessions);
        ClientTickEvents.END_CLIENT_TICK.register(PlatformLink::tick);
    }

    static void tick(MinecraftClient client) {
        if (client == null) {
            return;
        }
        long nowMs = System.currentTimeMillis();
        if (nowMs - lastPollMs < POLL_INTERVAL_MS) {
            return;
        }
        lastPollMs = nowMs;
        HandoffExchange current = exchange;
        DeviceLink flow = deviceLink;
        if (current == null || flow == null) {
            return;
        }
        HandoffOffer offer = KlymonBridge.get().handoff();
        if (DeviceLink.autostartRequested(current.linked(), offer != null)
                && flow.state() == DeviceLink.State.IDLE
                && BUSY.compareAndSet(false, true)) {
            LOGGER.info("Klymon e2e autolink starting the device flow");
            executor().submit(() -> {
                try {
                    String base = ApiBaseStore.read(FabricLoader.getInstance().getConfigDir());
                    flow.start(base == null ? ApiBaseStore.DEFAULT_API_BASE : base,
                            "Klymon Client " + KlymonMenuClient.modVersion(), System.currentTimeMillis());
                } finally {
                    BUSY.set(false);
                }
            });
        }
        if (current.linked()) {
            if (BUSY.compareAndSet(false, true)) {
                executor().submit(() -> {
                    try {
                        if (!current.refreshIfNeeded(System.currentTimeMillis())) {
                            LOGGER.info("Klymon platform session ended");
                        }
                    } finally {
                        BUSY.set(false);
                    }
                });
            }
            return;
        }
        if (!current.shouldExchange(offer, nowMs)) {
            return;
        }
        if (BUSY.compareAndSet(false, true)) {
            executor().submit(() -> {
                try {
                    HandoffExchange.Outcome outcome = current.exchange(offer, System.currentTimeMillis());
                    if (outcome == HandoffExchange.Outcome.LINKED) {
                        LOGGER.info("Klymon platform linked as {}", current.username());
                    } else {
                        LOGGER.info("Klymon platform link {} (offline? the game is unaffected)", outcome);
                    }
                } finally {
                    BUSY.set(false);
                }
            });
        }
    }

    /** Linked platform username, or null when the game runs unlinked. */
    public static String username() {
        PlatformSessionStore current = sessions;
        return current == null ? null : current.username();
    }

    /** The run's device-code flow (third-party launchers). Never null after {@link #init()}. */
    public static DeviceLink deviceLink() {
        return deviceLink;
    }

    private static ExecutorService executor() {
        return Holder.EXECUTOR;
    }

    private static final class Holder {
        private static final ThreadFactory DAEMON = runnable -> {
            Thread thread = new Thread(runnable, "klymon-platform");
            thread.setDaemon(true);
            return thread;
        };
        private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor(DAEMON);
    }
}
