import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  SkinViewer as SkinViewer3D,
  IdleAnimation,
  WalkingAnimation,
  RunningAnimation,
  FlyingAnimation,
  type SkinViewerOptions,
} from 'skinview3d';
import type { SkinVariant } from '@klymon/skin-manager/paper-doll';

export type SkinAnimation = 'idle' | 'walk' | 'run' | 'fly' | 'none';

export interface SkinViewerHandle {
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
}

const DEFAULT_ZOOM = 0.9;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.6;
const ZOOM_STEP = 1.25;

function createAnimation(animation: SkinAnimation): IdleAnimation | WalkingAnimation | RunningAnimation | FlyingAnimation | null {
  switch (animation) {
    case 'walk':
      return new WalkingAnimation();
    case 'run':
      return new RunningAnimation();
    case 'fly':
      return new FlyingAnimation();
    case 'none':
      return null;
    default:
      return new IdleAnimation();
  }
}

/**
 * Interactive 3D skin viewer. Drag to rotate, wheel to zoom, right-drag to
 * pan; the parent drives zoom/reset through the ref handle.
 */
export const SkinViewer = forwardRef<
  SkinViewerHandle,
  {
    skinUrl: string | null;
    capeUrl?: string | null;
    variant?: SkinVariant;
    width?: number;
    height?: number;
    animation?: SkinAnimation;
    autoRotate?: boolean;
    className?: string;
    label: string;
  }
>(function SkinViewer(
  { skinUrl, capeUrl = null, variant = 'classic', width = 260, height = 340, animation = 'idle', autoRotate = true, className, label },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<SkinViewer3D | null>(null);

  useImperativeHandle(ref, () => ({
    zoomIn() {
      const viewer = viewerRef.current;
      if (viewer) viewer.zoom = Math.min(MAX_ZOOM, viewer.zoom * ZOOM_STEP);
    },
    zoomOut() {
      const viewer = viewerRef.current;
      if (viewer) viewer.zoom = Math.max(MIN_ZOOM, viewer.zoom / ZOOM_STEP);
    },
    resetView() {
      const viewer = viewerRef.current;
      if (!viewer) return;
      viewer.zoom = DEFAULT_ZOOM;
      viewer.resetCameraPose();
    },
  }), []);

  // The WebGL context is expensive: create it once and update it in place.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const options: SkinViewerOptions = {
      canvas,
      width,
      height,
      background: 'transparent',
      enableControls: true,
    };
    const viewer = new SkinViewer3D(options);
    viewer.fov = 50;
    viewer.zoom = DEFAULT_ZOOM;
    viewer.autoRotate = true;
    viewer.autoRotateSpeed = 0.6;
    viewer.animation = new IdleAnimation();
    viewer.controls.enablePan = true;
    viewerRef.current = viewer;

    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [width, height]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (skinUrl) {
      viewer
        .loadSkin(skinUrl, { model: variant === 'slim' ? 'slim' : 'default' })
        .catch((error: unknown) => console.warn('[skins] 3D skin texture failed to load:', error));
    } else {
      viewer.resetSkin();
    }
  }, [skinUrl, variant]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (capeUrl) {
      viewer.loadCape(capeUrl).catch((error: unknown) => console.warn('[skins] 3D cape texture failed to load:', error));
    } else {
      viewer.resetCape();
    }
  }, [capeUrl]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.animation = createAnimation(animation);
    viewer.renderPaused = false;
  }, [animation]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.autoRotate = autoRotate;
  }, [autoRotate]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={label}
    />
  );
});
