import { describe, expect, it } from 'vitest';
import { drawPaperDoll, paperDollLayout, type PaperDollTarget } from '@klymon/skin-manager/paper-doll';

interface DrawCall {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

function mockTarget(): PaperDollTarget<{ width: number; height: number }> & { calls: DrawCall[] } {
  const calls: DrawCall[] = [];
  return {
    calls,
    imageSmoothingEnabled: true,
    clearRect() {},
    drawImage(_image, sx, sy, sw, sh, dx, dy, dw, dh) {
      calls.push({ sx, sy, sw, sh, dx, dy, dw, dh });
    },
  };
}

describe('2D paper-doll preview', () => {
  it('lays out a 16x32 classic doll with base + overlay per part', () => {
    const layout = paperDollLayout('classic');
    expect(layout.width).toBe(16);
    expect(layout.height).toBe(32);
    expect(layout.rects).toHaveLength(12);
    // Head base + hat share the destination; the hat reads from the overlay area.
    const head = layout.rects.filter((rect) => rect.dx === 4 && rect.dy === 0);
    expect(head).toHaveLength(2);
    expect(head[0]).toMatchObject({ sx: 8, sy: 8, sw: 8, sh: 8, overlay: false });
    expect(head[1]).toMatchObject({ sx: 40, sy: 8, sw: 8, sh: 8, overlay: true });
    // Torso, arms and legs sit in one row each.
    const armRow = layout.rects.filter((rect) => rect.dy === 8 && rect.sw === 4 && rect.sh === 12);
    expect(armRow.map((rect) => rect.dx).sort((a, b) => a - b)).toEqual([0, 0, 12, 12]);
    const torso = layout.rects.filter((rect) => rect.dy === 8 && rect.sw === 8);
    expect(torso.map((rect) => rect.dx)).toEqual([4, 4]);
    const legRow = layout.rects.filter((rect) => rect.dy === 20);
    expect(legRow.map((rect) => rect.dx).sort((a, b) => a - b)).toEqual([4, 4, 8, 8]);
  });

  it('narrows the arms to 3 px on slim skins', () => {
    const layout = paperDollLayout('slim');
    expect(layout.width).toBe(14);
    const arms = layout.rects.filter((rect) => rect.dy === 8 && rect.sh === 12 && rect.sw === 3);
    // Left/right arm, base + overlay each.
    expect(arms).toHaveLength(4);
    expect(arms.map((rect) => rect.dx).sort((a, b) => a - b)).toEqual([0, 0, 11, 11]);
  });

  it('draws every rect scaled and pixel-crisp on 64x64 skins', () => {
    const target = mockTarget();
    drawPaperDoll(target, { width: 64, height: 64 }, 'classic', 4);
    expect(target.imageSmoothingEnabled).toBe(false);
    expect(target.calls).toHaveLength(12);
    const hat = target.calls.find((call) => call.sx === 40 && call.sy === 8);
    expect(hat).toMatchObject({ sw: 8, sh: 8, dx: 16, dy: 0, dw: 32, dh: 32 });
  });

  it('mirrors the left limbs and drops missing overlays on legacy 64x32 skins', () => {
    const target = mockTarget();
    drawPaperDoll(target, { width: 64, height: 32 }, 'classic', 2);
    // Nothing may read below row 32.
    for (const call of target.calls) {
      expect(call.sy + call.sh).toBeLessThanOrEqual(32);
    }
    // The hat overlay survives (it lives in the top half).
    expect(target.calls.some((call) => call.sx === 40 && call.sy === 8)).toBe(true);
    // Left leg destination renders the right leg texture.
    const leftLeg = target.calls.filter((call) => call.dx === 8 && call.dy === 40);
    expect(leftLeg).toHaveLength(1);
    expect(leftLeg[0]).toMatchObject({ sx: 4, sy: 20, sw: 4, sh: 12 });
    // Left arm destination renders the right arm texture.
    const leftArm = target.calls.filter((call) => call.dx === 24 && call.dy === 16);
    expect(leftArm).toHaveLength(1);
    expect(leftArm[0]).toMatchObject({ sx: 44, sy: 20, sw: 4, sh: 12 });
  });
});
