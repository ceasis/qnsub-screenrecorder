# QNSub Studio

[![tests](https://github.com/ceasis/qnsub-screenrecorder/actions/workflows/test.yml/badge.svg)](https://github.com/ceasis/qnsub-screenrecorder/actions/workflows/test.yml)
![license](https://img.shields.io/badge/license-Source--available-blue)
![electron](https://img.shields.io/badge/electron-31-47848f)
![typescript](https://img.shields.io/badge/typescript-5.5-3178c6)

A full-featured cross-platform **screen recorder + face-cam studio + post-production toolbox**, built with Electron + React + TypeScript.

**100% open source** — every pixel the app composites, every bit of
audio it processes, every frame it encodes, is driven by code you
can read right here in this repo. Audit it, modify it, fork it,
ship your own build. No telemetry, no accounts, no cloud round-trips.

- **Source**: https://github.com/ceasis/qnsub-screenrecorder
- **Website**: https://ceasis.github.io/qnsub-screenrecorder/
- **Author**: [@choloasis on Twitter/X](https://twitter.com/choloasis)
- **Buy me a coffee** ☕: [paypal.me/qnsub](https://paypal.me/qnsub) — if QNSub Studio saved you time, a small tip keeps the updates coming. No pressure, no paywall.

> ⭐ **If this project is useful to you, please [star the repo on GitHub](https://github.com/ceasis/qnsub-screenrecorder)** — it costs nothing, takes one click, and is the single biggest thing you can do to help. Stars drive GitHub's discovery algorithm, so every extra star puts QNSub Studio in front of more people who need a free, open-source screen recorder. It's also the only metric I actually watch to decide how much time to pour into new features.

### Other projects by the same maintainer

QNSub Studio is one of several tools built in public. If you like how this one is put together, the rest of the lineup might be worth a look:

- **[qnsub.com](https://qnsub.com)** — our company's main website
- **[anythingtext.com](https://anythingtext.com)** — all the text tools you need, A to Z
- **[rescanflow.com](https://rescanflow.com)** — scan your website for UI and system issues
- **[buildnextapp.com](https://buildnextapp.com)** — build websites with AI
- **[cvscorecard.com](https://cvscorecard.com)** — CV scoring, get hired fast _(under construction)_
- **[backerspot.com](https://backerspot.com)** — get funding for your projects
- **[whatsaifor.com](https://whatsaifor.com)** — AI use cases directory
- **[langswarm.com](https://langswarm.com)** — create and use AI agents
- **[tym.io](https://tym.io)** — online timesheet

## Download the latest build

If you just want to **use** QNSub Studio without building from source, grab the latest pre-built installer:

- **Windows** — [Download QNSub Studio Setup 0.1.4 (.exe)](https://pub-85c4f8fe2d3341149c5f19d57efdcc7c.r2.dev/QNSub-ScreenRecorder-Setup-0.1.4.exe)
- **macOS** — coming soon (ping the maintainer if you need a build)

The installer is **not** code-signed yet, so Windows SmartScreen will show a blue "Windows protected your PC" warning on first launch. Click **More info → Run anyway** to proceed — it's a one-time prompt, the installer is safe, and the warning disappears once a handful of users have installed it and Microsoft's reputation system catches up. If you want zero warnings, build from source (instructions further down).

### Install on Windows

1. Click the download link above — the `.exe` installer downloads directly from the project's Cloudflare R2 bucket.
2. Run the downloaded `QNSub Screen Recorder Setup X.Y.Z.exe`.
3. If Windows SmartScreen appears, click **More info → Run anyway**.
4. Follow the NSIS installer (pick install location, create shortcuts).
5. Launch **QNSub Studio** from the Start Menu.

### Install on macOS

Not yet published. If you need a macOS build right now, follow the **Build it yourself** section below — `npm run dist:mac` produces a ready-to-ship DMG.

---

## Build it yourself

You only need this if you want to develop, modify, or package the app yourself.

### Prerequisites

- **Node.js 18+** and **npm**
- A working C/C++ toolchain (only required by some optional native deps; most builds work without it)

### Run from source (dev mode)

```bash
git clone https://github.com/ceasis/qnsub-screenrecorder.git
cd qnsub-screenrecorder
npm install
npm run dev
```

`npm run dev` boots Vite in watch mode, then launches Electron pointed at the dev server. Hot-reload works for the renderer; the main process restarts on save.

### Build production installers

```bash
npm run dist:win    # out/QNSub Studio Setup X.Y.Z.exe        (NSIS)
npm run dist:mac    # out/QNSub Studio-X.Y.Z.dmg              (signed DMG)
```

The `out/` directory contains the installer + supporting files. `electron-builder` pulls the bundled `ffmpeg-static` binary into `app.asar.unpacked` automatically so the recorder works on a fresh machine.

---

## Features at a glance

> Press the blue **Help** button in the top-right of the app for an in-app guide that walks through every feature with screenshots and tips. The list below is a high-level reference.

### Screen Recorder tab

- **Source picker** — desktop, window, or **drag-a-region** (live cursor preview at ~10fps before you hit Start).
- **3-2-1 countdown** before recording begins.
- **Pause / resume** via global shortcut `Ctrl + Shift + P`.
- **Streaming recorder pipeline** — the MediaRecorder's WebM chunks are piped into a long-running ffmpeg process in real time, so by the time you hit Stop most of the H.264 encode is already done. Hardware encoders (NVENC / QuickSync / AMF / VideoToolbox) are auto-detected with a `libx264` software fallback.
- **System audio** + **microphone**, mixed into the final track along with any background music.
- **Voice changer** — real-time mic pitch shift via a Web Audio "Jungle" delay-line pipeline, plus preset effect chains:
  - **Off** (pass-through, zero latency), **Deep (villain)**, **High (chipmunk)**, **Radio (tinny)**, **Robot (metallic)**, or **Custom pitch** with a ±1 octave slider.
- **Background music** — procedurally synthesised at runtime from Web Audio primitives, no audio files bundled or streamed. The player outputs to your speakers for preview AND into a MediaStream the recorder mixes into the final track, so what you preview is what lands in the MP4.
  - **Classical (public domain)**: Canon in D, Für Elise, Moonlight Sonata, Gymnopédie No. 1, Clair de Lune, Nocturne Op. 9 No. 2, Ode to Joy, Bach Prelude in C, Eine kleine Nachtmusik, Air on the G String, Turkish March, Spring (Vivaldi).
  - **Genres**: Ambient Drone, Lo-fi Beat, Piano Arp, Synthwave, Chiptune, Cinematic, Jazz Brush, Dream Pad, Upbeat Pop, Deep Focus, Epic Drums, Elevator, Ukulele, Chillhop, Suspense.
- **Floating face-cam bubble** with a built-in HUD (timer + Start/Pause/Stop + a red-X **Quit App** button) — content-protected so it doesn't appear in the recording.
  - 8 shapes (circle, rect, wide, squircle, hexagon, diamond, heart, star), 3 sizes.
  - Drag the centre handle to reposition your face inside the shape; click anywhere else to drag the whole window.
  - **±** zoom buttons + mouse-wheel zoom directly over the bubble.
  - **Auto-center** tracks the segmentation-mask centroid with confidence-gated, jitter-free smoothing so the framing holds when your face drifts near the edge of the camera frame.
  - **Face light** — soft fill-light filter (brightness + warmth + saturation).
  - **Face Blur** slider — Gaussian blur on the face layer only, for on-the-fly anonymisation without touching the background.
  - **Auto Reduce Opacity of Face Cam** — the bubble fades translucent when the cursor is near and returns to full opacity when you move away.
  - Backgrounds: **Off**, **Blur your real room**, **built-in scenes**, or **upload your own image**. Matting via MediaPipe Selfie Segmentation / Multiclass Segmenter / RVM Video Matting (Auto picks the best backend available).
  - Separate **Background Effect / Background Blur / Background Zoom** sliders so you can tint, soften, or push into the replacement scene without touching the face layer.
- **Cursor zoom** — the recorded canvas smoothly zooms toward your mouse for tutorial-style emphasis.
- **Annotation overlay** — hold `Ctrl` and drag while recording to draw arrows / lines / boxes / circles / highlights in 8 colors with thickness, outline, and style presets.
- **Idiot board** — a floating private teleprompter only you can see (hidden from screen capture). Auto-docks beneath the face-cam bubble.
- **Save to folder** — automatic MP4 (no Save dialog), with a toggle to **open the folder** when recording finishes.
- Recordings land in their own `ScreenRecording_YYYYMMDD_HHMMSS/` folder for clean organization.

### Player tab

- Automatically scans your save folder and lists every `ScreenRecording_*` MP4 it finds.
- Built-in HTML5 player with full-length seek bar.
- **Trim** — ffmpeg stream-copy cut (no re-encode) so a trimmed copy saves in seconds.
- **Reveal in folder** / **Delete to trash** per recording.
- When you finish a new recording in the Recorder tab, the app auto-jumps to Player and pre-selects the file you just saved.

### Face Blur tab

- Open an existing video and the app detects faces frame-by-frame and blurs them — useful for redacting bystanders before sharing a clip. The output is a fresh MP4; the source is left untouched.

### Editor tab

Coming soon — the editor is being rebuilt from scratch in a future release. Recordings still save fine in the meantime.

### Cross-app

- **Help** button in the header opens an in-app documentation modal with a left-rail nav, a section per feature area, and tips/troubleshooting — always ships with the build so the docs stay in sync with the code.
- **Coffee** button in the header links to `paypal.me/qnsub` if you want to tip the maintainer.
- **Quit** button in the header (and a red-X button in the floating HUD) shuts the whole app down immediately.
- All settings are persisted across sessions (camera, mic, voice preset, BG music preset + volume, save folder, auto toggles, etc.).
- Removed or renamed presets are auto-migrated to a safe default on next launch, so a version bump never leaves you staring at a silent selection.

### Packaging

- One-click **.exe** installer (Windows NSIS) and **.dmg** (macOS), both with the bundled `ffmpeg-static` binary in `app.asar.unpacked`.

---

## Shortcut reference

| Action                                                  | Shortcut                  |
|---------------------------------------------------------|---------------------------|
| Pause / resume recording (global)                       | `Ctrl + Shift + P`        |
| Draw annotation (while recording)                       | Hold `Ctrl` + drag        |
| Cancel region selection                                 | `Esc`                     |
| Close help modal                                        | `Esc`                     |
| Zoom face-cam (mouse over bubble)                       | Mouse wheel               |
| Reposition face inside the shape                        | Drag the centre handle    |
| Drag the whole face-cam window                          | Click & drag the bubble   |
| Start / pause / stop from the floating HUD              | HUD buttons               |
| Quit the entire app from the floating HUD               | Red **X** button          |

---

## Architecture

```
src/
├── main/         Electron main process
│                 (windows, IPC, streaming ffmpeg recorder, shortcuts,
│                  media:// protocol, cursor tracking, trimming)
├── preload/      Context-isolated preload bridges (one per window)
├── renderer/
│   ├── main/     React UI — App (tab host), Recorder, Player, FaceBlur,
│   │             Editor (soon), HelpModal
│   ├── region/   Transparent region-selector overlay
│   ├── annotation/ Always-on-top arrow drawing overlay
│   ├── countdown/  3-2-1 countdown window
│   ├── webcam/   Floating face-cam bubble + embedded HUD
│   ├── idiotboard/ Private teleprompter window (content-protected)
│   └── lib/      compositor, segmenter (MediaPipe/RVM), shapes,
│                 mediaRecorder, voiceChanger (Jungle pitch shifter),
│                 bgMusic (procedural synth + BgMusicPlayer),
│                 autoFrame (confidence-gated face tracking)
└── shared/       Shared types (shapes, effects, filters, annotation presets,
                  editor/project schema)
```

**Recording pipeline.** The recorder composites screen + webcam + annotations onto a hidden 1920×1080 canvas, captures it via `canvas.captureStream(30)`, and builds a final `MediaStream` by mixing:

1. **Video** — the composited canvas track.
2. **System audio** — Windows loopback / macOS screen-capture audio track.
3. **Mic audio** — optionally routed through the `voiceChanger` Web Audio graph (Jungle pitch shifter + preset effect chain like ring mod, bandpass, shelving).
4. **Background music** — the `BgMusicPlayer` renders each preset loop into an `AudioBuffer` via an `OfflineAudioContext` and plays it through a `MediaStreamAudioDestinationNode` that feeds the recorder.

The `MediaRecorder` produces WebM chunks that stream directly into a long-running `ffmpeg-static` child process. Ffmpeg encodes to MP4 in parallel with the capture using a hardware encoder when available (NVENC / QuickSync / AMF / VideoToolbox) with a `libx264 -preset ultrafast` software fallback, so when you hit Stop most of the encode is already done.

**Floating windows.** The webcam bubble, idiot board, annotation overlay, and countdown each run in their own `BrowserWindow` with `transparent: true`, `frame: false`, `alwaysOnTop('screen-saver')`, and `setContentProtection(true)` where appropriate so HUD chrome never shows up in screen-capture output.

**Cursor-aware opacity.** Runs in the **main** process: a `setInterval` polls `screen.getCursorScreenPoint()` at ~30fps, compares against the webcam window's bounds + a buffer, and adjusts `setOpacity()` via exponential smoothing so the fade glides instead of snapping. Only active when the "Auto reduce opacity" checkbox is on.

**Face auto-centering.** The segmentation mask centroid is piped through `autoFrame.ts` which applies four stacked stabilizers: confidence gate (hold last framing when mask coverage drops), dead-zone, exponential smoothing, and per-frame step cap. Both the live floating bubble and the recording compositor share the exact same filter so the preview and the MP4 match frame-for-frame.

---

## License

**Source-available commercial license.** See [LICENSE](./LICENSE) for the full terms.

- The full source code is public on GitHub so you can inspect, audit, study, and contribute.
- A **one-time purchase** grants a perpetual license for the current major version (1.x), including all minor and patch updates. **No subscription.**
- Future major versions (2.x, 3.x, …) are separate products sold separately. Your existing 1.x license continues to work indefinitely.
- Personal evaluation for up to 30 days is free. Non-commercial academic research use is free with citation.
- Redistribution, reselling, SaaS hosting, and repackaging are not permitted without a separate agreement.

To purchase a license key, contact QNSub via the address in this repository.
