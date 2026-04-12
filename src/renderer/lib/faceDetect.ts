// Thin wrapper around MediaPipe Tasks FaceDetector. The face-blur
// pipeline calls `init()` once, then `detect(video, timestampMs)` on
// every frame it wants to analyse. The detector runs in "VIDEO" mode
// so it can exploit temporal hints for stability.
//
// Model: short-range BlazeFace (best for faces within ~2m of the
// camera, which is what screen recordings and webcam captures look
// like). The `.tflite` file is downloaded from Google's public CDN
// on first use. ~2MB, cached by the browser after the first run.

import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

/** Must match `package.json` → `@mediapipe/tasks-vision` (WASM on CDN must match bundled JS). */
const MP_TASKS_VISION_VERSION = '0.10.34';

export type FaceDetection = {
  // Pixel-space bounding box in the SOURCE VIDEO coordinate system.
  x: number;
  y: number;
  width: number;
  height: number;
  score: number; // 0..1 detector confidence
};

let detector: FaceDetector | null = null;
let initPromise: Promise<void> | null = null;
let lastTs = 0;

export async function initFaceDetector(): Promise<void> {
  if (detector) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    console.log('[faceDetect] init start');
    // Race the whole init against a hard timeout. The Recorder tab
    // spins up its own segmentation backend on mount using the same
    // MediaPipe Tasks runtime, and occasionally the two init paths
    // wedge each other when both grab the GPU delegate. Without a
    // timeout the face detector init promise never resolves and the
    // UI sits on "Loading face detector…" forever.
    const HARD_TIMEOUT_MS = 20000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`init timed out after ${HARD_TIMEOUT_MS}ms — check network access to MediaPipe CDN`));
      }, HARD_TIMEOUT_MS);
    });
    try {
      await Promise.race([
        (async () => {
          // WASM build MUST match the JS bundle from the same npm release.
          const wasmBase = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_TASKS_VISION_VERSION}/wasm`;
          console.log('[faceDetect] fetching fileset…', wasmBase);
          const fileset = await FilesetResolver.forVisionTasks(wasmBase);
          console.log('[faceDetect] fileset ready, creating detector…');
          const modelAssetPath =
            'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite';
          // Lower threshold = more recall (small / profile / distant faces).
          // Users can deselect false positives in the UI before export.
          const common = { runningMode: 'VIDEO' as const, minDetectionConfidence: 0.28 };
          // Prefer GPU for faster offline scans; fall back to CPU if WebGL is
          // busy (Recorder selfie segmentation) or GPU init fails.
          try {
            detector = await FaceDetector.createFromOptions(fileset, {
              baseOptions: { modelAssetPath, delegate: 'GPU' },
              ...common
            });
            console.log('[faceDetect] detector ready (GPU delegate)');
          } catch (gpuErr) {
            console.warn('[faceDetect] GPU delegate unavailable, using CPU', gpuErr);
            detector = await FaceDetector.createFromOptions(fileset, {
              baseOptions: { modelAssetPath, delegate: 'CPU' },
              ...common
            });
            console.log('[faceDetect] detector ready (CPU delegate)');
          }
        })(),
        timeout
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  try {
    await initPromise;
  } catch (e) {
    // Reset so a second click retries instead of reusing the
    // rejected promise forever.
    initPromise = null;
    throw e;
  }
}

// Reusable scratch canvas that `detectFacesOnVideo` draws the current
// video frame into before passing it to MediaPipe. Drawing first
// forces Chromium to actually decode the seeked frame into CPU memory
// — passing an `HTMLVideoElement` directly to `detectForVideo` after
// a `seeked` event sometimes returns an empty detection list because
// the frame isn't fully committed yet, even though the video's
// `readyState` says HAVE_CURRENT_DATA. The canvas round-trip is
// cheap and removes that race entirely.
let detectCanvas: HTMLCanvasElement | null = null;
let detectCtx: CanvasRenderingContext2D | null = null;

/**
 * Run detection on the current frame of a video element.
 * `timestampMs` MUST be strictly increasing across calls or MediaPipe
 * will refuse to run in VIDEO mode — we auto-bump it if the caller
 * passes the same ts.
 *
 * Returns face bounding boxes in the video's native pixel space so
 * downstream code doesn't need to know about the detector's internal
 * resolution.
 */
export async function detectFacesOnVideo(
  video: HTMLVideoElement,
  timestampMs: number
): Promise<FaceDetection[]> {
  if (!detector) await initFaceDetector();
  if (!detector) return [];
  if (video.readyState < 2) return [];
  const vw = video.videoWidth || 0;
  const vh = video.videoHeight || 0;
  if (vw === 0 || vh === 0) return [];

  if (!detectCanvas) {
    detectCanvas = document.createElement('canvas');
    detectCtx = detectCanvas.getContext('2d', { willReadFrequently: false });
  }
  if (detectCanvas.width !== vw || detectCanvas.height !== vh) {
    detectCanvas.width = vw;
    detectCanvas.height = vh;
  }
  if (!detectCtx) return [];
  try {
    detectCtx.drawImage(video, 0, 0, vw, vh);
  } catch (e) {
    console.warn('[faceDetect] drawImage failed', e);
    return [];
  }

  let ts = Math.max(timestampMs, lastTs + 1);
  lastTs = ts;

  let result;
  try {
    result = detector.detectForVideo(detectCanvas, ts);
  } catch (e) {
    console.warn('[faceDetect] detectForVideo failed', e);
    return [];
  }
  const out: FaceDetection[] = [];
  for (const d of result.detections ?? []) {
    const bbox = d.boundingBox;
    if (!bbox) continue;
    // MediaPipe Tasks returns integer pixel coordinates in the input
    // image's native resolution (i.e. what we drew on `detectCanvas`).
    // Clamp defensively so downstream code can trust the rect is
    // inside the frame.
    const x = Math.max(0, Math.min(vw - 1, bbox.originX));
    const y = Math.max(0, Math.min(vh - 1, bbox.originY));
    const w = Math.max(1, Math.min(vw - x, bbox.width));
    const h = Math.max(1, Math.min(vh - y, bbox.height));
    const score = d.categories?.[0]?.score ?? 0;
    out.push({ x, y, width: w, height: h, score });
  }
  return out;
}

// Back-compat alias for the old name — the FaceBlur tab imports
// `detectFaces`, but renaming it everywhere would churn more files.
export const detectFaces = detectFacesOnVideo;

export function closeFaceDetector(): void {
  try { detector?.close(); } catch {}
  detector = null;
  initPromise = null;
  lastTs = 0;
}
