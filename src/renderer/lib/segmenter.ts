// Person segmentation / matting pipeline.
//
// This module hides three different model backends behind a single
// `WebcamSegmenter` interface so the compositor can swap between
// segmentation and matting without changing its draw code.
//
// Quality ladder (low → high):
//
//   1. "selfie"     — MediaPipe Selfie Segmentation (legacy).
//                     Binary person mask, low resolution, flickery edges.
//                     Cheapest to run, safest fallback.
//
//   2. "multiclass" — MediaPipe Tasks ImageSegmenter with the
//                     SelfieMulticlass model. Newer vendor model, same
//                     runtime cost, meaningfully cleaner hair edges.
//                     Still a binary mask — we post-process with the
//                     same bilateral refinement as "selfie".
//
//   3. "rvm"        — Robust Video Matting via onnxruntime-web. Real
//                     video matting: outputs a continuous per-pixel
//                     alpha instead of a binary mask, so hair strands
//                     get real semi-transparency. Recurrent network
//                     → temporally stable. Needs a GPU and a model
//                     file download; falls through on failure.
//
// All backends implement a tiny shared interface:
//
//   - `getMaskCanvas()`  — alpha-encoded person mask (the segmentation
//     shape). Used for centroid tracking and for the bilateral refine
//     pass in `composeSegmented`. RVM synthesises this from its alpha
//     output so auto-center keeps working.
//
//   - `getMatted()`      — a fully-matted foreground canvas (person
//     RGB + alpha). Only populated by the matting backend. When the
//     compositor sees this, it skips the whole mask-refinement path
//     and draws the matted canvas directly over the new background.

import { SelfieSegmentation } from '@mediapipe/selfie_segmentation';
import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';
import * as ort from 'onnxruntime-web';
import { refineMaskGL } from './maskRefineGL';
import { EFFECT_FILTERS, type WebcamEffect } from '../../shared/types';

export type SegMode = 'none' | 'blur' | 'image';
export type SegBackendId = 'selfie' | 'multiclass' | 'rvm';

interface Backend {
  readonly id: SegBackendId;
  init(): Promise<void>;
  process(video: HTMLVideoElement): Promise<void>;
  getMaskCanvas(): HTMLCanvasElement | null;
  getMatted(): HTMLCanvasElement | null;
  close(): void;
}

// ============================================================
// Backend 1 — MediaPipe Selfie Segmentation (legacy)
// ============================================================

class SelfieBackend implements Backend {
  readonly id: SegBackendId = 'selfie';
  private seg: SelfieSegmentation | null = null;
  private ready = false;
  private maskCanvas = document.createElement('canvas');
  private haveMask = false;

  async init() {
    if (this.seg) return;
    this.seg = new SelfieSegmentation({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
    });
    this.seg.setOptions({ modelSelection: 1, selfieMode: false });
    this.seg.onResults((r) => {
      const mask = r.segmentationMask as unknown as CanvasImageSource & { width: number; height: number };
      if (!mask) return;
      const w = mask.width || 256;
      const h = mask.height || 256;
      if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
        this.maskCanvas.width = w;
        this.maskCanvas.height = h;
      }
      const ctx = this.maskCanvas.getContext('2d')!;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(mask, 0, 0, w, h);
      this.haveMask = true;
    });
    await this.seg.initialize();
    this.ready = true;
  }

  async process(video: HTMLVideoElement) {
    if (!this.ready || !this.seg) return;
    if (video.readyState < 2) return;
    await this.seg.send({ image: video });
  }

  getMaskCanvas() { return this.haveMask ? this.maskCanvas : null; }
  getMatted() { return null; }
  close() {
    try { this.seg?.close(); } catch {}
    this.seg = null;
    this.ready = false;
  }
}

// ============================================================
// Backend 2 — MediaPipe Tasks ImageSegmenter (SelfieMulticlass)
// ============================================================

class MulticlassBackend implements Backend {
  readonly id: SegBackendId = 'multiclass';
  private seg: ImageSegmenter | null = null;
  private ready = false;
  private maskCanvas = document.createElement('canvas');
  private haveMask = false;
  private lastTs = 0;

