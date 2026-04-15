import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnnotationColor,
  Arrow,
  ArrowStyle,
  RegionResult,
  ScreenSource,
  WebcamEffect,
  WebcamShape,
  WebcamSize
} from '../../shared/types';
import { ANNOTATION_COLORS, ANNOTATION_PRESETS, ARROW_STYLES, COLOR_HEX, EFFECTS, SHAPES as ALL_SHAPES } from '../../shared/types';
import { Compositor, WebcamSettings, type TextOverlay, type TextOverlayEffect } from '../lib/compositor';
import { getMicStream, getWebcamStream, listCameras, listMics } from '../lib/webcam';
import { getScreenStream } from '../lib/screen';
import { Recorder as MR, mixAudioStreams } from '../lib/mediaRecorder';
import {
  createVoiceChanger,
  VOICE_PRESETS,
  voicePresetLabel,
  type VoiceChangerHandle,
  type VoicePreset
} from '../lib/voiceChanger';
import type { SegMode, SegBackendId } from '../lib/segmenter';
import { detectBestBackend } from '../lib/segmenter';
import { Help } from './Help';
import { usePersistedState } from './usePersistedState';
import { DID_YOU_KNOW_TIPS } from '../../shared/tips';

declare global {
  interface Window {
    api: {
      listSources: () => Promise<ScreenSource[]>;
      openRegion: () => Promise<boolean>;
      onRegionResult: (cb: (r: RegionResult) => void) => () => void;
      onRegionCancel: (cb: () => void) => () => void;
      showCountdown: (opts?: { seconds: number; style: 'numbers' | 'bar' }) => Promise<void>;
      openAnnotation: () => Promise<boolean>;
      closeAnnotation: () => Promise<boolean>;
      setAnnotationColor: (c: AnnotationColor) => void;
      setAnnotationThickness: (t: number) => void;
      setAnnotationOutline: (c: AnnotationColor | null) => void;
      setAnnotationStyle: (s: string) => void;
      onAnnotationArrow: (cb: (a: Arrow) => void) => () => void;
      onTogglePause: (cb: () => void) => () => void;
      saveRecording: (buf: ArrayBuffer, folder?: string, openAfter?: boolean) => Promise<{ canceled: boolean; path?: string }>;
      onSaveProgress: (cb: (percent: number) => void) => () => void;
      streamStart: (opts: { folder?: string; fps?: number }) => Promise<{ ok: boolean; sessionId?: string; outputPath?: string; projectFolder?: string; error?: string }>;
      streamChunk: (sessionId: string, bytes: ArrayBuffer) => Promise<boolean>;
      streamStop: (sessionId: string, openAfter?: boolean) => Promise<{ ok: boolean; path?: string; folder?: string; error?: string }>;
      streamCancel: (sessionId: string) => Promise<boolean>;
      getDefaultFolder: () => Promise<string>;
      getDownloadsFolder: () => Promise<string>;
      pickFolder: () => Promise<string | null>;
      showError: (msg: string) => Promise<void>;
      openWebcamOverlay: (cfg: WebcamOverlayCfg) => Promise<boolean>;
      updateWebcamOverlay: (cfg: WebcamOverlayCfg) => Promise<boolean>;
      closeWebcamOverlay: () => Promise<boolean>;
      onWebcamLocalChange: (cb: (patch: Partial<WebcamOverlayCfg>) => void) => () => void;
      startCursorTracking: () => Promise<boolean>;
      stopCursorTracking: () => Promise<boolean>;
      onCursorPos: (cb: (p: { x: number; y: number; displayX: number; displayY: number; displayW: number; displayH: number }) => void) => () => void;
      toggleIdiotBoard: () => Promise<boolean>;
      closeIdiotBoard: () => Promise<boolean>;
      getCursorPos: () => Promise<{ x: number; y: number; displayX: number; displayY: number; displayW: number; displayH: number; displayId: string } | null>;
    };
  }
}

type WebcamOverlayCfg = {
  deviceId?: string;
  shape: WebcamShape;
  size: WebcamSize;
  bgMode: 'none' | 'blur' | 'image';
  effect: WebcamEffect;
  zoom: number;
  offsetX: number;
  offsetY: number;
  faceLight: number;
  bgImageData?: string;
  enabled?: boolean;
  autoCenter?: boolean;
  segBackend?: SegBackendId;
  bgEffect?: WebcamEffect;
  bgBlurPx?: number;
  bgZoom?: number;
  faceBlurPx?: number;
};

const SHAPES: WebcamShape[] = ALL_SHAPES;
const SIZES: WebcamSize[] = ['small', 'medium', 'large'];
const BG_MODES: { id: SegMode; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'blur', label: 'Blur' },
  { id: 'image', label: 'Image' }
];
const COLORS: AnnotationColor[] = ANNOTATION_COLORS;

// Preset palette for the Fixed Text colour picker. Tuned for high
// contrast against both dark and busy backgrounds; the first entry
// (white) is the default.
const FIXED_TEXT_COLOR_PRESETS: string[] = [
  '#ffffff', // white
  '#000000', // black
  '#ff3b30', // red
  '#ff9500', // orange
  '#ffcc00', // yellow
  '#34c759', // green
  '#00e5ff', // cyan
  '#0a84ff', // blue
  '#af52de', // purple
  '#ff2d92'  // pink
];

// Fonts offered in the Fixed Text family dropdown. Shared between the
// dropdown render and the Randomise button so they can't drift.
const FIXED_TEXT_FONTS: string[] = [
  'Arial',
  'Arial Black',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Impact',
  'Comic Sans MS',
  'Verdana',
  'Trebuchet MS',
  'Tahoma',
  'Segoe UI',
  'Consolas'
];

// HH:MM:SS for the recording timer. Hours are omitted under an hour.
function fmtElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}

// Tiny inline-SVG icon map used in the Webcam panel chip buttons.
const SHAPE_LABELS: Record<WebcamShape, string> = {
  circle: 'Circle',
  rect: 'Square',
  wide: 'Rectangle',
  squircle: 'Squircle',
  hexagon: 'Hexagon',
  diamond: 'Diamond',
  heart: 'Heart',
  star: 'Star'
};

const SHAPE_ICONS: Record<WebcamShape, React.ReactNode> = {
  circle: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" /></svg>,
  rect: <svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1" /></svg>,
  wide: <svg viewBox="0 0 16 16"><rect x="1" y="5" width="14" height="6" rx="1" /></svg>,
  squircle: <svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="4" /></svg>,
  hexagon: <svg viewBox="0 0 16 16"><polygon points="8,2 14,5 14,11 8,14 2,11 2,5" /></svg>,
  diamond: <svg viewBox="0 0 16 16"><polygon points="8,2 14,8 8,14 2,8" /></svg>,
  heart: <svg viewBox="0 0 16 16"><path d="M8 14s-5-3.2-5-7a3 3 0 0 1 5-2 3 3 0 0 1 5 2c0 3.8-5 7-5 7z" /></svg>,
  star: <svg viewBox="0 0 16 16"><polygon points="8,2 10,6.5 15,7 11,10.5 12,15 8,12.5 4,15 5,10.5 1,7 6,6.5" /></svg>
};

const SIZE_ICONS: Record<WebcamSize, React.ReactNode> = {
  small: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" /></svg>,
  medium: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" /></svg>,
  large: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" /></svg>
};

const BG_ICONS: Record<SegMode, React.ReactNode> = {
  none: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="6" /><line x1="3.5" y1="12.5" x2="12.5" y2="3.5" /></svg>,
  blur: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="2" /><circle cx="8" cy="8" r="4.5" opacity=".6" /><circle cx="8" cy="8" r="7" opacity=".3" /></svg>,
  image: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="12" height="10" rx="1" /><circle cx="6" cy="7" r="1" fill="currentColor" /><path d="M2 11l3-3 3 3 2-2 4 4" /></svg>
};

function ArrowStyleIcon({ id }: { id: ArrowStyle }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'arrow':
      return <svg viewBox="0 0 16 16" {...common}><line x1="2" y1="13" x2="13" y2="3" /><polyline points="8,3 13,3 13,8" /></svg>;
    case 'line':
      return <svg viewBox="0 0 16 16" {...common}><line x1="2" y1="13" x2="14" y2="3" /></svg>;
    case 'double':
      return <svg viewBox="0 0 16 16" {...common}><line x1="3" y1="13" x2="13" y2="3" /><polyline points="8,3 13,3 13,8" /><polyline points="3,8 3,13 8,13" /></svg>;
    case 'curve':
      return <svg viewBox="0 0 16 16" {...common}><path d="M2 13 Q 4 4, 13 3" /><polyline points="9,3 13,3 13,7" /></svg>;
    case 'circle':
      return <svg viewBox="0 0 16 16" {...common}><circle cx="8" cy="8" r="5" /></svg>;
    case 'box':
      return <svg viewBox="0 0 16 16" {...common}><rect x="3" y="4" width="10" height="8" rx="0.5" /></svg>;
    case 'highlight':
      return <svg viewBox="0 0 16 16"><rect x="2" y="6" width="12" height="4" rx="2" fill="currentColor" opacity="0.55" /></svg>;
  }
}

const EFFECT_ICONS: Record<WebcamEffect, React.ReactNode> = {
  none: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="6" /><line x1="3.5" y1="12.5" x2="12.5" y2="3.5" /></svg>,
  grayscale: <svg viewBox="0 0 16 16"><path d="M8 2a6 6 0 0 0 0 12z" /><path d="M8 2a6 6 0 0 1 0 12z" fillOpacity=".35" /></svg>,
  sepia: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6" /><path d="M5 9c1 1.5 5 1.5 6 0" /></svg>,
  vintage: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2.5" y="3" width="11" height="10" rx="1" /><circle cx="8" cy="8" r="2.5" /></svg>,
  cool: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2v12M3 5l10 6M13 5L3 11" /></svg>,
  warm: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" /></svg>,
  vivid: <svg viewBox="0 0 16 16"><circle cx="5.5" cy="7" r="3" opacity=".7" /><circle cx="10.5" cy="7" r="3" opacity=".7" /><circle cx="8" cy="11" r="3" opacity=".7" /></svg>,
  dramatic: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 14L8 2l6 12z" /></svg>
};

