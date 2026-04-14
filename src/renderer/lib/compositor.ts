import type { Arrow, Rect, WebcamEffect, WebcamShape, WebcamSize } from '../../shared/types';
import { COLOR_HEX, WEBCAM_PX, combinedWebcamFilter } from '../../shared/types';
import { drawAnnotation } from './arrowDraw';
import { composeSegmented, computeMaskCentroid, SegMode, SegBackendId, WebcamSegmenter } from './segmenter';
import { createAutoFrameState, updateAutoFrame, type AutoFrameState } from './autoFrame';
import { shapePath } from './shapes';

export type CompositorConfig = {
  screenVideo: HTMLVideoElement;
  webcamVideo: HTMLVideoElement | null;
  crop: Rect | null;       // in source-video pixels
  outWidth: number;
  outHeight: number;
};

export type CursorZoomState = {
  enabled: boolean;
  factor: number; // 1..3
  // cursor position in the SAME coordinate space as the display that the
  // screen video captures (display CSS pixels relative to display top-left).
  x: number;
  y: number;
  // size of that display in CSS pixels, for normalization.
  displayW: number;
  displayH: number;
  // How aggressively the smoothed crop chases the cursor. 0.02 = slow
  // cinematic drift, 0.25 = aggressive follow. Expressed as the
  // exponential-moving-average blend factor applied each frame.
  followSpeed?: number;
  // Delay (in milliseconds) before the crop starts chasing a new
  // cursor target. Higher values "wait and see" — if the cursor
  // moves away and comes back within the delay window the camera
  // doesn't chase, which is the main cause of motion sickness.
  followDelayMs?: number;
};

export type WebcamSettings = {
  shape: WebcamShape;
  size: WebcamSize;
  x: number; // normalized 0..1 (top-left)
  y: number;
  bgMode: SegMode;
  bgImage: HTMLImageElement | null;
  effect: WebcamEffect;
  zoom: number;    // 1.0 - 3.0
  offsetX: number; // -0.5 .. 0.5, pan the face inside the shape
  offsetY: number;
  faceLight: number; // 0..100 — soft fill-light intensity applied on top of effect
  autoCenter?: boolean; // override offsetX/Y with mask centroid tracking
  segBackend?: SegBackendId; // which segmentation/matting model to use
  bgEffect?: WebcamEffect; // colour filter applied ONLY to the replacement background image
  bgBlurPx?: number; // 0..40 extra Gaussian blur applied to the background layer (image OR real room)
  bgZoom?: number; // 1..3 centred crop applied to the background image / blurred room
  faceBlurPx?: number; // 0..40 Gaussian blur applied ONLY to the face (anonymise / soften)
};

export type TextOverlayEffect = 'none' | 'shadow' | 'outline' | 'glow';

/**
 * A single fixed text label rendered on top of every output frame.
 * Position is normalized 0..1 in the output canvas so it scales with
 * the output resolution. Size is in pixels at the output resolution.
 */
