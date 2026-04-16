import React, { useEffect, useRef, useState } from 'react';
import type { WebcamEffect, WebcamShape, WebcamSize } from '../../shared/types';
import { EFFECTS, SHAPES, WEBCAM_PX, combinedWebcamFilter } from '../../shared/types';
import { WebcamSegmenter, composeSegmented, computeMaskCentroid, createComposeScratch, SegMode, SegBackendId, type ComposeScratch } from '../lib/segmenter';
import { createAutoFrameState, updateAutoFrame } from '../lib/autoFrame';
import { shapePath } from '../lib/shapes';

type CtrlState = {
  recState: 'idle' | 'recording' | 'paused' | 'finalizing';
  elapsedSec: number;
  finalizingPct?: number;
};

declare global {
  interface Window {
    webcamApi: {
      onConfig: (cb: (c: Config) => void) => () => void;
      resize: (sizeOrDims: number | { width: number; height: number }) => void;
      reportPosition: (pos: { x: number; y: number }) => void;
      notifyChange: (patch: Partial<Config>) => void;
      onControlState: (cb: (s: CtrlState) => void) => () => void;
      ctrlStart: () => void;
      ctrlPauseToggle: () => void;
      ctrlStop: () => void;
      quitApp: () => Promise<void>;
    };
  }
}

function fmtElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

type Config = {
  deviceId?: string;
  shape: WebcamShape;
  size: WebcamSize;
  bgMode: SegMode;
  effect: WebcamEffect;
  zoom: number;
  offsetX: number;
  offsetY: number;
  faceLight: number;
  bgImageData?: string; // data: URL of user-uploaded background
  enabled?: boolean;    // when false, hide the camera bubble (toolbar + HUD only)
  autoCenter?: boolean; // when true, override offsetX/Y with mask centroid
  segBackend?: SegBackendId;
  bgEffect?: WebcamEffect;
  bgBlurPx?: number;
  bgZoom?: number;
  faceBlurPx?: number;
};

const DEFAULT_CFG: Config = {
  shape: 'circle',
  size: 'medium',
  bgMode: 'none',
  effect: 'none',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  faceLight: 0,
  enabled: true,
  autoCenter: false
};

const BG_OPTIONS: { id: SegMode; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'blur', label: 'Blur' },
  { id: 'image', label: 'Image' }
];

const SIZES: WebcamSize[] = ['small', 'medium', 'large'];

// Toolbar + panel area reserved above the circle so the shape isn't cropped.
const CHROME_HEIGHT = 40;
// Padding so border / drop-shadow has room.
const CANVAS_PAD = 12;
// Min width when the config panel is open — the panel itself is 280px wide
// plus the outer .webcam-root padding on each side.
const PANEL_WIDTH = 280;
const PANEL_MIN_WIDTH = PANEL_WIDTH + CANVAS_PAD * 2;
// Height reserved for the embedded recording control HUD beneath the bubble.
const CTRL_HEIGHT = 38;

