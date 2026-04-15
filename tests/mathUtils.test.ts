import { describe, it, expect } from 'vitest';
import {
  centerCrop,
  iouRect,
  paddedFaceRect,
  blurRadiusPx
} from '../src/shared/mathUtils';

describe('centerCrop', () => {
  it('returns the whole source at zoom=1 with no offset', () => {
    const r = centerCrop(1920, 1080, 1, 0, 0);
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
    expect(r.sw).toBe(1920);
    expect(r.sh).toBe(1080);
  });

  it('returns half the source at zoom=2, centred', () => {
    const r = centerCrop(1920, 1080, 2, 0, 0);
    expect(r.sw).toBe(960);
    expect(r.sh).toBe(540);
    expect(r.sx).toBe(480);
    expect(r.sy).toBe(270);
  });

  it('preserves source aspect ratio at every zoom', () => {
    for (const z of [1, 1.5, 2, 2.7, 3]) {
      const r = centerCrop(1920, 1080, z, 0, 0);
      const inAspect = 1920 / 1080;
      const outAspect = r.sw / r.sh;
      expect(outAspect).toBeCloseTo(inAspect, 5);
    }
  });

  it('shifts the crop window with offsetX', () => {
    // At zoom=2 the pan range on each axis is (sw - cropW) / 2 = 480.
    // offsetX=+0.5 should push the crop fully to the right edge.
    const full = centerCrop(1920, 1080, 2, 0.5, 0);
    expect(full.sx).toBe(960);
    expect(full.sy).toBe(270);
    // offsetX=-0.5 should pin to the left edge.
    const left = centerCrop(1920, 1080, 2, -0.5, 0);
    expect(left.sx).toBe(0);
  });

  it('clamps out-of-range offsets to [-0.5, 0.5]', () => {
    const over = centerCrop(1000, 1000, 2, 5, -5);
    const capped = centerCrop(1000, 1000, 2, 0.5, -0.5);
    expect(over).toEqual(capped);
  });

  it('treats zoom < 1 as zoom = 1', () => {
    const z0 = centerCrop(800, 600, 0.5, 0, 0);
    const z1 = centerCrop(800, 600, 1, 0, 0);
    expect(z0).toEqual(z1);
  });

  it('never produces a crop rect that extends past the source', () => {
    for (const z of [1, 2, 3]) {
      for (const ox of [-0.5, 0, 0.5]) {
        for (const oy of [-0.5, 0, 0.5]) {
          const r = centerCrop(1920, 1080, z, ox, oy);
          expect(r.sx).toBeGreaterThanOrEqual(0);
          expect(r.sy).toBeGreaterThanOrEqual(0);
          expect(r.sx + r.sw).toBeLessThanOrEqual(1920 + 1e-9);
          expect(r.sy + r.sh).toBeLessThanOrEqual(1080 + 1e-9);
        }
      }
    }
  });
});

describe('iouRect', () => {
  it('returns 1 for two identical rects', () => {
    const r = { x: 10, y: 20, width: 100, height: 50 };
    expect(iouRect(r, r)).toBe(1);
  });

  it('returns 0 for non-overlapping rects', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 100, y: 100, width: 10, height: 10 };
    expect(iouRect(a, b)).toBe(0);
  });

  it('returns 0 when rects share exactly one edge (zero-area overlap)', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 10, y: 0, width: 10, height: 10 };
    expect(iouRect(a, b)).toBe(0);
  });

  it('computes the correct ratio for a known overlap', () => {
    // A = [0,0]..[10,10] area 100
    // B = [5,5]..[15,15] area 100
    // intersection = [5,5]..[10,10] area 25
    // union = 100 + 100 - 25 = 175
    // iou = 25 / 175 ≈ 0.1428...
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    expect(iouRect(a, b)).toBeCloseTo(25 / 175, 6);
  });

  it('returns 1 when B fully contains A and vice versa (same rect)', () => {
    const a = { x: 0, y: 0, width: 50, height: 50 };
    const b = { x: 0, y: 0, width: 50, height: 50 };
    expect(iouRect(a, b)).toBe(1);
  });

  it('handles inner rect: small inside big → ratio = smallArea / bigArea', () => {
    const big = { x: 0, y: 0, width: 100, height: 100 };
    const small = { x: 10, y: 10, width: 20, height: 20 };
    // intersection is `small` itself (fully contained) = 400
    // union = 10000 + 400 - 400 = 10000
    expect(iouRect(big, small)).toBeCloseTo(400 / 10000, 6);
  });
});

describe('paddedFaceRect', () => {
  it('expands the rect by padFrac on every side', () => {
    const r = paddedFaceRect({ x: 100, y: 100, width: 100, height: 100 }, 1000, 1000, 0.25);
    // With padFrac=0.25 the rect is scaled by 1.5x in each dim:
    // width = 100 * 1.5 = 150, height = 100 * 1.5 = 150
    // Re-centred around (150, 150) → x = 75, y = 75
    expect(r.x).toBeCloseTo(75, 5);
    expect(r.y).toBeCloseTo(75, 5);
    expect(r.width).toBeCloseTo(150, 5);
    expect(r.height).toBeCloseTo(150, 5);
  });

  it('clamps the padded rect to the source frame', () => {
    // Face right at the top-left corner; padding would push it off-screen.
    const r = paddedFaceRect({ x: 0, y: 0, width: 100, height: 100 }, 1000, 1000, 0.25);
    // cx=50, cy=50, bw=150, bh=150 → x1 = -25 clamped to 0
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    // width is `min(vw, cx + bw/2) - x1` = 125 - 0 = 125
    expect(r.width).toBeCloseTo(125, 5);
    expect(r.height).toBeCloseTo(125, 5);
  });

  it('never returns zero or negative width/height', () => {
    const r = paddedFaceRect({ x: 999, y: 999, width: 1, height: 1 }, 1000, 1000, 0);
    expect(r.width).toBeGreaterThanOrEqual(1);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it('padFrac=0 returns the original rect', () => {
    const r = paddedFaceRect({ x: 100, y: 100, width: 50, height: 50 }, 1000, 1000, 0);
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.y).toBeCloseTo(100, 5);
    expect(r.width).toBeCloseTo(50, 5);
    expect(r.height).toBeCloseTo(50, 5);
  });
});

describe('blurRadiusPx', () => {
  it('respects the 6..56 clamp floor and ceiling', () => {
    // Tiny face with low slider → clamped to floor 6.
    expect(blurRadiusPx(12, 10)).toBe(6);
    // Huge face with max slider → clamped to ceiling 56.
    expect(blurRadiusPx(120, 100000)).toBe(56);
  });

  it('scales with the long side of the face box', () => {
    // At default slider 48, a 300px face → (48 * 300) / 700 ≈ 20.57
    const r = blurRadiusPx(48, 300);
    expect(r).toBeCloseTo((48 * 300) / 700, 4);
  });

  it('clamps slider input to the 12..120 range', () => {
    expect(blurRadiusPx(-5, 400)).toBe(blurRadiusPx(12, 400));
    expect(blurRadiusPx(500, 400)).toBe(blurRadiusPx(120, 400));
  });
});
