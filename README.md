# QNSub Screen Recorder

Full-featured cross-platform desktop screen recorder built with Electron + React + TypeScript.

## Features

- **Desktop / window / region capture** with a green selection marker
- **3-2-1 countdown** overlay before recording starts
- **Pause / resume** while recording via global shortcut `Ctrl+Shift+P`
- **Webcam overlay** — circle or rectangle, small / medium / large, draggable position
- **Webcam background** — blur or image replacement (MediaPipe Selfie Segmentation)
- **System audio** ("what's playing on your computer") + microphone, mixed together
- **Live annotations** — hold `Ctrl` and drag to draw arrows in **red / green / blue**
- Exports to **MP4** (H.264 + AAC) via bundled `ffmpeg`
- Packaged to a one-click **.exe** (Windows, NSIS) and **.dmg** (macOS)

## Quick start

```bash
npm install
npm run dev
```

## Build installers

```bash
npm run dist:win    # produces out/QNSub Screen Recorder Setup X.Y.Z.exe
npm run dist:mac    # produces out/QNSub Screen Recorder-X.Y.Z.dmg
```

After running `dist:win`, the installer sits in `out/` — share it and users can install with a double-click.

## Shortcut reference

| Action            | Shortcut            |
|-------------------|---------------------|
| Pause / resume    | `Ctrl + Shift + P`  |
| Draw arrow        | `Hold Ctrl + drag`  |
| Cancel region     | `Esc`               |

## Architecture

```
src/
├── main/         Electron main process (windows, IPC, ffmpeg, shortcuts)
├── preload/      Context-isolated preload bridges
├── renderer/
│   ├── main/     React UI
│   ├── region/   Transparent region selector overlay
│   ├── annotation/ Always-on-top arrow drawing overlay
│   ├── countdown/  3-2-1 countdown window
│   └── lib/      compositor, segmenter, mediaRecorder, webcam
└── shared/       Shared type definitions
```

The renderer composites screen + webcam + annotations onto a hidden 1920×1080
canvas, captures it via `canvas.captureStream(30)`, mixes mic + system audio
through an `AudioContext`, and records to WebM with `MediaRecorder`. On stop,
the WebM is remuxed to MP4 by the bundled `ffmpeg-static` binary.
