// Pure math utilities used by the compositor / face tracker / face
// blur pipeline. Kept in `src/shared/` so the test suite can import
// them in a plain Node environment without pulling in Electron,
// MediaPipe, or Canvas 2D. Every function here is a pure function
// of its inputs — no DOM, no side effects, no module-level state.

/**
 * Centred crop rectangle for a given zoom + pan offsets.
 *
 * The crop preserves the SOURCE's aspect ratio (`sw/z × sh/z`), so a
 * 16:9 input gets a 16:9 output and doesn't need to be stretched
 * back up. Offsets are -0.5..+0.5 and shift the crop window inside
 * the source; values at the extremes move the window to the far
 * edge without going past it.
 *
 *   zoom=1           → the whole source
 *   zoom=2           → half the source, centred
 *   zoom=2, offX=0.5 → half the source, right edge
 */
export function centerCrop(
  sw: number,
  sh: number,
  zoom: number,
  offX: number,
  offY: number
): { sx: number; sy: number; sw: number; sh: number } {
  const z = Math.max(1, zoom || 1);
  const cropW = sw / z;
  const cropH = sh / z;
  const maxPanX = (sw - cropW) / 2;
  const maxPanY = (sh - cropH) / 2;
  const ox = Math.max(-0.5, Math.min(0.5, offX || 0));
  const oy = Math.max(-0.5, Math.min(0.5, offY || 0));
  const sx = Math.max(0, Math.min(sw - cropW, maxPanX + ox * maxPanX * 2));
  const sy = Math.max(0, Math.min(sh - cropH, maxPanY + oy * maxPanY * 2));
  return { sx, sy, sw: cropW, sh: cropH };
}

/**
 * Intersection-over-union for two axis-aligned rectangles. Returns
 * 0 when they don't overlap. Used by the face tracker to decide
 * whether a newly detected face is a continuation of an existing
 * track or a brand new one.
 */
export function iouRect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter === 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return inter / union;
}

/**
 * Padded, clamped face rect in source-video pixel space. The
 * BlazeFace detector returns tight crops that miss hair / chin, so
 * we expand each edge by `padFrac * width` before handing off to
 * the blur pipeline. Result is clamped to the video frame so the
 * blur never samples outside the captured area.
 */
export function paddedFaceRect(
  rect: { x: number; y: number; width: number; height: number },
  vw: number,
  vh: number,
  padFrac: number
): { x: number; y: number; width: number; height: number } {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const bw = rect.width * (1 + padFrac * 2);
  const bh = rect.height * (1 + padFrac * 2);
  const x1 = Math.max(0, cx - bw / 2);
  const y1 = Math.max(0, cy - bh / 2);
  const x2 = Math.min(vw, cx + bw / 2);
  const y2 = Math.min(vh, cy + bh / 2);
  return { x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) };
}

/**
 * Compute the CSS `filter: blur(Npx)` radius for the face-blur box
 * given the UI slider value (12..120) and the long side of the
 * padded face rect. Scales with face size so a small face at the
 * same slider setting gets proportionally less blur than a big one.
 * Output is clamped to `[6, 56]` px to stay within the range that
 * actually looks like blur (below 6 is sharp, above 56 the face
 * dissolves into the background).
 */
export function blurRadiusPx(blurStrength: number, boxLongSide: number): number {
  const t = Math.max(12, Math.min(120, blurStrength));
  const px = (t * boxLongSide) / 700;
  return Math.max(6, Math.min(56, px));
}
