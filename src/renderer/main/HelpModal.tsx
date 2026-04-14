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
        <h4>Auto-framing &amp; behavior</h4>
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
    id: 'tips',
    title: 'Tips &amp; troubleshooting',
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
          <h2>QNSub Studio — Help &amp; features</h2>
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
