import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnnotationColor,
  Arrow,
  RegionResult,
  ScreenSource,
  WebcamShape,
  WebcamSize
} from '../../shared/types';
import { Compositor, WebcamSettings } from '../lib/compositor';
import { getMicStream, getWebcamStream, listCameras, listMics } from '../lib/webcam';
import { getScreenStream } from '../lib/screen';
import { Recorder, mixAudioStreams } from '../lib/mediaRecorder';
import type { SegMode } from '../lib/segmenter';

declare global {
  interface Window {
    api: {
      listSources: () => Promise<ScreenSource[]>;
      openRegion: () => Promise<boolean>;
      onRegionResult: (cb: (r: RegionResult) => void) => () => void;
      onRegionCancel: (cb: () => void) => () => void;
      showCountdown: (s?: number) => Promise<void>;
      openAnnotation: () => Promise<boolean>;
      closeAnnotation: () => Promise<boolean>;
      setAnnotationColor: (c: AnnotationColor) => void;
      onAnnotationArrow: (cb: (a: Arrow) => void) => () => void;
      onTogglePause: (cb: () => void) => () => void;
      saveRecording: (buf: ArrayBuffer) => Promise<{ canceled: boolean; path?: string }>;
      showError: (msg: string) => Promise<void>;
    };
  }
}

const SHAPES: WebcamShape[] = ['circle', 'rect'];
const SIZES: WebcamSize[] = ['small', 'medium', 'large'];
const BG_MODES: { id: SegMode; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'blur', label: 'Blur' },
  { id: 'image', label: 'Image' }
];
const COLORS: AnnotationColor[] = ['red', 'green', 'blue'];

