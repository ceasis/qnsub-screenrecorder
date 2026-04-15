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

- **[qnsub.com](https://qnsub.com)** — studio home
- **[anythingtext.com](https://anythingtext.com)** — text tools
- **[rescanflow.com](https://rescanflow.com)** — scan workflow
- **[cvscorecard.com](https://cvscorecard.com)** — CV scoring
- **[backerspot.com](https://backerspot.com)** — backers
- **[whatsaifor.com](https://whatsaifor.com)** — AI use cases
- **[langswarm.com](https://langswarm.com)** — language
- **[tym.io](https://tym.io)** — tym.io

## Download the latest build

If you just want to **use** QNSub Studio without building from source, grab the latest pre-built installer from Google Drive:

- **Windows** — [QNSub Studio Setup (.exe) on Google Drive](https://drive.google.com/file/d/1WiiG7oKtfbUybBLH0OxqdwN5yZuUijJY/view?usp=sharing)
- **macOS** — coming soon (ping the maintainer if you need a build)

The installer is **not** code-signed yet, so Windows SmartScreen will show a blue "Windows protected your PC" warning on first launch. Click **More info → Run anyway** to proceed — it's a one-time prompt, the installer is safe, and the warning disappears once a handful of users have installed it and Microsoft's reputation system catches up. If you want zero warnings, build from source (instructions further down).

### Install on Windows

1. Open the Google Drive link above and click **Download** (the arrow icon at the top). Google Drive may show a "can't scan this file for viruses" notice because the installer is larger than the scan limit — click **Download anyway**.
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
- **System audio** + **microphone**, mixed into the final track.
- **Voice changer** with real-time pitch shift (Web Audio "Jungle" technique) and presets:
  - Off, Deep (villain), High (chipmunk), Radio (tinny), Robot (metallic), or **Custom pitch** (±1 octave slider).
- **Floating face-cam bubble** with a built-in HUD (timer + Start/Pause/Stop + a red-X **Quit App** button) — content-protected so it doesn't appear in the recording.
  - 8 shapes (circle, rect, wide, squircle, hexagon, diamond, heart, star), 3 sizes.
  - Drag the centre handle to reposition your face inside the shape; click anywhere else to drag the whole window.
  - **±** zoom buttons + mouse-wheel zoom directly over the bubble.
  - **Auto-center** tracks the segmentation-mask centroid with confidence-gated, jitter-free smoothing.
  - **Face light** — soft fill-light filter (brightness + warmth + saturation).
  - **Auto Reduce Opacity of Face Cam** — fades translucent when the cursor is near and returns to full opacity when you move away.
  - Background **blur**, built-in scenes, or **upload your own image** (matted via MediaPipe Selfie Segmentation).
  - Per-effect filters for the **face only** (so the background isn't tinted along with you).
- **Cursor zoom** — the recorded canvas smoothly zooms toward your mouse for tutorial-style emphasis.
- **Annotation overlay** — hold `Ctrl` and drag while recording to draw arrows / lines / boxes / circles / highlights in 8 colors with thickness, outline, and style presets.
- **Idiot board** — a floating private teleprompter only you can see (hidden from screen capture). Auto-docks beneath the face-cam bubble.
- **Save to folder** — automatic MP4 (no Save dialog), with a toggle to **open the folder** when recording finishes.
- Recordings land in their own `ScreenRecording_YYYYMMDD_HHMMSS/` folder for clean organization.

### Face Blur tab

- Open an existing video and the app detects faces frame-by-frame and blurs them — useful for redacting bystanders before sharing a clip. The output is a fresh MP4; the source is left untouched.

### Editor tab

Coming soon — the editor is being rebuilt from scratch in a future release. Recordings still save fine in the meantime.

### Cross-app conveniences

- **Help** button in the header opens an in-app feature guide with a left-rail nav and a section per feature area. Updates ship with the build, so the docs are always in sync with the code.
- **Quit** button in the header (and a red X in the floating HUD) shuts the entire app down immediately.
- All settings are persisted across sessions (camera, mic, voice preset, save folder, auto toggles, etc.).

### Packaging

- One-click **.exe** installer (Windows NSIS) and **.dmg** (macOS), both with the bundled `ffmpeg-static` binary in `app.asar.unpacked`.

---

## Shortcut reference

| Action                              | Shortcut                  |
|-------------------------------------|---------------------------|
| Pause / resume recording (global)   | `Ctrl + Shift + P`        |
| Draw annotation (while recording)   | Hold `Ctrl` + drag        |
| Cancel region selection             | `Esc`                     |
| Close help modal                    | `Esc`                     |
| Zoom face-cam (mouse over bubble)   | Mouse wheel               |

---

## Architecture

```
src/
├── main/         Electron main process (windows, IPC, ffmpeg, shortcuts, media:// protocol)
├── preload/      Context-isolated preload bridges (one per window)
├── renderer/
│   ├── main/     React UI — App (tab host), Recorder, Editor, FaceBlur, HelpModal
│   ├── region/   Transparent region-selector overlay
│   ├── annotation/ Always-on-top arrow drawing overlay
│   ├── countdown/  3-2-1 countdown window
│   ├── webcam/   Floating face-cam bubble + embedded HUD
│   ├── idiotboard/ Private teleprompter window (content-protected)
│   └── lib/      compositor, segmenter, shapes, mediaRecorder, voiceChanger, autoFrame
└── shared/       Shared types (shapes, effects, filters, annotation presets)
```

The recorder composites screen + webcam + annotations onto a hidden 1920×1080 canvas, captures it via `canvas.captureStream(30)`, mixes mic + system audio (optionally through the voice-changer Web Audio graph) via an `AudioContext`, and records to WebM with `MediaRecorder`. On stop, the WebM is encoded to MP4 by the bundled `ffmpeg-static` binary using a hardware encoder when available (NVENC / QuickSync / AMF / VideoToolbox) with a `libx264` software fallback.

The cursor-aware face-cam avoidance runs entirely in the **main** process: a single `setInterval` polls `screen.getCursorScreenPoint()` at ~30fps and adjusts the webcam window's bounds and opacity through `setBounds()` / `setOpacity()` with exponential smoothing so the transitions glide instead of snapping.

---

## License

**Source-available commercial license.** See [LICENSE](./LICENSE) for the full terms.

- The full source code is public on GitHub so you can inspect, audit, study, and contribute.
- A **one-time purchase** grants a perpetual license for the current major version (1.x), including all minor and patch updates. **No subscription.**
- Future major versions (2.x, 3.x, …) are separate products sold separately. Your existing 1.x license continues to work indefinitely.
- Personal evaluation for up to 30 days is free. Non-commercial academic research use is free with citation.
- Redistribution, reselling, SaaS hosting, and repackaging are not permitted without a separate agreement.

To purchase a license key, contact QNSub via the address in this repository.
