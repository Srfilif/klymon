import { useEffect, useRef } from 'react';
import { drawPaperDoll, paperDollLayout, type SkinVariant } from '@klymon/skin-manager/paper-doll';

/**
 * Flat front-view preview of a skin texture (base + overlay layers),
 * pixel-crisp. The doll always renders at an integer scale that fits
 * `maxHeight` so pixels stay sharp on any display.
 */
export function SkinPreview2D({
  skinUrl,
  variant = 'classic',
  maxHeight = 348,
  label,
}: {
  skinUrl: string | null;
  variant?: SkinVariant;
  maxHeight?: number;
  label: string;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layout = paperDollLayout(variant);
  const scale = Math.max(1, Math.floor(maxHeight / layout.height));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!skinUrl) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) drawPaperDoll(context, image, variant, scale);
    };
    image.src = skinUrl;
    return () => {
      cancelled = true;
    };
  }, [skinUrl, variant, scale]);

  return (
    <canvas
      ref={canvasRef}
      width={layout.width * scale}
      height={layout.height * scale}
      className="shrink-0 [image-rendering:pixelated]"
      role="img"
      aria-label={label}
    />
  );
}
