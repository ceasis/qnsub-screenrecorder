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
//        - apply a box-blur inside each rect on the canvas
//        - push a `track.requestFrame()` into the MediaRecorder
//      MediaRecorder produces a WebM stream that gets piped straight
//      to ffmpeg, so by the time the playback ends the MP4 is almost
//      done encoding.
//
// Everything runs in the renderer. No native bindings; no ffmpeg
// filter graph; no frame dumps to disk.

import React, { useEffect, useRef, useState } from 'react';
import { detectFaces, initFaceDetector, type FaceDetection } from '../lib/faceDetect';
import { FaceTrackerSession, sampleTrackAt, type FaceTrack } from '../lib/faceTracker';

type Phase = 'idle' | 'detecting' | 'ready' | 'exporting' | 'done' | 'error';

// `window.api` is already declared globally by Recorder.tsx with the
// full MainApi shape; we cast through `any` locally to reach the
// face-blur methods without re-augmenting the global and tripping
// TS2717 across files.
type BlurApi = {
  pickBlurVideo: () => Promise<{ path: string; name: string } | null>;
  pickBlurOutput: (suggestedName: string) => Promise<string | null>;
  blurStreamStart: (opts: { outputPath: string; fps?: number }) => Promise<{ ok: boolean; sessionId?: string; outputPath?: string; error?: string }>;
  blurStreamChunk: (sessionId: string, bytes: ArrayBuffer) => Promise<boolean>;
  blurStreamStop: (sessionId: string, openAfter?: boolean) => Promise<{ ok: boolean; path?: string; error?: string }>;
  blurStreamCancel: (sessionId: string) => Promise<boolean>;
  blurMuxAudio: (opts: { blurredPath: string; sourcePath: string }) => Promise<boolean>;
  readVideoFile: (path: string) => Promise<ArrayBuffer | null>;
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
  // Blur strength in CSS pixels. The actual filter is scaled by the
  // box size at export time so small faces still look blurred.
  const [blurStrength, setBlurStrength] = useState<number>(24);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<boolean>(false);

  // Average wall-clock time (ms) per detection sample. Populated by
  // `detectAllFaces` and reused to estimate export duration. The
  // export pipeline runs roughly the same seek-and-draw loop as
  // detection, so this is a decent proxy for "ms per output frame".
  const [avgSampleMs, setAvgSampleMs] = useState<number>(0);

  // Guards so auto-detect only fires once per loaded video.
  const autoDetectedForPathRef = useRef<string | null>(null);

  // Reset all downstream state whenever we pick a new video so the
  // thumbnails / selection don't leak across sessions.
  function resetForNewVideo() {
    setTracks([]);
    setSelected(new Set());
    setProgress(0);
    setStatusMsg('');
    setErrorMsg('');
    setOutputPath(null);
    setAvgSampleMs(0);
    autoDetectedForPathRef.current = null;
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
          if (
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
  // For each blur rect we draw a shrunk copy of the underlying video
  // into a scratch canvas and blit it back, producing the same
  // pixelation the export pipeline uses — so what you see is what
  // you'll get.
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

    const scratch = document.createElement('canvas');
    const scratchCtx = scratch.getContext('2d')!;
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
        const pad = 0.2;
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const bw = rect.width * (1 + pad * 2);
        const bh = rect.height * (1 + pad * 2);
        const bx = Math.max(0, cx - bw / 2);
        const by = Math.max(0, cy - bh / 2);
        const bx2 = Math.min(c.width, bx + bw);
        const by2 = Math.min(c.height, by + bh);
        const rw = bx2 - bx;
        const rh = by2 - by;
        if (rw <= 0 || rh <= 0) continue;
        const strength = Math.max(6, Math.round(blurStrength * Math.max(rw, rh) / 200));
        const sw = Math.max(2, Math.floor(rw / strength));
        const sh = Math.max(2, Math.floor(rh / strength));
        if (scratch.width !== sw || scratch.height !== sh) {
          scratch.width = sw;
          scratch.height = sh;
        }
        try {
          scratchCtx.drawImage(v, bx, by, rw, rh, 0, 0, sw, sh);
          ctx.drawImage(scratch, 0, 0, sw, sh, bx, by, rw, rh);
        } catch {
          // drawImage can throw briefly during seeks if the video
          // hasn't committed a frame yet — harmless, next tick
          // will redraw.
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
    window.addEventListener('unhandledrejection', origRejection);
    try {
      await detectAllFacesInner();
    } catch (e) {
      console.error('[FaceBlur] detection threw', e);
      setErrorMsg('Detection failed: ' + ((e as Error)?.message || String(e)));
      setPhase('error');
    } finally {
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

    // Sampling density: ~6 detections per second of video. Tracker
    // fills the gaps via linear interpolation, which is accurate
    // enough for face-blur rectangles at any reasonable playback speed.
    const SAMPLES_PER_SEC = 6;
    const totalSamples = Math.max(2, Math.floor(duration * SAMPLES_PER_SEC));
    const stepSec = duration / totalSamples;

    // Scratch canvas for thumbnail cropping — created once.
    const thumbCanvas = document.createElement('canvas');
    const THUMB_SIZE = 96;
    thumbCanvas.width = THUMB_SIZE;
    thumbCanvas.height = THUMB_SIZE;
    const thumbCtx = thumbCanvas.getContext('2d')!;

    const makeThumbnail = (d: FaceDetection): string => {
      if (!v.videoWidth) return '';
      const pad = 0.2;
      const cx = d.x + d.width / 2;
      const cy = d.y + d.height / 2;
      const side = Math.max(d.width, d.height) * (1 + pad * 2);
      const sx = Math.max(0, cx - side / 2);
      const sy = Math.max(0, cy - side / 2);
      const sw = Math.min(v.videoWidth - sx, side);
      const sh = Math.min(v.videoHeight - sy, side);
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
        let settled = false;
        const onSeeked = () => {
          if (settled) return;
          settled = true;
          v.removeEventListener('seeked', onSeeked);
          const vAny = v as HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: () => void) => number;
          };
          if (typeof vAny.requestVideoFrameCallback === 'function') {
            vAny.requestVideoFrameCallback(() => resolve());
          } else {
            setTimeout(resolve, 16);
          }
        };
        v.addEventListener('seeked', onSeeked);
        // Safety timeout so a failed seek can't hang the whole pass.
        setTimeout(() => {
          if (settled) return;
          settled = true;
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

    // Loosen the min-length threshold if the pass found very few
    // samples overall — on short videos (say, a 3-second clip) even
    // a genuine face only gets a handful of samples, so requiring 3
    // rejects everything.
    const minLen = totalDetections < 20 ? 1 : totalDetections < 60 ? 2 : 3;
    const finalTracks = tracker.finalize(minLen);
    console.log(`[FaceBlur] detection done: ${totalDetections} hits → ${finalTracks.length} tracks (minLen=${minLen})`);
    setTracks(finalTracks);
    setSelected(new Set(finalTracks.map((t) => t.id)));
    setProgress(1);
    setStatusMsg(
      finalTracks.length === 0
        ? `No faces found (${totalDetections} detections across ${totalSamples} samples). Try a different clip or ensure faces are well-lit and facing the camera.`
        : `Found ${finalTracks.length} face${finalTracks.length === 1 ? '' : 's'} (${totalDetections} total detections).`
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

    const suggested = (videoName || 'blurred.mp4').replace(/\.[^.]+$/, '') + '_blurred.mp4';
    const out = await api.pickBlurOutput(suggested);
    if (!out) return;
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

    const blurCanvas = document.createElement('canvas');
    const blurCtx = blurCanvas.getContext('2d')!;

    const FPS = 30;

    // Start the ffmpeg session.
    let session: string | null = null;
    try {
      const start = await api.blurStreamStart({ outputPath: out, fps: FPS });
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

    // CRITICAL: capture at a fixed fps, not manual-mode. The manual
    // `captureStream(0)` + `requestFrame()` path injects frames with
    // wall-clock timestamps based on when we called requestFrame,
    // and since our render loop has per-frame seek latency the
    // intervals are noisy. A fixed-rate captureStream tells Chromium
    // to sample the canvas at regular intervals regardless of how
    // often we draw; combined with ffmpeg's `-vsync cfr -r 30` on
    // the far side, this produces a perfectly smooth output.
    const stream = canvas.captureStream(FPS);

    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    const mr = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const pendingChunks: Promise<unknown>[] = [];
    mr.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0 || !session) return;
      const sid = session;
      const p = e.data.arrayBuffer()
        .then((buf) => api.blurStreamChunk(sid, buf))
        .catch(() => false);
      pendingChunks.push(p);
    };

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
        const pad = 0.2;
        const cx = (rect.x + rect.width / 2) * scaleX;
        const cy = (rect.y + rect.height / 2) * scaleY;
        const bw = rect.width * scaleX * (1 + pad * 2);
        const bh = rect.height * scaleY * (1 + pad * 2);
        const bx = Math.max(0, cx - bw / 2);
        const by = Math.max(0, cy - bh / 2);
        const bx2 = Math.min(outW, bx + bw);
        const by2 = Math.min(outH, by + bh);
        const rw = bx2 - bx;
        const rh = by2 - by;
        if (rw <= 0 || rh <= 0) continue;

        const strength = Math.max(6, Math.round(blurStrength * Math.max(rw, rh) / 200));
        const shrinkW = Math.max(2, Math.floor(rw / strength));
        const shrinkH = Math.max(2, Math.floor(rh / strength));
        if (blurCanvas.width !== shrinkW || blurCanvas.height !== shrinkH) {
          blurCanvas.width = shrinkW;
          blurCanvas.height = shrinkH;
        }
        blurCtx.clearRect(0, 0, shrinkW, shrinkH);
        blurCtx.drawImage(canvas, bx, by, rw, rh, 0, 0, shrinkW, shrinkH);
        ctx.save();
        (ctx as any).imageSmoothingEnabled = true;
        (ctx as any).imageSmoothingQuality = 'high';
        ctx.drawImage(blurCanvas, 0, 0, shrinkW, shrinkH, bx, by, rw, rh);
        ctx.restore();
      }

      const pv = previewCanvasRef.current;
      if (pv) {
        if (pv.width !== outW) { pv.width = outW; pv.height = outH; }
        pv.getContext('2d')!.drawImage(canvas, 0, 0);
      }
    };

    const vAny = v as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const waitForFrameCommit = () =>
      new Promise<void>((resolve) => {
        if (typeof vAny.requestVideoFrameCallback === 'function') {
          vAny.requestVideoFrameCallback!(() => resolve());
        } else {
          setTimeout(resolve, 16);
        }
      });

    const seekTo = (t: number) =>
      new Promise<void>((resolve) => {
        let settled = false;
        const onSeeked = () => {
          if (settled) return;
          settled = true;
          v.removeEventListener('seeked', onSeeked);
          waitForFrameCommit().then(() => resolve());
        };
        v.addEventListener('seeked', onSeeked);
        setTimeout(() => {
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

    // Kick off the recorder. With captureStream(FPS) it starts
    // sampling the canvas at a regular cadence immediately, so we
    // draw the frame corresponding to each output time BEFORE the
    // next sample tick fires. The 250ms timeslice keeps chunks
    // flowing to ffmpeg in parallel.
    mr.start(250);

    try {
      // Draw frame 0 before the recorder's first sample tick so the
      // first recorded frame is already blurred.
      await seekTo(0);
      drawFrameAt(0);

      // Paced render loop: produce one canvas frame per output time,
      // then sleep just long enough for the captureStream to sample
      // it. The recorder samples at 1/FPS intervals of wall-clock
      // time, so we target the same wall-clock rhythm. Seek latency
      // usually dominates, which naturally slows the loop — that's
      // fine: captureStream will just hold the last sample and the
      // output is still frame-accurate.
      const frameMs = 1000 / FPS;
      const startWall = performance.now();
      for (let i = 1; i < totalFrames; i++) {
        if (abortRef.current) break;
        const srcTime = i / FPS;
        await seekTo(srcTime);
        drawFrameAt(srcTime);

        // Pace ourselves to the wall clock so captureStream's
        // regular-interval sampler sees one new canvas content per
        // target interval. If we're already behind (seek was slow),
        // just fall through without sleeping.
        const targetWall = startWall + i * frameMs;
        const now = performance.now();
        const lag = targetWall - now;
        if (lag > 1) {
          await new Promise((r) => setTimeout(r, lag));
        }

        if (i % 10 === 0) {
          setProgress(i / totalFrames);
          setStatusMsg(`Rendering… ${Math.round((i / totalFrames) * 100)}%`);
        }
      }
    } catch (e) {
      console.error('[FaceBlur] render loop failed', e);
    }

    // Flush the recorder.
    try { mr.stop(); } catch {}
    await new Promise<void>((resolve) => {
      mr.addEventListener('stop', () => resolve(), { once: true });
    });
    await Promise.allSettled(pendingChunks);

    if (session) {
      setStatusMsg('Finalising video…');
      const fin = await api.blurStreamStop(session, true);
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
        <section className="fb-step">
          <h3>1. Choose video</h3>
          <div className="fb-row">
            <button className="chip" disabled={busy} onClick={pickVideo}>
              {videoName ? 'Change video…' : 'Choose video…'}
            </button>
            {videoName && <span className="muted">{videoName}</span>}
            {!videoName && <span className="muted">…or drag a video file anywhere in this tab</span>}
          </div>
          {videoPath && (
            <div className="fb-video-wrap">
              <video
                ref={videoRef}
                controls={!busy}
                muted={phase === 'exporting'}
                className="fb-video"
                crossOrigin="anonymous"
              />
              <canvas
                ref={overlayCanvasRef}
                className="fb-overlay"
                aria-hidden
              />
            </div>
          )}
        </section>

        {videoPath && (
          <section className="fb-step">
            <h3>2. Detect faces</h3>
            <div className="fb-row">
              <button className="chip sel" disabled={busy} onClick={detectAllFaces}>
                {phase === 'ready' || phase === 'done' ? 'Re-run detection' : 'Detect faces'}
              </button>
              {phase === 'detecting' && (
                <button className="chip" onClick={() => { abortRef.current = true; }}>
                  Cancel
                </button>
              )}
              {statusMsg && <span className="muted">{statusMsg}</span>}
            </div>
            {busy && (
              <div className="fb-progress">
                <div className="fb-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
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
                min={8}
                max={80}
                step={1}
                value={blurStrength}
                onChange={(e) => setBlurStrength(+e.target.value)}
                disabled={busy}
              />
              <span className="muted">{blurStrength}</span>
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
