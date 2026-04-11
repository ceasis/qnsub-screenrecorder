import React, { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    idiotApi: {
      close: () => void;
      resize: (dims: { width: number; height: number }) => void;
    };
  }
}

const STORAGE_KEY = 'idiotboard.notes';

export default function IdiotBoard() {
  const [text, setText] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) ?? ''; } catch { return ''; }
  });
  const [fontSize, setFontSize] = useState<number>(() => {
    try { return Number(localStorage.getItem(STORAGE_KEY + '.fs')) || 16; } catch { return 16; }
  });
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, text); } catch {}
  }, [text]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY + '.fs', String(fontSize)); } catch {}
  }, [fontSize]);

  return (
    <div className="idiot-root">
      <div className="idiot-header">
        <span className="idiot-title">📝 Idiot Board</span>
        <div className="idiot-controls">
          <button
            className="idiot-btn"
            title="Smaller text"
            onClick={() => setFontSize((s) => Math.max(10, s - 2))}
          >A−</button>
          <button
            className="idiot-btn"
            title="Bigger text"
            onClick={() => setFontSize((s) => Math.min(40, s + 2))}
          >A+</button>
          <button
            className="idiot-btn"
            title="Clear all"
            onClick={() => { if (confirm('Clear all notes?')) setText(''); }}
          >⌫</button>
          <button
            className="idiot-btn idiot-close"
            title="Close"
            onClick={() => window.idiotApi.close()}
          >×</button>
        </div>
      </div>
      <textarea
        ref={taRef}
        className="idiot-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Jot down your notes, cues, or script…\nThis window is invisible to the recording.'}
        style={{ fontSize: `${fontSize}px` }}
        spellCheck={false}
        autoFocus
      />
      <div className="idiot-footer">Invisible to screen capture · Drag header to move</div>
    </div>
  );
}
