package com.klymon.clientmenu.addon;

import com.klymon.clientmenu.KlymonTheme;

import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.block.BlockState;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.WorldRenderer;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import net.minecraft.util.shape.VoxelShape;

/**
 * Highlights the targeted block with a custom outline (and optional fill),
 * replacing the vanilla black outline through
 * {@code WorldRenderEvents.BEFORE_BLOCK_OUTLINE}.
 */
public final class BlockOverlayAddon extends Addon {
    public static final String ID = "block-overlay";

    private final Setting<Integer> lineColor = setting(Setting.color(ID, "lineColor", 0xFF5BE0C8,
            0xFF5BE0C8, 0xFFFFFFFF, 0xFF6EA8FF, 0xFFFFC857, 0xFFFF6B6B, 0xFF000000));
    private final Setting<Integer> lineWidth = setting(Setting.integer(ID, "lineWidth", 1, 1, 3, 1));
    private final Setting<Boolean> fillEnabled = setting(Setting.bool(ID, "fillEnabled", false));
    private final Setting<Integer> fillColor = setting(Setting.color(ID, "fillColor", 0x405BE0C8,
            0x405BE0C8, 0x40000000, 0x40FFFFFF, 0x40FFC857));
    private final Setting<Double> opacity = setting(Setting.decimal(ID, "opacity", 1.0, 0.1, 1.0, 0.05));

    public BlockOverlayAddon() {
        super(ID, AddonCategory.PVP, "1.2.0", false);
    }

    /**
     * Event handler: {@code false} cancels the vanilla outline (verified against
     * Fabric's {@code WorldRendererMixin} bytecode), {@code true} keeps it.
     */
    public boolean render(WorldRenderContext context, HitResult hit) {
        if (!enabled() || !(hit instanceof BlockHitResult blockHit)
                || hit.getType() != HitResult.Type.BLOCK || context.world() == null) {
            return true;
        }
        BlockPos pos = blockHit.getBlockPos();
        BlockState state = context.world().getBlockState(pos);
        if (state.isAir()) {
            return true;
        }
        VoxelShape shape = state.getOutlineShape(context.world(), pos);
        if (shape.isEmpty()) {
            return true;
        }

        float alpha = (float) this.opacity.getDouble();
        int line = KlymonTheme.withOpacity(this.lineColor.getInt(), alpha);
        float lr = ((line >> 16) & 0xFF) / 255.0f;
        float lg = ((line >> 8) & 0xFF) / 255.0f;
        float lb = (line & 0xFF) / 255.0f;
        float la = ((line >>> 24) & 0xFF) / 255.0f;

        MatrixStack matrices = context.matrixStack();
        Vec3d camera = context.camera().getPos();
        VertexConsumer lines = context.consumers().getBuffer(RenderLayer.getLines());
        for (Box box : shape.getBoundingBoxes()) {
            Box moved = box.offset(pos).offset(-camera.x, -camera.y, -camera.z);
            // Most drivers clamp GL line width to 1px, so thickness is drawn as
            // concentric outlines — a real, visible effect on every GPU.
            for (int layer = 0; layer < this.lineWidth.getInt(); layer++) {
                double grow = layer * 0.0025;
                WorldRenderer.drawBox(matrices, lines, moved.expand(grow), lr, lg, lb, la);
            }
        }

        if (this.fillEnabled.getBoolean()) {
            int fill = KlymonTheme.withOpacity(this.fillColor.getInt(), alpha);
            float fr = ((fill >> 16) & 0xFF) / 255.0f;
            float fg = ((fill >> 8) & 0xFF) / 255.0f;
            float fb = (fill & 0xFF) / 255.0f;
            float fa = ((fill >>> 24) & 0xFF) / 255.0f;
            VertexConsumer quads = context.consumers().getBuffer(RenderLayer.getDebugFilledBox());
            for (Box box : shape.getBoundingBoxes()) {
                Box moved = box.offset(pos).offset(-camera.x, -camera.y, -camera.z);
                WorldRenderer.renderFilledBox(matrices, quads,
                        moved.minX, moved.minY, moved.minZ, moved.maxX, moved.maxY, moved.maxZ,
                        fr, fg, fb, fa);
            }
        }
        return false;
    }
}