  async init() {
    if (this.seg) return;
    const fileset = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    this.seg = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true
    });
    this.ready = true;
  }

  async process(video: HTMLVideoElement) {
    if (!this.ready || !this.seg) return;
    if (video.readyState < 2) return;
    // segmentForVideo timestamps must be strictly increasing.
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const result = this.seg.segmentForVideo(video, ts);
    try {
      const masks = result?.confidenceMasks;
      if (!masks || masks.length === 0) return;
      // Category 0 = background. Person alpha = 1 - bg confidence
      // gives a soft-edge alpha mask the bilateral refine can clean.
      const bg = masks[0];
      const w = bg.width;
      const h = bg.height;
      const data = bg.getAsFloat32Array();
      if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
        this.maskCanvas.width = w;
        this.maskCanvas.height = h;
      }
      const ctx = this.maskCanvas.getContext('2d')!;
      const img = ctx.createImageData(w, h);
      for (let i = 0, j = 0; i < data.length; i++, j += 4) {
        const person = 1 - data[i];
        const a = person < 0 ? 0 : person > 1 ? 255 : (person * 255) | 0;
        img.data[j] = 255;
        img.data[j + 1] = 255;
        img.data[j + 2] = 255;
        img.data[j + 3] = a;
      }
      ctx.putImageData(img, 0, 0);
      this.haveMask = true;
    } finally {
      try { result?.close(); } catch {}
    }
  }

  getMaskCanvas() { return this.haveMask ? this.maskCanvas : null; }
  getMatted() { return null; }
  close() {
    try { this.seg?.close(); } catch {}
    this.seg = null;
    this.ready = false;
  }
}

// ============================================================
// Backend 3 — Robust Video Matting (RVM) via onnxruntime-web
// ============================================================
//
// Expected ONNX model: `rvm_mobilenetv3_fp32.onnx` (official export
// from https://github.com/PeterL1n/RobustVideoMatting). You can drop
// the file into `resources/` and point the URL below at it, or let
// the default HuggingFace URL do the download on first use.
//
// Inputs:
//   src:              (1, 3, H, W) float32 RGB in [0,1]
//   r1i..r4i:         recurrent state, start as zero tensors
//   downsample_ratio: float scalar (0.25 works well for webcam input)
// Outputs:
//   fgr:              (1, 3, H, W) matted foreground
//   pha:              (1, 1, H, W) alpha
//   r1o..r4o:         new recurrent state (feed back next frame)

const RVM_MODEL_URL =
  'https://huggingface.co/akhaliq/Robust-Video-Matting/resolve/main/rvm_mobilenetv3_fp32.onnx';

class RvmBackend implements Backend {
  readonly id: SegBackendId = 'rvm';
  private session: ort.InferenceSession | null = null;
  private ready = false;
  private r1: ort.Tensor = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
  private r2: ort.Tensor = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
  private r3: ort.Tensor = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
  private r4: ort.Tensor = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
  private downsample: ort.Tensor = new ort.Tensor('float32', new Float32Array([0.25]), []);
  // Working resolution. RVM scales to whatever you feed it, but webcam
  // overlay is small on screen and this keeps inference around 30fps
  // on integrated GPUs. Native 720p would bottleneck weaker hardware.
  private readonly IN_W = 384;
  private readonly IN_H = 224;
  private rgbBuffer = new Float32Array(1 * 3 * this.IN_H * this.IN_W);
  private inputCanvas = document.createElement('canvas');
  private mattedCanvas = document.createElement('canvas');
  private maskCanvas = document.createElement('canvas');
  private haveMatted = false;

  constructor() {
    this.inputCanvas.width = this.IN_W;
    this.inputCanvas.height = this.IN_H;
    this.mattedCanvas.width = this.IN_W;
    this.mattedCanvas.height = this.IN_H;
    this.maskCanvas.width = this.IN_W;
    this.maskCanvas.height = this.IN_H;
  }

  async init() {
    if (this.session) return;
    // Best-effort execution provider selection: webgpu first for
    // modern Chromium, then webgl, then wasm as the universal fallback.
    const eps: ('webgpu' | 'webgl' | 'wasm')[] = [];
    // WebGPU detection (navigator.gpu) — feature-detect to avoid an
    // InvalidArgument error on older browsers.
    if (typeof (navigator as any).gpu !== 'undefined') eps.push('webgpu');
    eps.push('webgl', 'wasm');
    this.session = await ort.InferenceSession.create(RVM_MODEL_URL, {
      executionProviders: eps,
      graphOptimizationLevel: 'all'
    });
    this.ready = true;
  }

