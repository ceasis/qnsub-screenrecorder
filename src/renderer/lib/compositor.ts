import type { Arrow, Rect, WebcamShape, WebcamSize } from '../../shared/types';
import { COLOR_HEX, WEBCAM_PX } from '../../shared/types';
import { composeSegmented, SegMode, WebcamSegmenter } from './segmenter';

export type CompositorConfig = {
  screenVideo: HTMLVideoElement;
  webcamVideo: HTMLVideoElement | null;
  crop: Rect | null;       // in source-video pixels
  outWidth: number;
  outHeight: number;
};

export type WebcamSettings = {
  shape: WebcamShape;
  size: WebcamSize;
  x: number; // normalized 0..1 (top-left)
  y: number;
  bgMode: SegMode;
  bgImage: HTMLImageElement | null;
};

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  private paused = false;

  private cfg: CompositorConfig;
  private webcamSettings: WebcamSettings;
  private arrows: Arrow[] = [];
  private segmenter = new WebcamSegmenter();
  private webcamOut: HTMLCanvasElement = document.createElement('canvas');

  constructor(cfg: CompositorConfig, webcamSettings: WebcamSettings) {
    this.cfg = cfg;
    this.webcamSettings = webcamSettings;
    this.canvas = document.createElement('canvas');
    this.canvas.width = cfg.outWidth;
    this.canvas.height = cfg.outHeight;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
  }

  setWebcamSettings(s: Partial<WebcamSettings>) {
    this.webcamSettings = { ...this.webcamSettings, ...s };
  }

  setCrop(crop: Rect | null) {
    this.cfg.crop = crop;
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
    const loop = () => {
      if (!this.running) return;
      if (!this.paused) this.drawFrame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.segmenter.close();
  }

  captureStream(fps: number = 30): MediaStream {
    return this.canvas.captureStream(fps);
  }

  private drawFrame() {
    const { screenVideo, webcamVideo, crop, outWidth, outHeight } = this.cfg;
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, outWidth, outHeight);

    if (screenVideo.readyState >= 2) {
      const vw = screenVideo.videoWidth;
      const vh = screenVideo.videoHeight;
      const src = crop ?? { x: 0, y: 0, width: vw, height: vh };
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
    const { shape, size, x, y, bgMode, bgImage } = this.webcamSettings;
    const px = WEBCAM_PX[size];
    const ctx = this.ctx;
    const cx = Math.round(x * (this.cfg.outWidth - px));
    const cy = Math.round(y * (this.cfg.outHeight - px));

    let src: CanvasImageSource = video;
    if (bgMode !== 'none') {
      // kick off segmentation (fire-and-forget, uses last result)
      this.segmenter.process(video).catch(() => {});
      const results = (this.segmenter as any).lastResults;
      src = composeSegmented(video, results, bgMode, bgImage, this.webcamOut);
    }

    ctx.save();
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(cx + px / 2, cy + px / 2, px / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
    }
    // Cover-fit the source into a square px x px
    const sw = (src as HTMLVideoElement).videoWidth || (src as HTMLCanvasElement).width;
    const sh = (src as HTMLVideoElement).videoHeight || (src as HTMLCanvasElement).height;
    const s = Math.max(px / sw, px / sh);
    const drawW = sw * s;
    const drawH = sh * s;
    const dX = cx + (px - drawW) / 2;
    const dY = cy + (px - drawH) / 2;
    ctx.drawImage(src, dX, dY, drawW, drawH);
    ctx.restore();

    // border
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(cx + px / 2, cy + px / 2, px / 2, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(cx, cy, px, px);
    }
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
      ctx.strokeStyle = COLOR_HEX[a.color];
      ctx.fillStyle = COLOR_HEX[a.color];
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      drawArrow(ctx, a.x1, a.y1, a.x2, a.y2);
      ctx.restore();
    }
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const headLen = 18;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}
