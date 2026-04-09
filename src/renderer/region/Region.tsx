import React, { useEffect, useRef, useState } from 'react';
import type { ScreenSource } from '../../shared/types';

declare global {
  interface Window {
    regionApi: {
      displayId: string;
      submit: (r: { sourceId: string; bounds: { x: number; y: number; width: number; height: number } }) => void;
      cancel: () => void;
    };
    api: { listSources: () => Promise<ScreenSource[]> };
  }
}

export default function Region() {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null);
  const [sourceId, setSourceId] = useState<string>('');

  useEffect(() => {
    // Pick the screen source that matches our displayId.
    (async () => {
      try {
        const sources = await window.api.listSources();
        const match = sources.find(
          (s) => s.id.startsWith('screen:') && (!window.regionApi.displayId || s.displayId === window.regionApi.displayId)
        );
        setSourceId(match?.id || sources.find((s) => s.id.startsWith('screen:'))?.id || '');
      } catch {}
    })();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.regionApi.cancel();
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
    window.regionApi.submit({
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
