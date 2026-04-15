// Face Blur tab.
//
// Pipeline, end to end:
//
//   1. User clicks "Choose video". Main process opens a native file
//      dialog and returns an absolute path. We load it via the custom
//      `media://` protocol so the renderer can decode it without
//      tripping file:// CSP restrictions.
//
//   2. The video metadata loads. We kick off a detection pass: run
//      the video at playbackRate=16 while sampling detections every
//      ~100ms of video time via `requestVideoFrameCallback`. Each
//      frame's detections feed the IoU tracker, which links them
//      into per-person tracks.
//
//   3. The tracker's output is rendered as a thumbnail strip. User
//      toggles which tracks to blur. Clicking "Select all" / "Clear"
//      toggles every track at once.
//
//   4. On export we open a streaming ffmpeg session (reusing the
//      existing recorder pipeline), play the video back at 1x, and
//      for every frame:
//        - draw the video into a canvas at the chosen output size
//        - sample each selected track's interpolated rect at the
//          current video time
//        - apply a strong GPU-backed canvas filter blur inside each rect
//        - push a `track.requestFrame()` into the MediaRecorder
//      MediaRecorder produces a WebM stream that gets piped straight
//      to ffmpeg, so by the time the playback ends the MP4 is almost
//      done encoding.
//
// Everything runs in the renderer. No native bindings; no ffmpeg
// filter graph; no frame dumps to disk.

import React, { useEffect, useRef, useState } from 'react';
import { detectFaces, initFaceDetector, closeFaceDetector, type FaceDetection } from '../lib/faceDetect';
import { FaceTrackerSession, sampleTrackAt, type FaceTrack } from '../lib/faceTracker';
import { drawObscuredFaceFromVideo, paddedFaceRect } from '../lib/faceBlurObscure';

