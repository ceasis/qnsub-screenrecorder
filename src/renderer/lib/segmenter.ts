import { SelfieSegmentation, Results } from '@mediapipe/selfie_segmentation';

export type SegMode = 'none' | 'blur' | 'image';

export class WebcamSegmenter {
  private seg: SelfieSegmentation | null = null;
  private lastResults: Results | null = null;
  private ready = false;

  async init() {
    if (this.seg) return;
    this.seg = new SelfieSegmentation({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
    });
    // selfieMode flips the mask horizontally; we draw the video un-flipped,
    // so enabling it causes the cutout to drift opposite to head movement.
    this.seg.setOptions({ modelSelection: 1, selfieMode: false });
    this.seg.onResults((r) => {
      this.lastResults = r;
    });
    await this.seg.initialize();
    this.ready = true;
  }

  async process(video: HTMLVideoElement) {
    if (!this.ready || !this.seg) return null;
    if (video.readyState < 2) return null;
    await this.seg.send({ image: video });
    return this.lastResults;
  }

  close() {
    this.seg?.close();
    this.seg = null;
    this.ready = false;
  }
}

// Reusable scratch canvas for the smoothed mask. Kept module-scoped so we
// don't reallocate it every frame and so the previous frame's mask can be
// blended into the next one (temporal smoothing kills edge flicker).
let maskCanvas: HTMLCanvasElement | null = null;

// Tiny scratch canvas used by `computeMaskCentroid` to read mask pixels
// at a low resolution. Reading 640x480 with getImageData every frame is
// expensive; downscaling to 64x48 first is ~100x cheaper and the
// centroid is still accurate to within a couple of source pixels.
let centroidCanvas: HTMLCanvasElement | null = null;
const CENTROID_W = 64;
const CENTROID_H = 48;

/**
 * Compute the head centroid from the segmentation mask, normalized to
 * 0..1 in the source video frame. Returns null if no mask is available
 * or no person pixels are visible.
 *
 * Why this is "head" not "whole person": a naive centroid of every person
 * pixel sits in the upper-torso / neck area because the body is bigger
 * than the head. Auto-center then keeps the user's neck centered and
 * crops out the top of their head. To track the face instead, we:
 *
 *   1. Find the topmost row that contains person pixels (the top of the
 *      head).
 *   2. Compute a weighted centroid of ONLY pixels in the top ~25% slice
 *      of the person blob. That slice is dominated by the head, so the
 *      resulting centroid lands roughly between the eyes.
 *
 * The horizontal centroid still uses the full slice (so leaning sideways
 * tracks correctly) and the vertical position is biased upward by ~0.05
 * so the eyes — not the chin — sit in the middle of the shape.
 */
