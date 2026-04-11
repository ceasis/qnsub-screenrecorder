# QNSub Studio

A full-featured cross-platform **screen recorder** *and* **video editor**, built with Electron + React + TypeScript.

## Features

### Screen Recorder tab
- Desktop, window, or custom **region** capture (with a green selection marker)
- **3-2-1 countdown** overlay before recording starts
- **Pause / resume** via the global shortcut `Ctrl+Shift+P`
- **Webcam overlay** — 7 shapes (circle, rect, squircle, hexagon, diamond, heart, star), 3 sizes, draggable position
- **Webcam background** — blur or image replacement (MediaPipe Selfie Segmentation)
- **Webcam effects** — grayscale, sepia, vintage, cool, warm, vivid, dramatic
- **Camera zoom** slider
- **Floating webcam bubble** on your desktop with a 3-dot config menu — reshape, resize, change effect, zoom, all without leaving the bubble
- **System audio** (what's playing on your computer) + microphone, mixed together
- Live **annotations** — hold `Ctrl` and drag to draw arrows in red / green / blue
- Output: **MP4** (H.264 + AAC) via bundled `ffmpeg`
- Context-sensitive `?` tooltips throughout the config page

### Video Editor tab
- Open any MP4 / WebM / MOV / MKV / M4V / AVI file
- Frame-accurate preview with play/pause/seek
- **Split** the current clip at the playhead
- **Trim in / out** of the selected clip
- **Delete** and **reorder** clips for the final export
- Playback **speed** (0.25× – 4×) and **volume** controls
- Keyboard shortcuts: `Space` play/pause, `←/→` scrub, `I/O` set in/out, `S` split, `Delete` remove clip
- Export to **MP4** via bundled `ffmpeg` with a single filter-graph pass (`trim` + `atrim` + `concat`)
- Progress bar during export

### Packaging
- One-click **.exe** installer (Windows NSIS) and **.dmg** (macOS)

## Quick start

```bash
npm install
npm run dev
```

## Build installers

```bash
npm run dist:win    # out/QNSub Studio Setup X.Y.Z.exe
npm run dist:mac    # out/QNSub Studio-X.Y.Z.dmg
```

## Shortcut reference

| Action                      | Shortcut            |
|-----------------------------|---------------------|
| Pause / resume recording    | `Ctrl + Shift + P`  |
| Draw arrow (while recording)| `Hold Ctrl + drag`  |
| Cancel region selection     | `Esc`               |
| Play/pause (editor)         | `Space`             |
| Scrub (editor)              | `← / →` (`Shift` = 1s) |
| Set in / out (editor)       | `I` / `O`           |
| Split at playhead (editor)  | `S`                 |
| Delete selected clip        | `Delete` / `Backspace` |

## License

**Source-available commercial license.** See [LICENSE](./LICENSE) for the full terms.

- The full source code is public on GitHub so you can inspect, audit, study, and contribute.
- A **one-time purchase** grants a perpetual license for the current major version (1.x), including all minor and patch updates. **No subscription.**
- Future major versions (2.x, 3.x, …) are separate products sold separately. Your existing 1.x license continues to work indefinitely.
- Personal evaluation for up to 30 days is free. Non-commercial academic research use is free with citation.
- Redistribution, reselling, SaaS hosting, and repackaging are not permitted without a separate agreement.

To purchase a license key, contact QNSub via the address in this repository.

## Architecture

```
src/
├── main/         Electron main process (windows, IPC, ffmpeg, shortcuts, media:// protocol)
├── preload/      Context-isolated preload bridges
├── renderer/
│   ├── main/     React UI — App (tab host), Recorder, Editor, Help
│   ├── region/   Transparent region selector overlay
│   ├── annotation/ Always-on-top arrow drawing overlay
│   ├── countdown/  3-2-1 countdown window
│   ├── webcam/   Floating webcam bubble with 3-dot config
│   └── lib/      compositor, segmenter, shapes, mediaRecorder, webcam
└── shared/       Shared types (shapes, effects, filters)
```

The recorder composites screen + webcam + annotations onto a hidden 1920×1080 canvas, captures it via `canvas.captureStream(30)`, mixes mic + system audio through an `AudioContext`, and records to WebM with `MediaRecorder`. On stop, the WebM is remuxed to MP4 by the bundled `ffmpeg-static` binary.

The editor loads local video files via a custom `media://` protocol registered in the main process, so it works both in dev (Vite over `http://`) and in packaged builds.