  async process(video: HTMLVideoElement) {
    if (!this.ready || !this.session) return;
    if (video.readyState < 2) return;
    const { IN_W, IN_H } = this;
    const ictx = this.inputCanvas.getContext('2d', { willReadFrequently: true })!;
    ictx.drawImage(video, 0, 0, IN_W, IN_H);
    const img = ictx.getImageData(0, 0, IN_W, IN_H);

    // HWC uint8 → CHW float32 [0,1] for the ONNX tensor.
    const rgb = this.rgbBuffer;
    const n = IN_W * IN_H;
    const src = img.data;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      rgb[i] = src[p] / 255;
      rgb[i + n] = src[p + 1] / 255;
      rgb[i + 2 * n] = src[p + 2] / 255;
    }

    const srcTensor = new ort.Tensor('float32', rgb, [1, 3, IN_H, IN_W]);
    const feeds: Record<string, ort.Tensor> = {
      src: srcTensor,
      r1i: this.r1,
      r2i: this.r2,
      r3i: this.r3,
      r4i: this.r4,
      downsample_ratio: this.downsample
    };

    let results: ort.InferenceSession.OnnxValueMapType;
    try {
      results = await this.session.run(feeds);
    } catch (e) {
      console.warn('RVM inference failed', e);
      return;
    }

    // Persist recurrent state for next frame — what makes RVM
    // temporally stable. If the session changes tensor shapes (it
    // won't, mid-stream) the next frame will error and we swallow it.
    this.r1 = results.r1o as ort.Tensor;
    this.r2 = results.r2o as ort.Tensor;
    this.r3 = results.r3o as ort.Tensor;
    this.r4 = results.r4o as ort.Tensor;

    const fgr = results.fgr.data as Float32Array;
    const pha = results.pha.data as Float32Array;

    // Compose CHW outputs back into RGBA buffers for both the matted
    // foreground (used directly by the compositor) and the mask
    // canvas (used by centroid tracking).
    const octx = this.mattedCanvas.getContext('2d')!;
    const mctx = this.maskCanvas.getContext('2d')!;
    const outImg = octx.createImageData(IN_W, IN_H);
    const maskImg = mctx.createImageData(IN_W, IN_H);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = fgr[i];
      const g = fgr[i + n];
      const b = fgr[i + 2 * n];
      const a = pha[i];
      const ar = a < 0 ? 0 : a > 1 ? 255 : (a * 255) | 0;
      outImg.data[p] = r < 0 ? 0 : r > 1 ? 255 : (r * 255) | 0;
      outImg.data[p + 1] = g < 0 ? 0 : g > 1 ? 255 : (g * 255) | 0;
      outImg.data[p + 2] = b < 0 ? 0 : b > 1 ? 255 : (b * 255) | 0;
      outImg.data[p + 3] = ar;
      maskImg.data[p] = 255;
      maskImg.data[p + 1] = 255;
      maskImg.data[p + 2] = 255;
      maskImg.data[p + 3] = ar;
    }
    octx.putImageData(outImg, 0, 0);
    mctx.putImageData(maskImg, 0, 0);
    this.haveMatted = true;
  }

  getMaskCanvas() { return this.haveMatted ? this.maskCanvas : null; }
  getMatted() { return this.haveMatted ? this.mattedCanvas : null; }
  close() {
    try { (this.session as any)?.release?.(); } catch {}
    this.session = null;
    this.ready = false;
  }
}

// ============================================================
// WebcamSegmenter — picks and drives the active backend
// ============================================================

function makeBackend(id: SegBackendId): Backend {
  if (id === 'rvm') return new RvmBackend();
  if (id === 'multiclass') return new MulticlassBackend();
  return new SelfieBackend();
}

/**
 * Probe backends in descending quality order and return the first
 * one whose init() succeeds. Used by the "auto" dropdown choice so
 * modern GPUs get RVM without the user having to care, and older
 * hardware falls through gracefully.
 */
export async function detectBestBackend(): Promise<SegBackendId> {
  const candidates: SegBackendId[] = ['rvm', 'multiclass', 'selfie'];
  for (const id of candidates) {
    const b = makeBackend(id);
    try {
      await b.init();
      b.close();
      return id;
    } catch (e) {
      console.warn(`seg backend ${id} unavailable`, e);
      try { b.close(); } catch {}
    }
  }
  return 'selfie';
}

export class WebcamSegmenter {
  private backend: Backend;
  private wantId: SegBackendId;