export default function WebcamOverlay() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segOutRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  // Per-instance scratch canvases for composeSegmented. Owned by this
  // window so its temporal mask smoothing doesn't fight the main
  // compositor's.
  const composeScratchRef = useRef<ComposeScratch>(createComposeScratch());
  const segRef = useRef<WebcamSegmenter | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startOX: number;
    startOY: number;
    px: number;
  } | null>(null);

  const [cfg, setCfg] = useState<Config>(DEFAULT_CFG);
  const cfgRef = useRef<Config>(DEFAULT_CFG);
  // When true, the main window is actively recording and its
  // compositor owns the GPU for segmentation. We skip our own
  // segmenter.process() so the two instances don't contend for
  // WebGL resources (~90 inferences/sec would saturate any GPU).
  const recordingActiveRef = useRef(false);
  // Stateful auto-framing filter. See lib/autoFrame.ts for the rationale
  // behind the smoothing, dead-zone, confidence gate, and step cap.
  const autoFrameRef = useRef(createAutoFrameState());
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const bubbleWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Embedded recording control HUD state. The main process forwards
  // `control:state` here in place of the standalone control window.
  const [ctrlState, setCtrlState] = useState<CtrlState['recState']>('idle');
  const [ctrlElapsed, setCtrlElapsed] = useState(0);
  const [ctrlPct, setCtrlPct] = useState(0);
  useEffect(() => {
    const off = window.webcamApi.onControlState((s) => {
      setCtrlState(s.recState);
      setCtrlElapsed(s.elapsedSec);
      if (typeof s.finalizingPct === 'number') setCtrlPct(s.finalizingPct);
      else if (s.recState !== 'finalizing') setCtrlPct(0);
    });
    return off;
  }, []);

  // Pause our own segmenter while the main window is recording so the
  // GPU isn't running ~90 MediaPipe inferences/sec (60 here + 30 in
  // the compositor). The bubble shows raw camera during recording;
  // background replacement is handled by the recording compositor.
  //
  // When recording STOPS, we reinitialize the segmenter from scratch.
  // During recording the compositor's MediaPipe Graph holds WebGL
  // contexts on the same GPU; Chrome may evict our idle Graph's
  // contexts under memory pressure. If that happens, our process()
  // calls silently produce null masks after resuming and the bubble
  // shows raw camera. A fresh init guarantees new WebGL contexts
  // from the now-freed GPU, so background replacement always comes
  // back cleanly after a recording.
  useEffect(() => {
    const off = (window.webcamApi as any).onRecordingState?.((recording: boolean) => {
      const wasRecording = recordingActiveRef.current;
      recordingActiveRef.current = recording;
      // Reinit the segmenter when transitioning recording → idle.
      if (wasRecording && !recording) {
        const cur = cfgRef.current;
        const needsSeg = cur.bgMode !== 'none' || cur.autoCenter === true;
        if (needsSeg && segRef.current) {
          try { segRef.current.close(); } catch {}
          segRef.current = new WebcamSegmenter(cur.segBackend ?? 'selfie');
          segRef.current.init().catch((e) => {
            console.warn('[Webcam] segmenter reinit after recording failed', e);
          });
        }
      }
    });
    return off;
  }, []);

  // Receive config updates from the main window. We shallow-compare against
  // `cfgRef.current` and skip the React re-render entirely when nothing
  // changed — otherwise the round-trip echo from a slider drag (local → main
  // → Recorder → webcam:open → us) re-renders the controlled <input> and
  // breaks the drag pointer capture mid-stream.
  useEffect(() => {
    const off = window.webcamApi.onConfig(async (incoming) => {
      const prev = cfgRef.current;
      const merged = { ...prev, ...incoming };
      const prevDev = prev.deviceId;
      const prevBg = prev.bgImageData;
      const prevEnabled = prev.enabled !== false;
      const nextEnabled = merged.enabled !== false;

      // Shallow-equal check across every key in the merged config.
      let dirty = false;
      for (const k of Object.keys(merged) as (keyof Config)[]) {
        if ((merged as any)[k] !== (prev as any)[k]) { dirty = true; break; }
      }

      cfgRef.current = merged;
      if (dirty) setCfg(merged);

      if (!nextEnabled) {
        // Camera is being turned off — stop the stream so the OS releases
        // the device, but leave the window itself open.
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          const v = videoRef.current;
          if (v) v.srcObject = null;
        }
      } else if (merged.deviceId !== prevDev || !streamRef.current || !prevEnabled) {
        await openStream(merged.deviceId);
      }

      if (merged.bgImageData && merged.bgImageData !== prevBg) {
        loadBgImage(merged.bgImageData);
      } else if (!merged.bgImageData) {
        bgImgRef.current = null;
      }
      if (dirty) resizeWindowTo(merged.size);
    });
    return off;
  }, []);

  function loadBgImage(dataUrl: string) {
    const img = new Image();
    img.onload = () => { bgImgRef.current = img; };
    img.src = dataUrl;
  }

  function onPickBgImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      loadBgImage(dataUrl);
      updateLocal({ bgImageData: dataUrl, bgMode: 'image' });
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  // Mouse-wheel zoom while hovering anywhere over the floating window.
  // Scroll up = zoom in, down = zoom out. Bound to the window itself so
  // hovering the bubble, the toolbar, or the config panel all work.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cur = cfgRef.current;
      const step = 0.1;
      const delta = e.deltaY < 0 ? step : -step;
      const next = Math.max(1, Math.min(3, +(cur.zoom + delta).toFixed(2)));
      if (next !== cur.zoom) updateLocal({ zoom: next });
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  // Resize the Electron window to fit the current bubble size and, if the
  // config panel is open, the panel below it. We measure the actual panel
  // DOM height so the window grows exactly as much as needed and nothing
  // gets clipped inside the small bubble shape.
  function resizeWindowTo(sz: WebcamSize, withPanel: boolean = panelOpen) {
    const px = WEBCAM_PX[sz];
    const enabled = cfgRef.current.enabled !== false;
    // When the bubble is hidden we still need room for the toolbar above
    // and the embedded HUD below; just no camera area in between.
    const bubbleAreaH = enabled
      ? CANVAS_PAD + CHROME_HEIGHT + px + CANVAS_PAD
      : CANVAS_PAD + CHROME_HEIGHT + CANVAS_PAD;
    const panelH = withPanel && panelRef.current ? panelRef.current.offsetHeight + 10 : 0;
    const minWidth = enabled ? px + CANVAS_PAD * 2 : 220;
    const width = Math.max(minWidth, withPanel ? PANEL_MIN_WIDTH : 0);
    const height = bubbleAreaH + CTRL_HEIGHT + panelH;
    window.webcamApi.resize({ width, height });
  }

  async function openStream(deviceId?: string) {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      streamRef.current = s;
      const v = videoRef.current!;
      v.srcObject = s;
      await v.play().catch(() => {});
    } catch (e) {
      console.warn('webcam overlay failed', e);
    }
  }

  // Resize window whenever the panel opens/closes or the bubble size changes.
  // This must run *after* the DOM updates so we can measure the panel's
  // actual rendered height.
  useEffect(() => {
    resizeWindowTo(cfgRef.current.size, panelOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, cfg.size]);

  // Init segmenter lazily. The initial backend comes from the config
  // the main app sends us (`cfg.segBackend`); subsequent swaps flow
  // through the separate effect below that watches `cfg.segBackend`.
  useEffect(() => {
    segRef.current = new WebcamSegmenter(cfgRef.current.segBackend ?? 'selfie');
    segRef.current.init().catch(() => {});
    return () => segRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hot-swap the segmentation backend when the main app's dropdown
  // changes. `setBackend` is a no-op if the requested backend is
  // already active, so this is cheap.
  useEffect(() => {
    if (!segRef.current) return;
    if (!cfg.segBackend) return;
    segRef.current.setBackend(cfg.segBackend).catch(() => {});
  }, [cfg.segBackend]);

  // Render loop
  useEffect(() => {
    const loop = async () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c && v.readyState >= 2) {
        const cur = cfgRef.current;
        const px = WEBCAM_PX[cur.size];
        if (c.width !== px) { c.width = px; c.height = px; }
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, px, px);

        // Build the face-only filter up front. If a background mode
        // is active we pass it INTO composeSegmented so it's applied
        // only on the face draws; otherwise we apply it on the outer
        // drawImage below. Face blur stacks on top of the colour
        // filter for an optional anonymise/soften look.
        const fl = cur.autoCenter ? 0 : (cur.faceLight || 0);
        const baseFaceFilter = combinedWebcamFilter(cur.effect, fl);
        const fbPx = Math.max(0, Math.min(40, cur.faceBlurPx || 0));
        const faceFilterStr = fbPx > 0
          ? (baseFaceFilter === 'none' ? `blur(${fbPx}px)` : `${baseFaceFilter} blur(${fbPx}px)`)
          : baseFaceFilter;

        // Run the segmenter when we need it for compositing OR when
        // auto-center is on (since the centroid comes from the mask).
        // SKIP entirely while the main window is recording so the GPU
        // isn't saturated with two concurrent segmenters.
        const wantSeg = (cur.bgMode !== 'none' || cur.autoCenter === true)
          && !recordingActiveRef.current;
        let src: CanvasImageSource = v;
        if (wantSeg && segRef.current) {
          await segRef.current.process(v);
          const mask = segRef.current.getMaskCanvas();
          const matted = segRef.current.getMatted();
          if (cur.bgMode !== 'none') {
            const useOffX = cur.autoCenter ? autoFrameRef.current.x : (cur.offsetX || 0);
            const useOffY = cur.autoCenter ? autoFrameRef.current.y : (cur.offsetY || 0);
            src = composeSegmented(
              v, mask, matted, cur.bgMode, bgImgRef.current, segOutRef.current,
              cur.bgEffect ?? 'none', cur.bgBlurPx ?? 0, faceFilterStr,
              cur.zoom, useOffX, useOffY,
              cur.bgZoom ?? 1,
              composeScratchRef.current
            );
          }
          // Auto-center: feed the mask centroid through the shared
          // auto-frame filter.
          if (cur.autoCenter) {
            const ctr = computeMaskCentroid(mask);
            updateAutoFrame(autoFrameRef.current, ctr);
          }
        }

        const sw = (src as HTMLVideoElement).videoWidth || (src as HTMLCanvasElement).width;
        const sh = (src as HTMLVideoElement).videoHeight || (src as HTMLCanvasElement).height;
        // Face zoom / pan are applied inside composeSegmented when a
        // background mode is active; the outer draw just cover-fits at
        // 1×. When there's no background compositing, the outer draw
        // still handles face zoom + pan against the raw video.
        const outerZoom = cur.bgMode === 'none' ? cur.zoom : 1;
        const side = Math.min(sw, sh) / Math.max(1, outerZoom);
        const maxPanX = (sw - side) / 2;
        const maxPanY = (sh - side) / 2;
        const rawOffX = cur.autoCenter ? autoFrameRef.current.x : (cur.offsetX || 0);
        const rawOffY = cur.autoCenter ? autoFrameRef.current.y : (cur.offsetY || 0);
        const useOffsetX = cur.bgMode === 'none' ? rawOffX : 0;
        const useOffsetY = cur.bgMode === 'none' ? rawOffY : 0;
        const sx = Math.max(0, Math.min(sw - side, maxPanX + useOffsetX * maxPanX * 2));
        const sy = Math.max(0, Math.min(sh - side, maxPanY + useOffsetY * maxPanY * 2));

        ctx.save();
        shapePath(ctx, cur.shape, px);
        ctx.clip();
        // Only apply the face filter on the outer draw when there's
        // no background compositing. Otherwise `src` already contains
        // the tinted face + untinted background from composeSegmented
        // and tinting again would bleed into the background.
        ctx.filter = cur.bgMode === 'none' ? faceFilterStr : 'none';
        ctx.drawImage(src, sx, sy, side, side, 0, 0, px, px);
        ctx.filter = 'none';
        ctx.restore();

        // white border along the shape
        ctx.save();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ffffff';
        shapePath(ctx, cur.shape, px);
        ctx.stroke();
        ctx.restore();
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  function updateLocal(patch: Partial<Config>) {
    const next = { ...cfgRef.current, ...patch };
    cfgRef.current = next;
    setCfg(next);
    // Window resizing is handled by the useEffect on [panelOpen, cfg.size].
    window.webcamApi.notifyChange(patch);
  }

  // Mousedown on the centre drag handle: track the pointer and translate
  // horizontal / vertical deltas into offsetX / offsetY updates. Dragging the
  // icon right pans the face right in the frame (we sample further from the
  // left of the source), so the sign is negative. Dragging across the full
  // bubble width maps to the full offset range of 1.0.
  function onHandleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const cur = cfgRef.current;
    const px = WEBCAM_PX[cur.size];
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOX: cur.offsetX ?? 0,
      startOY: cur.offsetY ?? 0,
      px
    };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      const nOX = Math.max(-0.5, Math.min(0.5, d.startOX - dx / d.px));
      const nOY = Math.max(-0.5, Math.min(0.5, d.startOY - dy / d.px));
      updateLocal({ offsetX: nOX, offsetY: nOY });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  const enabled = cfg.enabled !== false;

  return (
    <div className={`webcam-root ${enabled ? '' : 'cam-off'}`}>
      {/* Embedded recording HUD — placed at the top of the floating window */}
      <div className={`embedded-ctrl ${ctrlState}`}>
        <span className={`ec-dot ${ctrlState}`} />
        <span className="ec-timer">
          {ctrlState === 'finalizing' ? `${Math.round(ctrlPct)}%` : fmtElapsed(ctrlElapsed)}
        </span>
        {ctrlState === 'finalizing' ? (
          <div className="ec-progress">
            <div className="ec-progress-fill" style={{ width: `${Math.min(100, Math.max(2, ctrlPct))}%` }} />
          </div>
        ) : (
          <div className="ec-buttons">
            {ctrlState === 'idle' && (
              <>
                <button
                  className="ec-btn start"
                  title="Start recording"
                  onClick={(e) => { e.stopPropagation(); window.webcamApi.ctrlStart(); }}
                >
                  <svg viewBox="0 0 24 24" width="11" height="11"><circle cx="12" cy="12" r="7" fill="currentColor" /></svg>
                </button>
                <button
                  className="ec-btn quit"
                  title="Quit QNSub Studio"
                  aria-label="Quit"
                  onClick={(e) => { e.stopPropagation(); window.webcamApi.quitApp(); }}
                >
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </button>
              </>
            )}
            {(ctrlState === 'recording' || ctrlState === 'paused') && (
              <>
                <button
                  className="ec-btn pause"
                  title={ctrlState === 'paused' ? 'Resume' : 'Pause'}
                  onClick={(e) => { e.stopPropagation(); window.webcamApi.ctrlPauseToggle(); }}
                >
                  {ctrlState === 'paused' ? (
                    <svg viewBox="0 0 24 24" width="11" height="11"><path d="M6 4l14 8-14 8z" fill="currentColor" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="11" height="11"><rect x="6" y="4" width="4" height="16" fill="currentColor" /><rect x="14" y="4" width="4" height="16" fill="currentColor" /></svg>
                  )}
                </button>
                <button
                  className="ec-btn stop"
                  title="Stop"
                  onClick={(e) => { e.stopPropagation(); window.webcamApi.ctrlStop(); }}
                >
                  <svg viewBox="0 0 24 24" width="11" height="11"><rect x="5" y="5" width="14" height="14" fill="currentColor" /></svg>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {enabled && <div className="bubble-wrap" ref={bubbleWrapRef}>
        <div className="bubble">
          <canvas ref={canvasRef} />
          <video ref={videoRef} muted playsInline style={{ display: 'none' }} />
        </div>
        <div className="handle-cluster">
          <button
            className="zoom-btn"
            title="Zoom out"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const next = Math.max(1, +(cfgRef.current.zoom - 0.2).toFixed(2));
              updateLocal({ zoom: next });
            }}
          >−</button>
          <div
            className={`drag-handle ${cfg.autoCenter ? 'disabled' : ''}`}
            title={cfg.autoCenter ? 'Auto-center is on' : 'Drag to reposition your face inside the frame'}
            onMouseDown={(e) => {
              if (cfg.autoCenter) { e.preventDefault(); return; }
              onHandleMouseDown(e);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v18M3 12h18M8 7l-5 5 5 5M16 7l5 5-5 5M7 8l5-5 5 5M7 16l5 5 5-5" />
            </svg>
          </div>
          <button
            className="zoom-btn"
            title="Zoom in"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const next = Math.min(3, +(cfgRef.current.zoom + 0.2).toFixed(2));
              updateLocal({ zoom: next });
            }}
          >+</button>
        </div>
      </div>}

      {/* 3-dots toolbar — moved beneath the bubble. Clicking opens the
          config panel below it (or re-enables the camera when off).
          A maximize button sits to the right so the user can pop the
          main configuration window back into focus without alt-tabbing. */}
      <div className="toolbar toolbar-bottom">
        <button
          className="dots"
          aria-label={enabled ? 'Configure' : 'Show webcam'}
          title={enabled ? 'Configure' : 'Show webcam'}
          onClick={() => {
            if (!enabled) {
              updateLocal({ enabled: true });
              return;
            }
            setPanelOpen((o) => !o);
          }}
        >
          <span /><span /><span />
        </button>
        <button
          className="show-main"
          aria-label="Open main window"
          title="Open the main QNSub Studio window"
          onClick={() => (window as any).webcamApi?.showMainWindow?.()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9V5a1 1 0 0 1 1-1h4" />
            <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
            <path d="M4 15v4a1 1 0 0 0 1 1h4" />
            <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
          </svg>
        </button>
      </div>

      {/* Always-mounted config panel — hidden via CSS when closed instead of
          unmounted, so an in-progress slider drag doesn't lose its DOM
          target if a re-render fires mid-drag. */}
      <div
        ref={panelRef}
        className={`config-panel ${panelOpen ? '' : 'closed'}`}
        onMouseDown={(e) => e.stopPropagation()}
        aria-hidden={!panelOpen}
      >
          <div className="cp-section">
            <label>Shape</label>
            <div className="cp-chips">
              {SHAPES.map((s) => (
                <button
                  key={s}
                  className={`cp-chip ${cfg.shape === s ? 'sel' : ''}`}
                  onClick={() => updateLocal({ shape: s })}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="cp-section">
            <label>Size</label>
            <div className="cp-chips">
              {SIZES.map((s) => (
                <button
                  key={s}
                  className={`cp-chip ${cfg.size === s ? 'sel' : ''}`}
                  onClick={() => updateLocal({ size: s })}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="cp-section">
            <label>Background</label>
            <div className="cp-chips">
              {BG_OPTIONS.map((b) => (
                <button
                  key={b.id}
                  className={`cp-chip ${cfg.bgMode === b.id ? 'sel' : ''}`}
                  onClick={() => updateLocal({ bgMode: b.id })}
                >
                  {b.label}
                </button>
              ))}
            </div>
            {cfg.bgMode === 'image' && (
              <div className="cp-bg-upload">
                <button
                  className="cp-chip"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {cfg.bgImageData ? 'Change image…' : 'Upload image…'}
                </button>
                {cfg.bgImageData && (
                  <button
                    className="cp-chip"
                    onClick={() => {
                      bgImgRef.current = null;
                      updateLocal({ bgImageData: undefined });
                    }}
                  >
                    Clear
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={onPickBgImage}
                />
              </div>
            )}
          </div>

          <div className="cp-section">
            <label>Effect</label>
            <div className="cp-chips">
              {EFFECTS.map((e) => (
                <button
                  key={e}
                  className={`cp-chip ${cfg.effect === e ? 'sel' : ''}`}
                  onClick={() => updateLocal({ effect: e })}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className={`cp-section ${cfg.autoCenter ? 'disabled' : ''}`}>
            <label>Face light <span className="val">{Math.round(cfg.faceLight ?? 0)}</span></label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={cfg.faceLight ?? 0}
              disabled={cfg.autoCenter === true}
              onChange={(e) => updateLocal({ faceLight: Number(e.target.value) })}
            />
            {cfg.autoCenter && (
              <div className="cp-hint">Disabled while Auto-center is on.</div>
            )}
          </div>

          <div className="cp-section">
            <label>Zoom <span className="val">{cfg.zoom.toFixed(1)}×</span></label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={cfg.zoom}
              onChange={(e) => updateLocal({ zoom: Number(e.target.value) })}
            />
          </div>

        </div>
    </div>
  );
}