/** Same folder as source: `clip.mp4` → `clip-blurred-1430.mp4` (local HHMM). */
function blurOutputPathFromSource(sourcePath: string): string {
  const lastSep = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\'));
  const dir = lastSep >= 0 ? sourcePath.slice(0, lastSep + 1) : '';
  const base = lastSep >= 0 ? sourcePath.slice(lastSep + 1) : sourcePath;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '.mp4';
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dir}${stem}-blurred-${hh}${mm}${ext}`;
}

type Phase = 'idle' | 'detecting' | 'ready' | 'exporting' | 'done' | 'error';

// `window.api` is already declared globally by Recorder.tsx with the
// full MainApi shape; we cast through `any` locally to reach the
// face-blur methods without re-augmenting the global and tripping
// TS2717 across files.
type BlurApi = {
  pickBlurVideo: () => Promise<{ path: string; name: string } | null>;
  blurStreamStart: (opts: { outputPath: string; fps?: number }) => Promise<{ ok: boolean; sessionId?: string; outputPath?: string; error?: string }>;
  blurStreamChunk: (sessionId: string, bytes: ArrayBuffer) => Promise<boolean>;
  blurStreamStop: (sessionId: string, openAfter?: boolean) => Promise<{ ok: boolean; path?: string; error?: string }>;
  blurStreamCancel: (sessionId: string) => Promise<boolean>;
  blurMuxAudio: (opts: { blurredPath: string; sourcePath: string }) => Promise<boolean>;
  readVideoFile: (path: string) => Promise<ArrayBuffer | null>;
  imgStart: (opts: { outputPath: string; fps?: number; width: number; height: number }) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  imgFrame: (sessionId: string, jpegBytes: ArrayBuffer) => Promise<boolean>;
  imgStop: (sessionId: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  imgCancel: (sessionId: string) => Promise<void>;
};
const api: BlurApi = (window as any).api;

export default function FaceBlurTab() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [videoName, setVideoName] = useState<string | null>(null);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [tracks, setTracks] = useState<FaceTrack[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState(0); // 0..1
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [outputPath, setOutputPath] = useState<string | null>(null);
  // Blur strength (8–120): drives Canvas2D `filter: blur()` radius, scaled by face size.
  const [blurStrength, setBlurStrength] = useState<number>(48);
  const [sourceMetaLine, setSourceMetaLine] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<boolean>(false);
  /** Suppresses auto-detect if `loadedmetadata` fires mid-export (rare). */
  const exportingRef = useRef(false);
  // Synchronous guard so rapid clicks / auto-detect-on-load can't
  // kick off two detection passes concurrently. React state `phase`
  // lags by one render tick, so `disabled={busy}` alone isn't enough.
  const detectRunningRef = useRef(false);

  // Average wall-clock time (ms) per detection sample. Populated by
  // `detectAllFaces` and reused to estimate export duration. The
  // export pipeline runs roughly the same seek-and-draw loop as
  // detection, so this is a decent proxy for "ms per output frame".
  const [avgSampleMs, setAvgSampleMs] = useState<number>(0);

  // Guards so auto-detect only fires once per loaded video.
  const autoDetectedForPathRef = useRef<string | null>(null);

  // Reset all downstream state whenever we pick a new video so the
  // thumbnails / selection don't leak across sessions. Also signals
  // any in-flight detection loop to abort (the loop watches
  // `abortRef` on every iteration) and clears the overlay + preview
  // canvases so no ghost frame from the previous video lingers.
  function resetForNewVideo() {
    abortRef.current = true;
    setTracks([]);
    setSelected(new Set());
    setProgress(0);
    setStatusMsg('');
    setErrorMsg('');
    setOutputPath(null);
    setAvgSampleMs(0);
    setSourceMetaLine(null);
    autoDetectedForPathRef.current = null;
    // Clear canvases used by the live blur overlay and the export preview.
    const ov = overlayCanvasRef.current;
    if (ov) {
      const octx = ov.getContext('2d');
      if (octx) octx.clearRect(0, 0, ov.width, ov.height);
    }
    const pv = previewCanvasRef.current;
    if (pv) {
      const pctx = pv.getContext('2d');
      if (pctx) pctx.clearRect(0, 0, pv.width, pv.height);
    }
  }

  async function pickVideo() {
    if (phase === 'detecting' || phase === 'exporting') return;
    const picked = await api.pickBlurVideo();
    if (!picked) return;
    resetForNewVideo();
    setVideoPath(picked.path);
    setVideoName(picked.name);
    setPhase('idle');
  }

  // Drag-and-drop support. Electron's File objects expose a `.path`
  // property with the absolute filesystem path — we use that directly
  // instead of reading the file through FileReader. We prevent the
  // default `dragover` behaviour on the whole `<main>` so dropping
  // anywhere inside the tab works, not just on a specific dropzone.
  const [dragActive, setDragActive] = useState(false);
  function onDragOver(e: React.DragEvent) {
    if (phase === 'detecting' || phase === 'exporting') return;
    e.preventDefault();
    e.stopPropagation();
    if (!dragActive) setDragActive(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Only clear when we leave the main container, not when we move
    // between child elements (which also fires dragleave).
    if (e.currentTarget === e.target) setDragActive(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (phase === 'detecting' || phase === 'exporting') return;
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;
    const f = files[0] as File & { path?: string };
    if (!f.path) {
      setErrorMsg('Could not read dropped file path. Use the "Choose video…" button instead.');
      return;
    }
    // Very light extension check — the main-process pick dialog has
    // the same filter, so keep the two in sync.
    const ok = /\.(mp4|m4v|mov|mkv|webm|avi)$/i.test(f.name);
    if (!ok) {
      setErrorMsg(`"${f.name}" isn't a supported video format.`);
      return;
    }
    resetForNewVideo();
    setVideoPath(f.path);
    setVideoName(f.name);
    setPhase('idle');
  }

  // Attach the picked video to the <video> element.
  //
  // We read the file bytes over IPC and wrap them in a Blob URL.
  // This sidesteps Chromium's media URL safety check which, in
  // Electron 31, rejects custom schemes on <video> elements even
  // when the scheme has `corsEnabled: true` + `stream: true` +
  // `supportFetchAPI: true` registered. The rejection happens
  // before our protocol handler is invoked, so there's nothing we
  // can fix on the main side — Blob URLs are a native browser
  // primitive and don't go through any URL safety check, so they
  // always work.
  //
  // Tradeoff: the whole file is loaded into renderer memory. For
  // typical screen recordings (<500MB) this is fine on any modern
  // machine. If you ever need to handle huge files, switch to a
  // local HTTP server listening on 127.0.0.1 with Range support —
  // that's the other "always works" approach.

  // Tear down the MediaPipe FaceDetector when the user navigates
  // away from the Face Blur tab so the model + WebGL context go
  // back to the OS. Without this, the detector lives forever until
  // the app quits, pinning ~2MB + GPU memory. Reopening the tab
  // lazily re-inits on the next detection pass.
  useEffect(() => {
    return () => {
      try { closeFaceDetector(); } catch {}
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoPath) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    // React effect cleanup trampoline. The async IIFE below stores
    // its cleanup callback here, and the effect's return statement
    // calls it on unmount / re-run.
    let cleanupRef: (() => void) | null = null;

    (async () => {
      console.log('[FaceBlur] reading video file', videoPath);
      setStatusMsg('Loading video…');
      try {
        const buf = await api.readVideoFile(videoPath);
        if (cancelled) return;
        if (!buf) {
          setErrorMsg('Could not read the video file. Check that the path still exists.');
          setPhase('error');
          return;
        }
        const lower = videoPath.toLowerCase();
        const mime =
          lower.endsWith('.mp4') || lower.endsWith('.m4v') ? 'video/mp4' :
          lower.endsWith('.webm') ? 'video/webm' :
          lower.endsWith('.mov') ? 'video/quicktime' :
          lower.endsWith('.mkv') ? 'video/x-matroska' :
          lower.endsWith('.avi') ? 'video/x-msvideo' :
          'video/mp4';
        const blob = new Blob([buf], { type: mime });
        objectUrl = URL.createObjectURL(blob);
        console.log('[FaceBlur] blob URL ready', { size: buf.byteLength, mime });

        const onLoadedMeta = () => {
          console.log('[FaceBlur] loadedmetadata', {
            videoWidth: v.videoWidth,
            videoHeight: v.videoHeight,
            duration: v.duration,
            readyState: v.readyState
          });
          if (v.videoWidth > 0 && v.videoHeight > 0 && isFinite(v.duration) && v.duration > 0) {
            setSourceMetaLine(
              `${v.videoWidth}×${v.videoHeight} · ${formatDuration(Math.round(v.duration))}`
            );
          } else {
            setSourceMetaLine(null);
          }
          if (
            !exportingRef.current &&
            videoPath &&
            autoDetectedForPathRef.current !== videoPath &&
            v.videoWidth > 0 &&
            isFinite(v.duration) &&
            v.duration > 0
          ) {
            autoDetectedForPathRef.current = videoPath;
            setTimeout(() => { detectAllFaces(); }, 0);
          }
        };
        const onError = () => {
          const err = v.error;
          console.error('[FaceBlur] video error', err?.code, err?.message);
          setErrorMsg(
            `Video failed to decode (code ${err?.code ?? '?'}). ` +
            `The file may be in a codec Chromium can't decode — try MP4/H.264 or WebM/VP9.`
          );
        };
        v.addEventListener('loadedmetadata', onLoadedMeta);
        v.addEventListener('error', onError);
        v.src = objectUrl;
        v.load();
        setStatusMsg('');

        // Cleanup sits inside the async IIFE's closure so it can
        // tear down the listeners AND the blob URL together once the
        // effect re-runs or the component unmounts.
        cleanupRef = () => {
          v.removeEventListener('loadedmetadata', onLoadedMeta);
          v.removeEventListener('error', onError);
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
      } catch (e) {
        console.error('[FaceBlur] read file failed', e);
        setErrorMsg('Failed to read video: ' + (e as Error).message);
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      if (cleanupRef) cleanupRef();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [videoPath]);

  // Live blur preview overlay.
  //
  // A canvas positioned on top of the <video> element shows the
  // pixelated blur rectangles for every currently-selected track at
  // the video's current time. The canvas starts transparent and is
  // repainted on:
  //
  //   - `play` / rVFC while playing (for real-time preview)
  //   - `seeked` (when the user drags the native scrubber)
  //   - `loadeddata` (initial first frame)
  //   - selection/strength/track changes (React effect re-run)
  //
  // Same Gaussian-style blur as export (`faceBlurObscure.ts`).
  useEffect(() => {
    const v = videoRef.current;
    const c = overlayCanvasRef.current;
    if (!v || !c) return;
    if (tracks.length === 0 || selected.size === 0) {
      // Nothing to show — clear and bail.
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, c.width, c.height);
      }
      return;
    }

    const selectedTracksArr = tracks.filter((tr) => selected.has(tr.id));

    const draw = () => {
      if (!v.videoWidth || !v.videoHeight) return;
      if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      const t = v.currentTime;
      for (const track of selectedTracksArr) {
        const rect = sampleTrackAt(track, t);
        if (!rect) continue;
        const pr = paddedFaceRect(rect, c.width, c.height);
        if (pr.width < 2 || pr.height < 2) continue;
        try {
          drawObscuredFaceFromVideo(ctx, v, pr.x, pr.y, pr.width, pr.height, pr.x, pr.y, pr.width, pr.height, blurStrength);
        } catch {
          /* seek race */
        }
      }
    };

    const vAny = v as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    let rvfcHandle: number | null = null;
    let rafHandle: number | null = null;
    const tickPlaying = () => {
      if (v.paused || v.ended) return;
      draw();
      if (typeof vAny.requestVideoFrameCallback === 'function') {
        rvfcHandle = vAny.requestVideoFrameCallback!(tickPlaying);
      } else {
        rafHandle = requestAnimationFrame(tickPlaying);
      }
    };
    const onPlay = () => tickPlaying();
    const onSeeked = () => draw();
    const onLoadedData = () => draw();
    const onTimeUpdate = () => {
      // Safety net for browsers where rVFC isn't available — the
      // native `timeupdate` fires ~4x/sec during playback, enough
      // for a visibly-synced preview overlay even without rVFC.
      if (typeof vAny.requestVideoFrameCallback !== 'function') draw();
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadeddata', onLoadedData);
    v.addEventListener('timeupdate', onTimeUpdate);
    // Initial paint against whatever frame is currently showing.
    draw();

    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('loadeddata', onLoadedData);
      v.removeEventListener('timeupdate', onTimeUpdate);
      if (rvfcHandle != null && typeof vAny.cancelVideoFrameCallback === 'function') {
        try { vAny.cancelVideoFrameCallback(rvfcHandle); } catch {}
      }
      if (rafHandle != null) cancelAnimationFrame(rafHandle);
    };
  }, [tracks, selected, blurStrength]);

  async function detectAllFaces() {
    // Outer wrapper: any thrown error or unhandled rejection inside
    // the detection pass used to be swallowed (React event handlers
    // silently eat promise rejections), leaving the UI frozen on
    // whatever partial status we'd set. Catch everything and surface
    // it to the user so "nothing visibly happens" becomes an actual
    // error message on screen with the details they need to debug.
    const origRejection = (ev: PromiseRejectionEvent) => {
      console.error('[FaceBlur] unhandled rejection during detection', ev.reason);
      setErrorMsg(
        'Detection failed: ' +
        (ev.reason instanceof Error ? ev.reason.message : String(ev.reason))
      );
      setPhase('error');
    };
    if (detectRunningRef.current) return;
    detectRunningRef.current = true;
    setPhase('detecting');
    window.addEventListener('unhandledrejection', origRejection);
    try {
      await detectAllFacesInner();
    } catch (e) {
      console.error('[FaceBlur] detection threw', e);
      setErrorMsg('Detection failed: ' + ((e as Error)?.message || String(e)));
      setPhase('error');
    } finally {
      detectRunningRef.current = false;
      window.removeEventListener('unhandledrejection', origRejection);
    }
  }

  async function detectAllFacesInner() {
    const v = videoRef.current;
    if (!v) {
      console.warn('[FaceBlur] no video element');
      return;
    }

    console.log('[FaceBlur] detect clicked', {
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      duration: v.duration,
      readyState: v.readyState,
      src: v.src,
      networkState: v.networkState
    });

    setPhase('detecting');
    setErrorMsg('');
    setStatusMsg('Waiting for video to be ready…');
    setProgress(0);
    abortRef.current = false;

    // Wait up to 10s for metadata + a valid videoWidth. The user can
    // click "Detect" the moment the <video> src is assigned, which
    // fires before `loadedmetadata`. Retrying here is friendlier
    // than erroring out.
    const metaDeadline = Date.now() + 10000;
    while (
      (!v.videoWidth || !v.videoHeight || !isFinite(v.duration) || v.duration <= 0 || v.readyState < 1) &&
      Date.now() < metaDeadline
    ) {
      await new Promise((r) => setTimeout(r, 100));
    }
    console.log('[FaceBlur] after metadata wait', {
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      duration: v.duration,
      readyState: v.readyState,
      networkState: v.networkState,
      error: v.error?.code
    });
    if (!v.videoWidth || !v.videoHeight) {
      setErrorMsg(
        `Video metadata never loaded (networkState=${v.networkState}, readyState=${v.readyState}). ` +
        `Check the console for a [FaceBlur] video error log. The file may be in a codec Chromium can't play.`
      );
      setPhase('error');
      return;
    }

    setStatusMsg('Loading face detector…');
    console.log('[FaceBlur] calling initFaceDetector');
    try {
      await initFaceDetector();
      console.log('[FaceBlur] initFaceDetector resolved');
    } catch (e) {
      console.error('[FaceBlur] initFaceDetector failed', e);
      setErrorMsg('Could not initialise face detector: ' + (e as Error).message);
      setPhase('error');
      return;
    }

    const duration = v.duration || 0;
    console.log('[FaceBlur] pre-loop state', { duration, videoWidth: v.videoWidth, videoHeight: v.videoHeight });
    if (!isFinite(duration) || duration <= 0) {
      setErrorMsg('Could not read video duration.');
      setPhase('error');
      return;
    }

    // Denser temporal sampling improves recall (brief shots, crowd cuts).
    // Cap total seeks so very long files stay usable (~2 min pass budget target).
    const SAMPLES_PER_SEC = 15;
    const MAX_SAMPLES = 2200;
    const totalSamples = Math.max(2, Math.min(MAX_SAMPLES, Math.floor(duration * SAMPLES_PER_SEC)));
    const stepSec = duration / totalSamples;

    // Scratch canvas for thumbnail cropping — created once.
    const thumbCanvas = document.createElement('canvas');
    const THUMB_SIZE = 96;
    thumbCanvas.width = THUMB_SIZE;
    thumbCanvas.height = THUMB_SIZE;
    const thumbCtx = thumbCanvas.getContext('2d')!;

    const makeThumbnail = (d: FaceDetection): string => {
      if (!v.videoWidth) return '';
      const pr = paddedFaceRect({ x: d.x, y: d.y, width: d.width, height: d.height }, v.videoWidth, v.videoHeight);
      const side = Math.max(pr.width, pr.height);
      const cx = pr.x + pr.width / 2;
      const cy = pr.y + pr.height / 2;
      const sx = Math.max(0, Math.min(v.videoWidth - side, cx - side / 2));
      const sy = Math.max(0, Math.min(v.videoHeight - side, cy - side / 2));
      const sw = Math.min(side, v.videoWidth - sx);
      const sh = Math.min(side, v.videoHeight - sy);
      thumbCtx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
      try {
        thumbCtx.drawImage(v, sx, sy, sw, sh, 0, 0, THUMB_SIZE, THUMB_SIZE);
        return thumbCanvas.toDataURL('image/jpeg', 0.7);
      } catch {
        return '';
      }
    };

    const tracker = new FaceTrackerSession();

    // Seek-based sample loop.
    //
    // Two key fixes vs. the original naive version:
    //
    //   1. After the `seeked` event we also wait one
    //      `requestVideoFrameCallback` tick (falling back to a short
    //      setTimeout) so the browser has actually committed the new
    //      frame to the video element. Without this, the detector
    //      occasionally reads the *previous* frame or a blank one,
    //      which is the most common reason for "zero detections".
    //
    //   2. We clamp the seek target to a small offset inside the
    //      video duration. Seeking exactly to `duration` on some
    //      containers never fires `seeked`.
    const seekTo = (t: number) =>
      new Promise<void>((resolve) => {
        let seekedReceived = false;
        let safetyTimer: ReturnType<typeof setTimeout> | null = null;
        const onSeeked = () => {
          if (seekedReceived) return;
          seekedReceived = true;
          v.removeEventListener('seeked', onSeeked);
          // Clear the safety timer as soon as the seeked event fires
          // normally. Without this, each seek leaks a dead 1.5s timer
          // that fires later as a no-op — over a long detection pass
          // that's hundreds of queued timers stacking up.
          if (safetyTimer != null) {
            clearTimeout(safetyTimer);
            safetyTimer = null;
          }
          // Do NOT rely on requestVideoFrameCallback here: this pass keeps the
          // video paused, and Chromium/Electron often never runs rVFC callbacks
          // while paused — the promise would hang forever after "first seek".
          requestAnimationFrame(() => {
            setTimeout(resolve, 32);
          });
        };
        v.addEventListener('seeked', onSeeked);
        // Safety timeout so a failed seek can't hang the whole pass.
        safetyTimer = setTimeout(() => {
          safetyTimer = null;
          if (seekedReceived) return;
          seekedReceived = true;
          v.removeEventListener('seeked', onSeeked);
          resolve();
        }, 1500);
        const target = Math.min(Math.max(0, duration - 0.05), Math.max(0, t));
        // Setting currentTime to the same value doesn't fire `seeked`,
        // which would hang the loop; nudge it slightly in that case.
        if (Math.abs(v.currentTime - target) < 0.001) {
          v.currentTime = target + 0.01;
        } else {
          v.currentTime = target;
        }
      });

    try { v.pause(); } catch (e) { console.warn('[FaceBlur] pause threw', e); }

    console.log('[FaceBlur] entering seek loop', { totalSamples, stepSec });

    const passStartedAt = performance.now();
    let totalDetections = 0;
    for (let i = 0; i < totalSamples; i++) {
      if (abortRef.current) {
        setStatusMsg('Detection cancelled.');
        setPhase('idle');
        return;
      }
      const t = i * stepSec;
      if (i === 0) console.log('[FaceBlur] first seek to', t);
      try {
        await seekTo(t);
      } catch (e) {
        console.warn('[FaceBlur] seek threw at', t, e);
        continue;
      }
      if (i === 0) console.log('[FaceBlur] first seek resolved, running detect');
      let dets: FaceDetection[] = [];
      try {
        dets = await detectFaces(v, Math.floor(t * 1000) + i);
      } catch (e) {
        console.warn('[FaceBlur] detect failed at', t, e);
      }
      if (i === 0) console.log('[FaceBlur] first detect complete', { found: dets.length });
      totalDetections += dets.length;
      try {
        tracker.addFrame(t, dets, makeThumbnail);
      } catch (e) {
        // Thumbnail generation can throw if the canvas is tainted
        // from a cross-origin source. Blob URLs are same-origin but
        // catch anyway so one bad frame can't kill the whole pass.
        console.warn('[FaceBlur] addFrame threw at', t, e);
      }
      if (i % 5 === 0 || i === totalSamples - 1) {
        setProgress((i + 1) / totalSamples);
        setStatusMsg(
          `Detecting faces… ${Math.round(((i + 1) / totalSamples) * 100)}% ` +
          `(${Math.floor(t)}s / ${Math.floor(duration)}s, ${totalDetections} hits)`
        );
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    console.log('[FaceBlur] seek loop finished');

    const passElapsedMs = performance.now() - passStartedAt;
    const perSampleMs = totalSamples > 0 ? passElapsedMs / totalSamples : 0;
    setAvgSampleMs(perSampleMs);

    // Keep shorter tracks when the pass is sparse — avoids dropping
    // people who only appear in a few sampled frames.
    const minLen = totalDetections < 45 ? 1 : totalDetections < 110 ? 2 : 3;
    const finalTracks = tracker.finalize(minLen);
    console.log(`[FaceBlur] detection done: ${totalDetections} hits → ${finalTracks.length} tracks (minLen=${minLen})`);
    setTracks(finalTracks);
    setSelected(new Set(finalTracks.map((t) => t.id)));
    setProgress(1);
    setStatusMsg(
      finalTracks.length === 0
        ? `No faces found (${totalDetections} detections across ${totalSamples} samples). Try a different clip or ensure faces are well-lit and facing the camera.`
        : `Found ${finalTracks.length} track${finalTracks.length === 1 ? '' : 's'} (${totalDetections} raw detections). Deselect logos or false hits before export.`
    );
    setPhase('ready');
    try { v.currentTime = 0; } catch {}
  }

  function toggleTrack(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(tracks.map((t) => t.id)));
  }
  function clearAll() {
    setSelected(new Set());
  }

  async function doExport() {
    const v = videoRef.current;
    if (!v || !videoPath) return;
    if (selected.size === 0) {
      setErrorMsg('Select at least one face to blur.');
      return;
    }

    const out = blurOutputPathFromSource(videoPath);
    setOutputPath(out);

    v.pause();
    v.currentTime = 0;

    // Render resolution: cap at 1080p on the long edge, keep aspect
    // ratio, force even dimensions for H.264.
    const srcW = v.videoWidth;
    const srcH = v.videoHeight;
    const maxDim = 1080;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const outW = Math.round(srcW * scale / 2) * 2;
    const outH = Math.round(srcH * scale / 2) * 2;

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { alpha: false })!;

    const FPS = 30;

    // Image-pipe encoder: push individual JPEG frames to ffmpeg.
    // Each frame is exactly 1/FPS seconds — no wall-clock timestamps,
    // no MediaRecorder, no WebM. This guarantees output duration
    // matches source duration regardless of seek latency.
    let session: string | null = null;
    try {
      const start = await api.imgStart({ outputPath: out, fps: FPS, width: outW, height: outH });
      if (!start.ok || !start.sessionId) {
        setErrorMsg('Could not start encoder: ' + (start.error || 'unknown'));
        setPhase('error');
        return;
      }
      session = start.sessionId;
    } catch (e) {
      setErrorMsg('Encoder error: ' + (e as Error).message);
      setPhase('error');
      return;
    }

    // Off-main-thread JPEG encoder. OffscreenCanvas.convertToBlob()
    // runs the encode on a worker thread in modern Chromium, so the
    // main thread can already be seeking / drawing the next frame
    // while the previous one encodes. Falls back to the plain
    // `canvas.toBlob` path on browsers where OffscreenCanvas isn't
    // available (Electron 31 has it, but the fallback keeps the
    // pipeline working if we ever move to an older runtime).
    let encodeCanvas: OffscreenCanvas | null = null;
    let encodeCtx: OffscreenCanvasRenderingContext2D | null = null;
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        encodeCanvas = new OffscreenCanvas(outW, outH);
        encodeCtx = encodeCanvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D | null;
      } catch {
        encodeCanvas = null;
        encodeCtx = null;
      }
    }
    const canvasToJpegFast = async (): Promise<ArrayBuffer> => {
      if (encodeCanvas && encodeCtx) {
        encodeCtx.drawImage(canvas, 0, 0);
        const blob = await encodeCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
        return await blob.arrayBuffer();
      }
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('toBlob returned null')); return; }
          blob.arrayBuffer().then(resolve, reject);
        }, 'image/jpeg', 0.92);
      });
    };

    exportingRef.current = true;
    try {
      setPhase('exporting');
    setProgress(0);
    setStatusMsg('Rendering blurred video…');
    abortRef.current = false;

    const selectedTracks = tracks.filter((t) => selected.has(t.id));
    const duration = v.duration || 0;
    const totalFrames = Math.max(1, Math.floor(duration * FPS));
    const scaleX = outW / srcW;
    const scaleY = outH / srcH;

    const drawFrameAt = (srcTime: number) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(v, 0, 0, outW, outH);

      for (const track of selectedTracks) {
        const rect = sampleTrackAt(track, srcTime);
        if (!rect) continue;
        const padV = paddedFaceRect(rect, srcW, srcH);
        const dx = padV.x * scaleX;
        const dy = padV.y * scaleY;
        const dw = padV.width * scaleX;
        const dh = padV.height * scaleY;
        if (dw < 2 || dh < 2) continue;
        drawObscuredFaceFromVideo(ctx, v, padV.x, padV.y, padV.width, padV.height, dx, dy, dw, dh, blurStrength);
      }

      const pv = previewCanvasRef.current;
      if (pv) {
        if (pv.width !== outW) { pv.width = outW; pv.height = outH; }
        pv.getContext('2d')!.drawImage(canvas, 0, 0);
      }
    };

    // Paused export: never use requestVideoFrameCallback after seek — it
    // often never fires while paused (same Chromium issue as detection).
    const waitAfterSeeked = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 32);
        });
      });

    const seekTo = (t: number) =>
      new Promise<void>((resolve) => {
        let settled = false;
        let safetyTimer: ReturnType<typeof setTimeout> | null = null;
        const onSeeked = () => {
          if (settled) return;
          settled = true;
          v.removeEventListener('seeked', onSeeked);
          if (safetyTimer != null) {
            clearTimeout(safetyTimer);
            safetyTimer = null;
          }
          waitAfterSeeked().then(() => resolve());
        };
        v.addEventListener('seeked', onSeeked);
        safetyTimer = setTimeout(() => {
          safetyTimer = null;
          if (settled) return;
          settled = true;
          v.removeEventListener('seeked', onSeeked);
          resolve();
        }, 1500);
        const target = Math.min(Math.max(0, duration - 0.01), Math.max(0, t));
        if (Math.abs(v.currentTime - target) < 0.001) {
          v.currentTime = target + 0.001;
        } else {
          v.currentTime = target;
        }
      });

    try {
      // Pipelined render loop: while the PREVIOUS frame's encode +
      // IPC send is running on a worker thread / async handler, the
      // main thread is already seeking + drawing the NEXT frame.
      // This nearly doubles export throughput because the seek
      // latency (~70ms) and the JPEG encode (~5-10ms) overlap
      // instead of running serially.
      //
      // Correctness: back-pressure is still enforced by awaiting the
      // previous frame's in-flight promise before starting a new
      // one, so we never queue up more than one frame in flight at
      // a time.
      let pendingSend: Promise<boolean> | null = null;
      let sendFailed = false;

      for (let i = 0; i < totalFrames; i++) {
        if (abortRef.current) break;
        if (sendFailed) break;
        const srcTime = i / FPS;
        await seekTo(srcTime);
        drawFrameAt(srcTime);
        const jpeg = await canvasToJpegFast();

        // Wait for the previous frame's send to complete before
        // starting the current one — one-deep queue keeps memory
        // bounded while still letting the seek overlap the encode.
        if (pendingSend) {
          const ok = await pendingSend;
          if (!ok) { sendFailed = true; break; }
        }
        // Kick off this frame's send without awaiting.
        pendingSend = api.imgFrame(session!, jpeg);

        if (i % 5 === 0 || i === totalFrames - 1) {
          setProgress((i + 1) / totalFrames);
          setStatusMsg(`Rendering… ${Math.round(((i + 1) / totalFrames) * 100)}% (frame ${i + 1} / ${totalFrames})`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      // Drain the final in-flight send before closing ffmpeg.
      if (pendingSend) {
        const ok = await pendingSend;
        if (!ok) sendFailed = true;
      }
      if (sendFailed) {
        setErrorMsg('Encoder stopped accepting frames.');
        setPhase('error');
        if (session) { try { await api.imgCancel(session); } catch {} }
        return;
      }
    } catch (e) {
      console.error('[FaceBlur] render loop failed', e);
    }

    // Close ffmpeg. On a clean finish we `imgStop` which closes
    // stdin and waits for ffmpeg to write the moov atom. On abort we
    // `imgCancel` which SIGKILLs the child and skips the waiting
    // step — otherwise cancelling an export would still block for
    // a second or two while ffmpeg flushes what it has, and would
    // leave a partial / corrupted MP4 on disk.
    if (session) {
      if (abortRef.current) {
        try { await api.imgCancel(session); } catch {}
        setStatusMsg('Export cancelled.');
        setPhase('idle');
        setProgress(0);
        return;
      }
      setStatusMsg('Finalising video…');
      const fin = await api.imgStop(session);
      if (!fin.ok) {
        setErrorMsg('Encoder finished with error: ' + (fin.error || 'unknown'));
        setPhase('error');
        return;
      }
    }

    // Second pass: mux the original audio track from the source
    // video into the rendered (video-only) MP4 so the blurred
    // export keeps its soundtrack. We do this as a post-process
    // because the MediaRecorder stream has no audio — feeding the
    // source video's audio into the same stream would force us back
    // onto playback-based timing, which is what caused the jitter
    // in the first place.
    try {
      setStatusMsg('Adding audio…');
      const ok = await api.blurMuxAudio({ blurredPath: out, sourcePath: videoPath });
      if (!ok) {
        console.warn('[FaceBlur] audio mux failed (export still valid, just silent)');
      }
    } catch (e) {
      console.warn('[FaceBlur] audio mux error', e);
    }

    setPhase('done');
    setStatusMsg('Export complete.');
    setProgress(1);
    } finally {
      exportingRef.current = false;
    }
  }

  function cancelExport() {
    abortRef.current = true;
    const v = videoRef.current;
    if (v) { try { v.pause(); } catch {} }
  }

  const busy = phase === 'detecting' || phase === 'exporting';

  // Rough wall-clock estimate of how long an export will take, based
  // on the average time-per-sample observed during detection. The
  // export loop runs at 30fps and does one seek + draw + blur per
  // output frame, which is the same cost profile as detection — so
  // we just multiply. Add a couple of seconds for ffmpeg's moov
  // flush and the audio mux pass.
  const estimatedExportSec: number | null = (() => {
    const v = videoRef.current;
    if (!v || !avgSampleMs || !isFinite(v.duration) || v.duration <= 0) return null;
    const totalFrames = Math.floor(v.duration * 30);
    const sec = Math.ceil((totalFrames * avgSampleMs) / 1000) + 3;
    return sec;
  })();

  return (
    <>
      <div className="tab-toolbar">
        <div className="status">Face Blur</div>
      </div>
      <main
        className={`faceblur ${dragActive ? 'drag-active' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <section className="fb-step fb-step--source">
          <div className="fb-source-head">
            <span className="fb-source-badge" aria-hidden>
              1
            </span>
            <div className="fb-source-head-text">
              <h3 className="fb-source-title">Source video</h3>
              <p className="fb-source-lead">
                Local file · MP4, WebM, MOV, MKV, AVI — processed on this machine only.
              </p>
            </div>
          </div>

          {!videoPath ? (
            <div className={`fb-upload-drop ${dragActive ? 'fb-upload-drop--active' : ''}`}>
              <div className="fb-upload-drop-icon" aria-hidden>
                <svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="8" y="14" width="40" height="28" rx="4" stroke="currentColor" strokeWidth="1.75" opacity="0.9" />
                  <path d="M8 22h40" stroke="currentColor" strokeWidth="1.25" opacity="0.35" />
                  <path d="M18 14v-3a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v3M32 14v-3a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
                  <path d="M28 26v10M23 31h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <p className="fb-upload-drop-title">Drop your clip here</p>
              <p className="fb-upload-drop-sub">Release to load · or pick a file with the button below</p>
              <button type="button" className="fb-upload-primary" disabled={busy} onClick={pickVideo}>
                Choose video…
              </button>
            </div>
          ) : (
            <div className="fb-source-loaded">
              <div className="fb-source-file">
                <div className="fb-source-file-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="2" y="5" width="20" height="14" rx="2" />
                    <path d="M10 9l5 3.5-5 3.5V9z" fill="currentColor" stroke="none" />
                  </svg>
                </div>
                <div className="fb-source-file-info">
                  <span className="fb-source-file-name">{videoName}</span>
                  {sourceMetaLine && <span className="fb-source-file-meta">{sourceMetaLine}</span>}
                </div>
                <button type="button" className="fb-source-file-change chip" disabled={busy} onClick={pickVideo}>
                  Change…
                </button>
              </div>
              <div className="fb-video-wrap">
                <video
                  ref={videoRef}
                  controls={!busy}
                  muted={phase === 'exporting'}
                  className="fb-video"
                  crossOrigin="anonymous"
                />
                <canvas ref={overlayCanvasRef} className="fb-overlay" aria-hidden />
              </div>
            </div>
          )}
        </section>

        {videoPath && (
          <section className="fb-step">
            <h3>2. Detect faces</h3>
            <div className="fb-row">
              <button className="chip sel" disabled={busy} onClick={detectAllFaces}>
                {phase === 'exporting'
                  ? 'Exporting…'
                  : phase === 'ready' || phase === 'done'
                    ? 'Re-run detection'
                    : 'Detect faces'}
              </button>
              {phase === 'detecting' && (
                <button className="chip" onClick={() => { abortRef.current = true; }}>
                  Cancel
                </button>
              )}
              {phase === 'detecting' && statusMsg && (
                <span className="muted">{statusMsg}</span>
              )}
            </div>
            {phase === 'detecting' && (
              <div className="fb-progress">
                <div className="fb-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
            {phase === 'ready' && tracks.length > 0 && (
              <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 12 }}>
                Next: scroll down to <strong>select faces</strong>, then <strong>Export blurred MP4</strong>.
              </p>
            )}
          </section>
        )}

        {tracks.length > 0 && (
          <section className="fb-step">
            <h3>3. Select faces to blur</h3>
            <div className="fb-row">
              <button className="chip" onClick={selectAll}>Select all</button>
              <button className="chip" onClick={clearAll}>Deselect all</button>
              <span className="muted">{selected.size} of {tracks.length} selected</span>
            </div>
            <div className="fb-thumbs">
              {tracks.map((t) => (
                <button
                  key={t.id}
                  className={`fb-thumb ${selected.has(t.id) ? 'sel' : ''}`}
                  onClick={() => toggleTrack(t.id)}
                  title={`Face seen ${formatTime(t.start)} - ${formatTime(t.end)}`}
                >
                  {t.thumbnail ? (
                    <img src={t.thumbnail} alt="face" />
                  ) : (
                    <div className="fb-thumb-fallback">?</div>
                  )}
                  <span className="fb-thumb-time">
                    {formatTime(t.start)}–{formatTime(t.end)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {tracks.length > 0 && (
          <section className="fb-step">
            <h3>4. Blur strength</h3>
            <div className="fb-row">
              <input
                type="range"
                min={12}
                max={120}
                step={1}
                value={blurStrength}
                onChange={(e) => setBlurStrength(+e.target.value)}
                disabled={busy}
              />
              <span className="muted">{blurStrength} — lower = lighter blur, higher = stronger blur</span>
            </div>
          </section>
        )}

        {tracks.length > 0 && (
          <section className="fb-step">
            <h3>5. Export</h3>
            <div className="fb-row">
              <button
                className="chip sel"
                disabled={busy || selected.size === 0}
                onClick={doExport}
              >
                Export blurred MP4
              </button>
              {phase === 'exporting' && (
                <button className="chip" onClick={cancelExport}>Cancel</button>
              )}
              {phase === 'exporting' && statusMsg && (
                <span className="muted">{statusMsg}</span>
              )}
              {estimatedExportSec != null && phase !== 'exporting' && phase !== 'done' && (
                <span className="muted">
                  Estimated time: {formatDuration(estimatedExportSec)}
                </span>
              )}
              {outputPath && phase === 'done' && (
                <span className="muted">Saved to {outputPath}</span>
              )}
            </div>
            {phase === 'exporting' && (
              <>
                <div className="fb-progress">
                  <div className="fb-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <canvas ref={previewCanvasRef} className="fb-preview" />
              </>
            )}
          </section>
        )}

        {errorMsg && <div className="fb-error">{errorMsg}</div>}
      </main>
    </>
  );
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

// Human-friendly duration used for the export estimate. Short values
// read as seconds, longer ones as `Nm Ns`, very long ones as `Nh Nm`.
function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const ss = s % 60;
  if (m < 60) return ss === 0 ? `${m}m` : `${m}m ${ss}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
}
