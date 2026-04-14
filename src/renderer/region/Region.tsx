import React, { useEffect, useRef, useState } from 'react';
import type { RegionResult, ScreenSource } from '../../shared/types';

// `window.api` is already declared globally by the main Recorder
// module with the full MainApi shape. Declaring it again here with a
// narrower type collides (TS2717), so we cast locally instead. The
// region preload actually only exposes `listSources`, but the cast is
// safe because this component never touches the other methods.
type RegionPreload = {
  displayId: string;
  submit: (r: Omit<RegionResult, 'displayId'>) => void;
  cancel: () => void;
};
const regionApi = (window as unknown as { regionApi: RegionPreload }).regionApi;
const listSources = (window as unknown as { api: { listSources: () => Promise<ScreenSource[]> } }).api.listSources;

export default function Region() {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null);
  const [sourceId, setSourceId] = useState<string>('');

  useEffect(() => {
    // Pick the screen source that matches our displayId.
    (async () => {
      try {
        const sources = await listSources();
        const match = sources.find(
          (s) => s.id.startsWith('screen:') && (!regionApi.displayId || s.displayId === regionApi.displayId)
        );
        setSourceId(match?.id || sources.find((s) => s.id.startsWith('screen:'))?.id || '');
      } catch {}
    })();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') regionApi.cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onMouseDown(e: React.MouseEvent) {
    setStart({ x: e.clientX, y: e.clientY });
    setEnd({ x: e.clientX, y: e.clientY });
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!start) return;
    setEnd({ x: e.clientX, y: e.clientY });
  }
  function onMouseUp() {
    if (!start || !end) return;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    if (width < 10 || height < 10) {
      setStart(null); setEnd(null);
      return;
    }
    regionApi.submit({
      sourceId,
      bounds: { x, y, width, height },
      displaySize: { width: window.innerWidth, height: window.innerHeight }
    });
  }

  const rect =
    start && end
      ? {
          left: Math.min(start.x, end.x),
          top: Math.min(start.y, end.y),
          width: Math.abs(end.x - start.x),
          height: Math.abs(end.y - start.y)
        }
      : null;

  return (
    <div
      className="region"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      <div className="hint">Drag to select a region · Esc to cancel</div>
      {rect && (
        <div
          className="box"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          }}
        >
          <div className="dim">{rect.width}×{rect.height}</div>
        </div>
      )}
    </div>
  );
}