  constructor(id: SegBackendId = 'selfie') {
    this.wantId = id;
    this.backend = makeBackend(id);
  }

  async init() {
    try {
      await this.backend.init();
    } catch (e) {
      // Silent drop-down to the safest backend on failure so the app
      // never loses segmentation entirely. The caller sees a working
      // segmenter — just a cheaper one than it asked for.
      console.warn(`seg backend ${this.wantId} init failed — falling back to selfie`, e);
      try { this.backend.close(); } catch {}
      this.backend = makeBackend('selfie');
      this.wantId = 'selfie';
      await this.backend.init();
    }
  }

  async process(video: HTMLVideoElement) {
    try {
      await this.backend.process(video);
    } catch (e) {
      console.warn('seg process failed', e);
    }
  }

  getMaskCanvas() { return this.backend.getMaskCanvas(); }
  getMatted() { return this.backend.getMatted(); }
  get id(): SegBackendId { return this.backend.id; }

  /**
   * Swap backends mid-session. Old backend is closed only after the
   * new one initialises successfully, so a failed swap leaves the
   * running backend intact instead of dropping us to "no segmentation".
   */
  async setBackend(id: SegBackendId) {
    if (this.backend.id === id) return;
    const next = makeBackend(id);
    try {
      await next.init();
    } catch (e) {
      console.warn(`seg backend swap to ${id} failed — keeping ${this.backend.id}`, e);
      try { next.close(); } catch {}
      return;
    }
    try { this.backend.close(); } catch {}
    this.backend = next;
    this.wantId = id;
  }

  close() {
    try { this.backend.close(); } catch {}
  }
}

// ============================================================
// Mask centroid (auto-center feature)
// ============================================================

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
export function computeMaskCentroid(
  mask: HTMLCanvasElement | null
): { x: number; y: number; area: number } | null {
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
    ctx.drawImage(mask, 0, 0, CENTROID_W, CENTROID_H);
    // We stored the person signal in the alpha channel of every
    // backend's mask canvas, so read alpha (+3 offset) not red.
    const data = ctx.getImageData(0, 0, CENTROID_W, CENTROID_H).data;

    let topRow = -1;
    for (let y = 0; y < CENTROID_H && topRow < 0; y++) {
      for (let x = 0; x < CENTROID_W; x++) {
        if (data[(y * CENTROID_W + x) * 4 + 3] >= 64) { topRow = y; break; }
      }
    }
    if (topRow < 0) return null;

    let botRow = topRow;
    for (let y = CENTROID_H - 1; y > topRow; y--) {
      let any = false;
      for (let x = 0; x < CENTROID_W; x++) {
        if (data[(y * CENTROID_W + x) * 4 + 3] >= 64) { any = true; break; }
      }
      if (any) { botRow = y; break; }
    }
    const personHeight = botRow - topRow + 1;
    const sliceRows = Math.max(4, Math.min(14, Math.round(personHeight * 0.28)));
    const sliceBot = topRow + sliceRows;

    let sumX = 0, sumY = 0, total = 0;
    for (let y = topRow; y < sliceBot && y < CENTROID_H; y++) {
      for (let x = 0; x < CENTROID_W; x++) {
        const w = data[(y * CENTROID_W + x) * 4 + 3];
        if (w < 48) continue;
        sumX += x * w;
        sumY += y * w;
        total += w;
      }
    }
    if (total === 0) return null;

    const cx = (sumX / total) / (CENTROID_W - 1);
    let cy = (sumY / total) / (CENTROID_H - 1);
    cy = Math.min(1, cy + 0.05);
    const area = total / ((CENTROID_W * sliceRows) * 255);
    return { x: cx, y: cy, area };
  } catch {
    return null;
  }
}

// ============================================================
// Compositing
// ============================================================

// Reusable scratch canvases for the mask refinement pipeline.
let maskCanvas: HTMLCanvasElement | null = null;
let erodeCanvas: HTMLCanvasElement | null = null;

/**
 * Compose a webcam frame with optional blur or background image
 * replacement. The backend's mask or matted output is spliced in as
 * appropriate:
 *
 *   - If `matted` is provided (RVM path), draw the background first
 *     and alpha-blend the matted foreground on top. No mask refinement
 *     needed because RVM already produced a proper alpha matte.
 *
 *   - Otherwise use `mask` (segmentation path): temporal smooth,
 *     joint-bilateral refine on WebGL (or canvas2D erode fallback),
 *     then matte the live video through it and place a background
 *     behind.
 */
