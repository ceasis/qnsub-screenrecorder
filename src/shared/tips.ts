// Rotating "Did you know?" tips shown in the splash screen and in the
// recorder toolbar. Kept in `src/shared` so both the main process
// (splash data: URL) and the renderer can import the same list.
//
// Style rules:
//   - one sentence, plain text (no markdown)
//   - mention a real, shippable feature
//   - keep under ~160 chars so two-line wrapping stays tidy
export const DID_YOU_KNOW_TIPS: string[] = [
  // ---- Shortcuts & interactions ----
  'Press Ctrl+Shift+P anywhere on your system to pause or resume the recording — even when QNSub is minimized.',
  'Hold Ctrl while recording to draw live arrows, lines, boxes, circles, or highlights over your screen.',
  'Scroll the mouse wheel directly over the face-cam bubble to zoom your face in or out.',
  'Drag the centre handle inside the face-cam bubble to reposition your face within the shape.',
  'Click anywhere on the face-cam bubble (not the centre handle) to drag the whole window around the screen.',
  'The ± buttons on either side of the face-cam centre handle give you precise zoom control.',

  // ---- Recording flow ----
  'A 3-2-1 countdown overlay runs before every recording so you have time to get ready.',
  'Pick desktop, a specific window, or drag a custom region — with a live cursor preview before you hit Start.',
  'Every recording saves into its own ScreenRecording_YYYYMMDD_HHMMSS folder for clean organization.',
  'Recordings save as MP4 automatically — no Save dialog pops up in the middle of your workflow.',
  'Toggle "Open the folder when done" to auto-reveal the finished MP4 in your file browser after you stop.',
  'Recordings use your GPU hardware encoder (NVENC, QuickSync, AMF, or VideoToolbox) for fast, low-CPU encoding.',

  // ---- Audio ----
  'System audio and microphone are mixed into one clean track, so narration and tutorial audio record in one pass.',
  'The voice changer has Deep, High, Radio, Robot, and a custom ±1 octave slider — all in real time.',
  'Voice changer "Off" has zero latency; presets add a tiny Web Audio buffer for the effect graph.',

  // ---- Face cam & background ----
  'Pick from 8 face-cam shapes: circle, rect, wide, squircle, hexagon, diamond, heart, and star.',
  'Auto-center tracks the segmentation-mask centroid so your face stays framed even when you drift around.',
  'The face-cam Face Light filter softly brightens you with warmth and saturation — like a fill light on your face.',
  'Effects like mono, sepia, or neon can apply to just your face, leaving the background untouched.',
  'The face-cam bubble can auto-fade translucent when your cursor gets close and return to full opacity when you move away.',
  'Replace your background with blur, a built-in scene, or any image you upload — with hair-accurate matting.',
  'Background zoom and background blur have their own sliders, so you can tune the scene independently of your face.',
  'Switch segmentation backends: MediaPipe Selfie for speed, or Robust Video Matting (RVM) for broadcast-quality edges.',

  // ---- Overlays ----
  'Cursor zoom smoothly zooms the recorded canvas toward your mouse for tutorial-style emphasis.',
  'The fixed-text overlay burns a lower-third caption onto every recording — with a random-style button for quick variety.',
  'Annotation strokes auto-fade after a few seconds so your whiteboard doesn\'t pile up on screen.',
  'The Idiot Board is a floating teleprompter only YOU can see — it\'s hidden from screen capture by content protection.',

  // ---- Floating HUD + tray ----
  'The floating HUD above the face-cam has the timer, Start / Pause / Stop, and a red X to quit the whole app.',
  'Closing the main window keeps QNSub alive in the system tray so the floating HUD can keep recording.',
  'Right-click the tray icon for Show / Buy me a coffee / Quit — and single-click the tray icon to bring the window back.',
  'The face-cam HUD and the Idiot Board are both invisible to screen capture, so they never show up in your recordings.',

  // ---- Face Blur & Editor ----
  'The Face Blur tab auto-detects and blurs faces in an existing video — great for redacting bystanders before sharing.',
  'Face Blur writes a fresh MP4 — your source file is never touched.',

  // ---- App & project ----
  'QNSub Studio is 100% local — no accounts, no cloud round-trips, no telemetry. Your recordings never leave your machine.',
  'QNSub Studio is 100% open source — read, audit, fork, and ship your own build from github.com/ceasis/qnsub-screenrecorder.',
  'Starring the repo on GitHub is the biggest no-cost favor you can do — it\'s what drives discovery to other users.',
  'Reinstalling a new version keeps all your settings — they live in %APPDATA%, which the installer never touches.',
  'Click the blue Help button in the top-right for an in-app guide with a section per feature.',
  'Click the ☕ Coffee button in the top-right to tip the maintainer via paypal.me/qnsub if QNSub Studio saved you time.',
  'The app auto-increments its version on every build, so the installer filename always tells you exactly what you\'re running.'
];
