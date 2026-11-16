package com.klymon.clientmenu.cosmetic;

import java.util.List;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.OverlayTexture;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.render.model.json.ModelTransformationMode;
import java.util.Map;

import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.item.Item;
import net.minecraft.item.Items;
import net.minecraft.item.ItemStack;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.RotationAxis;

/**
 * Renders the local player's equipped cloth cosmetics (cape, wings, hat, pet)
 * using the palette carried by the launcher bridge. Particles, auras, trails
 * and entrance bursts are spawned by {@link CosmeticsManager} instead.
 *
 * <p>Local-player only: other players' cosmetics would require a server that
 * tells us what they wear, which is out of scope for the local ecosystem.</p>
 */
public final class CosmeticFeatureRenderer
        extends FeatureRenderer<AbstractClientPlayerEntity, PlayerEntityModel<AbstractClientPlayerEntity>> {

    /**
     * Vanilla items the catalog may reference as hat/pet visuals. A static map
     * on purpose: {@code Registries} would drag datafixerupper onto the
     * Gradle-free compile classpath for no runtime benefit.
     */
    private static final Map<String, Item> ITEMS = Map.ofEntries(
            Map.entry("minecraft:lantern", Items.LANTERN),
            Map.entry("minecraft:sea_lantern", Items.SEA_LANTERN),
            Map.entry("minecraft:torch", Items.TORCH),
            Map.entry("minecraft:golden_helmet", Items.GOLDEN_HELMET),
            Map.entry("minecraft:diamond_helmet", Items.DIAMOND_HELMET),
            Map.entry("minecraft:leather_helmet", Items.LEATHER_HELMET),
            Map.entry("minecraft:carved_pumpkin", Items.CARVED_PUMPKIN),
            Map.entry("minecraft:dragon_head", Items.DRAGON_HEAD),
            Map.entry("minecraft:slime_ball", Items.SLIME_BALL),
            Map.entry("minecraft:amethyst_shard", Items.AMETHYST_SHARD),
            Map.entry("minecraft:ender_pearl", Items.ENDER_PEARL),
            Map.entry("minecraft:totem_of_undying", Items.TOTEM_OF_UNDYING),
            Map.entry("minecraft:music_disc_cat", Items.MUSIC_DISC_CAT),
            Map.entry("minecraft:cake", Items.CAKE));

    public CosmeticFeatureRenderer(
            FeatureRendererContext<AbstractClientPlayerEntity, PlayerEntityModel<AbstractClientPlayerEntity>> context) {
        super(context);
    }

    @Override
    public void render(MatrixStack matrices, VertexConsumerProvider vertexConsumers, int light,
            AbstractClientPlayerEntity entity, float limbAngle, float limbDistance, float tickDelta,
            float animationProgress, float headYaw, float headPitch) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (entity != client.player || entity.isInvisible()) {
            return;
        }
        KlymonBridge bridge = KlymonBridge.get();
        float age = entity.age + tickDelta;

        KlymonBridge.Equipped cape = bridge.equipped("cape");
        if (cape != null) {
            renderCape(matrices, vertexConsumers, light, entity, cape, limbDistance, age);
        }
        KlymonBridge.Equipped wings = bridge.equipped("wings");
        if (wings != null) {
            renderWings(matrices, vertexConsumers, light, wings, age);
        }
        KlymonBridge.Equipped hat = bridge.equipped("hat");
        if (hat != null) {
            renderHat(matrices, vertexConsumers, light, entity, hat);
        }
        KlymonBridge.Equipped pet = bridge.equipped("pet");
        if (pet != null) {
            renderPet(matrices, vertexConsumers, light, entity, pet, age);
        }
    }

    // ------------------------------------------------------------------ cape

    private void renderCape(MatrixStack matrices, VertexConsumerProvider vertexConsumers, int light,
            AbstractClientPlayerEntity entity, KlymonBridge.Equipped cape, float limbDistance, float age) {
        List<String> colors = cape.colors();
        Identifier texture = CosmeticTextures.gradient(
                colors.isEmpty() ? "#22d3ee" : colors.get(0),
                colors.size() > 1 ? colors.get(1) : colors.get(0));
        matrices.push();
        // Entity space: +Z is the back, +Y points down (model units).
        matrices.translate(0.0f, 0.0f, 0.10f);
        float sway = (float) Math.sin(age * 0.12f) * 2.5f + Math.min(14.0f, limbDistance * 40.0f);
        matrices.multiply(RotationAxis.POSITIVE_X.rotationDegrees(6.0f + sway));
        // Cloth: 0.62 wide, hanging 0.95 down from the shoulders.
        quad(matrices, vertexConsumers, texture, light, -0.31f, -0.12f, 0.31f, 0.83f, 0.0f);
        matrices.pop();
    }

    // ----------------------------------------------------------------- wings

    private void renderWings(MatrixStack matrices, VertexConsumerProvider vertexConsumers, int light,
            KlymonBridge.Equipped wings, float age) {
        List<String> colors = wings.colors();
        Identifier texture = CosmeticTextures.gradient(
                colors.isEmpty() ? "#a5f3fc" : colors.get(0),
                colors.size() > 1 ? colors.get(1) : colors.get(0));
        float flap = (float) Math.sin(age * 0.18f) * 6.0f;
        for (int side = -1; side <= 1; side += 2) {
            matrices.push();
            matrices.translate(0.16f * side, -0.05f, 0.10f);
            matrices.multiply(RotationAxis.POSITIVE_Z.rotationDegrees(side * (28.0f + flap)));
            matrices.multiply(RotationAxis.POSITIVE_Y.rotationDegrees(side * -12.0f));
            float outer = 0.62f;
            quad(matrices, vertexConsumers, texture, light,
                    side < 0 ? -outer : 0.0f, -0.62f,
                    side < 0 ? 0.0f : outer, 0.05f, 0.0f);
            matrices.pop();
        }
    }

    // ------------------------------------------------------------------- hat

    private void renderHat(MatrixStack matrices, VertexConsumerProvider vertexConsumers, int light,
            AbstractClientPlayerEntity entity, KlymonBridge.Equipped hat) {
        ItemStack stack = stackOf(hat.baseItem());
        matrices.push();
        this.getContextModel().head.rotate(matrices);
        if (stack != null) {
            matrices.translate(0.0f, -0.42f, 0.0f);
            matrices.scale(0.72f, 0.72f, 0.72f);
            MinecraftClient.getInstance().getItemRenderer().renderItem(stack,
                    ModelTransformationMode.FIXED, light, OverlayTexture.DEFAULT_UV,
                    matrices, vertexConsumers, entity.getWorld(), entity.getId());
        } else {
            List<String> colors = hat.colors();
            Identifier texture = CosmeticTextures.solid(colors.isEmpty() ? "#4ade80" : colors.get(0));
            matrices.translate(0.0f, -0.30f, 0.0f);
            quad(matrices, vertexConsumers, texture, light, -0.22f, -0.16f, 0.22f, 0.02f, 0.16f);
        }
        matrices.pop();
    }

    // ------------------------------------------------------------------- pet

    private void renderPet(MatrixStack matrices, VertexConsumerProvider vertexConsumers, int light,
            AbstractClientPlayerEntity entity, KlymonBridge.Equipped pet, float age) {
        ItemStack stack = stackOf(pet.baseItem());
        if (stack == null) {
            return;
        }
        matrices.push();
        float bob = (float) Math.sin(age * 0.15f) * 0.07f;
        matrices.translate(0.72f, -0.95f + bob, 0.25f);
        matrices.scale(0.42f, 0.42f, 0.42f);
        matrices.multiply(RotationAxis.POSITIVE_Y.rotationDegrees(age * 2.0f % 360.0f));
        MinecraftClient.getInstance().getItemRenderer().renderItem(stack,
                ModelTransformationMode.FIXED, light, OverlayTexture.DEFAULT_UV,
                matrices, vertexConsumers, entity.getWorld(), entity.getId());
        matrices.pop();
    }

    // ---------------------------------------------------------------- helpers

    private static ItemStack stackOf(String itemId) {
        if (itemId == null || itemId.isBlank()) {
            return null;
        }
        Item item = ITEMS.get(itemId.trim());
        if (item == null) {
            return null;
        }
        ItemStack stack = new ItemStack(item);
        return stack.isEmpty() ? null : stack;
    }

    /** Axis-aligned textured quad at depth {@code z} (double-sided layer, no culling). */
    private static void quad(MatrixStack matrices, VertexConsumerProvider vertexConsumers,
            Identifier texture, int light, float x1, float y1, float x2, float y2, float z) {
        VertexConsumer vertices = vertexConsumers.getBuffer(RenderLayer.getEntityCutoutNoCull(texture));
        MatrixStack.Entry entry = matrices.peek();
        int overlay = OverlayTexture.DEFAULT_UV;
        vertices.vertex(entry, x1, y1, z).color(255, 255, 255, 255).texture(0.0f, 1.0f).overlay(overlay).light(light).normal(entry, 0.0f, 0.0f, 1.0f);
        vertices.vertex(entry, x2, y1, z).color(255, 255, 255, 255).texture(1.0f, 1.0f).overlay(overlay).light(light).normal(entry, 0.0f, 0.0f, 1.0f);
        vertices.vertex(entry, x2, y2, z).color(255, 255, 255, 255).texture(1.0f, 0.0f).overlay(overlay).light(light).normal(entry, 0.0f, 0.0f, 1.0f);
        vertices.vertex(entry, x1, y2, z).color(255, 255, 255, 255).texture(0.0f, 0.0f).overlay(overlay).light(light).normal(entry, 0.0f, 0.0f, 1.0f);
    }
}
