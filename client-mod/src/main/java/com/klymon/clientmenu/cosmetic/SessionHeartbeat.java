package com.klymon.clientmenu.cosmetic;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import com.klymon.clientmenu.logic.SessionAccumulator;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;

/**
 * Game-to-launcher sync: reports the real in-world playtime to
 * {@code config/klymon-session.json} every 10 seconds (and immediately on
 * world unload) so the launcher accrues, rewards and displays live playtime
 * instead of waiting for the game to close.
 */
public final class SessionHeartbeat {
    private static final long WRITE_INTERVAL_MS = 10_000L;
    private static final String RUN_ID = UUID.randomUUID().toString();
    private static final SessionAccumulator ACCUMULATOR = new SessionAccumulator();

    private static long lastWriteMs;
    private static boolean wasInWorld;

    private SessionHeartbeat() {
    }

    public static void init() {
        ClientTickEvents.END_CLIENT_TICK.register(SessionHeartbeat::tick);
    }

    static void tick(MinecraftClient client) {
        long nowMs = System.currentTimeMillis();
        boolean inWorld = client.world != null && client.player != null;
        ACCUMULATOR.tick(nowMs, inWorld);
        boolean disconnectFlush = wasInWorld && !inWorld;
        wasInWorld = inWorld;
        if (disconnectFlush || nowMs - lastWriteMs >= WRITE_INTERVAL_MS) {
            lastWriteMs = nowMs;
            write(nowMs);
        }
    }

    private static void write(long nowMs) {
        try {
            Path file = FabricLoader.getInstance().getConfigDir().resolve("klymon-session.json");
            Files.createDirectories(file.getParent());
            String json = SessionAccumulator.heartbeatJson(RUN_ID, nowMs, ACCUMULATOR.totalSeconds());
            Files.writeString(file, json, StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            // Best-effort: a missing heartbeat only means the launcher falls
            // back to the wall clock for this session.
        }
    }
}
