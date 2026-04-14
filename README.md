# QNSub Studio

A full-featured cross-platform **screen recorder + face-cam studio + post-production toolbox**, built with Electron + React + TypeScript.

## Download the latest build

If you just want to **use** QNSub Studio without building from source, grab the latest pre-built installer:

> **TODO:** add the S3 download URL here once it's provisioned.
>
> ```
> Windows  : https://<your-s3-bucket>/qnsub-studio/latest/QNSub-Studio-Setup.exe
> macOS    : https://<your-s3-bucket>/qnsub-studio/latest/QNSub-Studio.dmg
> ```

Replace the `<your-s3-bucket>` placeholders above with the real bucket / key the maintainer provides. The installers are signed and self-contained — no extra runtime needed.

### Install on Windows

1. Download `QNSub-Studio-Setup.exe`.
2. Double-click and follow the NSIS installer (it lets you pick the install location and create shortcuts).
3. Launch **QNSub Studio** from the Start Menu.

### Install on macOS

1. Download `QNSub-Studio.dmg`.
2. Open the DMG and drag **QNSub Studio** into your Applications folder.
3. The first launch needs **Screen Recording** permission — System Settings → Privacy & Security → Screen Recording → enable QNSub Studio.

---

## Build it yourself

You only need this if you want to develop, modify, or package the app yourself.

### Prerequisites

- **Node.js 18+** and **npm**
- A working C/C++ toolchain (only required by some optional native deps; most builds work without it)

### Run from source (dev mode)

```bash
git clone <this-repo-url>
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
  - **Auto Relocate Face Cam** — slides sideways out of the cursor's way and glides back when clear.
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
