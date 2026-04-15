import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePersistedState } from './usePersistedState';

// Recording row returned by the main process. Path stays absolute
// so the media:// loader can stream it; mtime drives the sort order.
type Recording = {
  path: string;
  name: string;
  size: number;
  mtime: number;
  folder: string;
};

// `Recorder.tsx` already declares the strict `Window.api` shape, so
// here we just cast to the subset of methods this tab uses. The
// preload bridge exposes them all via `exposeInMainWorld('api', ...)`.
const api = () => (window as any).api;

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4] as const;

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Full HH:MM:SS for the recording list. Always zero-padded so the
// column stays aligned even when clips cross the hour boundary.
function fmtHMS(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '--:--:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Absolute "Apr 01, 2026" format. Zero-padded day so the column
// stays aligned across rows regardless of whether the day is
// single or double digit.
function fmtDate(mtime: number): string {
  const d = new Date(mtime);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = d.getDate().toString().padStart(2, '0');
  return `${months[d.getMonth()]} ${day}, ${d.getFullYear()}`;
}

// Convert a native OS path to a media:// URL the renderer can load.
// Format matches what the main process handler expects:
//   media:///C:/Users/.../ScreenRecording_.../clip.mp4
// Forward slashes, drive letter preserved, each segment URL-encoded so
// spaces and unicode survive the trip through `new URL()`.
function pathToMediaUrl(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const withSlash = norm.startsWith('/') ? norm : '/' + norm;
  const encoded = withSlash.split('/').map(encodeURIComponent).join('/');
  return 'media://local' + encoded;
}

interface PlayerTabProps {
  // Path the Recorder asked us to jump straight to after a save
  // completes. We select it the moment the refreshed list includes
  // it, then call onAutoSelectHandled so App can clear the request.
  autoSelectPath?: string | null;
  onAutoSelectHandled?: () => void;
}

export default function PlayerTab({ autoSelectPath = null, onAutoSelectHandled }: PlayerTabProps = {}) {
  // Reuse the same save folder the Recorder writes to.
  const [saveFolder] = usePersistedState<string>('rec.saveFolder', '');
  // The Audio panel in the Recorder persists a chosen speaker
  // (audiooutput device). We apply it to the <video> via
  // setSinkId whenever it changes so the user's selection is
  // honoured the moment playback starts.
  const [speakerId] = usePersistedState<string | undefined>('rec.speakerId', undefined);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Probed video metadata, keyed by absolute file path. Populated
  // lazily one clip at a time after the list refreshes — loading
  // only the metadata (no frames) is cheap, but doing a hundred
  // at once still thrashes the disk. `fps` is estimated via
  // requestVideoFrameCallback because HTML5 video has no direct API.
  type VideoMeta = { duration: number; width: number; height: number; fps: number };
  const [meta, setMeta] = useState<Record<string, VideoMeta>>({});

  const videoRef = useRef<HTMLVideoElement>(null);
  // Set to true whenever the Recorder auto-drops us here; the next
  // loadedmetadata starts playback automatically so the user sees
  // their recording immediately instead of having to hit Play.
  const autoPlayOnLoadRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);

  const selected = useMemo(
    () => recordings.find((r) => r.path === selectedPath) || null,
    [recordings, selectedPath]
  );

  const videoSrc = useMemo(
    () => (selected ? pathToMediaUrl(selected.path) : ''),
    [selected]
  );

  // ---- Load recordings list from disk ----
  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api().listRecordings(saveFolder || null);
      setRecordings(list);
      // Priority 1: honour any auto-select request from the Recorder.
      // Priority 2: keep the user's current selection if it still exists.
      // Priority 3: fall back to the newest recording.
      if (autoSelectPath && list.find((r: Recording) => r.path === autoSelectPath)) {
        setSelectedPath(autoSelectPath);
        autoPlayOnLoadRef.current = true;
        onAutoSelectHandled?.();
      } else if (list.length > 0 && !list.find((r: Recording) => r.path === selectedPath)) {
        setSelectedPath(list[0].path);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // Refresh when new recordings are saved from the Recorder tab.
    const unsub = api()?.onRecordingSaved?.(() => {
      refresh();
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFolder]);

  // Lazy-probe metadata for every recording that doesn't already
  // have it cached. One clip at a time via a throwaway <video>
  // element. Duration and resolution come free from loadedmetadata;
  // fps is estimated with requestVideoFrameCallback over a short
  // play window (~600ms) because HTML5 video has no direct fps API.
  useEffect(() => {
    let cancelled = false;
    const pending = recordings.filter((r) => meta[r.path] === undefined);
    if (pending.length === 0) return;

    const probeOne = (idx: number) => {
      if (cancelled || idx >= pending.length) return;
      const rec = pending[idx];
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.playsInline = true;
      // Keep the element off-screen but still attached so frame
      // callbacks fire in Chromium.
      v.style.position = 'fixed';
      v.style.left = '-9999px';
      v.style.width = '2px';
      v.style.height = '2px';
      v.style.opacity = '0';
      v.style.pointerEvents = 'none';
      document.body.appendChild(v);

      let duration = NaN;
      let width = 0;
      let height = 0;
      let finished = false;

      const cleanup = () => {
        if (finished) return;
        finished = true;
        try { v.pause(); } catch {}
        v.removeAttribute('src');
        try { v.load(); } catch {}
        try { v.remove(); } catch {}
      };

      const finish = (fps: number) => {
        if (finished) return;
        if (!cancelled) {
          setMeta((prev) => ({ ...prev, [rec.path]: { duration, width, height, fps } }));
        }
        cleanup();
        probeOne(idx + 1);
      };

      const onError = () => {
        if (!cancelled) {
          setMeta((prev) => ({ ...prev, [rec.path]: { duration: NaN, width: 0, height: 0, fps: NaN } }));
        }
        cleanup();
        probeOne(idx + 1);
      };

      v.addEventListener('error', onError, { once: true });
      v.addEventListener('loadedmetadata', () => {
        duration = v.duration;
        width = v.videoWidth;
        height = v.videoHeight;
        // Kick off playback to measure FPS via rVFC. Fall back to
        // timeupdate-based estimate if rVFC isn't available.
        const hasRVFC = typeof (v as any).requestVideoFrameCallback === 'function';
        const WINDOW_MS = 600;
        let frames = 0;
        let firstTs = 0;
        let lastTs = 0;

        const safetyTimer = window.setTimeout(() => {
          if (lastTs > firstTs && frames > 1) {
            finish((frames - 1) * 1000 / (lastTs - firstTs));
          } else {
            finish(NaN);
          }
        }, WINDOW_MS + 400);

        if (hasRVFC) {
          const onFrame: VideoFrameRequestCallback = (_now, metadataCb) => {
            if (frames === 0) firstTs = metadataCb.mediaTime * 1000;
            lastTs = metadataCb.mediaTime * 1000;
            frames += 1;
            if (lastTs - firstTs >= WINDOW_MS && frames > 2) {
              window.clearTimeout(safetyTimer);
              const fps = (frames - 1) * 1000 / (lastTs - firstTs);
              finish(fps);
              return;
            }
            (v as any).requestVideoFrameCallback(onFrame);
          };
          (v as any).requestVideoFrameCallback(onFrame);
        }

        v.play().catch(() => {
          // Autoplay denied — still return what we have so the row
          // at least gets duration + resolution.
          window.clearTimeout(safetyTimer);
          finish(NaN);
        });
      }, { once: true });

      v.src = pathToMediaUrl(rec.path);
    };
    probeOne(0);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordings]);

  // ---- Video element sync ----
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
  }, [rate, videoSrc]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.loop = loop;
  }, [loop]);

  // Apply the persisted speaker selection. `setSinkId` is Chromium-
  // only and needs the device to still be plugged in — wrapped in
  // try/catch so a stale id (e.g. a headset the user unplugged)
  // doesn't crash the tab.
  useEffect(() => {
    const v = videoRef.current as HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> };
    if (!v || typeof v.setSinkId !== 'function') return;
    v.setSinkId(speakerId || '').catch(() => {});
  }, [speakerId, videoSrc]);

  // Reset play state when switching videos.
  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [videoSrc]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing in inputs.
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const v = videoRef.current;
      if (!v || !selected) return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          if (v.paused) v.play(); else v.pause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - (e.shiftKey ? 10 : 5));
          break;
        case 'ArrowRight':
          e.preventDefault();
          v.currentTime = Math.min(v.duration || 0, v.currentTime + (e.shiftKey ? 10 : 5));
          break;
        case 'j':
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 10);
          break;
        case 'l':
          e.preventDefault();
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
          break;
        case ',':
          e.preventDefault();
          v.pause();
          v.currentTime = Math.max(0, v.currentTime - 1 / 30);
          break;
        case '.':
          e.preventDefault();
          v.pause();
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 1 / 30);
          break;
        case 'm':
          e.preventDefault();
          setMuted((m) => !m);
          break;
        case 'f':
          e.preventDefault();
          if (document.fullscreenElement) document.exitFullscreen();
          else v.requestFullscreen();
          break;
        case '0':
          e.preventDefault();
          v.currentTime = 0;
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  // ---- Controls handlers ----
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  };

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, t), v.duration || 0);
  };

  const stepFrame = (dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.min(Math.max(0, v.currentTime + dir / 30), v.duration || 0);
  };

  const toggleFullscreen = () => {
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else v.requestFullscreen();
  };

  const takeSnapshot = () => {
    const v = videoRef.current;
    if (!v || !selected) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth || 1920;
    c.height = v.videoHeight || 1080;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = selected.name.replace(/\.[^.]+$/, '') + `_${Math.floor(v.currentTime)}s.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  };

  const deleteSelected = async () => {
    if (!selected) return;
    const ok = await api().deleteRecording(selected.path);
    if (ok) {
      setSelectedPath(null);
      await refresh();
    }
  };

  const [trimming, setTrimming] = useState(false);

  // Run ffmpeg trim + refresh list + auto-select the new file so
  // the user sees their trimmed clip immediately. `side = 'before'`
  // drops everything before the current frame; `'after'` drops
  // everything after.
  const trim = async (side: 'before' | 'after') => {
    const v = videoRef.current;
    if (!selected || !v) return;
    const duration = v.duration || 0;
    if (duration <= 0) return;
    const startSec = side === 'before' ? v.currentTime : 0;
    const endSec = side === 'before' ? duration : v.currentTime;
    if (endSec - startSec < 0.1) return;
    setTrimming(true);
    try {
      const res = await api().trimRecording({ path: selected.path, startSec, endSec });
      if (res?.ok && res.path) {
        autoPlayOnLoadRef.current = false;
        setSelectedPath(res.path);
        await refresh();
      } else {
        alert('Trim failed: ' + (res?.error || 'unknown'));
      }
    } finally {
      setTrimming(false);
    }
  };

  return (
    <div className="player-tab">
      {/* Left column — recording list */}
      <aside className="player-list">
        <div className="player-list-header">
          <div>
            <h2>Recordings</h2>
            <p className="muted">{recordings.length} in {saveFolder || 'no folder'}</p>
          </div>
          <div className="player-list-actions">
            <button
              className="chip"
              onClick={() => api().openPlayerFolder()}
              title="Open the Desktop folder in your file browser"
            >
              🖥 Desktop
            </button>
            <button className="chip" onClick={refresh} title="Refresh list">
              {loading ? '…' : '↻'}
            </button>
          </div>
        </div>
        {!saveFolder && (
          <div className="player-empty">
            <p>Set a save folder on the Recorder tab first.</p>
          </div>
        )}
        {saveFolder && recordings.length === 0 && !loading && (
          <div className="player-empty">
            <p>No recordings yet. Record something on the Recorder tab and it'll land here automatically.</p>
          </div>
        )}
        <ul className="player-list-items">
          {recordings.map((r) => (
            <li
              key={r.path}
              className={`player-list-item ${r.path === selectedPath ? 'sel' : ''}`}
              onClick={() => setSelectedPath(r.path)}
              title={r.path}
            >
              <div className="player-list-thumb">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />
                </svg>
              </div>
              <div className="player-list-meta">
                <div className="player-list-name">{r.name}</div>
                <div className="player-list-sub">
                  <span className="player-list-duration">{fmtHMS(meta[r.path]?.duration ?? NaN)}</span>
                  <span className="player-list-sep">·</span>
                  {fmtDate(r.mtime)}
                  <span className="player-list-sep">·</span>
                  {fmtSize(r.size)}
                </div>
                <div className="player-list-sub player-list-tech">
                  {(() => {
                    const m = meta[r.path];
                    if (!m) return <span className="muted">probing…</span>;
                    const res = m.width && m.height ? `${m.width}×${m.height}` : '—';
                    const fps = isFinite(m.fps) && m.fps > 0 ? `${Math.round(m.fps)} fps` : '—';
                    return (
                      <>
                        {res}
                        <span className="player-list-sep">·</span>
                        {fps}
                      </>
                    );
                  })()}
                </div>
                {r.folder && <div className="player-list-folder">{r.folder}</div>}
                {r.path === selectedPath && (
                  <div className="player-list-actions-row">
                    <button
                      type="button"
                      className="chip"
                      onClick={(e) => {
                        e.stopPropagation();
                        api().revealRecording(r.path);
                      }}
                      title="Show in file explorer"
                    >
                      📂 Reveal
                    </button>
                    <button
                      type="button"
                      className="chip danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSelected();
                      }}
                      title="Move to Recycle Bin"
                    >
                      🗑 Delete
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </aside>

      {/* Right column — player */}
      <section className="player-main">
        {!selected && (
          <div className="player-empty-main">
            <div className="player-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <polygon points="10 9 16 12 10 15 10 9" fill="currentColor" />
              </svg>
            </div>
            <h3>Pick a recording from the list</h3>
            <p className="muted">Use the arrow keys, space to play/pause, F for fullscreen, M to mute, and , / . to step one frame at a time.</p>
          </div>
        )}
        {selected && (
          <>
            <div className="player-video-wrap">
              <video
                key={selected.path}
                ref={videoRef}
                src={videoSrc}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration || 0);
                  if (autoPlayOnLoadRef.current) {
                    autoPlayOnLoadRef.current = false;
                    e.currentTarget.play().catch(() => {});
                  }
                }}
                onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
                onClick={togglePlay}
                playsInline
              />
            </div>
            <div className="player-controls">
              <div className="player-scrub">
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.01}
                  value={currentTime}
                  onChange={(e) => seekTo(+e.target.value)}
                />
                <div className="player-scrub-time">
                  <span>{fmtTime(currentTime)}</span>
                  <span className="muted"> / {fmtTime(duration)}</span>
                </div>
              </div>
              <div className="player-buttons">
                <button className="chip success player-play" onClick={togglePlay} title="Play / Pause (Space)">
                  {playing ? '❚❚ Pause' : '▶ Play'}
                </button>
                <button className="chip" onClick={() => seekTo(0)} title="Back to start (0)">
                  ⏮
                </button>
                <button className="chip" onClick={() => seekTo(currentTime - 10)} title="Back 10s (J)">
                  −10s
                </button>
                <button className="chip" onClick={() => stepFrame(-1)} title="Previous frame (,)">
                  ◂ frame
                </button>
                <button className="chip" onClick={() => stepFrame(1)} title="Next frame (.)">
                  frame ▸
                </button>
                <button className="chip" onClick={() => seekTo(currentTime + 10)} title="Forward 10s (L)">
                  +10s
                </button>
                <button className="chip" onClick={() => seekTo(duration)} title="Jump to end">
                  ⏭
                </button>
                <span className="player-spacer" />
                <button
                  className="chip"
                  disabled={trimming}
                  onClick={() => trim('before')}
                  title="Trim: drop everything before the current frame and save as a new file"
                >
                  ✂ Trim start
                </button>
                <button
                  className="chip"
                  disabled={trimming}
                  onClick={() => trim('after')}
                  title="Trim: drop everything after the current frame and save as a new file"
                >
                  Trim end ✂
                </button>
                <span className="player-spacer" />
                <button className="chip" onClick={() => setMuted((m) => !m)} title="Mute (M)">
                  {muted || volume === 0 ? '🔇' : '🔊'}
                </button>
                <input
                  type="range"
                  className="player-volume"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    const v = +e.target.value;
                    setVolume(v);
                    if (v > 0) setMuted(false);
                  }}
                  title="Volume"
                />
                <label className="check inline">
                  <input
                    type="checkbox"
                    checked={loop}
                    onChange={(e) => setLoop(e.target.checked)}
                  />
                  Loop
                </label>
                <select
                  className="player-rate"
                  value={rate}
                  onChange={(e) => setRate(+e.target.value)}
                  title="Playback speed"
                >
                  {PLAYBACK_RATES.map((r) => (
                    <option key={r} value={r}>{r}×</option>
                  ))}
                </select>
                <button className="chip" onClick={takeSnapshot} title="Save the current frame as a PNG">
                  📷 Snapshot
                </button>
                <button className="chip" onClick={toggleFullscreen} title="Fullscreen (F)">
                  ⛶
                </button>
                <button className="chip" onClick={() => api().revealRecording(selected.path)} title="Show in folder">
                  📂 Reveal
                </button>
                <button className="chip danger" onClick={deleteSelected} title="Move to Recycle Bin">
                  🗑 Delete
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