export function computeMaskCentroid(results: Results | null): { x: number; y: number; area: number } | null {
  const mask = results?.segmentationMask;
  if (!mask) return null;
  if (!centroidCanvas) {
    centroidCanvas = document.createElement('canvas');
    centroidCanvas.width = CENTROID_W;
    centroidCanvas.height = CENTROID_H;
  }
  const ctx = centroidCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.clearRect(0, 0, CENTROID_W, CENTROID_H);
    ctx.drawImage(mask as CanvasImageSource, 0, 0, CENTROID_W, CENTROID_H);
    const data = ctx.getImageData(0, 0, CENTROID_W, CENTROID_H).data;

    // Pass 1: find the topmost row that contains a confident person pixel.
    // We treat anything with mask weight >= 64 as "definitely person" so
    // we don't latch onto stray noise pixels at the top of the frame.
    let topRow = -1;
    for (let y = 0; y < CENTROID_H && topRow < 0; y++) {
      for (let x = 0; x < CENTROID_W; x++) {
        if (data[(y * CENTROID_W + x) * 4] >= 64) { topRow = y; break; }
      }
    }
    if (topRow < 0) return null;

    // Pass 2: also find the bottommost row so we know how tall the
    // person blob is. The "head slice" is the top 25% of that range,
    // capped at ~12 rows (about 1/4 of the 48-row scratch canvas).
    let botRow = topRow;
    for (let y = CENTROID_H - 1; y > topRow; y--) {
      let any = false;
      for (let x = 0; x < CENTROID_W; x++) {
        if (data[(y * CENTROID_W + x) * 4] >= 64) { any = true; break; }
      }
      if (any) { botRow = y; break; }
    }
    const personHeight = botRow - topRow + 1;
    const sliceRows = Math.max(4, Math.min(14, Math.round(personHeight * 0.28)));
    const sliceBot = topRow + sliceRows;

    // Pass 3: weighted centroid over the head slice only.
    let sumX = 0, sumY = 0, total = 0;
    for (let y = topRow; y < sliceBot && y < CENTROID_H; y++) {
      for (let x = 0; x < CENTROID_W; x++) {
        const w = data[(y * CENTROID_W + x) * 4];
        if (w < 48) continue;
        sumX += x * w;
        sumY += y * w;
        total += w;
      }
    }
    if (total === 0) return null;

    const cx = (sumX / total) / (CENTROID_W - 1);
    let cy = (sumY / total) / (CENTROID_H - 1);
    // Nudge the y target slightly DOWN so the eyes/nose sit in the middle
    // of the shape rather than the forehead. The head slice's natural
    // centroid lands a bit too high because the top of the head has more
    // mask area than the chin (hair is wider than jawline).
    cy = Math.min(1, cy + 0.05);
    // Normalised head-slice coverage (0..1). Used by callers as a
    // confidence signal: when the face is half off-screen the slice
    // shrinks a lot, so we can hold the previous target instead of
    // chasing a clipped centroid.
    const area = total / ((CENTROID_W * sliceRows) * 255);
    return { x: cx, y: cy, area };
  } catch {
    return null;
  }
}

/**
 * Compose a webcam frame with optional blur or background image replacement.
 * Returns a canvas (size = videoWidth x videoHeight).
 */
export function composeSegmented(
  video: HTMLVideoElement,
  results: Results | null,
  mode: SegMode,
  bgImage: HTMLImageElement | null,
  out: HTMLCanvasElement
): HTMLCanvasElement {
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  if (out.width !== w) out.width = w;
  if (out.height !== h) out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  if (mode === 'none' || !results) {
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    return out;
  }

  // ---- Build a smoothed mask ----
  // 1. Temporal smoothing: blend the new mask over the previous one with a
  //    low alpha (0.55) so single-frame jitter gets averaged out.
  // 2. Spatial smoothing: blur the result a few pixels so the cutout edge
  //    is feathered instead of hard-pixel jagged.
  if (!maskCanvas) maskCanvas = document.createElement('canvas');
  if (maskCanvas.width !== w) { maskCanvas.width = w; maskCanvas.height = h; }
  const mctx = maskCanvas.getContext('2d')!;
  mctx.save();
  mctx.globalCompositeOperation = 'source-over';
  // Fade the previous mask slightly so it doesn't ghost forever.
  mctx.globalAlpha = 0.45;
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, w, h);
  // Blend in the new mask on top.
  mctx.globalAlpha = 0.55;
  mctx.drawImage(results.segmentationMask as any, 0, 0, w, h);
  mctx.restore();

  // Draw the smoothed mask into the output with a feathering blur.
  ctx.save();
  ctx.filter = 'blur(3px)';
  ctx.drawImage(maskCanvas, 0, 0, w, h);
  ctx.filter = 'none';
  ctx.restore();

  // 2) Only draw person where mask exists
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(video, 0, 0, w, h);

  // 3) Draw background behind
  ctx.globalCompositeOperation = 'destination-over';
  if (mode === 'blur') {
    ctx.filter = 'blur(14px)';
    ctx.drawImage(video, 0, 0, w, h);
    ctx.filter = 'none';
  } else if (mode === 'image' && bgImage && bgImage.complete) {
    ctx.drawImage(bgImage, 0, 0, w, h);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }

  ctx.restore();
  return out;
}