export default function RecorderTab() {
  // One-shot localStorage maintenance on mount.
  //
  //   1. Remove `rec.webcamAutoRelocate` — a key from the removed
  //      auto-relocate feature. Harmless but dead data.
  //   2. If `rec.bgImageData` holds an oversized base64 PNG from
  //      before the upload-time downscale was added, re-decode and
  //      re-compress it as a ≤1920-wide JPEG at 0.85 quality. Keeps
  //      localStorage slim for users who uploaded before the fix.
  //
  // Wrapped in try/catch because bad localStorage state (quota full,
  // bad base64) shouldn't block the Recorder from rendering.
  useEffect(() => {
    try {
      localStorage.removeItem('rec.webcamAutoRelocate');
    } catch {}
    try {
      const raw = localStorage.getItem('rec.bgImageData');
      if (!raw) return;
      // Stored values are wrapped in JSON quotes by usePersistedState.
      let parsed: string;
      try { parsed = JSON.parse(raw); } catch { return; }
      if (typeof parsed !== 'string' || !parsed.startsWith('data:image/')) return;
      // 1.5 MB cutoff. Anything larger gets re-encoded.
      if (parsed.length < 1_500_000) return;
      const img = new Image();
      img.onload = () => {
        try {
          const MAX = 1920;
          const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const cctx = c.getContext('2d');
          if (!cctx) return;
          cctx.drawImage(img, 0, 0, w, h);
          const smaller = c.toDataURL('image/jpeg', 0.85);
          if (smaller.length < parsed.length) {
            localStorage.setItem('rec.bgImageData', JSON.stringify(smaller));
            console.log('[Recorder] compressed stored bgImageData', parsed.length, '→', smaller.length);
          }
        } catch {}
      };
      img.src = parsed;
    } catch {}
  }, []);

  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = usePersistedState<string | undefined>('rec.cameraId', undefined);
  const [micId, setMicId] = usePersistedState<string | undefined>('rec.micId', undefined);
  const [includeSystemAudio, setIncludeSystemAudio] = usePersistedState<boolean>('rec.sysAudio', true);
  const [includeMic, setIncludeMic] = usePersistedState<boolean>('rec.mic', true);
  const [voicePreset, setVoicePreset] = usePersistedState<VoicePreset>('rec.voicePreset', 'off');
  const [voicePitch, setVoicePitch] = usePersistedState<number>('rec.voicePitch', 0);
  const [includeWebcam, setIncludeWebcam] = usePersistedState<boolean>('rec.webcam', true);

  const [shape, setShape] = usePersistedState<WebcamShape>('rec.shape', 'circle');
  const [size, setSize] = usePersistedState<WebcamSize>('rec.size', 'medium');
  const [bgMode, setBgMode] = usePersistedState<SegMode>('rec.bgMode', 'none');
  const [effect, setEffect] = usePersistedState<WebcamEffect>('rec.effect', 'none');
  const [zoom, setZoom] = usePersistedState<number>('rec.zoom', 1);
  const [offsetX, setOffsetX] = usePersistedState<number>('rec.offsetX', 0);
  const [offsetY, setOffsetY] = usePersistedState<number>('rec.offsetY', 0);
  const [faceLight, setFaceLight] = usePersistedState<number>('rec.faceLight', 0);
  const [bgImageData, setBgImageData] = usePersistedState<string | undefined>('rec.bgImageData', undefined);
  // Colour filter applied ONLY to the background image. Separate from
  // `effect` so the user can stylise their replacement scene without
  // also tinting their face.
  const [bgEffect, setBgEffect] = usePersistedState<WebcamEffect>('rec.bgEffect', 'none');
  // Extra Gaussian blur on the background layer — works with both
  // real-room blur mode (stacks on top of the built-in 14px) and
  // image-replacement mode (softens the fake background).
  const [bgBlurPx, setBgBlurPx] = usePersistedState<number>('rec.bgBlurPx', 0);
  // Background zoom — independent from the face Zoom. Scales the
  // replacement image (or the blurred real-room source) without
  // touching the face framing.
  const [bgZoom, setBgZoom] = usePersistedState<number>('rec.bgZoom', 1);
  // Face-only Gaussian blur. Anonymises / softens the face without
  // touching the background. Stacks on top of the face colour effect.
  const [faceBlurPx, setFaceBlurPx] = usePersistedState<number>('rec.faceBlurPx', 0);
  // Fixed text overlay. Baked into the recorded output as a label
  // placed at a normalized x/y in the output canvas. Empty text =
  // no overlay.
  const fixedTextPreviewRef = useRef<HTMLCanvasElement>(null);
  const [fixedText, setFixedText] = usePersistedState<string>('rec.fixedText', '');
  // One-click "feeling lucky" — picks a random font + preset colour.
  // Declared here rather than in a useMemo because it needs access
  // to the setter functions defined just below.
  function randomizeFixedTextStyle() {
    const font = FIXED_TEXT_FONTS[Math.floor(Math.random() * FIXED_TEXT_FONTS.length)];
    const color = FIXED_TEXT_COLOR_PRESETS[Math.floor(Math.random() * FIXED_TEXT_COLOR_PRESETS.length)];
    setFixedTextFont(font);
    setFixedTextColor(color);
  }
  const [fixedTextFont, setFixedTextFont] = usePersistedState<string>('rec.fixedTextFont', 'Arial');
  const [fixedTextSize, setFixedTextSize] = usePersistedState<number>('rec.fixedTextSize', 48);
  const [fixedTextColor, setFixedTextColor] = usePersistedState<string>('rec.fixedTextColor', '#ffffff');
  const [fixedTextEffect, setFixedTextEffect] = usePersistedState<TextOverlayEffect>('rec.fixedTextEffect', 'shadow');
  const [fixedTextX, setFixedTextX] = usePersistedState<number>('rec.fixedTextX', 0.5);
  const [fixedTextY, setFixedTextY] = usePersistedState<number>('rec.fixedTextY', 0.92);
  const [fixedTextBold, setFixedTextBold] = usePersistedState<boolean>('rec.fixedTextBold', true);
  const [fixedTextItalic, setFixedTextItalic] = usePersistedState<boolean>('rec.fixedTextItalic', false);
  const [autoCenter, setAutoCenter] = usePersistedState<boolean>('rec.autoCenter', false);
  // Sample backgrounds loaded from `sample-background/` on mount.
  // Each entry has a name and a self-contained data URL so clicking a
  // thumbnail can set `bgImageData` directly without a second round-trip.
  const [bgSamples, setBgSamples] = useState<{ name: string; dataUrl: string }[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const list = await (window as any).api.listBgSamples?.();
        if (Array.isArray(list)) setBgSamples(list);
      } catch (e) {
        console.warn('[Recorder] failed to load bg samples', e);
      }
    })();
  }, []);
  // Segmentation / matting backend preference. 'auto' resolves on
  // mount to whichever backend successfully initialised (RVM > Tasks
  // Multiclass > legacy Selfie). The resolved id is what actually
  // gets pushed into the compositor + floating webcam overlay.
  const [segBackendPref, setSegBackendPref] = usePersistedState<'auto' | SegBackendId>('rec.segBackend', 'auto');
  const [resolvedBackend, setResolvedBackend] = useState<SegBackendId>('selfie');
  // `true` while `detectBestBackend()` is probing RVM / Multiclass /
  // Selfie in order. RVM downloads a ~15MB model on first run so
  // this probe can take 10–30s on a cold cache — the UI shows a
  // "detecting…" hint next to the dropdown so the user isn't left
  // wondering whether the auto pick is stuck or working.
  const [segBackendDetecting, setSegBackendDetecting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (segBackendPref === 'auto') {
      setSegBackendDetecting(true);
      detectBestBackend()
        .then((id) => {
          if (cancelled) return;
          setResolvedBackend(id);
          setSegBackendDetecting(false);
        })
        .catch((e) => {
          if (cancelled) return;
          console.warn('[Recorder] detectBestBackend failed, falling back to selfie', e);
          setResolvedBackend('selfie');
          setSegBackendDetecting(false);
        });
    } else {
      setResolvedBackend(segBackendPref);
      setSegBackendDetecting(false);
    }
    return () => { cancelled = true; };
  }, [segBackendPref]);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);
  const onPickBgImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // Read the file, decode it, downscale to at most 1920×1080 (more
    // than enough for a background at recording resolution), and
    // re-encode as JPEG at 0.85 quality. This prevents a 4K PNG from
    // parking 8+ MB of base64 permanently in localStorage, and it
    // also makes the compositor's drawImage calls faster since the
    // source is smaller. Transparency is lost but background images
    // don't usually need it.
    const MAX_SIDE = 1920;
    const JPEG_Q = 0.85;
    const reader = new FileReader();
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      if (!rawUrl) return;
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const cctx = c.getContext('2d');
          if (!cctx) { setBgImageData(rawUrl); setBgMode('image'); return; }
          cctx.drawImage(img, 0, 0, w, h);
          const compact = c.toDataURL('image/jpeg', JPEG_Q);
          // Only use the downscaled version if it's actually smaller
          // (small PNGs sometimes inflate when re-encoded to JPEG).
          const best = compact.length < rawUrl.length ? compact : rawUrl;
          setBgImageData(best);
          setBgMode('image');
        } catch {
          setBgImageData(rawUrl);
          setBgMode('image');
        }
      };
      img.onerror = () => {
        setBgImageData(rawUrl);
        setBgMode('image');
      };
      img.src = rawUrl;
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  };
  const [webcamPos, setWebcamPos] = usePersistedState<{ x: number; y: number }>('rec.webcamPos', { x: 0.75, y: 0.72 });
  const [color, setColor] = usePersistedState<AnnotationColor>('rec.color', 'red');
  const [annPresetId, setAnnPresetId] = usePersistedState<string>('rec.annPresetId', 'red');
  const [annOutline, setAnnOutline] = usePersistedState<AnnotationColor | null>('rec.annOutline', null);
  const [annThickness, setAnnThickness] = usePersistedState<number>('rec.annThickness', 6);
  const [annStyle, setAnnStyle] = usePersistedState<ArrowStyle>('rec.annStyle', 'arrow');

  function pickPreset(id: string) {
    const p = ANNOTATION_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setAnnPresetId(id);
    setColor(p.color);
    setAnnOutline(p.outline ?? null);
  }
  // Countdown before recording starts. 0 = skip entirely and start
  // instantly. Style controls whether the overlay shows a big number
  // (3-2-1) or a progress bar — both feed from the same duration.
  const [countdownSeconds, setCountdownSeconds] = usePersistedState<number>('rec.countdownSeconds', 3);
  const [countdownStyle, setCountdownStyle] = usePersistedState<'numbers' | 'bar'>('rec.countdownStyle', 'numbers');
  const [cursorZoom, setCursorZoom] = usePersistedState<boolean>('rec.cursorZoom', false);
  const [cursorZoomFactor, setCursorZoomFactor] = usePersistedState<number>('rec.cursorZoomFactor', 1.3);
  // How aggressively the crop chases the cursor. Low = slow drift,
  // high = snappy follow. Stored raw as the EMA blend factor.
  const [cursorFollowSpeed, setCursorFollowSpeed] = usePersistedState<number>('rec.cursorFollowSpeed', 0.08);
  // Hold time before a new cursor target is accepted. Higher = more
  // forgiving of flicks / jittery mouse moves.
  const [cursorFollowDelayMs, setCursorFollowDelayMs] = usePersistedState<number>('rec.cursorFollowDelayMs', 300);
  // Output framerate for the encoded MP4. ffmpeg forces CFR at this rate,
  // duplicating or dropping source frames as needed to hit the grid.
  const [outputFps, setOutputFps] = usePersistedState<number>('rec.outputFps', 30);
  const [sourceThumbSize, setSourceThumbSize] = usePersistedState<number>('rec.sourceThumbSize', 164);
  // If a previous session saved a value below the new floor, bump it up.
  useEffect(() => {
    if (sourceThumbSize < 135) setSourceThumbSize(135);
  }, []);

  const [region, setRegion] = useState<RegionResult | null>(null);
  const [livePointer, setLivePointer] = useState<{ x: number; y: number; displayW: number; displayH: number } | null>(null);
  // Recording elapsed time (seconds, excludes paused intervals).
  const [elapsedSec, setElapsedSec] = useState(0);
  const elapsedAccumRef = useRef(0); // accumulated seconds before the current segment
  const segmentStartRef = useRef<number | null>(null); // wall-clock ms when current run-segment started
  const [recState, setRecState] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [status, setStatus] = useState('Ready');
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * DID_YOU_KNOW_TIPS.length));
  const [saveFolder, setSaveFolder] = usePersistedState<string>('rec.saveFolder', '');
  const [openFolderAfter, setOpenFolderAfter] = usePersistedState<boolean>('rec.openFolderAfter', true);
  const [webcamAutoOpacity, setWebcamAutoOpacity] = usePersistedState<boolean>('rec.webcamAutoOpacity', false);

  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const recorderRef = useRef<MR | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const voiceChangerRef = useRef<VoiceChangerHandle | null>(null);
  // Streaming-finalize session id (returned from main when ffmpeg is
  // ready). Null means we're using the legacy buffered save path.
  const streamSessionRef = useRef<string | null>(null);
  // Set to true if any streamChunk IPC call returns false (ffmpeg died,
  // pipe broken, etc). Triggers the buffered save fallback at stop time.
  const streamFailedRef = useRef(false);

  // ---- Load sources + devices ----
  useEffect(() => {
    (async () => {
      try {
        const [s, cams, mis, defFolder] = await Promise.all([
          window.api.listSources(),
          listCameras().catch(() => []),
          listMics().catch(() => []),
          window.api.getDefaultFolder().catch(() => '')
        ]);
        setSources(s);
        setCameras(cams);
        setMics(mis);
        const screens = s.filter((x) => x.id.startsWith('screen:'));
        if (screens[0]) setSelectedSource(screens[0].id);
        if (!saveFolder && defFolder) setSaveFolder(defFolder);
      } catch (e: any) {
        setStatus('Failed to load sources: ' + e.message);
      }
    })();
  }, []);

  // Refresh source thumbnails periodically so the region preview reflects
  // what's currently on screen. We only poll while a region is active and
  // the user is idle (not recording) — every 1000ms is enough for "live"
  // feel without burning CPU on the desktopCapturer thumbnail snapshot.
  useEffect(() => {
    if (!region || recState !== 'idle') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await window.api.listSources();
        if (!cancelled) setSources(s);
      } catch {}
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [region, recState]);

  // Tick the recording elapsed-time display while we're actively
  // recording (not paused). Pause/resume just rolls the accumulator
  // forward, so the displayed time excludes paused intervals.
  useEffect(() => {
    if (recState !== 'recording') return;
    const id = setInterval(() => {
      const startedAt = segmentStartRef.current;
      if (startedAt == null) return;
      setElapsedSec(elapsedAccumRef.current + (Date.now() - startedAt) / 1000);
    }, 250);
    return () => clearInterval(id);
  }, [recState]);

  // Poll the system cursor position at ~10fps so both the full-screen and
  // region previews can draw a live cursor dot. The desktopCapturer
  // thumbnail itself never contains a cursor.
  useEffect(() => {
    if (recState !== 'idle') { setLivePointer(null); return; }
    let cancelled = false;
    const tick = async () => {
      try {
        const p = await window.api.getCursorPos();
        if (cancelled || !p) return;
        // Convert global screen coords to display-local coords. The preview
        // uses display.width/height as its coordinate space.
        setLivePointer({
          x: p.x - p.displayX,
          y: p.y - p.displayY,
          displayW: p.displayW,
          displayH: p.displayH
        });
      } catch {}
    };
    const id = setInterval(tick, 100);
    tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [recState]);

  async function pickSaveFolder() {
    const f = await window.api.pickFolder();
    if (f) setSaveFolder(f);
  }
  async function setFolderToDesktop() {
    const def = await window.api.getDefaultFolder();
    setSaveFolder(def);
  }
  async function setFolderToDownloads() {
    const dl = await window.api.getDownloadsFolder();
    setSaveFolder(dl);
  }

  // ---- Region selection ----
  useEffect(() => {
    const off1 = window.api.onRegionResult((r) => {
      setRegion(r);
      setSelectedSource(r.sourceId);
      setStatus(`Region selected: ${r.bounds.width}×${r.bounds.height}`);
    });
    const off2 = window.api.onRegionCancel(() => setStatus('Region cancelled'));
    return () => { off1(); off2(); };
  }, []);

  // ---- Global pause shortcut ----
  useEffect(() => {
    const off = window.api.onTogglePause(() => togglePause());
    return off;
  }, [recState]);

  // ---- Floating control panel (mini HUD) ----
  // Open once on mount; App.tsx hides/shows it as the user flips tabs,
  // and closes it on app shutdown via the unmount below.
  useEffect(() => {
    (window as any).api.openControlPanel?.();
    return () => { (window as any).api.closeControlPanel?.(); };
  }, []);

  // Forward button presses from the floating panel into the recorder state
  // machine. We route through refs so the listener always calls the latest
  // versions of startRecording / togglePause / stopRecording (and reads the
  // latest recState) without having to re-subscribe on every render —
  // re-subscribing was racing with the user's click and dropping events.
  const recStateRef = useRef(recState);
  recStateRef.current = recState;
  const handlersRef = useRef({ startRecording, togglePause, stopRecording });
  handlersRef.current = { startRecording, togglePause, stopRecording };
  useEffect(() => {
    const off = (window as any).api.onControlCommand?.((action: 'start' | 'pause' | 'stop') => {
      const h = handlersRef.current;
      const s = recStateRef.current;
      if (action === 'start') {
        if (s === 'idle') h.startRecording();
      } else if (action === 'pause') {
        if (s !== 'idle') h.togglePause();
      } else if (action === 'stop') {
        if (s !== 'idle') h.stopRecording();
      }
    });
    return off;
  }, []);

  // Push state + elapsed-time ticks into the control panel so its timer
  // stays in sync. The elapsedSec state already ticks at 4Hz while
  // recording; we just mirror it.
  useEffect(() => {
    (window as any).api.sendControlState?.({ recState, elapsedSec });
  }, [recState, elapsedSec]);

  // ---- Annotation arrows from overlay window ----
  useEffect(() => {
    const off = window.api.onAnnotationArrow((a) => {
      compositorRef.current?.addArrow(a);
    });
    return off;
  }, []);

  function togglePause() {
    if (recState === 'recording') {
      // Roll the current run-segment into the accumulator before stopping it.
      if (segmentStartRef.current != null) {
        elapsedAccumRef.current += (Date.now() - segmentStartRef.current) / 1000;
        segmentStartRef.current = null;
      }
      recorderRef.current?.pause();
      compositorRef.current?.pause();
      setRecState('paused');
      setStatus('Paused (Ctrl+Shift+P to resume)');
    } else if (recState === 'paused') {
      segmentStartRef.current = Date.now();
      recorderRef.current?.resume();
      compositorRef.current?.resume();
      setRecState('recording');
      setStatus('Recording…');
    }
  }

  async function pickRegion() {
    await window.api.openRegion();
  }

  async function startRecording() {
    if (!selectedSource) {
      setStatus('Pick a screen first');
      return;
    }
    setStatus('Preparing…');

    try {
      // 1. Screen stream (+ loopback audio if requested)
      const screenStream = await getScreenStream(selectedSource, includeSystemAudio);
      screenStreamRef.current = screenStream;
      const video = screenVideoRef.current!;
      video.srcObject = screenStream;
      await video.play().catch(() => {});
      // Wait for video dimensions so we can correctly scale the crop rect.
      if (!video.videoWidth) {
        await new Promise<void>((resolve) => {
          const onMeta = () => { video.removeEventListener('loadedmetadata', onMeta); resolve(); };
          video.addEventListener('loadedmetadata', onMeta);
        });
      }

      // 2. Webcam stream (optional)
      let webcamStream: MediaStream | null = null;
      if (includeWebcam) {
        try {
          webcamStream = await getWebcamStream(cameraId);
          webcamStreamRef.current = webcamStream;
          const wv = webcamVideoRef.current!;
          wv.srcObject = webcamStream;
          await wv.play().catch(() => {});
        } catch (e) {
          console.warn('Webcam unavailable', e);
        }
      }

      // 3. Mic stream (optional)
      let micStream: MediaStream | null = null;
      if (includeMic) {
        try {
          micStream = await getMicStream(micId);
          micStreamRef.current = micStream;
        } catch (e) {
          console.warn('Mic unavailable', e);
        }
      }

      // 4. Build compositor
      const webcamSettings: WebcamSettings = {
        shape, size, bgMode, effect, zoom, offsetX, offsetY, faceLight,
        x: webcamPos.x, y: webcamPos.y,
        bgImage: bgImageRef.current,
        autoCenter,
        segBackend: resolvedBackend,
        bgEffect,
        bgBlurPx,
        bgZoom,
        faceBlurPx
      };
      const comp = new Compositor(
        {
          screenVideo: video,
          webcamVideo: webcamStream ? webcamVideoRef.current : null,
          crop: region ? (() => {
            const sx = video.videoWidth / region.displaySize.width;
            const sy = video.videoHeight / region.displaySize.height;
            return {
              x: Math.round(region.bounds.x * sx),
              y: Math.round(region.bounds.y * sy),
              width: Math.round(region.bounds.width * sx),
              height: Math.round(region.bounds.height * sy)
            };
          })() : null,
          outWidth: 1920,
          outHeight: 1080
        },
        webcamSettings
      );
      compositorRef.current = comp;
      // Seed the fixed text overlay if the user typed one before
      // starting the recording.
      if (fixedText.trim()) {
        comp.setTextOverlay({
          text: fixedText,
          font: fixedTextFont,
          size: fixedTextSize,
          color: fixedTextColor,
          effect: fixedTextEffect,
          x: fixedTextX,
          y: fixedTextY,
          bold: fixedTextBold,
          italic: fixedTextItalic
        });
      }

      // attach canvas to preview host for visual feedback
      if (previewHostRef.current) {
        previewHostRef.current.innerHTML = '';
        comp.canvas.style.width = '100%';
        comp.canvas.style.height = 'auto';
        comp.canvas.style.display = 'block';
        previewHostRef.current.appendChild(comp.canvas);
      }

      // Bind the capture stream FIRST so the compositor's draw loop has
      // a track to push frames into from the very first draw. The loop
      // uses manual frame emission (captureStream(0)) so a missing
      // captureTrack means dropped frames at the start of the recording.
      const videoTrack = comp.captureStream(outputFps).getVideoTracks()[0];

      await comp.start();

      // 5. Mix audio — if a voice changer preset is active, run the mic
      // through it first so the recorded audio has the processed voice.
      const audioStreams: MediaStream[] = [];
      if (screenStream.getAudioTracks().length > 0) audioStreams.push(screenStream);
      if (micStream) {
        const vc = createVoiceChanger(micStream, { preset: voicePreset, pitch: voicePitch });
        voiceChangerRef.current = vc;
        audioStreams.push(vc.stream);
      }
      const mixed = audioStreams.length > 0 ? mixAudioStreams(audioStreams) : null;

      // 6. Build recording stream
      const tracks: MediaStreamTrack[] = [videoTrack];
      if (mixed) tracks.push(...mixed.getAudioTracks());
      const recStream = new MediaStream(tracks);

      // Seed cursor-zoom state + start the main-process cursor tracker.
      if (cursorZoom) {
        await window.api.startCursorTracking();
        comp.setCursorZoom({
          enabled: true,
          factor: cursorZoomFactor,
          x: 0, y: 0,
          displayW: 1920,
          displayH: 1080,
          followSpeed: cursorFollowSpeed,
          followDelayMs: cursorFollowDelayMs
        });
      }

      // 7. Countdown — skip entirely if the user set duration to 0.
      if (countdownSeconds > 0) {
        setStatus('Get ready…');
        await window.api.showCountdown({ seconds: countdownSeconds, style: countdownStyle });
      }

      // 9. Annotation overlay
      await window.api.openAnnotation();
      window.api.setAnnotationColor(color);
      window.api.setAnnotationThickness(annThickness);
      window.api.setAnnotationOutline(annOutline);
      window.api.setAnnotationStyle(annStyle);

      // 9. Start recording.
      // Spin up the parallel ffmpeg pipeline first so chunks can stream
      // into it as soon as MediaRecorder produces them. If anything
      // fails (ffmpeg missing, mkdir error, etc.) we silently fall back
      // to the buffered save path — the recording itself still works.
      streamSessionRef.current = null;
      streamFailedRef.current = false;
      try {
        const ss = await window.api.streamStart({ folder: saveFolder, fps: outputFps });
        if (ss?.ok && ss.sessionId) {
          streamSessionRef.current = ss.sessionId;
        }
      } catch {
        // ignore — streaming optional
      }

      const rec = new MR();
      const sid = streamSessionRef.current;
      rec.start(recStream, sid ? (bytes) => {
        // Best-effort push. If a chunk fails to land we mark the session
        // dead so stop() falls back to the buffered save path.
        if (streamFailedRef.current) return;
        window.api.streamChunk(sid, bytes).then((ok) => {
          if (!ok) streamFailedRef.current = true;
        }).catch(() => { streamFailedRef.current = true; });
      } : undefined);
      recorderRef.current = rec;
      // Reset and start the elapsed-time clock.
      elapsedAccumRef.current = 0;
      segmentStartRef.current = Date.now();
      setElapsedSec(0);
      setRecState('recording');
      setStatus('Recording… (Ctrl+Shift+P to pause, hold Ctrl + drag to draw)');
    } catch (e: any) {
      console.error(e);
      setStatus('Error: ' + e.message);
      window.api.showError('Failed to start recording: ' + e.message);
      cleanup();
    }
  }

  async function stopRecording() {
    if (!recorderRef.current) return;
    // Stop the elapsed clock — keep the final value visible until idle.
    segmentStartRef.current = null;
    setStatus('Finalizing…');
    // Push the "finalizing" state to the floating HUD immediately so the
    // user gets feedback that their Stop click was received, even before
    // ffmpeg has any progress to report.
    (window as any).api.sendControlState?.({ recState: 'finalizing', elapsedSec, finalizingPct: 0 });
    const offProgress = window.api.onSaveProgress((pct) => {
      setStatus(`Finalizing… ${Math.round(pct)}%`);
      (window as any).api.sendControlState?.({ recState: 'finalizing', elapsedSec, finalizingPct: pct });
    });
    try {
      const blob = await recorderRef.current.stop();
      compositorRef.current?.stop();
      // Close overlays in parallel — they're independent of each other and of
      // the encoding. Closing them sequentially used to add a noticeable beat
      // before ffmpeg even started.
      await Promise.all([
        window.api.closeAnnotation(),
        window.api.stopCursorTracking()
      ]);

      // Streaming finalize path: ffmpeg has been encoding live this
      // entire time, so we just need it to flush the trailing buffered
      // chunks + write the moov atom. Typically <1 second regardless of
      // recording length. Falls back to the legacy buffered save path
      // if streaming wasn't started or failed mid-recording.
      const sid = streamSessionRef.current;
      streamSessionRef.current = null;
      let savedPath: string | undefined;
      if (sid && !streamFailedRef.current) {
        const res = await window.api.streamStop(sid, openFolderAfter);
        if (res.ok && res.path) {
          savedPath = res.path;
        } else {
          // Streaming finalize failed — fall through to the buffered
          // save path so the user doesn't lose the recording.
          streamFailedRef.current = true;
        }
      } else if (sid) {
        // The session existed but a chunk push failed earlier; cancel
        // the dangling ffmpeg before falling back so we don't leak it.
        try { await window.api.streamCancel(sid); } catch {}
      }

      if (!savedPath) {
        const buf = await blob.arrayBuffer();
        const res = await window.api.saveRecording(buf, saveFolder, openFolderAfter);
        savedPath = res.path;
      }
      setStatus('Saved: ' + savedPath);
    } catch (e: any) {
      setStatus('Error: ' + e.message);
    } finally {
      offProgress();
      cleanup();
      setRecState('idle');
      // Reset the HUD back to idle.
      (window as any).api.sendControlState?.({ recState: 'idle', elapsedSec: 0 });
    }
  }

  function cleanup() {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
    try { voiceChangerRef.current?.close(); } catch {}
    voiceChangerRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    webcamStreamRef.current = null;
    micStreamRef.current = null;
  }

  // Keep compositor settings live while recording
  useEffect(() => {
    compositorRef.current?.setWebcamSettings({
      shape, size, bgMode, effect, zoom, offsetX, offsetY, faceLight,
      x: webcamPos.x, y: webcamPos.y,
      autoCenter,
      segBackend: resolvedBackend,
      bgEffect,
      bgBlurPx,
      bgZoom,
      faceBlurPx
    });
  }, [shape, size, bgMode, effect, zoom, offsetX, offsetY, faceLight, webcamPos, autoCenter, resolvedBackend, bgEffect, bgBlurPx, bgZoom, faceBlurPx]);

  // Push the fixed text overlay whenever any of its inputs change.
  // Cleared (null) when the text field is empty.
  useEffect(() => {
    const overlay: TextOverlay | null = fixedText.trim()
      ? {
          text: fixedText,
          font: fixedTextFont,
          size: fixedTextSize,
          color: fixedTextColor,
          effect: fixedTextEffect,
          x: fixedTextX,
          y: fixedTextY,
          bold: fixedTextBold,
          italic: fixedTextItalic
        }
      : null;
    compositorRef.current?.setTextOverlay(overlay);
  }, [fixedText, fixedTextFont, fixedTextSize, fixedTextColor, fixedTextEffect, fixedTextX, fixedTextY, fixedTextBold, fixedTextItalic]);

  // Fixed text preview canvas — shows a live miniature of how the
  // overlay will look on the recorded frame. Renders with the same
  // ctx.font / fillText / effect logic as the compositor's
  // `drawTextOverlay`, but scaled down to a 16:9 mini screen so the
  // user can see position + style without starting a recording.
  useEffect(() => {
    const cv = fixedTextPreviewRef.current;
    if (!cv) return;
    const CSS_W = 320;
    const CSS_H = 180;
    const dpr = window.devicePixelRatio || 1;
    // Size the canvas at device pixel ratio for a crisp miniature,
    // then scale the context so draw coordinates match CSS pixels.
    if (cv.width !== CSS_W * dpr) {
      cv.width = CSS_W * dpr;
      cv.height = CSS_H * dpr;
      cv.style.width = CSS_W + 'px';
      cv.style.height = CSS_H + 'px';
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CSS_W, CSS_H);

    // Checkerboard background so dark text stays visible — half-dark
    // / half-mid-grey so any colour reads clearly.
    const cellsX = 16;
    const cellsY = 9;
    const cellW = CSS_W / cellsX;
    const cellH = CSS_H / cellsY;
    for (let j = 0; j < cellsY; j++) {
      for (let i = 0; i < cellsX; i++) {
        ctx.fillStyle = (i + j) % 2 === 0 ? '#1e2530' : '#262d36';
        ctx.fillRect(i * cellW, j * cellH, cellW + 1, cellH + 1);
      }
    }
    // Outer frame so the mini screen reads as a bounded area.
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, CSS_W - 1, CSS_H - 1);

    if (!fixedText.trim()) {
      ctx.fillStyle = '#6b7380';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Type text above to preview', CSS_W / 2, CSS_H / 2);
      return;
    }

    // Mirror the compositor's drawTextOverlay logic, scaled down.
    // The real compositor renders at outW × outH (1920 × 1080 by
    // default). We scale the font size from "output pixels" to
    // "preview pixels" by the canvas height ratio so the text size
    // in the preview matches how big it'll be in the recording.
    const outH = 1080;
    const sizeScale = CSS_H / outH;
    const weight = fixedTextBold ? '700' : '400';
    const style = fixedTextItalic ? 'italic' : 'normal';
    const px = Math.max(4, Math.round(fixedTextSize * sizeScale));
    const raw = (fixedTextFont || 'sans-serif').trim();
    const isGeneric = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(raw);
    const family = isGeneric ? raw : `"${raw.replace(/"/g, '')}"`;

    try {
      ctx.font = `${style} ${weight} ${px}px ${family}`;
    } catch {
      ctx.font = `${px}px sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = fixedTextColor || '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    const cx = Math.round(fixedTextX * CSS_W);
    const cy = Math.round(fixedTextY * CSS_H);

    if (fixedTextEffect === 'shadow') {
      ctx.shadowColor = 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = Math.max(2, px * 0.12);
      ctx.shadowOffsetX = Math.max(1, px * 0.06);
      ctx.shadowOffsetY = Math.max(1, px * 0.06);
      ctx.fillText(fixedText, cx, cy);
    } else if (fixedTextEffect === 'outline') {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = Math.max(1, px * 0.12);
      ctx.strokeText(fixedText, cx, cy);
      ctx.fillText(fixedText, cx, cy);
    } else if (fixedTextEffect === 'glow') {
      ctx.shadowColor = fixedTextColor || '#ffffff';
      ctx.shadowBlur = Math.max(2, px * 0.4);
      ctx.fillText(fixedText, cx, cy);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.fillText(fixedText, cx, cy);
    } else {
      ctx.fillText(fixedText, cx, cy);
    }
  }, [fixedText, fixedTextFont, fixedTextSize, fixedTextColor, fixedTextEffect, fixedTextX, fixedTextY, fixedTextBold, fixedTextItalic]);

  // Always show the floating webcam overlay window while we're on the
  // Recorder tab. The window contains:
  //   - the camera bubble (when `includeWebcam` is on)
  //   - the 3-dots config toggle
  //   - the embedded recording HUD
  // When the user unchecks "Include webcam overlay" we just send an update
  // with `enabled: false` so the bubble hides + the camera stream stops,
  // but the floating window itself stays open so the HUD is still reachable.
  //
  // Probing the camera (a `getUserMedia` round-trip) is expensive and steals
  // device access from the existing webcam window's stream — so we only
  // probe the FIRST time we enable a particular camera, then call the
  // cheap `updateWebcamOverlay` for subsequent config changes (e.g. when
  // the user drags the face-light or zoom slider). Otherwise the panel
  // would flicker / collapse on every slider tick.
  const lastProbedDeviceRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const currentDevice = cameraId ?? '';
      const probeKey = includeWebcam ? `enabled:${currentDevice}` : 'disabled';
      const needsProbe = includeWebcam && lastProbedDeviceRef.current !== probeKey;

      if (needsProbe) {
        try {
          const probe = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: cameraId ? { exact: cameraId } : undefined },
            audio: false
          });
          probe.getTracks().forEach((t) => t.stop());
          lastProbedDeviceRef.current = probeKey;
        } catch {
          // Camera denied / unavailable — show the window in disabled mode
          // so the HUD is still visible.
          if (cancelled) return;
          lastProbedDeviceRef.current = 'disabled';
          await window.api.openWebcamOverlay({
            deviceId: cameraId, shape, size, bgMode, effect, zoom, offsetX, offsetY, faceLight, bgImageData, segBackend: resolvedBackend, bgEffect, bgBlurPx, bgZoom, faceBlurPx,
            enabled: false,
            autoCenter
          });
          return;
        }
      } else if (!includeWebcam) {
        lastProbedDeviceRef.current = 'disabled';
      }

      if (cancelled) return;
      // `openWebcamOverlay` is idempotent — creates the window if missing,
      // otherwise just sends the new config to the existing one. The
      // expensive probe above is only done on first-enable, so subsequent
      // config changes (slider drags) are now cheap and don't disturb the
      // already-running camera stream.
      await window.api.openWebcamOverlay({
        deviceId: cameraId, shape, size, bgMode, effect, zoom, offsetX, offsetY, faceLight, bgImageData, segBackend: resolvedBackend, bgEffect, bgBlurPx, bgZoom, faceBlurPx,
        enabled: includeWebcam,
        autoCenter
      });
    })();
    return () => { cancelled = true; };
  }, [includeWebcam, cameraId, shape, size, bgMode, effect, zoom, offsetX, offsetY, faceLight, bgImageData, autoCenter, resolvedBackend, bgEffect, bgBlurPx, bgZoom, faceBlurPx]);

  // Push the cursor-avoidance toggles into the main process whenever
  // they change. Main process runs its own ~30fps cursor poll and
  // smoothly slides / fades the webcam window based on these flags.
  // Avoidance is gated on recState — the bubble should only dodge the
  // cursor while a recording is actually running (or paused), never
  // during idle setup.
  useEffect(() => {
    const recordingActive = recState === 'recording' || recState === 'paused';
    (window as any).api.setWebcamAvoidance?.({
      autoRelocate: false,
      autoOpacity: includeWebcam && webcamAutoOpacity && recordingActive
    });
  }, [includeWebcam, webcamAutoOpacity, recState]);

  // Decode the persisted bg image data URL into an HTMLImageElement that
  // the compositor can draw. Cleared when the user removes the image.
  useEffect(() => {
    if (!bgImageData) { bgImageRef.current = null; return; }
    const img = new Image();
    img.onload = () => {
      bgImageRef.current = img;
      compositorRef.current?.setWebcamSettings({ bgImage: img } as any);
    };
    img.src = bgImageData;
  }, [bgImageData]);

  // Cursor position stream → compositor. Position from main is global
  // screen coords, but the display object tells us the origin so we can
  // convert to display-local coords the compositor expects.
  useEffect(() => {
    const off = window.api.onCursorPos((p) => {
      const comp = compositorRef.current;
      if (!comp) return;
      comp.setCursorZoom({
        enabled: cursorZoom,
        factor: cursorZoomFactor,
        x: p.x - p.displayX,
        y: p.y - p.displayY,
        displayW: p.displayW,
        displayH: p.displayH,
        followSpeed: cursorFollowSpeed,
        followDelayMs: cursorFollowDelayMs
      });
    });
    return off;
  }, [cursorZoom, cursorZoomFactor, cursorFollowSpeed, cursorFollowDelayMs]);

  // Live-swap the voice changer effect chain when the preset or
  // custom pitch changes. `setConfig` tears down the old FX nodes and
  // rewires new ones inside the same AudioContext, so the recorder's
  // MediaRecorder keeps feeding from the same track without a
  // dropout. Only runs while a recording is active (voiceChangerRef
  // is null during idle).
  useEffect(() => {
    voiceChangerRef.current?.setConfig({ preset: voicePreset, pitch: voicePitch });
  }, [voicePreset, voicePitch]);

  // Receive config changes made from the floating bubble's 3-dot menu.
  useEffect(() => {
    const off = window.api.onWebcamLocalChange((patch) => {
      if (patch.shape !== undefined) setShape(patch.shape);
      if (patch.size !== undefined) setSize(patch.size);
      if (patch.bgMode !== undefined) setBgMode(patch.bgMode as SegMode);
      if (patch.effect !== undefined) setEffect(patch.effect);
      if (patch.zoom !== undefined) setZoom(patch.zoom);
      if (patch.offsetX !== undefined) setOffsetX(patch.offsetX);
      if (patch.offsetY !== undefined) setOffsetY(patch.offsetY);
      if ((patch as any).faceLight !== undefined) setFaceLight((patch as any).faceLight);
      if ((patch as any).bgImageData !== undefined) setBgImageData((patch as any).bgImageData || undefined);
      if ((patch as any).enabled !== undefined) setIncludeWebcam(!!(patch as any).enabled);
      if ((patch as any).autoCenter !== undefined) setAutoCenter(!!(patch as any).autoCenter);
    });
    return off;
  }, []);

  // Close the overlay when the main window is closed
  useEffect(() => {
    return () => { window.api.closeWebcamOverlay(); };
  }, []);

  useEffect(() => {
    if (recState !== 'idle') window.api.setAnnotationColor(color);
  }, [color, recState]);

  useEffect(() => {
    if (recState !== 'idle') window.api.setAnnotationThickness(annThickness);
  }, [annThickness, recState]);

  useEffect(() => {
    if (recState !== 'idle') window.api.setAnnotationOutline(annOutline);
  }, [annOutline, recState]);

  useEffect(() => {
    if (recState !== 'idle') window.api.setAnnotationStyle(annStyle);
  }, [annStyle, recState]);

  const screens = useMemo(() => sources.filter((s) => s.id.startsWith('screen:')), [sources]);
  const windowsSources = useMemo(() => sources.filter((s) => s.id.startsWith('window:')), [sources]);

  return (
    <>
      <div className="tab-toolbar">
        <div className="tip-box" title="Click Next for another tip">
          <span className="tip-box-icon" aria-hidden>💡</span>
          <div className="tip-box-body">
            <div className="tip-box-label">
              Did you know? <span className="tip-box-count">Tip {tipIndex + 1} of {DID_YOU_KNOW_TIPS.length}</span>
            </div>
            <div className="tip-box-text">{DID_YOU_KNOW_TIPS[tipIndex]}</div>
          </div>
          <button
            type="button"
            className="tip-box-next"
            onClick={() => setTipIndex((i) => (i + 1) % DID_YOU_KNOW_TIPS.length)}
            title="Show next tip"
            aria-label="Next tip"
          >
            Next ▸
          </button>
        </div>
        <div className={`status ${recState}`}>{status}</div>
        {recState !== 'idle' && (
          <div className={`rec-timer ${recState}`}>
            <span className="rec-dot" />
            {fmtElapsed(elapsedSec)}
          </div>
        )}
        <span className="shortcut">Pause <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd></span>
        <div className="header-actions">
          {recState === 'idle' && (
            <button className="success big" onClick={startRecording}>● Start recording</button>
          )}
          {recState !== 'idle' && (
            <>
              <button className="warn big" onClick={togglePause}>
                {recState === 'paused' ? '▶ Resume' : '❚❚ Pause'}
              </button>
              <button className="danger big" onClick={stopRecording}>■ Stop</button>
            </>
          )}
        </div>
      </div>

      <main>
        <section className="panel">
          <h2>
            <span className="step">1</span> Web Cam Basic Settings
            <Help>Core webcam framing plus the background scene. Shape, size, and zoom control how your face is framed in the floating bubble and in the recording. Mode + samples + effect control what goes behind you. Everything here applies to both the live preview and the final video.</Help>
          </h2>
          <div className="row two-col">
            <label className="row-label">Webcam overlay <Help>Master switch for the whole face-cam pipeline. When enabled, a small floating webcam window shows on your desktop immediately. You can drag it anywhere and click the 3-dot menu on it to configure. Turn off to record the screen without any face-cam.</Help></label>
            <div className="row-ctrl">
              <label className="check inline">
                <input type="checkbox" checked={includeWebcam} onChange={(e) => setIncludeWebcam(e.target.checked)} />
                Include me on screen
              </label>
            </div>
          </div>
          <div className="row two-col">
            <label className="row-label">Shape <Help>Frame for the webcam feed: circle, rectangle, squircle (rounded square), hexagon, diamond, heart, or star.</Help></label>
            <div className="row-ctrl">
              {SHAPES.map((sh) => (
                <button key={sh} className={shape === sh ? 'chip sel' : 'chip'} onClick={() => setShape(sh)}>
                  <span className="chip-icon">{SHAPE_ICONS[sh]}</span>
                  {SHAPE_LABELS[sh]}
                </button>
              ))}
            </div>
          </div>
          <div className="row two-col">
            <label className="row-label">Size <Help>Small (240px), Medium (360px) or Large (480px). Sets both the floating bubble size and how big the overlay appears in the recorded video.</Help></label>
            <div className="row-ctrl">
              {SIZES.map((sz) => (
                <button key={sz} className={size === sz ? 'chip sel' : 'chip'} onClick={() => setSize(sz)}>
                  <span className="chip-icon">{SIZE_ICONS[sz]}</span>
                  {sz}
                </button>
              ))}
            </div>
          </div>
          <div className="row two-col">
            <label className="row-label">Face Zoom {zoom.toFixed(1)}× <Help>Digitally zoom into the centre of your webcam — the face layer only. 1.0× is the full frame, 3.0× is a tight crop. Independent from Background Zoom further down: you can tighten your face without pushing into the replacement scene.</Help></label>
            <div className="row-ctrl">
              <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(+e.target.value)} />
            </div>
          </div>
          <div className="row two-col">
            <label className="row-label">Face Effect <Help>Colour filter applied only to your face (the webcam feed). Does not affect the background. Pair with Background Effect below to mix-and-match looks — e.g. a grayscale face over a vivid image background.</Help></label>
            <div className="row-ctrl">
              {EFFECTS.map((ef) => (
                <button key={`face-${ef}`} className={effect === ef ? 'chip sel' : 'chip'} onClick={() => setEffect(ef)}>
                  <span className="chip-icon">{EFFECT_ICONS[ef]}</span>
                  {ef}
                </button>
              ))}
            </div>
          </div>
          <div className="row two-col">
            <label className="row-label">Face Blur {faceBlurPx}px <Help>Gaussian blur applied only to your face — not the background. Useful for anonymising yourself, softening skin, or adding a dreamy look. Stacks on top of any Face Effect colour filter. 0 = sharp.</Help></label>
            <div className="row-ctrl">
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={faceBlurPx}
                onChange={(e) => setFaceBlurPx(+e.target.value)}
              />
            </div>
          </div>
          <div className="row two-col">
            <label className="row-label">Mode <Help>Off = raw camera feed (no segmentation). Blur = keep you sharp, blur your real room. Image = replace the background with a picked image. Requires the floating webcam overlay to be on.</Help></label>
            <div className="row-ctrl">
              {BG_MODES.map((b) => (
                <button key={b.id} className={bgMode === b.id ? 'chip sel' : 'chip'} onClick={() => setBgMode(b.id)}>
                  <span className="chip-icon">{BG_ICONS[b.id]}</span>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          {bgMode !== 'none' && (
            <div className="row two-col">
              <label className="row-label">Background Blur {bgBlurPx}px <Help>Extra Gaussian blur applied to the background layer. Works with both Blur mode (stacks on top of the built-in real-room blur) and Image mode (softens the replacement image). 0 = no extra blur.</Help></label>
              <div className="row-ctrl">
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={bgBlurPx}
                  onChange={(e) => setBgBlurPx(+e.target.value)}
                />
              </div>
            </div>
          )}
          {bgMode !== 'none' && (
            <div className="row two-col">
              <label className="row-label">Background Zoom {bgZoom.toFixed(1)}× <Help>Independent zoom for the background layer. Crops into the replacement image (or the blurred real-room source) from the centre, without touching how tight your face is framed. 1.0× shows the full background; 3.0× is a tight push-in.</Help></label>
              <div className="row-ctrl">
                <input type="range" min={1} max={3} step={0.1} value={bgZoom} onChange={(e) => setBgZoom(+e.target.value)} />
              </div>
            </div>
          )}
          {bgMode === 'image' && (
            <>
              <div className="row two-col">
                <label className="row-label">Samples <Help>Built-in background images bundled with the app. Click one to use it as your background. Tap again or pick another to switch.</Help></label>
                <div className="row-ctrl bg-samples">
                  {bgSamples.length === 0 && <span className="muted">No samples found in <code>build/sample-background/</code>.</span>}
                  {bgSamples.map((s) => {
                    const active = bgImageData === s.dataUrl;
                    return (
                      <button
                        key={s.name}
                        type="button"
                        className={`bg-sample ${active ? 'sel' : ''}`}
                        onClick={() => setBgImageData(s.dataUrl)}
                        title={s.name}
                      >
                        <img src={s.dataUrl} alt={s.name} loading="lazy" decoding="async" />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="row two-col">
                <label className="row-label">Upload <Help>Pick your own image file. Reads the file from disk; it lives only in this browser session unless you keep it.</Help></label>
                <div className="row-ctrl">
                  <button className="chip" onClick={() => bgFileInputRef.current?.click()}>
                    {bgImageData ? 'Change image…' : 'Upload image…'}
                  </button>
                  {bgImageData && (
                    <button
                      className="chip"
                      onClick={() => {
                        bgImageRef.current = null;
                        setBgImageData(undefined);
                        compositorRef.current?.setWebcamSettings({ bgImage: null } as any);
                      }}
                    >
                      Clear
                    </button>
                  )}
                  <input
                    ref={bgFileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={onPickBgImage}
                  />
                </div>
              </div>
              <div className="row two-col">
                <label className="row-label">Background Effect <Help>Colour filter applied to the background image only — not to your face. Combine any filter with any sample or uploaded image to restyle the scene behind you.</Help></label>
                <div className="row-ctrl">
                  {EFFECTS.map((ef) => (
                    <button key={`bg-${ef}`} className={bgEffect === ef ? 'chip sel' : 'chip'} onClick={() => setBgEffect(ef)}>
                      <span className="chip-icon">{EFFECT_ICONS[ef]}</span>
                      {ef}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <h2>
            <span className="step">2</span> Live Annotation
            <Help>Color, shape and thickness used when you draw annotations on the screen during recording. Hold <b>Ctrl</b> and drag anywhere to draw — release Ctrl to click through to apps again.</Help>
          </h2>
          <div className="row two-col">
            <label className="row-label">Shape <Help>Pick what each Ctrl+drag draws. Arrow points at the endpoint. Line is just a stroke. Double has heads on both ends. Curve is a gentle bend. Circle and Box outline an area. Highlight is a translucent fat stripe.</Help></label>
            <div className="row-ctrl">
              {ARROW_STYLES.map((s) => (
                <button
                  key={s.id}
                  className={annStyle === s.id ? 'chip sel' : 'chip'}
                  onClick={() => setAnnStyle(s.id)}
                  title={s.label}
                >
                  <span className="chip-icon" aria-hidden>
                    <ArrowStyleIcon id={s.id} />
                  </span>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="row two-col">
            <label className="row-label">Style <Help>Plain colors or color-with-outline presets. Outlined arrows stay readable on busy or same-color backgrounds (e.g. red on a red logo).</Help></label>
            <div className="row-ctrl">
              {ANNOTATION_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`color-chip ${annPresetId === p.id ? 'sel' : ''}`}
                  onClick={() => pickPreset(p.id)}
                  title={p.label}
                  style={{
                    background: COLOR_HEX[p.color],
                    boxShadow: p.outline
                      ? `inset 0 0 0 3px ${COLOR_HEX[p.outline]}`
                      : undefined,
                    border: p.color === 'white' || p.color === 'yellow' || p.outline === 'white'
                      ? '2px solid rgba(0,0,0,0.55)'
                      : '2px solid rgba(255,255,255,0.55)'
                  }}
                />
              ))}
            </div>
          </div>
          <div className="row two-col">
            <label className="row-label">Thickness {annThickness}px <Help>How thick the drawn arrow lines are. Thicker lines are easier to see on busy backgrounds.</Help></label>
            <div className="row-ctrl">
              <input
                type="range"
                min={2}
                max={20}
                step={1}
                value={annThickness}
                onChange={(e) => setAnnThickness(+e.target.value)}
              />
              <span
                className="ann-thickness-preview"
                style={{
                  background: COLOR_HEX[color],
                  height: annThickness,
                  boxShadow: annOutline
                    ? `0 0 0 ${Math.max(2, Math.round(annThickness * 0.4))}px ${COLOR_HEX[annOutline]}`
                    : undefined
                }}
              />
            </div>
          </div>
          <div className="row two-col">
            <span className="row-label" />
            <p className="hint row-ctrl">Hold <kbd>Ctrl</kbd> and drag over the screen to draw annotations while recording. Release <kbd>Ctrl</kbd> to click through to apps again.</p>
          </div>
        </section>

        <section className="panel">
          <h2>
            <span className="step">3</span> Fixed Text
            <Help>A permanent text label baked into every recorded frame. Useful for watermarks, lower-thirds, titles, or a fixed "LIVE" tag. Leave the text box blank to disable.</Help>
          </h2>
          <div className="row two-col">
            <label className="row-label">Text <Help>Type the label that should appear on every recorded frame. Empty = no overlay.</Help></label>
            <div className="row-ctrl">
              <input
                type="text"
                value={fixedText}
                onChange={(e) => setFixedText(e.target.value)}
                placeholder="e.g. @yourhandle or LIVE"
                style={{ flex: '1 1 100%', minWidth: 160, background: '#0d1117', color: '#e6edf3', border: '1px solid #262d36', borderRadius: 6, padding: '6px 8px' }}
              />
            </div>
          </div>
          <div className="row two-col">
            <label className="row-label">Preview <Help>Mini 16:9 preview of how the text will appear on the recorded frame. Drag the horizontal slider under the preview to move the text left/right; drag the vertical slider on the right to move it up/down. Updates live as you tweak font, size, colour, effect, and position.</Help></label>
            <div className="row-ctrl" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 2 }}>
                <canvas
                  ref={fixedTextPreviewRef}
                  style={{ display: 'block', borderRadius: 6 }}
                />
                {/* Vertical Y slider on the right edge of the preview.
                    `writing-mode: vertical-lr` alone puts min (0) at
                    the top and max (1) at the bottom — same direction
                    as the preview's 0% = top / 100% = bottom
                    convention. No `direction: rtl` because that
                    inverts the axis and makes the thumb travel
                    opposite to where the text is visually. */}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={fixedTextY}
                  onChange={(e) => setFixedTextY(+e.target.value)}
                  aria-label={`Y ${Math.round(fixedTextY * 100)}%`}
                  title={`Y ${Math.round(fixedTextY * 100)}%`}
                  style={{
                    width: 24,
                    height: 180,
                    margin: 0,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    writingMode: 'vertical-lr' as any
                  }}
                />
              </div>
              {/* Horizontal X slider beneath the preview. Width matches
                  the preview canvas so the slider thumb maps 1:1 to
                  the text's horizontal position. */}
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={fixedTextX}
                onChange={(e) => setFixedTextX(+e.target.value)}
                aria-label={`X ${Math.round(fixedTextX * 100)}%`}
                title={`X ${Math.round(fixedTextX * 100)}%`}
                style={{ width: 320, display: 'block' }}
              />
              <span className="muted" style={{ fontSize: 11 }}>
                X {Math.round(fixedTextX * 100)}% · Y {Math.round(fixedTextY * 100)}%
              </span>
            </div>
          </div>
          {fixedText.trim() !== '' && (
            <>
              <div className="row two-col">
                <label className="row-label">Font <Help>Font family used for the fixed text. Uses the Windows-installed fonts list; anything you already have installed will work.</Help></label>
                <div className="row-ctrl">
                  <select
                    value={fixedTextFont}
                    onChange={(e) => setFixedTextFont(e.target.value)}
                    style={{ flex: '1 1 100%', minWidth: 160, background: '#0d1117', color: '#e6edf3', border: '1px solid #262d36', borderRadius: 6, padding: '6px 8px' }}
                  >
                    {FIXED_TEXT_FONTS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                    <option value="sans-serif">System sans-serif</option>
                    <option value="serif">System serif</option>
                    <option value="monospace">System monospace</option>
                  </select>
                </div>
              </div>
              <div className="row two-col">
                <label className="row-label">Size {fixedTextSize}px <Help>Font size in output pixels. At 1080p recording, 48 is a typical lower-third label, 120+ is a big title.</Help></label>
                <div className="row-ctrl">
                  <input
                    type="range"
                    min={12}
                    max={240}
                    step={1}
                    value={fixedTextSize}
                    onChange={(e) => setFixedTextSize(+e.target.value)}
                  />
                </div>
              </div>
              <div className="row two-col">
                <label className="row-label">Weight <Help>Bold / italic toggles. Bold is the default because it reads better at small sizes against busy backgrounds.</Help></label>
                <div className="row-ctrl">
                  <label className="check inline">
                    <input type="checkbox" checked={fixedTextBold} onChange={(e) => setFixedTextBold(e.target.checked)} />
                    Bold
                  </label>
                  <label className="check inline" style={{ marginLeft: 12 }}>
                    <input type="checkbox" checked={fixedTextItalic} onChange={(e) => setFixedTextItalic(e.target.checked)} />
                    Italic
                  </label>
                </div>
              </div>
              <div className="row two-col">
                <label className="row-label">Color <Help>Click a preset swatch, open the colour picker, or type a hex / rgba string. Picks are applied instantly to the preview above.</Help></label>
                <div className="row-ctrl" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {FIXED_TEXT_COLOR_PRESETS.map((hex) => (
                    <button
                      key={`tp-${hex}`}
                      type="button"
                      className={fixedTextColor.toLowerCase() === hex.toLowerCase() ? 'color-chip sel' : 'color-chip'}
                      title={hex}
                      aria-label={`Set text color to ${hex}`}
                      onClick={() => setFixedTextColor(hex)}
                      style={{
                        width: 26,
                        height: 26,
                        padding: 0,
                        borderRadius: 6,
                        background: hex,
                        border: '2px solid rgba(255,255,255,0.35)',
                        cursor: 'pointer'
                      }}
                    />
                  ))}
                  <input
                    type="color"
                    value={fixedTextColor.startsWith('#') ? fixedTextColor : '#ffffff'}
                    onChange={(e) => setFixedTextColor(e.target.value)}
                    style={{ width: 40, height: 32, padding: 0, border: '1px solid #262d36', borderRadius: 6, background: 'transparent' }}
                  />
                  <input
                    type="text"
                    value={fixedTextColor}
                    onChange={(e) => setFixedTextColor(e.target.value)}
                    style={{ flex: '1 1 auto', minWidth: 100, background: '#0d1117', color: '#e6edf3', border: '1px solid #262d36', borderRadius: 6, padding: '6px 8px' }}
                  />
                </div>
              </div>
              <div className="row two-col">
                <label className="row-label">Randomise <Help>One-click "feeling lucky" — picks a random font from the list and a random colour from the preset palette. Great for quickly auditioning different looks without manually cycling through dropdowns.</Help></label>
                <div className="row-ctrl">
                  <button
                    type="button"
                    className="chip"
                    onClick={randomizeFixedTextStyle}
                  >
                    🎲 Random font + colour
                  </button>
                </div>
              </div>
              <div className="row two-col">
                <label className="row-label">Effect <Help>None = flat fill. Outline = black stroke wrapped around the fill (readable over anything). Shadow = classic drop shadow. Glow = soft halo in the text colour.</Help></label>
                <div className="row-ctrl">
                  {(['none', 'outline', 'shadow', 'glow'] as TextOverlayEffect[]).map((ef) => (
                    <button
                      key={`txtfx-${ef}`}
                      className={fixedTextEffect === ef ? 'chip sel' : 'chip'}
                      onClick={() => setFixedTextEffect(ef)}
                    >
                      {ef}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>

        <section className="panel wide" style={{ ['--src-thumb' as any]: `${sourceThumbSize}px` }}>
          <h2>
            <span className="step">4</span> Source
            <Help>Pick which monitor or window to capture. You can also drag a <b>region</b> to record only part of the screen.</Help>
            <button
              className="h2-action"
              title="Refresh sources"
              onClick={async () => {
                try { setSources(await window.api.listSources()); } catch {}
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-3-6.7" />
                <polyline points="21 4 21 10 15 10" />
              </svg>
              Refresh
            </button>
          </h2>
          <div className="row two-col">
            <label className="row-label">Select source <Help>Choose to record an entire screen, or drag out a custom rectangle to capture only part of it.</Help></label>
            <div className="row-ctrl source-picker">
              {(() => {
                // Live preview: shows the full selected screen, or — if a
                // region is set — the cropped portion of the selected screen.
                // Fall back aggressively so we always render something —
                // region.sourceId may not match the current sources list if
                // the user just re-opened the app or the list was refreshed.
                let src: ScreenSource | undefined;
                if (region) {
                  src =
                    sources.find((s) => s.id === region.sourceId) ||
                    sources.find((s) => s.id === selectedSource) ||
                    screens[0];
                } else {
                  src = sources.find((s) => s.id === selectedSource) || screens[0];
                }
                if (!src) return null;
                const previewW = sourceThumbSize;
                if (region) {
                  const dw = region.displaySize.width;
                  const dh = region.displaySize.height;
                  const rb = region.bounds;
                  const scale = previewW / rb.width;
                  const previewH = rb.height * scale;
                  return (
                    <div className="source-preview-wrap">
                      <div
                        className="region-preview"
                        style={{
                          width: previewW,
                          height: previewH,
                          backgroundImage: `url(${src.thumbnail})`,
                          backgroundSize: `${dw * scale}px ${dh * scale}px`,
                          backgroundPosition: `-${rb.x * scale}px -${rb.y * scale}px`
                        }}
                      >
                        {livePointer && (() => {
                          const cx = (livePointer.x - rb.x) * scale;
                          const cy = (livePointer.y - rb.y) * scale;
                          if (cx < 0 || cy < 0 || cx > previewW || cy > previewH) return null;
                          return <div className="region-cursor" style={{ left: cx, top: cy }} />;
                        })()}
                      </div>
                      <span className="tag green">Region {rb.width}×{rb.height}</span>
                    </div>
                  );
                }
                // Full-screen preview — full thumbnail with cursor overlay
                const previewH = Math.round(previewW * 9 / 16);
                return (
                  <div className="source-preview-wrap">
                    <div
                      className="region-preview"
                      style={{
                        width: previewW,
                        height: previewH,
                        backgroundImage: `url(${src.thumbnail})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center'
                      }}
                    >
                      {livePointer && livePointer.displayW > 0 && (() => {
                        const cx = (livePointer.x / livePointer.displayW) * previewW;
                        const cy = (livePointer.y / livePointer.displayH) * previewH;
                        if (cx < 0 || cy < 0 || cx > previewW || cy > previewH) return null;
                        return <div className="region-cursor" style={{ left: cx, top: cy }} />;
                      })()}
                    </div>
                    <span className="hint">{src.name}</span>
                  </div>
                );
              })()}
              <div className="source-divider" />
              <div className="source-actions">
                <button
                  className={`action-card ${!region ? 'sel' : ''}`}
                  onClick={() => { setRegion(null); if (!selectedSource && screens[0]) setSelectedSource(screens[0].id); }}
                >
                  <span className="action-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="13" rx="2" />
                      <path d="M8 21h8M12 17v4" />
                    </svg>
                  </span>
                  <span className="action-text">
                    <span className="action-title">Share Entire Screen</span>
                    <span className="action-sub">Record everything on your screen</span>
                  </span>
                </button>
                <button
                  className={`action-card ${region ? 'sel' : ''}`}
                  onClick={pickRegion}
                >
                  <span className="action-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 8V5a1 1 0 0 1 1-1h3" />
                      <path d="M16 4h3a1 1 0 0 1 1 1v3" />
                      <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
                      <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
                      <rect x="9" y="9" width="6" height="6" rx="0.5" />
                    </svg>
                  </span>
                  <span className="action-text">
                    <span className="action-title">Select Custom Region</span>
                    <span className="action-sub">Drag out a rectangle to record only part of the screen</span>
                  </span>
                </button>
                {screens.length > 1 && (
                  <div className="display-switcher">
                    {screens.map((s, i) => (
                      <button
                        key={s.id}
                        className={`chip ${selectedSource === s.id ? 'sel' : ''}`}
                        onClick={() => { setSelectedSource(s.id); setRegion(null); }}
                      >
                        Display {i + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          {windowsSources.length > 0 && (
            <div className="row two-col">
              <label className="row-label">Windows <Help>Capture a specific application window instead of a whole screen. Only the chosen window is recorded — other apps on top of it are excluded.</Help></label>
              <div className="row-ctrl">
                {windowsSources.map((s) => (
                  <button key={s.id} className={`source ${selectedSource === s.id ? 'sel' : ''}`} onClick={() => setSelectedSource(s.id)}>
                    <img src={s.thumbnail} alt={s.name} />
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="row two-col">
            <label className="row-label">Thumbnail size <Help>Resize the source thumbnails. Bigger is easier to pick at a glance; smaller fits more windows on screen.</Help></label>
            <div className="row-ctrl">
              <input
                type="range"
                min={135}
                max={330}
                step={1}
                value={sourceThumbSize}
                onChange={(e) => setSourceThumbSize(+e.target.value)}
              />
              <span className="hint" style={{ minWidth: 44 }}>{sourceThumbSize}px</span>
            </div>
          </div>
          <div className="row two-col">
            <span className="row-label" />
            <p className="hint row-ctrl">Tip: Full screen captures everything including notifications and system overlays. A window capture stays locked to that app even if you drag it around.</p>
          </div>
        </section>

        <section className="panel">
          <h2>
            <span className="step">5</span> Audio
            <Help>Capture the sounds your computer is playing (games, videos, calls) and/or your microphone. Both are mixed together into the final video.</Help>
          </h2>
          <div className="row two-col">
            <label className="row-label">Computer audio <Help>Records the audio coming out of your speakers — music, video calls, game sounds. On Windows this uses Electron's loopback; on macOS it requires granting screen-recording permission.</Help></label>
            <div className="row-ctrl">
              <label className="check inline">
                <input type="checkbox" checked={includeSystemAudio} onChange={(e) => setIncludeSystemAudio(e.target.checked)} />
                Capture what's playing
              </label>
            </div>
          </div>
          <div className="row two-col">
            <label className="row-label">Microphone <Help>Records your voice through the selected input device. Noise suppression and echo cancellation are enabled by default.</Help></label>
            <div className="row-ctrl">
              <label className="check inline">
                <input type="checkbox" checked={includeMic} onChange={(e) => setIncludeMic(e.target.checked)} />
                Capture my voice
              </label>
            </div>
          </div>
          {includeMic && (
            <div className="row two-col">
              <label className="row-label">Mic device <Help>Pick which connected microphone to record from. Defaults to your system's default input.</Help></label>
              <div className="row-ctrl">
                <select value={micId ?? ''} onChange={(e) => setMicId(e.target.value || undefined)}>
                  <option value="">Default microphone</option>
                  {mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label || m.deviceId}</option>)}
                </select>
              </div>
            </div>
          )}
          {includeMic && (
            <div className="row two-col">
              <label className="row-label">Voice changer <Help>Process the mic through a Web Audio pitch-shifter and optional effect chain before recording. "Custom pitch" unlocks the slider so you can dial the amount yourself. Applied at Start; change and restart to preview a different preset.</Help></label>
              <div className="row-ctrl">
                <select value={voicePreset} onChange={(e) => setVoicePreset(e.target.value as VoicePreset)}>
                  {VOICE_PRESETS.map((p) => (
                    <option key={p} value={p}>{voicePresetLabel(p)}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {includeMic && voicePreset === 'custom' && (
            <div className="row two-col">
              <label className="row-label">Pitch {voicePitch >= 0 ? '+' : ''}{voicePitch.toFixed(2)} <Help>Negative values lower the pitch (deeper), positive values raise it (higher). ±1 is roughly ±1 octave.</Help></label>
              <div className="row-ctrl">
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={voicePitch}
                  onChange={(e) => setVoicePitch(+e.target.value)}
                />
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>
            <span className="step">6</span> Webcam
            <Help>Overlay a live camera feed on top of your screen. A floating bubble appears on your desktop so you can see yourself, and it's baked into the final video at the position you pick. The master on/off switch lives at the top of step 1 — Web Cam Basic Settings.</Help>
          </h2>
          {!includeWebcam && (
            <div className="row two-col">
              <span className="row-label" />
              <p className="hint row-ctrl">
                Enable <b>Webcam overlay</b> at the top of step 1 to access camera, segmentation, auto-center and face light.
              </p>
            </div>
          )}
          {includeWebcam && (
            <>
              <div className="row two-col">
                <label className="row-label">Camera <Help>Pick which connected camera to use. Defaults to your system's default camera.</Help></label>
                <div className="row-ctrl">
                  <select value={cameraId ?? ''} onChange={(e) => setCameraId(e.target.value || undefined)}>
                    <option value="">Default camera</option>
                    {cameras.map((c) => <option key={c.deviceId} value={c.deviceId}>{c.label || c.deviceId}</option>)}
                  </select>
                </div>
              </div>
              <div className="row two-col">
                <label className="row-label">
                  Segmentation <Help>Which model to use for removing your background. Auto picks the highest-quality one your machine can run. Selfie is fastest and most compatible. Multiclass is a newer segmentation model with cleaner hair edges. RVM is real video matting — outputs semi-transparent hair strands, best quality, needs a GPU and downloads a ~15MB model file on first run.</Help>
                  {segBackendPref === 'auto' && (
                    <span style={{ opacity: 0.6, fontSize: 11, marginLeft: 6 }}>
                      {segBackendDetecting ? '(detecting…)' : `→ ${resolvedBackend}`}
                    </span>
                  )}
                </label>
                <div className="row-ctrl">
                  <select
                    value={segBackendPref}
                    onChange={(e) => setSegBackendPref(e.target.value as 'auto' | SegBackendId)}
                    style={{ flex: '1 1 100%', minWidth: 160, background: '#0d1117', color: '#e6edf3', border: '1px solid #262d36', borderRadius: 6, padding: '6px 8px' }}
                  >
                    <option value="auto">Auto (best available)</option>
                    <option value="selfie">Selfie Segmentation (fast)</option>
                    <option value="multiclass">Multiclass Segmenter (better edges)</option>
                    <option value="rvm">RVM Video Matting (best quality, GPU)</option>
                  </select>
                </div>
              </div>
              <div className="row two-col">
                <label className="row-label">Auto-center <Help>Tracks your face inside the shape so you stay framed as you lean side to side or move closer / further from the camera. Uses the existing background-segmentation model — works with any background mode.</Help></label>
                <div className="row-ctrl">
                  <label className="check inline">
                    <input
                      type="checkbox"
                      checked={autoCenter}
                      onChange={(e) => setAutoCenter(e.target.checked)}
                    />
                    Track my face
                  </label>
                </div>
              </div>
              <div className="row two-col">
                <label className="row-label" style={autoCenter ? { opacity: 0.5 } : undefined}>
                  Face light {Math.round(faceLight)} <Help>Artificial fill-light that brightens and warms your face — like a soft ring light. Applied on top of any colour effect, in both the preview and the recording.</Help>
                </label>
                <div className="row-ctrl">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={faceLight}
                    disabled={autoCenter}
                    onChange={(e) => setFaceLight(+e.target.value)}
                  />
                </div>
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <h2>
            <span className="step">7</span> Floating Panel
            <Help>How the floating webcam / HUD window behaves on your desktop while recording. These settings only affect the floating bubble — they don't appear in the recorded video. Only active while the webcam overlay is enabled; otherwise there's nothing floating to configure.</Help>
          </h2>
          <div className="row two-col">
            <span className="row-label" />
            <p className="hint row-ctrl">
              The floating bubble shows a live preview of yourself and the recording controls. Drag it anywhere; it stays on top of every other window while recording.
            </p>
          </div>
          <div className="row two-col">
            <label className="row-label" style={!includeWebcam ? { opacity: 0.5 } : undefined}>
              Fade near cursor <Help>When enabled, the floating face-cam becomes translucent while the mouse is over or near it, and returns to full opacity when the cursor moves away.</Help>
            </label>
            <div className="row-ctrl">
              <label className="check inline">
                <input
                  type="checkbox"
                  checked={webcamAutoOpacity}
                  disabled={!includeWebcam}
                  onChange={(e) => setWebcamAutoOpacity(e.target.checked)}
                />
                Auto reduce opacity of face cam
              </label>
            </div>
          </div>
          {!includeWebcam && (
            <div className="row two-col">
              <span className="row-label" />
              <p className="hint row-ctrl" style={{ color: 'var(--muted)' }}>
                Enable “Include me on screen” in the Webcam panel to use these settings.
              </p>
            </div>
          )}
        </section>


        <section className="panel">
          <h2>
            <span className="step">8</span> Recording FX
            <Help>Extra effects applied during recording. The cursor-zoom pans and zooms into the area around your mouse for tutorial-style videos. The idiot board shows notes only to you — they are hidden from the recording.</Help>
          </h2>
          <div className="row two-col">
            <label className="row-label">Start countdown <Help>How long the 3-2-1 overlay runs before recording actually starts. Set to "Off" to start recording instantly with zero delay. Useful if you've already set up your scene and just want to hit record.</Help></label>
            <div className="row-ctrl">
              <select value={countdownSeconds} onChange={(e) => setCountdownSeconds(+e.target.value)}>
                <option value={0}>Off (start instantly)</option>
                <option value={1}>1 second</option>
                <option value={2}>2 seconds</option>
                <option value={3}>3 seconds</option>
                <option value={5}>5 seconds</option>
                <option value={10}>10 seconds</option>
              </select>
            </div>
          </div>
          {countdownSeconds > 0 && (
            <div className="row two-col">
              <label className="row-label">Countdown style <Help>How the countdown is displayed on screen. Numbers shows a big 3-2-1 ring in the middle of your screen. Progress bar shows a subtle pill with a filling bar — less obtrusive if you're mid-scene.</Help></label>
              <div className="row-ctrl">
                <label className="check inline">
                  <input type="radio" name="countdownStyle" value="numbers" checked={countdownStyle === 'numbers'} onChange={() => setCountdownStyle('numbers')} />
                  Numbers (3-2-1)
                </label>
                <label className="check inline">
                  <input type="radio" name="countdownStyle" value="bar" checked={countdownStyle === 'bar'} onChange={() => setCountdownStyle('bar')} />
                  Progress bar
                </label>
              </div>
            </div>
          )}
          <div className="row two-col">
            <label className="row-label">Cursor zoom <Help>When enabled, the recorded video smoothly zooms toward your mouse cursor. Useful for tutorials where you want to emphasise what you are clicking. The zoom is applied to the captured screen, not the live display.</Help></label>
            <div className="row-ctrl">
              <label className="check inline">
                <input type="checkbox" checked={cursorZoom} onChange={(e) => setCursorZoom(e.target.checked)} />
                Follow my mouse
              </label>
            </div>
          </div>
          <div className="row two-col">
            <span className="row-label" />
            <p className="hint row-ctrl">Smoothly zooms the recorded frame toward your cursor so viewers always know where you're clicking. Great for tutorials and walkthroughs — the zoom is baked into the final video, not your live screen.</p>
          </div>

          {cursorZoom && (
            <>
              <div className="row two-col">
                <label className="row-label">Zoom factor {cursorZoomFactor.toFixed(1)}× <Help>How tight the zoom gets around the cursor. 1.1× is a gentle push-in; 3× is a tight close-up.</Help></label>
                <div className="row-ctrl">
                  <input type="range" min={1.1} max={3} step={0.1} value={cursorZoomFactor} onChange={(e) => setCursorZoomFactor(+e.target.value)} />
                </div>
              </div>
              <div className="row two-col">
                <label className="row-label">
                  Follow speed {cursorFollowSpeed.toFixed(2)}
                  <Help>How fast the recorded frame chases the cursor once it commits to a new target. Low values (0.02–0.05) drift slowly like a cinematic camera, higher values (0.15–0.25) snap quickly to the mouse. Too high + fast mouse movement feels dizzying on playback.</Help>
                </label>
                <div className="row-ctrl">
                  <input
                    type="range"
                    min={0.02}
                    max={0.25}
                    step={0.01}
                    value={cursorFollowSpeed}
                    onChange={(e) => setCursorFollowSpeed(+e.target.value)}
                  />
                </div>
              </div>
              <div className="row two-col">
                <label className="row-label">
                  Follow delay {cursorFollowDelayMs}ms
                  <Help>How long the cursor has to stay still before the frame starts chasing it. Higher values ignore quick flicks and only follow deliberate moves — the main fix for motion sickness. 0 = chase immediately, 600+ = very forgiving.</Help>
                </label>
                <div className="row-ctrl">
                  <input
                    type="range"
                    min={0}
                    max={1200}
                    step={20}
                    value={cursorFollowDelayMs}
                    onChange={(e) => setCursorFollowDelayMs(+e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div className="row two-col">
            <label className="row-label">Idiot Board <Help>A floating sticky-note window that's invisible to screen capture. Perfect for script cues, reminders, or bullet points you want to glance at while recording.</Help></label>
            <div className="row-ctrl">
              <button className="ghost btn-icon" onClick={() => window.api.toggleIdiotBoard()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="9" y1="13" x2="15" y2="13" />
                  <line x1="9" y1="17" x2="13" y2="17" />
                </svg>
                Toggle Idiot Board
              </button>
            </div>
          </div>
          <div className="row two-col">
            <span className="row-label" />
            <p className="hint row-ctrl">A floating text window only you can see — it's hidden from the recording via content protection. Use it as a teleprompter for scripts or a checklist while you record.</p>
          </div>
        </section>

        <section className="panel">
          <h2>
            <span className="step">9</span> Save to
            <Help>Where finished recordings go. Defaults to your Desktop. Click <b>Change…</b> to pick another folder — your choice is remembered across sessions. Recordings are saved automatically as MP4; no prompt.</Help>
          </h2>
          <div className="row two-col">
            <label className="row-label">Folder <Help>Where finished recordings go. Click <b>Change…</b> to pick another folder — your choice is remembered across sessions.</Help></label>
            <div className="row-ctrl">
              <input
                type="text"
                value={saveFolder}
                readOnly
                style={{ flex: '1 1 100%', minWidth: 160, background: '#0d1117', color: '#e6edf3', border: '1px solid #262d36', borderRadius: 6, padding: '6px 8px' }}
              />
              <div className="folder-actions">
                <button className="btn-icon" onClick={pickSaveFolder}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                  Change…
                </button>
                <button className="btn-icon" onClick={setFolderToDesktop}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="13" rx="1" />
                    <path d="M8 21h8M12 17v4" />
                  </svg>
                  Set To Desktop
                </button>
                <button className="btn-icon" onClick={setFolderToDownloads}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12" />
                    <path d="M7 10l5 5 5-5" />
                    <path d="M4 19h16" />
                  </svg>
                  Set To Downloads
                </button>
              </div>
            </div>
          </div>
          <div className="row two-col">
            <label className="row-label">After recording <Help>When enabled, the saved file is revealed in your OS file browser as soon as the recording finishes. Turn off if you'd rather keep recording back-to-back without windows popping up.</Help></label>
            <div className="row-ctrl">
              <label className="check inline">
                <input type="checkbox" checked={openFolderAfter} onChange={(e) => setOpenFolderAfter(e.target.checked)} />
                Open the folder when done
              </label>
            </div>
          </div>
          <div className="row two-col">
            <label className="row-label">Frame rate <Help>Target output frames-per-second. ffmpeg writes a constant-frame-rate file at this exact rate regardless of how jittery the source capture is. 30 fps is standard for screen recordings; 60 fps is smoother for gameplay or cursor-heavy demos but doubles the file size; 24 fps matches cinematic content; 15 fps makes tiny files for quick screencasts.</Help></label>
            <div className="row-ctrl">
              <select value={outputFps} onChange={(e) => setOutputFps(+e.target.value)}>
                <option value={15}>15 fps (small file)</option>
                <option value={24}>24 fps (cinematic)</option>
                <option value={30}>30 fps (standard)</option>
                <option value={60}>60 fps (smooth, large)</option>
              </select>
            </div>
          </div>
          <div className="row two-col">
            <span className="row-label" />
            <p className="hint row-ctrl">Recordings are saved automatically as MP4 — no prompt. Your choice is remembered across sessions.</p>
          </div>
        </section>

        <section className="panel wide">
          <h2>Preview</h2>
          <div className="preview" ref={previewHostRef}>
            <div className="empty">Preview appears after you press Start recording.</div>
          </div>
        </section>
      </main>

      {/* hidden video elements feeding the compositor */}
      <video ref={screenVideoRef} style={{ display: 'none' }} muted playsInline />
      <video ref={webcamVideoRef} style={{ display: 'none' }} muted playsInline />
    </>
  );
}
