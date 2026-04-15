import { describe, it, expect } from 'vitest';
import {
  EFFECTS,
  EFFECT_FILTERS,
  faceLightFilter,
  combinedWebcamFilter,
  WEBCAM_PX
} from '../src/shared/types';

describe('EFFECT_FILTERS', () => {
  it('has an entry for every EFFECTS value', () => {
    for (const effect of EFFECTS) {
      expect(EFFECT_FILTERS[effect]).toBeDefined();
    }
  });

  it("maps 'none' to the CSS no-op value", () => {
    expect(EFFECT_FILTERS.none).toBe('none');
  });

  it('every non-none filter is a non-empty CSS filter string', () => {
    for (const effect of EFFECTS) {
      const v = EFFECT_FILTERS[effect];
      if (effect === 'none') continue;
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
      // A CSS filter string should contain at least one `function(arg)` token.
      expect(v).toMatch(/\w+\([^)]*\)/);
    }
  });
});

describe('faceLightFilter', () => {
  it("returns 'none' at amount 0", () => {
    expect(faceLightFilter(0)).toBe('none');
  });

  it('clamps negative amounts to 0 → none', () => {
    expect(faceLightFilter(-50)).toBe('none');
  });

  it('clamps values above 100 to the same result as exactly 100', () => {
    expect(faceLightFilter(9999)).toBe(faceLightFilter(100));
  });

  it('includes brightness + contrast + saturate + sepia tokens when active', () => {
    const f = faceLightFilter(50);
    expect(f).toMatch(/brightness\(/);
    expect(f).toMatch(/contrast\(/);
    expect(f).toMatch(/saturate\(/);
    expect(f).toMatch(/sepia\(/);
  });

  it('monotonically increases brightness as the amount rises', () => {
    const low = faceLightFilter(10);
    const high = faceLightFilter(90);
    const lowBright = Number((low.match(/brightness\(([\d.]+)\)/) || [])[1]);
    const highBright = Number((high.match(/brightness\(([\d.]+)\)/) || [])[1]);
    expect(highBright).toBeGreaterThan(lowBright);
  });
});

describe('combinedWebcamFilter', () => {
  it("returns 'none' when both effect and face-light are off", () => {
    expect(combinedWebcamFilter('none', 0)).toBe('none');
  });

  it('returns just the effect when face-light is 0', () => {
    expect(combinedWebcamFilter('grayscale', 0)).toBe(EFFECT_FILTERS.grayscale);
  });

  it('returns just the face-light when effect is none', () => {
    const fl = faceLightFilter(40);
    expect(combinedWebcamFilter('none', 40)).toBe(fl);
  });

  it('concatenates effect and face-light with a space when both are active', () => {
    const combo = combinedWebcamFilter('vivid', 60);
    expect(combo).toContain(EFFECT_FILTERS.vivid);
    expect(combo).toContain('brightness(');
    // Order: effect first, then face-light.
    const effectIdx = combo.indexOf(EFFECT_FILTERS.vivid);
    const brightnessIdx = combo.indexOf('brightness(');
    expect(effectIdx).toBeLessThan(brightnessIdx);
  });
});

describe('WEBCAM_PX', () => {
  it('is monotonically increasing from small to large', () => {
    expect(WEBCAM_PX.small).toBeLessThan(WEBCAM_PX.medium);
    expect(WEBCAM_PX.medium).toBeLessThan(WEBCAM_PX.large);
  });

  it('all values are positive integers', () => {
    for (const k of Object.keys(WEBCAM_PX) as (keyof typeof WEBCAM_PX)[]) {
      const v = WEBCAM_PX[k];
      expect(v).toBeGreaterThan(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
