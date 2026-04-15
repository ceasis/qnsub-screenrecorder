import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

// Global catch-all for async errors nobody awaited / caught. Without
// this, a silent `.catch(() => {})` or a forgotten await can swallow
// real bugs into the void — you'd see a feature stop working with
// nothing in the console. Logging every unhandled rejection forces
// them to leave a trail. `error` events (sync throws) are already
// surfaced by Chromium's default handler.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    // eslint-disable-next-line no-console
    console.error('[Renderer] unhandled promise rejection:', e.reason);
  });
  window.addEventListener('error', (e) => {
    // eslint-disable-next-line no-console
    console.error('[Renderer] uncaught error:', e.error || e.message);
  });
}

createRoot(document.getElementById('root')!).render(<App />);
