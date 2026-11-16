import type { SkinVariant } from './skin';

// Re-exported for renderer consumers of this subpath (type-only, erased at build).
export type { SkinVariant } from './skin';

/**
 * Flat front-view ("paper doll") renderer for skin textures. Pure layout plus
 * a draw routine against a minimal canvas interface, so it runs in the
 * renderer and under plain vitest with a mocked context.
 */

export interface PaperDollImage {
  readonly width: number;
  readonly height: number;
}

export interface PaperDollTarget<TImage extends PaperDollImage> {
  imageSmoothingEnabled: boolean;
  clearRect(x: number, y: number, w: number, h: number): void;
  // Method syntax on purpose: it stays bivariant, so both the DOM context
  // and plain test doubles satisfy this interface.
  drawImage(image: TImage, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
}

export interface PaperDollRect {
  /** Source pixels in the skin texture. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Destination pixels in the doll (pre-scale). */
  dx: number;
  dy: number;
  /** Second-layer rect: skipped when the source runs outside the texture. */
  overlay: boolean;
  /** Fallback source when the primary one is out of bounds (legacy mirror). */
  mirrorFrom?: { sx: number; sy: number };
}

export interface PaperDollLayout {
  /** Doll size in skin pixels (multiply by the render scale). */
  width: number;
  height: number;
  rects: PaperDollRect[];
}

/**
 * Front-view layout: head, torso, both arms and both legs, base layer first
 * and the overlay ("hat", "jacket", "sleeves", "pants") on top. Slim arms are
 * 3 px wide, classic 4 px. Coordinates follow the Mojang 64x64 template, the
 * same one skinview3d maps onto its boxes.
 */
export function paperDollLayout(variant: SkinVariant): PaperDollLayout {
  const armW = variant === 'slim' ? 3 : 4;
  const width = 8 + armW * 2;
  const height = 32;
  const cx = (width - 8) / 2;
  const rects: PaperDollRect[] = [
    // Head + hat.
    { sx: 8, sy: 8, sw: 8, sh: 8, dx: cx, dy: 0, overlay: false },
    { sx: 40, sy: 8, sw: 8, sh: 8, dx: cx, dy: 0, overlay: true },
    // Torso + jacket.
    { sx: 20, sy: 20, sw: 8, sh: 12, dx: cx, dy: 8, overlay: false },
    { sx: 20, sy: 36, sw: 8, sh: 12, dx: cx, dy: 8, overlay: true },
    // Right arm + sleeve (viewer's left).
    { sx: 44, sy: 20, sw: armW, sh: 12, dx: cx - armW, dy: 8, overlay: false },
    { sx: 44, sy: 36, sw: armW, sh: 12, dx: cx - armW, dy: 8, overlay: true },
    // Left arm + sleeve (viewer's right). Legacy skins mirror the right arm.
    { sx: 36, sy: 52, sw: armW, sh: 12, dx: cx + 8, dy: 8, overlay: false, mirrorFrom: { sx: 44, sy: 20 } },
    { sx: 52, sy: 52, sw: armW, sh: 12, dx: cx + 8, dy: 8, overlay: true, mirrorFrom: { sx: 44, sy: 36 } },
    // Right leg + pants (viewer's left).
    { sx: 4, sy: 20, sw: 4, sh: 12, dx: cx, dy: 20, overlay: false },
    { sx: 4, sy: 36, sw: 4, sh: 12, dx: cx, dy: 20, overlay: true },
    // Left leg + pants (viewer's right). Legacy skins mirror the right leg.
    { sx: 20, sy: 52, sw: 4, sh: 12, dx: cx + 4, dy: 20, overlay: false, mirrorFrom: { sx: 4, sy: 20 } },
    { sx: 4, sy: 52, sw: 4, sh: 12, dx: cx + 4, dy: 20, overlay: true, mirrorFrom: { sx: 4, sy: 36 } },
  ];
  return { width, height, rects };
}

function inBounds(image: PaperDollImage, sx: number, sy: number, sw: number, sh: number): boolean {
  return sx >= 0 && sy >= 0 && sx + sw <= image.width && sy + sh <= image.height;
}

/** Draws the doll at `scale` device pixels per skin pixel, pixel-crisp. */
export function drawPaperDoll<TImage extends PaperDollImage>(
  ctx: PaperDollTarget<NoInfer<TImage>>,
  image: TImage,
  variant: SkinVariant,
  scale: number,
): void {
  const layout = paperDollLayout(variant);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, layout.width * scale, layout.height * scale);
  for (const rect of layout.rects) {
    let { sx, sy } = rect;
    if (!inBounds(image, sx, sy, rect.sw, rect.sh)) {
      // Legacy 64x32: mirror the left limbs, drop the missing overlays.
      if (!rect.mirrorFrom || !inBounds(image, rect.mirrorFrom.sx, rect.mirrorFrom.sy, rect.sw, rect.sh)) continue;
      sx = rect.mirrorFrom.sx;
      sy = rect.mirrorFrom.sy;
    }
    ctx.drawImage(image, sx, sy, rect.sw, rect.sh, rect.dx * scale, rect.dy * scale, rect.sw * scale, rect.sh * scale);
  }
}
