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
    this.seg.setOptions({ modelSelection: 1, selfieMode: true });
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

  // 1) Draw mask
  ctx.drawImage(results.segmentationMask as any, 0, 0, w, h);

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
