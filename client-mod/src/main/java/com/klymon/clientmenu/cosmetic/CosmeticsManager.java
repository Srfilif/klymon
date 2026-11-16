package com.klymon.clientmenu.cosmetic;

import java.util.Random;

import java.util.Map;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.LivingEntityFeatureRendererRegistrationCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.render.entity.PlayerEntityRenderer;
import net.minecraft.client.util.InputUtil;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.particle.ParticleEffect;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.text.Text;

/**
 * Client-side cosmetics driven by the launcher bridge: particle trails and
 * auras on tick, the entrance burst on world join, and the emote flourish on
 * its keybind. Cloth cosmetics (cape, wings, hat, pet) render through
 * {@link CosmeticFeatureRenderer}.
 */
public final class CosmeticsManager {
    /** GLFW_KEY_G — unbound in vanilla, next to the movement keys. */
    private static final int EMOTE_KEY_CODE = 71;
    private static final String KEY_CATEGORY = "key.categories.klymon";

    private static final Random RANDOM = new Random();
    private static KeyBinding emoteKey;
    private static int tickCounter;
    private static ClientWorld lastWorld;

    /**
     * Vanilla particles the catalog may reference. A static map on purpose:
     * resolving through {@code Registries} would drag the datafixerupper
     * classes onto the Gradle-free compile classpath for no runtime benefit.
     */
    private static final Map<String, ParticleEffect> PARTICLES = Map.ofEntries(
            Map.entry("minecraft:electric_spark", ParticleTypes.ELECTRIC_SPARK),
            Map.entry("minecraft:soul_fire_flame", ParticleTypes.SOUL_FIRE_FLAME),
            Map.entry("minecraft:dragon_breath", ParticleTypes.DRAGON_BREATH),
            Map.entry("minecraft:glow", ParticleTypes.GLOW),
            Map.entry("minecraft:sculk_soul", ParticleTypes.SCULK_SOUL),
            Map.entry("minecraft:bubble", ParticleTypes.BUBBLE),
            Map.entry("minecraft:note", ParticleTypes.NOTE),
            Map.entry("minecraft:end_rod", ParticleTypes.END_ROD),
            Map.entry("minecraft:firework", ParticleTypes.FIREWORK),
            Map.entry("minecraft:totem_of_undying", ParticleTypes.TOTEM_OF_UNDYING),
            Map.entry("minecraft:happy_villager", ParticleTypes.HAPPY_VILLAGER),
            Map.entry("minecraft:enchant", ParticleTypes.ENCHANT),
            Map.entry("minecraft:heart", ParticleTypes.HEART),
            Map.entry("minecraft:flame", ParticleTypes.FLAME),
            Map.entry("minecraft:cloud", ParticleTypes.CLOUD));

    private CosmeticsManager() {
    }

    public static void init() {
        LivingEntityFeatureRendererRegistrationCallback.EVENT.register((entityType, entityRenderer, helper, context) -> {
            if (entityRenderer instanceof PlayerEntityRenderer playerRenderer) {
                helper.register(new CosmeticFeatureRenderer(playerRenderer));
            }
        });
        emoteKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.klymon.emote", InputUtil.Type.KEYSYM, EMOTE_KEY_CODE, KEY_CATEGORY));
        ClientTickEvents.END_CLIENT_TICK.register(CosmeticsManager::tick);
    }

    static void tick(MinecraftClient client) {
        tickCounter++;
        if (client.world != lastWorld) {
            lastWorld = client.world;
            onJoin(client);
        }
        if (client.player == null || client.world == null) {
            return;
        }
        if (emoteKey != null) {
            while (emoteKey.wasPressed()) {
                playEmote(client);
            }
        }
        KlymonBridge bridge = KlymonBridge.get();
        KlymonBridge.Equipped trail = bridge.equipped("trail");
        if (trail != null && tickCounter % 3 == 0) {
            spawn(client, trail.particle(), client.player.getX(), client.player.getY() + 0.15, client.player.getZ(),
                    2, 0.35, 0.5, 0.35, 0.02);
        }
        KlymonBridge.Equipped particles = bridge.equipped("particles");
        if (particles != null && tickCounter % 6 == 0) {
            double angle = client.player.age * 0.35;
            double x = client.player.getX() + Math.cos(angle) * 0.7;
            double z = client.player.getZ() + Math.sin(angle) * 0.7;
            spawn(client, particles.particle(), x, client.player.getY() + 1.1, z, 1, 0.05, 0.25, 0.05, 0.01);
        }
        KlymonBridge.Equipped aura = bridge.equipped("aura");
        if (aura != null && tickCounter % 8 == 0) {
            for (int i = 0; i < 10; i++) {
                double angle = (Math.PI * 2.0 * i / 10.0) + client.player.age * 0.08;
                double x = client.player.getX() + Math.cos(angle) * 0.9;
                double z = client.player.getZ() + Math.sin(angle) * 0.9;
                spawn(client, aura.particle(), x, client.player.getY() + 0.06, z, 1, 0.0, 0.0, 0.0, 0.0);
            }
        }
    }

    static void onJoin(MinecraftClient client) {
        KlymonBridge.invalidate();
        if (client.player == null || client.world == null) {
            return;
        }
        KlymonBridge.Equipped entrance = KlymonBridge.get().equipped("entrance");
        if (entrance != null) {
            spawn(client, entrance.particle(), client.player.getX(), client.player.getY() + 1.0, client.player.getZ(),
                    40, 0.6, 0.9, 0.6, 0.25);
        }
    }

    private static void playEmote(MinecraftClient client) {
        if (client.player == null || client.world == null) {
            return;
        }
        KlymonBridge.Equipped emote = KlymonBridge.get().equipped("emote");
        if (emote == null) {
            return;
        }
        spawn(client, emote.particle() != null ? emote.particle() : "minecraft:note",
                client.player.getX(), client.player.getY() + 1.6, client.player.getZ(),
                16, 0.5, 0.4, 0.5, 0.12);
        client.inGameHud.setOverlayMessage(Text.translatable("klymon.cosmetics.emote", emote.id()), false);
    }

    private static void spawn(MinecraftClient client, String particleId, double x, double y, double z,
            int count, double spreadX, double spreadY, double spreadZ, double speed) {
        ParticleEffect effect = effectOf(particleId);
        if (effect == null) {
            return;
        }
        ClientWorld world = client.world;
        if (world == null) {
            return;
        }
        for (int i = 0; i < count; i++) {
            double px = x + (RANDOM.nextDouble() - 0.5) * 2.0 * spreadX;
            double py = y + (RANDOM.nextDouble() - 0.5) * 2.0 * spreadY;
            double pz = z + (RANDOM.nextDouble() - 0.5) * 2.0 * spreadZ;
            double vx = (RANDOM.nextDouble() - 0.5) * 2.0 * speed;
            double vy = RANDOM.nextDouble() * speed;
            double vz = (RANDOM.nextDouble() - 0.5) * 2.0 * speed;
            world.addParticle(effect, px, py, pz, vx, vy, vz);
        }
    }

    /** Resolves a vanilla particle id from the bridge; unknown ids spawn nothing. */
    static ParticleEffect effectOf(String particleId) {
        if (particleId == null || particleId.isBlank()) {
            return null;
        }
        return PARTICLES.get(particleId.trim());
    }

}
