// Placeholder only. The live Face Blur UI is `FaceBlur.tsx` (wired from `App.tsx`).
// This file is kept as a lightweight fallback if the full tab is disabled again.
import React from 'react';

export default function FaceBlurComingSoon() {
  return (
    <>
      <div className="tab-toolbar">
        <div className="status">Face Blur</div>
      </div>
      <main className="editor-coming-soon">
        <div className="coming-soon-card">
          <div className="coming-soon-icon">😶‍🌫️</div>
          <h2>Coming soon</h2>
          <p>Automatic face detection and blur for existing videos.</p>
          <p className="muted">
            The pipeline is in progress. It will return in a future release.
          </p>
        </div>
      </main>
    </>
  );
}
