import React, { useEffect, useState } from 'react';
import RecorderTab from './Recorder';
import EditorTab from './Editor';
import FaceBlurTab from './FaceBlur';
import PlayerTab from './Player';
import HelpModal from './HelpModal';

type Tab = 'recorder' | 'player' | 'editor' | 'faceblur';

export default function App() {
  const [tab, setTab] = useState<Tab>('recorder');
  const [helpOpen, setHelpOpen] = useState(false);
  // Path the Player tab should auto-select the next time it mounts.
  // Set by the Recorder via a DOM CustomEvent after a save completes,
  // then cleared by the PlayerTab once it has honoured the request.
  const [playerAutoSelect, setPlayerAutoSelect] = useState<string | null>(null);

  useEffect(() => {
    const onSaved = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string }>).detail;
      if (detail?.path) setPlayerAutoSelect(detail.path);
      setTab('player');
    };
    window.addEventListener('qnsub:recording-saved', onSaved);
    return () => window.removeEventListener('qnsub:recording-saved', onSaved);
  }, []);

  // Keep the floating webcam preview tied to the Recorder tab only.
  // The webcam window is intentionally NOT hidden when the main window
  // hides — the user can hide the main config window via the X button
  // and still drive the recorder from the floating webcam HUD.
  useEffect(() => {
    const api: any = (window as any).api;
    if (!api) return;
    if (tab === 'recorder') {
      api.showWebcamOverlay?.();
      api.showControlPanel?.();
    } else {
      api.hideWebcamOverlay?.();
      api.hideControlPanel?.();
    }
  }, [tab]);

  return (
    <div className="app">
      <header>
        <h1>QNSub Studio</h1>
        <nav className="tabs">
          <button
            className={`tab ${tab === 'recorder' ? 'sel' : ''}`}
            onClick={() => setTab('recorder')}
          >
            <span className="tab-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="14" rx="2" />
                <path d="M8 22h8M12 18v4" />
                <circle cx="12" cy="11" r="3" />
              </svg>
            </span>
            Screen Recorder
          </button>
          <button
            className={`tab ${tab === 'player' ? 'sel' : ''}`}
            onClick={() => setTab('player')}
            title="Play back your recordings"
          >
            <span className="tab-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <polygon points="10 9 16 12 10 15 10 9" fill="currentColor" stroke="none" />
              </svg>
            </span>
            Player
          </button>
          <button
            className={`tab ${tab === 'faceblur' ? 'sel' : ''}`}
            onClick={() => setTab('faceblur')}
            title="Blur faces in an existing video"
          >
            <span className="tab-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="10" r="4" />
                <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
                <path d="M9 9.5c.6-.4 1.3-.6 2-.6M14 11.2c-.3.4-.8.7-1.3.8" opacity="0.5" />
              </svg>
            </span>
            Face Blur
          </button>
          <button
            className={`tab ${tab === 'editor' ? 'sel' : ''}`}
            onClick={() => setTab('editor')}
            title="Editor — coming soon"
          >
            <span className="tab-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M2 9h20M7 4v5M17 4v5M7 20v-5M17 20v-5" />
                <path d="M10 12.5l5 2.5-5 2.5z" fill="currentColor" stroke="none" />
              </svg>
            </span>
            Editor
          </button>
          <button
            className="tab tab-coffee"
            onClick={() => window.open('https://paypal.me/qnsub', '_blank', 'noopener')}
            title="Buy me a coffee — support QNSub Studio via PayPal"
            aria-label="Buy me a coffee"
          >
            <span className="tab-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 8h1a4 4 0 0 1 0 8h-1" />
                <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
                <line x1="6" y1="2" x2="6" y2="4" />
                <line x1="10" y1="2" x2="10" y2="4" />
                <line x1="14" y1="2" x2="14" y2="4" />
              </svg>
            </span>
            Coffee
          </button>
          <button
            className="tab tab-help"
            onClick={() => setHelpOpen(true)}
            title="Open the help & features guide"
            aria-label="Help"
          >
            <span className="tab-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4" />
                <line x1="12" y1="17" x2="12" y2="17.01" />
              </svg>
            </span>
            Help
          </button>
          <button
            className="tab tab-quit"
            onClick={() => (window as any).api?.quitApp?.()}
            title="Quit QNSub Studio"
            aria-label="Quit"
          >
            <span className="tab-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </span>
            Quit
          </button>
        </nav>
      </header>

      {/*
        Render all tabs but hide the inactive ones via CSS. This keeps the
        recorder's hidden <video> refs, compositor, and in-progress recording
        alive if the user flips tabs mid-session.
      */}
      <div className={`tab-panel ${tab === 'recorder' ? 'active' : 'inactive'}`}>
        <RecorderTab />
      </div>
      {tab === 'player' && (
        <div className="tab-panel active">
          <PlayerTab
            autoSelectPath={playerAutoSelect}
            onAutoSelectHandled={() => setPlayerAutoSelect(null)}
          />
        </div>
      )}
      <div className={`tab-panel ${tab === 'faceblur' ? 'active' : 'inactive'}`}>
        <FaceBlurTab />
      </div>
      <div className={`tab-panel ${tab === 'editor' ? 'active' : 'inactive'}`}>
        <EditorTab />
      </div>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      <footer className="app-footer">
        <button
          type="button"
          className="footer-link"
          onClick={() => (window as any).api?.toggleDevTools?.()}
          title="Open / close Chromium DevTools (developer use)"
        >
          DevTools
        </button>
      </footer>
    </div>
  );
}
