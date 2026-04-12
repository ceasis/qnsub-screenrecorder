/**
 * Face Blur: opaque hard-edged rectangular obscure. Mirrors the web-app
 * Basic Face Blur pipeline — crop the padded face rect, Gaussian-blur
 * it once, composite it back at full alpha. No radial feather; no
 * translucent haze. The rectangular boundary is intentional: it's the
 * same visual as `ffmpeg boxblur + maskedmerge` using axis-aligned
 * rects, which is what the server-side blur produces. Canvas2D
 * `filter: blur()` is Gaussian where ffmpeg uses box blur, but at
 * moderate radii the difference is barely noticeable to a viewer.
 */

// Padding added around the detected face rect before blurring. The
// BlazeFace detector returns a box on the facial features; a small
// expansion catches forehead and chin that the detector clips. Keep
// this tight — the feather zone handles the visual edge softening.
export const FACE_BOX_PAD_FRAC = 0.08;

export type Box = { x: number; y: number; width: number; height: number };

let blurScratch: HTMLCanvasElement | null = null;
let blurScratchCtx: CanvasRenderingContext2D | null = null;
// Alpha-masked canvas: holds the blurred crop with a feathered alpha
// so edges blend smoothly into the surrounding image instead of
// showing a hard rectangular boundary.
let feathered: HTMLCanvasElement | null = null;
let featheredCtx: CanvasRenderingContext2D | null = null;
// Mask canvas: a white rounded-rect on transparent background, then
// Gaussian-blurred to create a soft falloff. We cache it at a given
// size so we don't regenerate every frame.
let maskCache: HTMLCanvasElement | null = null;
let maskCacheCtx: CanvasRenderingContext2D | null = null;
let maskCacheW = 0;
let maskCacheH = 0;
let maskCacheFeather = 0;

function ensureCanvases(w: number, h: number) {
  if (!blurScratch) {
    blurScratch = document.createElement('canvas');
    blurScratchCtx = blurScratch.getContext('2d', { alpha: false, willReadFrequently: false });
  }
  if (!feathered) {
    feathered = document.createElement('canvas');
    featheredCtx = feathered.getContext('2d', { alpha: true, willReadFrequently: false });
  }
  if (blurScratch.width !== w || blurScratch.height !== h) {
    blurScratch.width = w;
    blurScratch.height = h;
  }
  if (feathered.width !== w || feathered.height !== h) {
    feathered.width = w;
    feathered.height = h;
  }
  return { blurScratch, blurScratchCtx: blurScratchCtx!, feathered, featheredCtx: featheredCtx! };
}

function getFeatherMask(w: number, h: number, featherPx: number): HTMLCanvasElement {
  if (maskCache && maskCacheW === w && maskCacheH === h && maskCacheFeather === featherPx) {
    return maskCache;
  }
  if (!maskCache) {
    maskCache = document.createElement('canvas');
    maskCacheCtx = maskCache.getContext('2d', { alpha: true, willReadFrequently: false });
  }
  maskCache.width = w;
  maskCache.height = h;
  maskCacheW = w;
  maskCacheH = h;
  maskCacheFeather = featherPx;
  const ctx = maskCacheCtx!;
  ctx.clearRect(0, 0, w, h);
  // Draw a white rounded rect inset by the feather amount, then blur
  // the whole thing. The blurred edge ramps alpha from 1 → 0 over
  // ~featherPx, producing a smooth transition.
  const inset = featherPx;
  const rx = Math.min(inset, w / 3);
  const ry = Math.min(inset, h / 3);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(inset, inset, Math.max(1, w - inset * 2), Math.max(1, h - inset * 2), [rx, ry]);
  ctx.fill();
  // Blur the mask to feather the edges.
  ctx.filter = `blur(${featherPx}px)`;
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(maskCache, 0, 0);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  return maskCache;
}

/** Padded, clamped crop in source-video pixel space. */
export function paddedFaceRect(rect: Box, vw: number, vh: number, padFrac = FACE_BOX_PAD_FRAC): Box {
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
 * Map UI slider (12–120) + box size → CSS blur() radius in px.
 *
 * Mirrors the web-app Basic Face Blur numbers: for a typical padded
 * face crop (~300 px on the long side) the slider produces a 6–40 px
 * radius, which is the same range the server-side `boxblur` filter
 * uses with its default of 20. Scaling by `boxLongSide` keeps the
 * blur visually proportional when different face sizes appear in the
 * same video.
 */
export function blurRadiusPx(blurStrength: number, boxLongSide: number): number {
  const t = Math.max(12, Math.min(120, blurStrength));
  const px = (t * boxLongSide) / 700;
  return Math.max(6, Math.min(56, px));
}

/**
 * Composite a soft-blurred copy of `video[sx,sy,sw,sh]` onto `destCtx` at
 * `[dx,dy,dw,dh]` with alpha so the underlying frame still reads through
 * (translucent haze). Caller must have drawn the sharp frame first.
 */
export function drawObscuredFaceFromVideo(
  destCtx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  blurStrength: number
): void {
  if (sw < 2 || sh < 2 || dw < 2 || dh < 2) return;
  const rw = Math.ceil(dw);
  const rh = Math.ceil(dh);
  const { blurScratch, blurScratchCtx, feathered, featheredCtx } = ensureCanvases(rw, rh);

  // 1. Crop the padded face rect onto the scratch canvas.
  blurScratchCtx.setTransform(1, 0, 0, 1, 0, 0);
  blurScratchCtx.filter = 'none';
  blurScratchCtx.globalAlpha = 1;
  blurScratchCtx.clearRect(0, 0, rw, rh);
  try {
    blurScratchCtx.drawImage(video, sx, sy, sw, sh, 0, 0, rw, rh);
  } catch {
    return;
  }

  // 2. Apply a single Gaussian blur pass in place.
  const b = blurRadiusPx(blurStrength, Math.max(rw, rh));
  blurScratchCtx.filter = `blur(${b}px)`;
  blurScratchCtx.drawImage(blurScratch, 0, 0, rw, rh, 0, 0, rw, rh);
  blurScratchCtx.filter = 'none';

  // 3. Apply a feathered alpha mask so the blur fades smoothly into
  //    the surrounding sharp image instead of showing a hard edge.
  //    Fixed small feather — just enough to soften the boundary
  //    without inflating the visible blur area beyond the face.
  const featherPx = Math.max(4, Math.min(10, Math.round(Math.max(rw, rh) * 0.04)));
  const mask = getFeatherMask(rw, rh, featherPx);

  featheredCtx.setTransform(1, 0, 0, 1, 0, 0);
  featheredCtx.globalAlpha = 1;
  featheredCtx.globalCompositeOperation = 'source-over';
  featheredCtx.clearRect(0, 0, rw, rh);
  // Draw the blurred crop.
  featheredCtx.drawImage(blurScratch, 0, 0, rw, rh, 0, 0, rw, rh);
  // Punch the feather mask into the alpha channel.
  featheredCtx.globalCompositeOperation = 'destination-in';
  featheredCtx.drawImage(mask, 0, 0, rw, rh);
  featheredCtx.globalCompositeOperation = 'source-over';

  // 4. Composite the feathered blurred crop onto the destination.
  try {
    destCtx.save();
    destCtx.globalAlpha = 1;
    destCtx.drawImage(feathered, 0, 0, rw, rh, dx, dy, dw, dh);
    destCtx.restore();
  } catch {
    try { destCtx.restore(); } catch { /* */ }
  }
}
