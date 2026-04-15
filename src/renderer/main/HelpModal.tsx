import React, { useEffect, useState } from 'react';

// In-app documentation modal. Opened from the Help button in the header.
// Content is plain JSX so there's no markdown parser dependency, and so
// the docs ship with the build (no internet required). Each section maps
// to a feature area in the app — keep this in sync as features land.

type Section = {
  id: string;
  title: string;
  icon: React.ReactNode;
  body: React.ReactNode;
};

const SECTIONS: Section[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    icon: <span>🚀</span>,
    body: (
      <>
        <p>
          QNSub Studio is a screen recorder + face-cam + post-production toolbox.
          Pick a tab at the top: <b>Screen Recorder</b> for capturing,
          <b> Face Blur</b> for redacting an existing video, or <b>Editor</b>{' '}
          (coming soon) for trimming.
        </p>
        <p>
          When the Recorder tab is active, three companion windows can appear:
          the <b>floating face-cam bubble</b>, the <b>idiot board</b> (your
          private teleprompter), and any <b>annotation overlay</b> you draw
          while recording. Switching tabs auto-hides the face-cam.
        </p>
      </>
    )
  },
  {
    id: 'screen-source',
    title: '1. Screen source',
    icon: <span>🖥️</span>,
    body: (
      <>
        <p>
          Pick a monitor or window thumbnail to capture, or click <b>Select
          region…</b> to drag a rectangle and record only that area.
          <b> Full screen</b> clears any region you've selected. Window sources
          appear under the collapsed <b>Windows</b> section.
        </p>
        <p>
          The preview shows a live cursor dot at ~10fps so you can confirm
          your region without starting a recording.
        </p>
      </>
    )
  },
  {
    id: 'audio',
    title: '2. Audio + voice changer',
    icon: <span>🎙️</span>,
    body: (
      <>
        <p>
          <b>Computer audio</b> records what's playing through your speakers
          (loopback on Windows, screen-recording permission on macOS).
          <b> Microphone</b> records your voice with noise suppression and
          echo cancellation enabled.
        </p>
        <p>
          <b>Voice changer</b> runs the mic through a Web Audio pitch shifter
          + effect chain before recording:
        </p>
        <ul>
          <li><b>Off</b> — pass-through, zero latency.</li>
          <li><b>Deep (villain)</b> — pitch down + low-shelf boost.</li>
          <li><b>High (chipmunk)</b> — pitch up + high-shelf sparkle.</li>
          <li><b>Radio (tinny)</b> — bandpass 300–3400 Hz.</li>
          <li><b>Robot (metallic)</b> — ring modulation at 50 Hz.</li>
          <li><b>Custom pitch</b> — slider unlocks for ±1 octave control.</li>
        </ul>
        <p className="muted">
          The effect is applied at <b>Start</b>; change preset and re-start
          to preview a different one.
        </p>
      </>
    )
  },
  {
    id: 'webcam',
    title: '3. Webcam (face-cam bubble)',
    icon: <span>📸</span>,
    body: (
      <>
        <p>
          When enabled, a small floating bubble shows your camera and is
          baked into the recording at the position you choose. Drag the
          bubble anywhere on your desktop; click the 3-dot menu on it to
          tweak shape, size, background, effects, face-light, and zoom.
        </p>
        <h4>Inside the bubble</h4>
        <ul>
          <li><b>Drag handle</b> — hover the bubble and drag the centre icon
            to reposition your face inside the frame. Clicking anywhere
            else on the bubble drags the whole window.</li>
          <li><b>± buttons</b> — quick zoom controls on either side of the
            drag handle. Mouse-wheel over the window also zooms.</li>
          <li><b>Embedded HUD</b> — the recording timer, Start / Pause /
            Stop, and a red <b>X</b> to quit the entire app live above
            the bubble. The HUD is invisible to screen capture so it
            doesn't appear in your recordings.</li>
        </ul>
        <h4>Auto-framing & behavior</h4>
        <ul>
          <li><b>Auto-center</b> tracks the segmentation-mask centroid and
            keeps your face in the middle of the shape automatically.
            Heavy smoothing + a confidence gate prevents jitter when
            you drift toward the edge of the camera frame.</li>
          <li><b>Face light</b> applies a soft fill-light filter
            (brightness + warmth + saturation) on top of any color effect.
            Tune via the slider for the right intensity.</li>
          <li><b>Auto relocate face cam</b> — the bubble slides sideways
            out of your cursor's way and glides back when the cursor
            clears off.</li>
          <li><b>Auto reduce opacity of face cam</b> — the bubble fades
            translucent when the cursor is near it and returns to full
            opacity when you move away. Both auto-options can be
            toggled independently.</li>
          <li><b>Backgrounds</b> — choose blur, a built-in scene, or
            upload your own image. MediaPipe Selfie Segmentation handles
            the matting; you can stack additional blur or color filters
            on the background only.</li>
        </ul>
      </>
    )
  },
  {
    id: 'recording-fx',
    title: '4. Recording FX',
    icon: <span>✨</span>,
    body: (
      <>
        <p>
          <b>Cursor zoom</b> smoothly zooms the recorded canvas toward your
          mouse cursor for tutorial-style emphasis. Configure the zoom
          factor with the slider — the live display is unaffected.
        </p>
        <p>
          <b>Annotation overlay</b> — hold <kbd>Ctrl</kbd> and drag while
          recording to draw arrows, lines, boxes, circles, or highlights
          over your screen. Pick colour, thickness, outline, and style
          presets in the panel. Strokes auto-fade after 6 seconds.
        </p>
        <p>
          <b>Idiot board</b> is a floating notes window only YOU can see —
          it's hidden from the recording via content protection. Use it as
          a teleprompter or checklist. It auto-docks beneath the face-cam
          bubble so they move together.
        </p>
      </>
    )
  },
  {
    id: 'save-to',
    title: '5. Save to',
    icon: <span>💾</span>,
    body: (
      <>
        <p>
          Recordings are saved automatically as MP4 — no Save dialog. Pick
          your output folder once and it's remembered across sessions.
          Quick-set buttons jump to your <b>Desktop</b> or <b>Downloads</b>
          folder.
        </p>
        <p>
          <b>Open the folder when done</b> reveals the saved file in your
          OS file browser as soon as the recording finishes. Untick if
          you'd rather keep recording back-to-back without windows
          popping up.
        </p>
        <p className="muted">
          Each recording is saved into its own
          <code> ScreenRecording_YYYYMMDD_HHMMSS</code> folder so the MP4
          and any future project metadata stay together.
        </p>
      </>
    )
  },
  {
    id: 'controls',
    title: 'Floating control HUD',
    icon: <span>🎛️</span>,
    body: (
      <>
        <p>
          The mini HUD lives at the top of the floating face-cam window.
          It shows the elapsed recording time, a Start button (idle), or
          Pause/Stop (recording), and a finalising progress bar after you
          stop. The whole HUD is hidden from screen capture.
        </p>
        <p>
          A red <b>X</b> next to the green Start button immediately quits
          the entire app — useful when you're done and don't want to
          alt-tab back to the main window.
        </p>
        <p className="muted">
          Global shortcut: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>
          to toggle pause/resume from anywhere.
        </p>
      </>
    )
  },
  {
    id: 'face-blur',
    title: 'Face Blur tab',
    icon: <span>🫥</span>,
    body: (
      <>
        <p>
          Open an existing video and the app detects faces frame-by-frame
          and blurs them. Used for redacting bystanders before sharing a
          recording. The output is a fresh MP4 — your source file is left
          alone.
        </p>
      </>
    )
  },
  {
    id: 'support',
    title: 'Support & about',
    icon: <span>☕</span>,
    body: (
      <>
        <p>
          <b>QNSub Studio</b> is 100% open source — every pixel the app
          composites, every bit of audio it processes, every frame it
          encodes is driven by code you can read, audit, fork, and ship
          your own build of. No telemetry, no accounts, no cloud
          round-trips.
        </p>
        <div
          style={{
            margin: '12px 0 18px',
            padding: '14px 16px',
            borderRadius: 10,
            border: '1px solid rgba(255, 200, 60, 0.4)',
            background: 'linear-gradient(160deg, rgba(255, 200, 60, 0.09) 0%, rgba(255, 200, 60, 0.03) 100%)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>⭐</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: '#ffd96b', marginBottom: 4 }}>
              Please star the repo on GitHub
            </div>
            <div style={{ fontSize: 13, color: '#c7ced9', lineHeight: 1.55 }}>
              It costs nothing, takes one click, and is the single biggest
              thing you can do to help. Stars drive GitHub's discovery
              algorithm — every extra star puts QNSub Studio in front of
              more people who need a free, open-source screen recorder.
              It's also the one metric the maintainer actually watches to
              decide how much time to pour into new features.
            </div>
            <a
              href="https://github.com/ceasis/qnsub-screenrecorder"
              target="_blank"
              rel="noopener"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 10,
                padding: '7px 14px',
                borderRadius: 8,
                border: '1px solid rgba(255, 200, 60, 0.55)',
                background: 'rgba(255, 200, 60, 0.12)',
                color: '#ffd96b',
                fontWeight: 600,
                fontSize: 13,
                textDecoration: 'none'
              }}
            >
              ⭐ Star on GitHub
            </a>
          </div>
        </div>
        <h4>Project links</h4>
        <ul>
          <li>
            <b>Source code</b> —{' '}
            <a href="https://github.com/ceasis/qnsub-screenrecorder" target="_blank" rel="noopener">
              github.com/ceasis/qnsub-screenrecorder
            </a>
          </li>
          <li>
            <b>Website</b> —{' '}
            <a href="https://ceasis.github.io/qnsub-screenrecorder/" target="_blank" rel="noopener">
              ceasis.github.io/qnsub-screenrecorder
            </a>
          </li>
          <li>
            <b>Report an issue</b> —{' '}
            <a href="https://github.com/ceasis/qnsub-screenrecorder/issues" target="_blank" rel="noopener">
              GitHub issues
            </a>
          </li>
        </ul>
        <h4>Author</h4>
        <p>
          Built in public by{' '}
          <a href="https://twitter.com/choloasis" target="_blank" rel="noopener">
            @choloasis on Twitter / X
          </a>
          . Updates, feature demos, and the occasional "why this took
          three attempts to get right" post-mortem ship there first.
        </p>
        <h4>Buy me a coffee ☕</h4>
        <p>
          QNSub Studio is free and always will be. If it saved you time
          or money on a screen-recorder subscription, tossing a coffee
          tip keeps the updates coming and the maintainer caffeinated.
          No pressure, no paywall, no "unlock premium features" screen —
          everything is already unlocked.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 10,
            margin: '14px 0 10px'
          }}
        >
          {[
            { label: '1 day', amount: 5, emoji: '☕' },
            { label: '1 week', amount: 20, emoji: '☕☕' },
            { label: '1 month', amount: 50, emoji: '☕☕☕' },
            { label: '3 months', amount: 120, emoji: '☕×4' },
            { label: '6 months', amount: 200, emoji: '☕×5' },
            { label: '12 months', amount: 365, emoji: '☕×6' }
          ].map((t) => (
            <a
              key={t.label}
              href={`https://paypal.me/qnsub/${t.amount}USD`}
              target="_blank"
              rel="noopener"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: '14px 10px',
                borderRadius: 10,
                border: '1px solid #262d36',
                background: 'linear-gradient(160deg, #161b22 0%, #0d1117 100%)',
                color: '#e6edf3',
                textDecoration: 'none',
                transition: 'border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#e11d48';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 20px rgba(225, 29, 72, 0.25)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#262d36';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <span style={{ fontSize: 20 }}>{t.emoji}</span>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#ff6b7a' }}>${t.amount}</span>
              <span style={{ fontSize: 12, color: '#8b949e' }}>{t.label} of coffee</span>
            </a>
          ))}
        </div>
        <a
          href="https://paypal.me/qnsub/1000USD"
          target="_blank"
          rel="noopener"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            padding: '18px 22px',
            marginBottom: 12,
            borderRadius: 12,
            border: '1px solid rgba(255, 200, 60, 0.45)',
            background: 'linear-gradient(135deg, rgba(255, 200, 60, 0.12) 0%, rgba(225, 29, 72, 0.12) 100%)',
            textDecoration: 'none',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 200, 60, 0.8)';
            e.currentTarget.style.boxShadow = '0 10px 24px rgba(255, 200, 60, 0.22)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 200, 60, 0.45)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#ffd96b',
              padding: '3px 10px',
              borderRadius: 999,
              border: '1px solid rgba(255, 200, 60, 0.5)',
              background: 'rgba(255, 200, 60, 0.12)'
            }}
          >
            🏆 Sponsor tier
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>🖥️☕</span>
            <span style={{ fontSize: 30, fontWeight: 800, color: '#ffd96b', letterSpacing: '-0.02em' }}>
              $1,000
            </span>
          </div>
          <span style={{ fontSize: 12.5, color: '#9aa3b2', textAlign: 'center' }}>
            Pays for a full year of project hosting, domain, signing cert & CI
          </span>
        </a>
        <p className="muted" style={{ fontSize: 12 }}>
          Prefer a custom amount? Just open{' '}
          <a href="https://paypal.me/qnsub" target="_blank" rel="noopener">
            paypal.me/qnsub
          </a>
          {' '}and type your own.
        </p>
        <h4>Other projects by the same maintainer</h4>
        <p>
          QNSub Studio is one of several tools built in public. If you
          like how this one is put together, the rest of the lineup
          might be worth a look.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 10,
            marginTop: 10
          }}
        >
          {[
            { domain: 'qnsub.com', tag: 'Studio home' },
            { domain: 'anythingtext.com', tag: 'Text tools' },
            { domain: 'rescanflow.com', tag: 'Scan workflow' },
            { domain: 'cvscorecard.com', tag: 'CV scoring' },
            { domain: 'backerspot.com', tag: 'Backers' },
            { domain: 'whatsaifor.com', tag: 'AI use cases' },
            { domain: 'langswarm.com', tag: 'Language' },
            { domain: 'tym.io', tag: 'tym.io' }
          ].map((p) => (
            <a
              key={p.domain}
              href={`https://${p.domain}`}
              target="_blank"
              rel="noopener"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                padding: '12px 8px',
                borderRadius: 10,
                border: '1px solid #262d36',
                background: 'linear-gradient(160deg, #161b22 0%, #0d1117 100%)',
                textDecoration: 'none',
                transition: 'border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#ff3d5a';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 18px rgba(225, 29, 72, 0.22)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#262d36';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: '#ff6b7a' }}>{p.domain}</span>
              <span style={{ fontSize: 11, color: '#6b7380' }}>{p.tag}</span>
            </a>
          ))}
        </div>
      </>
    )
  },
  {
    id: 'tips',
    title: 'Tips & troubleshooting',
    icon: <span>💡</span>,
    body: (
      <>
        <ul>
          <li>If the face-cam doesn't appear, your camera may be in use by
            another app. Close it (Zoom, Teams, browser tab) and toggle
            "Include me on screen" off and back on.</li>
          <li>On Windows, computer audio uses Electron's loopback and
            should always work. On macOS, grant <b>Screen Recording</b>
            permission in System Settings.</li>
          <li>If a recording finishes with strange audio sync, check the
            voice changer preset — pure pass-through ("Off") has zero
            latency; presets add a small Web Audio buffer.</li>
          <li>The DevTools button in the footer opens Chromium DevTools
            for the main window — only useful for debugging.</li>
        </ul>
      </>
    )
  }
];

export default function HelpModal({ onClose }: { onClose: () => void }) {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const active = SECTIONS.find((s) => s.id === activeId) || SECTIONS[0];

  return (
    <div className="help-modal-backdrop" onClick={onClose}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Help">
        <header className="help-header">
          <h2>QNSub Studio — Help & features</h2>
          <button className="help-close" onClick={onClose} aria-label="Close help" title="Close (Esc)">×</button>
        </header>
        <div className="help-body">
          <nav className="help-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`help-nav-item ${activeId === s.id ? 'sel' : ''}`}
                onClick={() => setActiveId(s.id)}
              >
                <span className="help-nav-icon">{s.icon}</span>
                <span className="help-nav-label">{s.title}</span>
              </button>
            ))}
          </nav>
          <article className="help-content">
            <h3>{active.title}</h3>
            {active.body}
          </article>
        </div>
      </div>
    </div>
  );
}