export type TextOverlay = {
  text: string;
  font: string;       // CSS font-family
  size: number;       // px
  color: string;      // CSS color
  effect: TextOverlayEffect;
  x: number;          // 0..1 (center x)
  y: number;          // 0..1 (center y)
  bold?: boolean;
  italic?: boolean;
};

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  // The compositor draws on the SCREEN VIDEO's actual frame cadence using
  // `requestVideoFrameCallback`. This is the only way to get drift-free
  // recording: every time the screen capture produces a new frame, we
  // immediately compose it onto the canvas and push it into the recorder.
  // Drawing on a fixed timer (rAF or setInterval) drifts against the
  // source and produces duplicate/skipped frames roughly once a second,
  // which is exactly the "skipping" the user reported.
  private vfcHandle: number | null = null;
  // Fallback timer used only when the browser doesn't expose
  // `requestVideoFrameCallback` (older Chromium / Firefox).
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private paused = false;
  // The video track returned by `captureStream`. We call `.requestFrame()`
  // after every draw so the MediaRecorder receives exactly one new frame
  // per loop tick. This matches the canvas content to recorded frames 1:1.
  private captureTrack: CanvasCaptureMediaStreamTrack | null = null;
  private targetFps = 30;
  // In-flight guard for the segmenter so it never piles up.
  private segPending = false;
  // Last time we actually drew a frame, in performance.now() ms. Used to
  // rate-limit the requestVideoFrameCallback driver — Windows screen capture
  // delivers frames on a 60Hz vsync clock even when nothing changed, and
  // without rate-limiting we'd encode 60+ fps of mostly-duplicate frames
  // and the resulting WebM looks jittery despite a high reported fps.
  private lastDrawAt = 0;

  private cfg: CompositorConfig;
  private webcamSettings: WebcamSettings;
  private arrows: Arrow[] = [];
  private textOverlay: TextOverlay | null = null;
  private segmenter: WebcamSegmenter;
  private webcamOut: HTMLCanvasElement = document.createElement('canvas');
  private cursorZoom: CursorZoomState = {
    enabled: false, factor: 1.3, x: 0, y: 0, displayW: 1920, displayH: 1080,
    followSpeed: 0.08, followDelayMs: 300
  };
  // Smoothed cursor position (normalized 0..1 within the source crop).
  private smoothedNx = 0.5;
  private smoothedNy = 0.5;
  private smoothedZoom = 1;
  // The committed target the EMA smoother is chasing. Only updated
  // once the cursor has stayed AWAY from the current view for at
  // least `followDelayMs` (see drawFrame logic).
  private targetNx = 0.5;
  private targetNy = 0.5;
  // Wall-clock (ms) when the cursor first left the current committed
  // target's zone. 0 = cursor is near the target and no commit is
  // pending. Used to implement the "settle for N ms before chasing"
  // behaviour without requiring the mouse to be completely still.
  private farSinceMs = 0;
  // Stateful face auto-framing filter. See lib/autoFrame.ts — holds
  // framing when the face is partially off-screen so the pan doesn't
  // chase a clipped centroid.
  private autoFrame: AutoFrameState = createAutoFrameState();

  constructor(cfg: CompositorConfig, webcamSettings: WebcamSettings) {
    this.cfg = cfg;
    this.webcamSettings = webcamSettings;
    this.segmenter = new WebcamSegmenter(webcamSettings.segBackend ?? 'selfie');
    this.canvas = document.createElement('canvas');
    this.canvas.width = cfg.outWidth;
    this.canvas.height = cfg.outHeight;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
  }

  setWebcamSettings(s: Partial<WebcamSettings>) {
    const prevBackend = this.webcamSettings.segBackend;
    this.webcamSettings = { ...this.webcamSettings, ...s };
    if (s.segBackend && s.segBackend !== prevBackend) {
      // Hot-swap the segmenter in the background — old one keeps
      // serving frames until the new backend has finished init.
      this.segmenter.setBackend(s.segBackend).catch(() => {});
    }
  }

  setCrop(crop: Rect | null) {
    this.cfg.crop = crop;
  }

  setCursorZoom(state: Partial<CursorZoomState>) {
    this.cursorZoom = { ...this.cursorZoom, ...state };
  }

  /** Set (or clear with `null`) the fixed text overlay rendered on every frame. */
  setTextOverlay(t: TextOverlay | null) {
    // Empty text string → treat as "no overlay" so the user clearing
    // the input box removes the label without toggling another flag.
    if (t && t.text.trim() === '') {
      this.textOverlay = null;
    } else {
      this.textOverlay = t;
    }
  }

  addArrow(a: Arrow) {
    this.arrows.push(a);
    // Auto-fade old arrows after 6s
    const now = Date.now();
    this.arrows = this.arrows.filter((x) => now - x.createdAt < 6000);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    try {
      await this.segmenter.init();
    } catch (e) {
      console.warn('Segmenter init failed; falling back to raw webcam', e);
    }
    // Draw one initial frame so the canvas isn't black at t=0.
    if (!this.paused) this.drawFrame();

    const v = this.cfg.screenVideo as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: VideoFrameRequestCallback) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    if (typeof v.requestVideoFrameCallback === 'function') {
      // Drive draws on the actual screen-video frame cadence. ffmpeg
      // handles the fps normalization downstream (`-vsync cfr -r <fps>`),
      // so we don't rate-limit here — feeding it every source frame
      // lets ffmpeg pick the cleanest output cadence.
      this.lastDrawAt = performance.now();
      const tick: VideoFrameRequestCallback = () => {
        if (!this.running) return;
        if (!this.paused) {
          this.lastDrawAt = performance.now();
          this.drawFrame();
          this.pushCapturedFrame();
        }
        this.vfcHandle = v.requestVideoFrameCallback!(tick);
      };
      this.vfcHandle = v.requestVideoFrameCallback(tick);
    } else {
      // Fallback: timer at the target fps. Less ideal (can drift) but
      // strictly better than rAF, which is throttled in hidden windows.
      this.startFallbackTimer();
    }
  }

  private startFallbackTimer() {
    if (this.timer != null) return;
    const intervalMs = 1000 / Math.max(1, this.targetFps);
    this.timer = setInterval(() => {
      if (!this.running || this.paused) return;
      this.drawFrame();
      this.pushCapturedFrame();
    }, intervalMs);
  }

  private pushCapturedFrame() {
    const t = this.captureTrack;
    if (t && typeof t.requestFrame === 'function') {
      try { t.requestFrame(); } catch { /* ignore */ }
    }
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  stop() {
    this.running = false;
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.vfcHandle != null) {
      const v = this.cfg.screenVideo as HTMLVideoElement & {
        cancelVideoFrameCallback?: (handle: number) => void;
      };
      try { v.cancelVideoFrameCallback?.(this.vfcHandle); } catch { /* ignore */ }
      this.vfcHandle = null;
    }
    this.captureTrack = null;
    this.segmenter.close();
  }

  captureStream(fps: number = 30): MediaStream {
    this.targetFps = fps;
    // Manual frame emission only. Passing 0 means the canvas never emits
    // a frame on its own — every recorded frame comes from an explicit
    // `track.requestFrame()` call inside the draw loop. Without this,
    // Chromium's auto-emit fires whenever the canvas is "dirty", which
    // happens MORE OFTEN than our draw calls (the rasterizer repaints
    // can each register as a dirty event). The result was a recorded
    // framerate of 100-180 fps even though we only called drawFrame
    // ~30 times per second.
    const stream = this.canvas.captureStream(0);
    const tracks = stream.getVideoTracks();
    if (tracks.length > 0) {
      this.captureTrack = tracks[0] as CanvasCaptureMediaStreamTrack;
    }
    return stream;
  }

  private drawFrame() {
    const { screenVideo, webcamVideo, crop, outWidth, outHeight } = this.cfg;
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, outWidth, outHeight);

    if (screenVideo.readyState >= 2) {
      const vw = screenVideo.videoWidth;
      const vh = screenVideo.videoHeight;
      const base = crop ?? { x: 0, y: 0, width: vw, height: vh };

      // Apply cursor-zoom by shrinking the source rect around the smoothed
      // cursor position. We keep the rect clamped to the base crop so it
      // never samples outside the captured area.
      //
      // Two tunables control the motion-sickness feel of this effect:
      //
      //   - `followSpeed` — the exponential-moving-average blend factor.
      //     Low = slow, cinematic drift; high = snappy follow.
      //
      //   - `followDelayMs` — a "hold" time before a new cursor target
      //     is accepted. When the user flicks the mouse, we remember the
      //     new position as a PENDING target but don't commit it to the
      //     smoother until the cursor has been "still" for this many ms.
      //     This kills twitchy chasing on micro-movements.
      const cz = this.cursorZoom;
      const targetZoom = cz.enabled ? Math.max(1, Math.min(3, cz.factor)) : 1;
      // Zoom smoothing stays fixed so the in/out transition feels consistent
      // regardless of the follow-speed slider.
      this.smoothedZoom += (targetZoom - this.smoothedZoom) * 0.12;

      const followSpeed = Math.max(0.01, Math.min(0.4, cz.followSpeed ?? 0.08));
      const followDelayMs = Math.max(0, Math.min(2000, cz.followDelayMs ?? 300));

      // Normalized cursor within the captured display (0..1). If the
      // cursor position hasn't been reported yet, default to the centre.
      let nx = 0.5, ny = 0.5;
      if (cz.enabled && cz.displayW > 0 && cz.displayH > 0) {
        nx = Math.max(0, Math.min(1, cz.x / cz.displayW));
        ny = Math.max(0, Math.min(1, cz.y / cz.displayH));
      }

      // Dwell-before-chase gate:
      //
      //   1. Measure how far the raw cursor is from the currently
      //      committed target.
      //   2. If it's within a small "near" radius, reset the dwell
      //      timer — the cursor is still roughly where the camera is
      //      already pointing, nothing to do.
      //   3. If it's outside that radius, start (or continue) a dwell
      //      timer. Once the timer exceeds `followDelayMs` the cursor
      //      is committed as the new target and the EMA smoother
      //      starts chasing.
      //
      // Crucially this does NOT require the mouse to be completely
      // still — only that the cursor has "moved away" from the
      // current target for long enough. Continuous mouse movement
      // around a UI still commits the target after the delay. Quick
      // flicks that bounce back within the delay window are ignored.
      const now = performance.now();
      const tdx = nx - this.targetNx;
      const tdy = ny - this.targetNy;
      const dist = Math.hypot(tdx, tdy);
      const NEAR_RADIUS = 0.03; // 3% of the captured display
      if (dist < NEAR_RADIUS) {
        this.farSinceMs = 0;
      } else {
        if (this.farSinceMs === 0) this.farSinceMs = now;
        if (now - this.farSinceMs >= followDelayMs) {
          // Commit the current cursor as the new target. On every
          // subsequent frame the cursor may still be "far" (because
          // the camera hasn't caught up yet), so keep updating the
          // target so it tracks the live cursor while the EMA chases.
          this.targetNx = nx;
          this.targetNy = ny;
        }
      }

      this.smoothedNx += (this.targetNx - this.smoothedNx) * followSpeed;
      this.smoothedNy += (this.targetNy - this.smoothedNy) * followSpeed;

      const z = this.smoothedZoom;
      const zw = base.width / z;
      const zh = base.height / z;
      const halfW = zw / 2;
      const halfH = zh / 2;
      const cx = base.x + this.smoothedNx * base.width;
      const cy = base.y + this.smoothedNy * base.height;
      const sx = Math.max(base.x, Math.min(base.x + base.width - zw, cx - halfW));
      const sy = Math.max(base.y, Math.min(base.y + base.height - zh, cy - halfH));

      const src = { x: sx, y: sy, width: zw, height: zh };

      // letterbox fit into out canvas
      const scale = Math.min(outWidth / src.width, outHeight / src.height);
      const dw = src.width * scale;
      const dh = src.height * scale;
      const dx = (outWidth - dw) / 2;
      const dy = (outHeight - dh) / 2;
      ctx.drawImage(screenVideo, src.x, src.y, src.width, src.height, dx, dy, dw, dh);
    }

    // Webcam overlay
    if (webcamVideo && webcamVideo.readyState >= 2) {
      this.drawWebcam(webcamVideo);
    }

    // Arrows
    this.drawArrows();

    // Fixed text overlay — drawn last so it sits on top of webcam + arrows.
    if (this.textOverlay) this.drawTextOverlay(this.textOverlay);
  }

  /**
   * Render a TextOverlay on top of the output canvas. Position is
   * normalized 0..1 in `outWidth / outHeight`. Effects:
   *
   *   - none    : flat fill
   *   - outline : stroke twice the font weight around the fill
   *   - shadow  : offset drop shadow
   *   - glow    : centred soft shadow with high blur
   */
  private drawTextOverlay(t: TextOverlay) {
    const text = t.text;
    if (!text) return;
    const ctx = this.ctx;
    const ow = this.cfg.outWidth;
    const oh = this.cfg.outHeight;

    ctx.save();
    const weight = t.bold ? '700' : '400';
    const style = t.italic ? 'italic' : 'normal';
    const px = Math.max(8, Math.min(400, t.size | 0));
    ctx.font = `${style} ${weight} ${px}px ${t.font || 'sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = t.color || '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    const cx = Math.round(Math.max(0, Math.min(1, t.x)) * ow);
    const cy = Math.round(Math.max(0, Math.min(1, t.y)) * oh);

    if (t.effect === 'shadow') {
      ctx.shadowColor = 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = Math.max(4, px * 0.12);
      ctx.shadowOffsetX = Math.max(2, px * 0.06);
      ctx.shadowOffsetY = Math.max(2, px * 0.06);
      ctx.fillText(text, cx, cy);
    } else if (t.effect === 'outline') {
      // Thick stroke first (clipped to even pixels with lineJoin=round
      // so corners don't spike), then fill on top.
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = Math.max(2, px * 0.12);
      ctx.strokeText(text, cx, cy);
      ctx.fillText(text, cx, cy);
    } else if (t.effect === 'glow') {
      // Centred soft glow using shadow with zero offset. Multiple
      // fills stack the glow for extra punch without being too slow.
      ctx.shadowColor = t.color || '#ffffff';
      ctx.shadowBlur = Math.max(8, px * 0.4);
      ctx.fillText(text, cx, cy);
      ctx.fillText(text, cx, cy);
    } else {
      ctx.fillText(text, cx, cy);
    }
    ctx.restore();
  }

  private async drawWebcam(video: HTMLVideoElement) {
    const { shape, size, x, y, bgMode, bgImage, effect, zoom, offsetX, offsetY, faceLight, autoCenter, bgEffect, bgBlurPx, bgZoom, faceBlurPx } = this.webcamSettings;
    const px = WEBCAM_PX[size];
    const ctx = this.ctx;
    const cx = Math.round(x * (this.cfg.outWidth - px));
    const cy = Math.round(y * (this.cfg.outHeight - px));

    // Run the segmenter when we need it for compositing OR when auto-center
    // is on (the centroid comes from the mask). Both paths share the same
    // in-flight guard so we never queue more than one process() call.
    const wantSeg = bgMode !== 'none' || autoCenter === true;
    let src: CanvasImageSource = video;
    // Build the face-only filter once so we can either:
    //   - apply it INSIDE composeSegmented (segmentation / matting
    //     path) where it only touches the face draws, not the
    //     background; or
    //   - apply it on the OUTER drawImage below when there's no
    //     background compositing and `src` is still the raw video.
    // Auto-center disables face-light to match the UI panel's
    // disabled-slider state. Face blur stacks on top so the user can
    // anonymise / soften themselves independently of the background.
    const fl = autoCenter ? 0 : (faceLight || 0);
    const baseFaceFilter = combinedWebcamFilter(effect, fl);
    const fbPx = Math.max(0, Math.min(40, faceBlurPx || 0));
    const faceFilterStr = fbPx > 0
      ? (baseFaceFilter === 'none' ? `blur(${fbPx}px)` : `${baseFaceFilter} blur(${fbPx}px)`)
      : baseFaceFilter;

    if (wantSeg) {
      if (!this.segPending) {
        this.segPending = true;
        this.segmenter.process(video)
          .catch(() => {})
          .finally(() => { this.segPending = false; });
      }
      const mask = this.segmenter.getMaskCanvas();
      const matted = this.segmenter.getMatted();
      if (autoCenter) {
        const ctr = computeMaskCentroid(mask);
        updateAutoFrame(this.autoFrame, ctr);
      }
      if (bgMode !== 'none') {
        // When a background mode is active, face zoom + pan are applied
        // INSIDE composeSegmented so they only touch the face layer.
        // Auto-center overrides manual offsets with the tracked
        // centroid (same rule the outer draw uses in no-bg mode).
        const useOffsetX = autoCenter ? this.autoFrame.x : offsetX;
        const useOffsetY = autoCenter ? this.autoFrame.y : offsetY;
        src = composeSegmented(
          video, mask, matted, bgMode, bgImage, this.webcamOut,
          bgEffect ?? 'none', bgBlurPx ?? 0, faceFilterStr,
          zoom, useOffsetX, useOffsetY,
          bgZoom ?? 1
        );
      }
    }

    // Translate to top-left of the overlay so the shape path is local.
    ctx.save();
    ctx.translate(cx, cy);
    shapePath(ctx, shape, px);
    ctx.clip();

    // Cover-fit crop. When bgMode is 'none' we apply face zoom + pan
    // directly here against the raw video. Otherwise composeSegmented
    // already zoomed / panned the face layer for us, so we just
    // center-cover the composed canvas at 1× with no offsets.
    const sw = (src as HTMLVideoElement).videoWidth || (src as HTMLCanvasElement).width;
    const sh = (src as HTMLVideoElement).videoHeight || (src as HTMLCanvasElement).height;
    const outerZoom = bgMode === 'none' ? zoom : 1;
    const side = Math.min(sw, sh) / Math.max(1, outerZoom);
    const maxPanX = (sw - side) / 2;
    const maxPanY = (sh - side) / 2;
    const rawOffsetX = autoCenter ? this.autoFrame.x : offsetX;
    const rawOffsetY = autoCenter ? this.autoFrame.y : offsetY;
    const outerOffX = bgMode === 'none' ? rawOffsetX : 0;
    const outerOffY = bgMode === 'none' ? rawOffsetY : 0;
    const sx = Math.max(0, Math.min(sw - side, maxPanX + outerOffX * maxPanX * 2));
    const sy = Math.max(0, Math.min(sh - side, maxPanY + outerOffY * maxPanY * 2));

    // When a background mode is active, `src` is a canvas that
    // already includes BOTH the face (already filtered inside
    // composeSegmented) AND the replacement background. Applying
    // the face filter again here would tint the background too —
    // that's the "grayscale face → grayscale background" bug.
    // So only apply the filter on the outer draw when we're passing
    // through the raw video.
    if (bgMode === 'none') {
      ctx.filter = faceFilterStr;
    } else {
      ctx.filter = 'none';
    }
    ctx.drawImage(src, sx, sy, side, side, 0, 0, px, px);
    ctx.filter = 'none';
    ctx.restore();

    // shape border
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    shapePath(ctx, shape, px);
    ctx.stroke();
    ctx.restore();
  }

  private drawArrows() {
    const now = Date.now();
    this.arrows = this.arrows.filter((a) => now - a.createdAt < 6000);
    const ctx = this.ctx;
    for (const a of this.arrows) {
      const age = (now - a.createdAt) / 6000;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age);
      drawAnnotation(ctx, a);
      ctx.restore();
    }
  }
}

