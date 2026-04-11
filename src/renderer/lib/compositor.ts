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
  private segmenter: WebcamSegmenter;
  private webcamOut: HTMLCanvasElement = document.createElement('canvas');
  private cursorZoom: CursorZoomState = {
    enabled: false, factor: 1.6, x: 0, y: 0, displayW: 1920, displayH: 1080
  };
  // Smoothed cursor position (normalized 0..1 within the source crop).
  private smoothedNx = 0.5;
  private smoothedNy = 0.5;
  private smoothedZoom = 1;
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
      const cz = this.cursorZoom;
      const targetZoom = cz.enabled ? Math.max(1, Math.min(3, cz.factor)) : 1;
      // Smoothing: exponential moving average for both position and zoom
      const smooth = 0.12;
      this.smoothedZoom += (targetZoom - this.smoothedZoom) * smooth;

      // Normalized cursor within the captured display (0..1). If the
      // cursor position hasn't been reported yet, default to the center.
      let nx = 0.5, ny = 0.5;
      if (cz.enabled && cz.displayW > 0 && cz.displayH > 0) {
        nx = Math.max(0, Math.min(1, cz.x / cz.displayW));
        ny = Math.max(0, Math.min(1, cz.y / cz.displayH));
      }
      this.smoothedNx += (nx - this.smoothedNx) * smooth;
      this.smoothedNy += (ny - this.smoothedNy) * smooth;

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
  }

  private async drawWebcam(video: HTMLVideoElement) {
    const { shape, size, x, y, bgMode, bgImage, effect, zoom, offsetX, offsetY, faceLight, autoCenter } = this.webcamSettings;
    const px = WEBCAM_PX[size];
    const ctx = this.ctx;
    const cx = Math.round(x * (this.cfg.outWidth - px));
    const cy = Math.round(y * (this.cfg.outHeight - px));

    // Run the segmenter when we need it for compositing OR when auto-center
    // is on (the centroid comes from the mask). Both paths share the same
    // in-flight guard so we never queue more than one process() call.
    const wantSeg = bgMode !== 'none' || autoCenter === true;
    let src: CanvasImageSource = video;
    if (wantSeg) {
      if (!this.segPending) {
        this.segPending = true;
        this.segmenter.process(video)
          .catch(() => {})
          .finally(() => { this.segPending = false; });
      }
      const mask = this.segmenter.getMaskCanvas();
      const matted = this.segmenter.getMatted();
      if (bgMode !== 'none') {
        src = composeSegmented(video, mask, matted, bgMode, bgImage, this.webcamOut);
      }
      if (autoCenter) {
        const ctr = computeMaskCentroid(mask);
        updateAutoFrame(this.autoFrame, ctr);
      }
    }

    // Translate to top-left of the overlay so the shape path is local.
    ctx.save();
    ctx.translate(cx, cy);
    shapePath(ctx, shape, px);
    ctx.clip();

    // Cover-fit with zoom and user offset. The offset slides the source
    // crop window so the user can nudge their face inside the shape
    // (e.g. push the crop upward for a star so the forehead stays visible).
    // When auto-center is on, the smoothed centroid offsets override the
    // manual sliders so the face stays framed as the user moves.
    const sw = (src as HTMLVideoElement).videoWidth || (src as HTMLCanvasElement).width;
    const sh = (src as HTMLVideoElement).videoHeight || (src as HTMLCanvasElement).height;
    const side = Math.min(sw, sh) / Math.max(1, zoom);
    const maxPanX = (sw - side) / 2;
    const maxPanY = (sh - side) / 2;
    const useOffsetX = autoCenter ? this.autoFrame.x : offsetX;
    const useOffsetY = autoCenter ? this.autoFrame.y : offsetY;
    const sx = Math.max(0, Math.min(sw - side, maxPanX + useOffsetX * maxPanX * 2));
    const sy = Math.max(0, Math.min(sh - side, maxPanY + useOffsetY * maxPanY * 2));

    // Auto-center disables the manual face-light filter to match the
    // panel UI (the face-light slider is also disabled while on).
    const fl = autoCenter ? 0 : (faceLight || 0);
    ctx.filter = combinedWebcamFilter(effect, fl);
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