// Compute a centred crop rectangle for a given zoom and pan offsets.
// The crop preserves the SOURCE's aspect ratio (sw/z × sh/z) so the
// face isn't horizontally stretched when drawn back into a non-square
// output canvas. Offsets are -0.5..+0.5 and shift the crop window
// inside the source. Returns rect in the source's pixel space.
function centerCrop(sw: number, sh: number, zoom: number, offX: number, offY: number) {
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

export function composeSegmented(
  video: HTMLVideoElement,
  mask: HTMLCanvasElement | null,
  matted: HTMLCanvasElement | null,
  mode: SegMode,
  bgImage: HTMLImageElement | null,
  out: HTMLCanvasElement,
  // Colour filter applied to the replacement background IMAGE only,
  // not to the foreground (face). The filter string comes from the
  // shared EFFECT_FILTERS map so the background picks the same
  // palette as the face Effect dropdown.
  bgEffect: WebcamEffect = 'none',
  // Extra Gaussian blur (in px) applied to the background layer
  // regardless of mode. Works with both the real-room blur path
  // and the replacement-image path, so users can soften a fake
  // background OR stack additional blur on top of `mode === 'blur'`.
  bgBlurPx: number = 0,
  // Colour filter applied ONLY to the foreground face, not the
  // background. Built by the caller via `combinedWebcamFilter` so it
  // already includes the face-light adjustment if any. Passed as a
  // pre-composed CSS filter string so the caller picks the palette
  // once and we just apply it on the face draws inside.
  faceFilter: string = 'none',
  // Face-only zoom + offset. Applied via a centred crop on the video
  // (or matted) draw so the face can be framed tighter without
  // zooming the background along with it. Pan offsets are -0.5..+0.5.
  faceZoom: number = 1,
  faceOffsetX: number = 0,
  faceOffsetY: number = 0,
  // Independent background zoom — crops into the replacement image
  // (or the blurred-room source) from the centre, so the user can
  // "push in" to the fake scene without touching the face framing.
  bgZoom: number = 1
): HTMLCanvasElement {
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  if (out.width !== w) out.width = w;
  if (out.height !== h) out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  if (mode === 'none') {
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    return out;
  }

  // ---- Matting fast path (RVM) ----
  // Backend already produced a premultiplied foreground; we just need
  // to drop a background behind it.
  // Combined filter for the replacement image: colour effect + optional
  // extra Gaussian blur. Empty string means no filter.
  const bgExtraBlur = Math.max(0, Math.min(80, bgBlurPx || 0));
  const bgEffectFilter = EFFECT_FILTERS[bgEffect] || 'none';
  const bgImageFilter = (() => {
    const parts: string[] = [];
    if (bgEffectFilter !== 'none') parts.push(bgEffectFilter);
    if (bgExtraBlur > 0) parts.push(`blur(${bgExtraBlur}px)`);
    return parts.join(' ') || 'none';
  })();
  // Real-room blur: 14px default + any extra the user added.
  const roomBlur = 14 + bgExtraBlur;

  // Pre-compute crop rects for each layer.
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  const faceCropVideo = centerCrop(vw, vh, faceZoom, faceOffsetX, faceOffsetY);
  const bgCropVideo = centerCrop(vw, vh, bgZoom, 0, 0);
  const bgCropImg = bgImage
    ? centerCrop(bgImage.naturalWidth || w, bgImage.naturalHeight || h, bgZoom, 0, 0)
    : { sx: 0, sy: 0, sw: w, sh: h };
  const faceCropOut = centerCrop(w, h, faceZoom, faceOffsetX, faceOffsetY);
  const faceCropMatted = matted
    ? centerCrop(matted.width || w, matted.height || h, faceZoom, faceOffsetX, faceOffsetY)
    : { sx: 0, sy: 0, sw: w, sh: h };

  if (matted) {
    if (mode === 'blur') {
      ctx.filter = `blur(${roomBlur}px)`;
      ctx.drawImage(video, bgCropVideo.sx, bgCropVideo.sy, bgCropVideo.sw, bgCropVideo.sh, 0, 0, w, h);
      ctx.filter = 'none';
    } else if (mode === 'image' && bgImage && bgImage.complete) {
      if (bgImageFilter !== 'none') ctx.filter = bgImageFilter;
      ctx.drawImage(bgImage, bgCropImg.sx, bgCropImg.sy, bgCropImg.sw, bgCropImg.sh, 0, 0, w, h);
      ctx.filter = 'none';
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    if (faceFilter !== 'none') ctx.filter = faceFilter;
    ctx.drawImage(matted, faceCropMatted.sx, faceCropMatted.sy, faceCropMatted.sw, faceCropMatted.sh, 0, 0, w, h);
    ctx.filter = 'none';
    ctx.restore();
    return out;
  }

  if (!mask) {
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    return out;
  }

  // ---- Segmentation path (Selfie / Multiclass) ----
  // Temporal smoothing: fade the previous frame's alpha in place and
  // draw the new one on top at full alpha. `destination-out` fades
  // alpha without darkening colors, which would otherwise confuse
  // the source-in matte step below.
  if (!maskCanvas) maskCanvas = document.createElement('canvas');
  if (maskCanvas.width !== w) { maskCanvas.width = w; maskCanvas.height = h; }
  const mctx = maskCanvas.getContext('2d')!;
  mctx.save();
  mctx.globalCompositeOperation = 'destination-out';
  mctx.globalAlpha = 0.55;
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, w, h);
  mctx.globalCompositeOperation = 'source-over';
  mctx.globalAlpha = 1.0;
  mctx.drawImage(mask, 0, 0, w, h);
  mctx.restore();

  // Preferred refinement: joint-bilateral in WebGL. Snaps the mask
  // boundary to real image edges (hair, jaw, collar) using the live
  // video as a guide. Falls back to a canvas2D erosion pass on
  // machines without working WebGL.
  let maskSource: HTMLCanvasElement = maskCanvas;
  const refined = refineMaskGL(video, maskCanvas, 0.55);
  if (refined) {
    maskSource = refined;
  } else {
    if (!erodeCanvas) erodeCanvas = document.createElement('canvas');
    if (erodeCanvas.width !== w) { erodeCanvas.width = w; erodeCanvas.height = h; }
    const ectx = erodeCanvas.getContext('2d')!;
    ectx.save();
    ectx.clearRect(0, 0, w, h);
    ectx.globalCompositeOperation = 'source-over';
    ectx.drawImage(maskCanvas, 0, 0, w, h);
    ectx.globalCompositeOperation = 'destination-in';
    const e = 2;
    for (const [dx, dy] of [
      [ e, 0], [-e, 0], [0,  e], [0, -e],
      [ e,  e], [ e, -e], [-e,  e], [-e, -e]
    ] as [number, number][]) {
      ectx.drawImage(maskCanvas, dx, dy, w, h);
    }
    ectx.restore();
    maskSource = erodeCanvas;
  }

  // Draw the (optionally eroded / refined) mask, applying the face
  // zoom+offset crop so it lines up 1:1 with the zoomed face video
  // below. maskSource dims are (w, h) so we use the output-space crop.
  ctx.save();
  if (refined) {
    ctx.drawImage(maskSource, faceCropOut.sx, faceCropOut.sy, faceCropOut.sw, faceCropOut.sh, 0, 0, w, h);
  } else {
    ctx.filter = 'blur(3px)';
    ctx.drawImage(maskSource, faceCropOut.sx, faceCropOut.sy, faceCropOut.sw, faceCropOut.sh, 0, 0, w, h);
    ctx.filter = 'none';
  }
  ctx.restore();

  ctx.globalCompositeOperation = 'source-in';
  if (faceFilter !== 'none') ctx.filter = faceFilter;
  ctx.drawImage(video, faceCropVideo.sx, faceCropVideo.sy, faceCropVideo.sw, faceCropVideo.sh, 0, 0, w, h);
  ctx.filter = 'none';

  ctx.globalCompositeOperation = 'destination-over';
  if (mode === 'blur') {
    ctx.filter = `blur(${roomBlur}px)`;
    ctx.drawImage(video, bgCropVideo.sx, bgCropVideo.sy, bgCropVideo.sw, bgCropVideo.sh, 0, 0, w, h);
    ctx.filter = 'none';
  } else if (mode === 'image' && bgImage && bgImage.complete) {
    if (bgImageFilter !== 'none') ctx.filter = bgImageFilter;
    ctx.drawImage(bgImage, bgCropImg.sx, bgCropImg.sy, bgCropImg.sw, bgCropImg.sh, 0, 0, w, h);
    ctx.filter = 'none';
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }

  ctx.restore();
  return out;
}
