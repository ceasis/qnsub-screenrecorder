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
          QNSub Studio is a screen recorder + face-cam studio + post-production
          toolbox. Pick a tab at the top:
        </p>
        <ul>
          <li><b>Screen Recorder</b> — capture your screen with webcam, audio, voice changer, BG music, annotations, and a floating mini HUD.</li>
          <li><b>Player</b> — browse, preview, trim, reveal, and delete recordings saved on disk.</li>
          <li><b>Face Blur</b> — open an existing video and automatically blur faces frame-by-frame for redaction.</li>
          <li><b>Editor</b> — coming soon.</li>
        </ul>
        <p>
          When the Recorder tab is active, three companion windows can appear:
          the <b>floating face-cam bubble</b> (with embedded recording HUD),
          the <b>idiot board</b> (your private teleprompter), and any
          <b> annotation overlay</b> you draw while recording. Switching tabs
          auto-hides the face-cam so it doesn't hover over other UI.
        </p>
        <p className="muted">
          Everything runs locally — no accounts, no telemetry, no cloud.
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
          echo cancellation enabled. Both feed into a single mixed track
          alongside any background music.
        </p>
        <h4>Voice changer</h4>
        <p>
          Runs the mic through a Web Audio pitch shifter (classic "Jungle"
          delay-line technique) + optional effect chain before the recorder
          sees it. The processed voice is what lands in the MP4.
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
          The preset is applied at <b>Start</b>; change preset and re-start
          to preview a different one.
        </p>
      </>
    )
  },
  {
    id: 'bg-music',
    title: '3. Background music',
    icon: <span>🎵</span>,
    body: (
      <>
        <p>
          Procedurally-synthesised background music generated at runtime from
          pure Web Audio primitives — no audio files ship with the app, so
          nothing to license, download, or worry about copyright on. Each
          preset renders a short loop into an AudioBuffer and plays it
          seamlessly forever while recording.
        </p>
        <p>
          The player outputs to your speakers (for preview) AND into a
          MediaStream the recorder mixes into the final track, so what you
          preview is exactly what lands in the MP4. Volume slider is independent
          of system volume.
        </p>
        <h4>Classical pieces (public domain)</h4>
        <ul>
          <li><b>Canon in D</b> — Pachelbel, c.1680. Full 8-bar progression with walking bass, chord pad, and sustained top-line melody.</li>
          <li><b>Für Elise</b> — Beethoven's WoO 59 opening motif.</li>
          <li><b>Moonlight Sonata</b> — Beethoven Op. 27 No. 2, 1st mvt triplet arpeggio over C#m bass.</li>
          <li><b>Gymnopédie No. 1</b> — Satie, 1888, 3/4 oom-pah-pah with the descending D-major melody.</li>
          <li><b>Clair de Lune</b> — Debussy, Suite bergamasque 3rd mvt.</li>
          <li><b>Nocturne Op. 9 No. 2</b> — Chopin, Eb major dotted-rhythm melody over arpeggiated bass.</li>
          <li><b>Ode to Joy</b> — Beethoven Symphony 9, 4th mvt theme.</li>
          <li><b>Prelude in C</b> — Bach BWV 846 (WTC Book I), continuous broken-chord arpeggios.</li>
          <li><b>Eine kleine Nachtmusik</b> — Mozart K.525 opening call and answer.</li>
          <li><b>Air on the G String</b> — Bach Orchestral Suite 3, BWV 1068.</li>
          <li><b>Turkish March</b> — Mozart's Rondo alla turca from K.331.</li>
          <li><b>Spring (Vivaldi)</b> — Four Seasons Op. 8 No. 1, opening Allegro ritornello.</li>
        </ul>
        <h4>Genre presets</h4>
        <ul>
          <li><b>Ambient Drone</b>, <b>Lo-fi Beat</b>, <b>Piano Arp</b>, <b>Synthwave</b>, <b>Chiptune</b>, <b>Cinematic</b>, <b>Jazz Brush</b>, <b>Dream Pad</b>, <b>Upbeat Pop</b>, <b>Deep Focus</b>, <b>Epic Drums</b>, <b>Elevator</b>, <b>Ukulele</b>, <b>Chillhop</b>, <b>Suspense</b>.</li>
        </ul>
        <p className="muted">
          Switching presets while idle previews them instantly through your
          speakers. The switch is seamless during recording too — no dropout,
          no re-init click.
        </p>
      </>
    )
  },
  {
    id: 'webcam',
    title: '4. Webcam (face-cam bubble)',
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
            Tune via the slider for the right intensity. Disabled
            automatically when Auto-center is on.</li>
          <li><b>Face Blur</b> — Gaussian blur applied only to the face
            layer, for anonymizing yourself on the fly without touching
            the background.</li>
          <li><b>Auto reduce opacity of face cam</b> — toggled in the main
            panel. When on, the bubble fades translucent whenever your
            cursor is over or near it, and returns to full opacity when
            the cursor moves away. Useful when the bubble is in the
            corner you need to click through.</li>
          <li><b>Backgrounds</b> — choose <i>Off</i> (raw camera), <i>Blur</i>
            (blur your real room), or <i>Image</i> (replace with a
            built-in scene or your own upload). Matting uses MediaPipe
            Selfie Segmentation, Multiclass Segmenter, or RVM Video
            Matting depending on which backend you pick (Auto picks the
            best your machine can run).</li>
          <li><b>Background-only effects</b> — separate Background Effect,
            Background Blur, and Background Zoom sliders let you tint/blur/
            push into the replacement scene without touching the face layer.
            Pair a grayscale face with a vivid background, etc.</li>
        </ul>
      </>
    )
  },
  {
    id: 'recording-fx',
    title: '5. Recording FX',
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
    title: '6. Save to',
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
    id: 'player',
    title: 'Player tab',
    icon: <span>▶️</span>,
    body: (
      <>
        <p>
          Browse and play back the recordings you've saved. The Player tab
          scans your save folder for <code>ScreenRecording_*</code>
          directories and lists every MP4 it finds. Click a recording to
          preview it in the built-in video player.
        </p>
        <h4>Per-recording actions</h4>
        <ul>
          <li><b>Play / scrub</b> — standard HTML5 video controls with the
            full-length seek bar.</li>
          <li><b>Trim</b> — pick a start and end time and write a new MP4
            containing only that range. Uses an ffmpeg stream-copy cut,
            so the trim happens in seconds without re-encoding (the cut
            snaps to the nearest keyframe at or before your start point —
            standard fast-trim behaviour).</li>
          <li><b>Reveal in folder</b> — open the recording's containing
            folder in your OS file browser.</li>
          <li><b>Delete</b> — send the recording to the OS trash.</li>
        </ul>
        <p className="muted">
          When you finish a new recording in the Recorder tab, the app
          automatically jumps to the Player tab and pre-selects the file
          you just saved so you can watch it immediately.
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
                e.currentTarget.style.borderColor = '#ffb86b';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 20px rgba(255, 184, 107, 0.22)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#262d36';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <span style={{ fontSize: 20 }}>{t.emoji}</span>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#ffb86b' }}>${t.amount}</span>
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
            border: '1px solid rgba(255, 184, 107, 0.45)',
            background: 'linear-gradient(135deg, rgba(255, 184, 107, 0.14) 0%, rgba(120, 74, 32, 0.18) 100%)',
            textDecoration: 'none',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 184, 107, 0.85)';
            e.currentTarget.style.boxShadow = '0 10px 24px rgba(255, 184, 107, 0.22)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 184, 107, 0.45)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#ffb86b',
              padding: '3px 10px',
              borderRadius: 999,
              border: '1px solid rgba(255, 184, 107, 0.5)',
              background: 'rgba(255, 184, 107, 0.12)'
            }}
          >
            🏆 Sponsor tier
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>🖥️☕</span>
            <span style={{ fontSize: 30, fontWeight: 800, color: '#ffb86b', letterSpacing: '-0.02em' }}>
              $1,000
            </span>
          </div>
          <span style={{ fontSize: 12.5, color: '#9aa3b2', textAlign: 'center' }}>
            Helps pay for tech expenses
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
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 10,
            marginTop: 10
          }}
        >
          {[
            { domain: 'qnsub.com', tag: "Our company's main website" },
            { domain: 'anythingtext.com', tag: 'All the text tools you need, A to Z' },
            { domain: 'rescanflow.com', tag: 'Scan your site for UI & system issues' },
            { domain: 'buildnextapp.com', tag: 'Build websites with AI' },
            { domain: 'cvscorecard.com', tag: 'CV scoring — get hired fast (soon)' },
            { domain: 'backerspot.com', tag: 'Get funding for your projects' },
            { domain: 'whatsaifor.com', tag: 'AI use cases directory' },
            { domain: 'langswarm.com', tag: 'Create and use AI agents' },
            { domain: 'tym.io', tag: 'Online timesheet' }
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
                e.currentTarget.style.borderColor = '#6fb6ff';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 18px rgba(111, 182, 255, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#262d36';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>{p.domain}</span>
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
        <h4>Shortcuts &amp; gestures</h4>
        <ul>
          <li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> — global pause/resume
            toggle, works even when the main window isn't focused.</li>
          <li>Hold <kbd>Ctrl</kbd> and drag while recording — draws an
            annotation arrow/line/box/circle/highlight at your cursor.</li>
          <li>Mouse-wheel over the floating face-cam bubble — zoom the camera
            in/out without opening the config panel.</li>
          <li>Drag the centre handle inside the face-cam bubble — reposition
            your face <i>inside</i> the shape instead of moving the window.</li>
          <li><kbd>Esc</kbd> — closes the Help modal, cancels a region selection.</li>
        </ul>
        <h4>Common fixes</h4>
        <ul>
          <li><b>Face-cam doesn't appear</b> — your camera may be in use by
            another app. Close it (Zoom, Teams, browser tab) and toggle the
            "Webcam overlay" checkbox off and back on at the top of step 1.</li>
          <li><b>System audio missing</b> — on Windows it uses Electron's
            loopback automatically. On macOS, grant <b>Screen Recording</b>
            permission in System Settings and relaunch the app.</li>
          <li><b>Audio feels out of sync</b> — check the voice changer preset.
            "Off" has zero latency; other presets add a small Web Audio
            buffer (~10-20ms) that's usually imperceptible but can compound
            with OS-level latency on some mics.</li>
          <li><b>Face-cam drifts near the edge of the camera frame</b> —
            Auto-center uses a confidence gate and heavy smoothing so it
            holds the previous framing instead of chasing a half-clipped
            face. Step back into frame and it resumes automatically.</li>
          <li><b>Idiot board or control HUD appears in the recording</b> —
            they shouldn't (both are marked with content protection). If
            you do see them, update your OS (older macOS / Linux Wayland
            sessions sometimes ignore content protection).</li>
          <li><b>Persisted settings don't apply after update</b> — click the
            corresponding chip or checkbox once to re-save. Some removed
            presets get auto-migrated to "Off" on mount.</li>
          <li><b>DevTools</b> — the footer button opens Chromium DevTools
            for the main window; only useful for debugging.</li>
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