export default function App() {
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | undefined>();
  const [micId, setMicId] = useState<string | undefined>();
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [includeMic, setIncludeMic] = useState(true);
  const [includeWebcam, setIncludeWebcam] = useState(true);

  const [shape, setShape] = useState<WebcamShape>('circle');
  const [size, setSize] = useState<WebcamSize>('medium');
  const [bgMode, setBgMode] = useState<SegMode>('none');
  const [webcamPos, setWebcamPos] = useState({ x: 0.75, y: 0.72 });
  const [color, setColor] = useState<AnnotationColor>('red');

  const [region, setRegion] = useState<RegionResult | null>(null);
  const [recState, setRecState] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [status, setStatus] = useState('Ready');

  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  // ---- Load sources + devices ----
  useEffect(() => {
    (async () => {
      try {
        const [s, cams, mis] = await Promise.all([
          window.api.listSources(),
          listCameras().catch(() => []),
          listMics().catch(() => [])
        ]);
        setSources(s);
        setCameras(cams);
        setMics(mis);
        const screens = s.filter((x) => x.id.startsWith('screen:'));
        if (screens[0]) setSelectedSource(screens[0].id);
      } catch (e: any) {
        setStatus('Failed to load sources: ' + e.message);
      }
    })();
  }, []);

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

  // ---- Annotation arrows from overlay window ----
  useEffect(() => {
    const off = window.api.onAnnotationArrow((a) => {
      compositorRef.current?.addArrow(a);
    });
    return off;
  }, []);

  function togglePause() {
    if (recState === 'recording') {
      recorderRef.current?.pause();
      compositorRef.current?.pause();
      setRecState('paused');
      setStatus('Paused (Ctrl+Shift+P to resume)');
    } else if (recState === 'paused') {
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
        shape, size, bgMode,
        x: webcamPos.x, y: webcamPos.y,
        bgImage: null
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

      // attach canvas to preview host for visual feedback
      if (previewHostRef.current) {
        previewHostRef.current.innerHTML = '';
        comp.canvas.style.width = '100%';
        comp.canvas.style.height = 'auto';
        comp.canvas.style.display = 'block';
        previewHostRef.current.appendChild(comp.canvas);
      }
      await comp.start();

      // 5. Mix audio
      const audioStreams: MediaStream[] = [];
      if (screenStream.getAudioTracks().length > 0) audioStreams.push(screenStream);
      if (micStream) audioStreams.push(micStream);
      const mixed = audioStreams.length > 0 ? mixAudioStreams(audioStreams) : null;

      // 6. Build recording stream
      const videoTrack = comp.captureStream(30).getVideoTracks()[0];
      const tracks: MediaStreamTrack[] = [videoTrack];
      if (mixed) tracks.push(...mixed.getAudioTracks());
      const recStream = new MediaStream(tracks);

      // 7. Countdown
      setStatus('Get ready…');
      await window.api.showCountdown(3);

      // 8. Annotation overlay
      await window.api.openAnnotation();
      window.api.setAnnotationColor(color);

      // 9. Start recording
      const rec = new Recorder();
      rec.start(recStream);
      recorderRef.current = rec;
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
    setStatus('Finalizing…');
    try {
      const blob = await recorderRef.current.stop();
      compositorRef.current?.stop();
      await window.api.closeAnnotation();
      const buf = await blob.arrayBuffer();
      const res = await window.api.saveRecording(buf);
      if (res.canceled) setStatus('Save cancelled');
      else setStatus('Saved: ' + res.path);
    } catch (e: any) {
      setStatus('Error: ' + e.message);
    } finally {
      cleanup();
      setRecState('idle');
    }
  }

  function cleanup() {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    webcamStreamRef.current = null;
    micStreamRef.current = null;
  }

  // Keep compositor settings live while recording
  useEffect(() => {
    compositorRef.current?.setWebcamSettings({ shape, size, bgMode, x: webcamPos.x, y: webcamPos.y });
  }, [shape, size, bgMode, webcamPos]);

  useEffect(() => {
    if (recState !== 'idle') window.api.setAnnotationColor(color);
  }, [color, recState]);

  const screens = useMemo(() => sources.filter((s) => s.id.startsWith('screen:')), [sources]);
  const windowsSources = useMemo(() => sources.filter((s) => s.id.startsWith('window:')), [sources]);

  return (
    <div className="app">
      <header>
        <h1>QNSub Screen Recorder</h1>
        <div className={`status ${recState}`}>{status}</div>
      </header>

      <main>
        <section className="panel">
          <h2>1. Source</h2>
          <div className="sources">
            {screens.map((s) => (
              <button
                key={s.id}
                className={`source ${selectedSource === s.id ? 'sel' : ''}`}
                onClick={() => { setSelectedSource(s.id); setRegion(null); }}
              >
                <img src={s.thumbnail} alt={s.name} />
                <span>{s.name}</span>
              </button>
            ))}
          </div>
          <div className="row">
            <button onClick={pickRegion}>Select region…</button>
            <button onClick={() => setRegion(null)}>Full screen</button>
            {region && <span className="tag green">Region {region.bounds.width}×{region.bounds.height}</span>}
          </div>
          {windowsSources.length > 0 && (
            <details>
              <summary>Windows ({windowsSources.length})</summary>
              <div className="sources">
                {windowsSources.map((s) => (
                  <button key={s.id} className={`source ${selectedSource === s.id ? 'sel' : ''}`} onClick={() => setSelectedSource(s.id)}>
                    <img src={s.thumbnail} alt={s.name} />
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
        </section>

        <section className="panel">
          <h2>2. Audio</h2>
          <label className="check">
            <input type="checkbox" checked={includeSystemAudio} onChange={(e) => setIncludeSystemAudio(e.target.checked)} />
            Computer audio (what's playing)
          </label>
          <label className="check">
            <input type="checkbox" checked={includeMic} onChange={(e) => setIncludeMic(e.target.checked)} />
            Microphone
          </label>
          {includeMic && (
            <select value={micId ?? ''} onChange={(e) => setMicId(e.target.value || undefined)}>
              <option value="">Default microphone</option>
              {mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label || m.deviceId}</option>)}
            </select>
          )}
        </section>

        <section className="panel">
          <h2>3. Webcam</h2>
          <label className="check">
            <input type="checkbox" checked={includeWebcam} onChange={(e) => setIncludeWebcam(e.target.checked)} />
            Include webcam overlay
          </label>
          {includeWebcam && (
            <>
              <select value={cameraId ?? ''} onChange={(e) => setCameraId(e.target.value || undefined)}>
                <option value="">Default camera</option>
                {cameras.map((c) => <option key={c.deviceId} value={c.deviceId}>{c.label || c.deviceId}</option>)}
              </select>
              <div className="row">
                <label>Shape</label>
                {SHAPES.map((sh) => (
                  <button key={sh} className={shape === sh ? 'chip sel' : 'chip'} onClick={() => setShape(sh)}>{sh}</button>
                ))}
              </div>
              <div className="row">
                <label>Size</label>
                {SIZES.map((sz) => (
                  <button key={sz} className={size === sz ? 'chip sel' : 'chip'} onClick={() => setSize(sz)}>{sz}</button>
                ))}
              </div>
              <div className="row">
                <label>Background</label>
                {BG_MODES.map((b) => (
                  <button key={b.id} className={bgMode === b.id ? 'chip sel' : 'chip'} onClick={() => setBgMode(b.id)}>{b.label}</button>
                ))}
              </div>
              <div className="row">
                <label>Position</label>
                <input type="range" min={0} max={1} step={0.01} value={webcamPos.x} onChange={(e) => setWebcamPos((p) => ({ ...p, x: +e.target.value }))} />
                <input type="range" min={0} max={1} step={0.01} value={webcamPos.y} onChange={(e) => setWebcamPos((p) => ({ ...p, y: +e.target.value }))} />
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <h2>4. Annotation color</h2>
          <div className="row">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`color-chip ${c} ${color === c ? 'sel' : ''}`}
                onClick={() => setColor(c)}
                title={c}
              />
            ))}
          </div>
          <p className="hint">Hold <kbd>Ctrl</kbd> and drag over the screen to draw arrows while recording.</p>
        </section>

        <section className="panel wide">
          <h2>Preview</h2>
          <div className="preview" ref={previewHostRef}>
            <div className="empty">Preview appears after you press Start.</div>
          </div>
        </section>
      </main>

      <footer>
        {recState === 'idle' && <button className="primary big" onClick={startRecording}>● Start recording</button>}
        {recState !== 'idle' && (
          <>
            <button className="warn big" onClick={togglePause}>{recState === 'paused' ? '▶ Resume' : '❚❚ Pause'}</button>
            <button className="danger big" onClick={stopRecording}>■ Stop &amp; save MP4</button>
          </>
        )}
        <span className="shortcut">Pause/Resume: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd></span>
      </footer>

      {/* hidden video elements feeding the compositor */}
      <video ref={screenVideoRef} style={{ display: 'none' }} muted playsInline />
      <video ref={webcamVideoRef} style={{ display: 'none' }} muted playsInline />
    </div>
  );
}
