# Screen Recorder — Feature Catalog

## Source picker

Lets you choose between sharing an entire screen or dragging out a custom region of any monitor. The right-side preview shows a live thumbnail of the selected screen with a tracked cursor dot, and when a region is set it crops the preview down to just the selected rectangle. A vertical separator splits the preview from two large action cards (Share Entire Screen / Select Custom Region) and a Display switcher appears automatically when more than one monitor is connected. A thumbnail-size slider (135-330px) lets you make the source previews bigger or smaller and the choice persists across sessions. A Refresh button on the section header re-pulls the desktopCapturer source list on demand.

## Audio capture

Has independent toggles for system audio (whatever's playing on your speakers via Electron's loopback) and microphone input. When mic is on, a device dropdown lets you pick which connected microphone to record from, defaulting to the system default. Both streams are mixed into the final video via WebAudio's `MediaStreamDestination`. Each row uses the standardized two-column layout with a help icon and a checkbox styled to be 30% larger and easier to click. Settings persist across sessions via the `usePersistedState` hook.

## Webcam overlay

Opens a separate floating Electron window that shows your camera feed in a chosen shape (circle, square, rectangle, squircle, hexagon, diamond, heart, or star) and is composited into the recorded canvas at the position you select. The floating bubble has its own three-dot menu to tweak shape, size, background mode (none/blur/uploaded image), color effect, face light fill, and zoom — all values sync back to the main window via local-change IPC so the recording stays in step. Hover anywhere on the bubble and scroll the mouse wheel to zoom in/out, or use the [−] [center] [+] cluster of overlay buttons that appears on hover (the center handle drags to reposition your face inside the shape). The bubble has `setContentProtection(true)` so it never gets captured twice in the recording, and a custom background image can be uploaded right from the overlay's panel. The webcam window auto-hides when you switch tabs and restores when you come back.

## Recording effects

Include a cursor zoom that smoothly pans and zooms the recorded frame toward your mouse cursor (configurable zoom factor 1.1-3×), and an Idiot Board floating notes window that's invisible to screen capture for use as a teleprompter. The Idiot Board persists its content and font size to localStorage, has A+/A− buttons for live resizing, and docks itself directly beneath the floating control panel whenever it's shown. Both effects bake into the recorded video without needing post-processing. The cursor position is fed by a 16ms-interval main-process tracker that converts global screen coordinates to display-local coordinates. The control panel itself is a tiny floating HUD that mirrors the recording state and lets you start/pause/stop without flipping back to the main window.

## Save destination

Lets you pick any folder via a native dialog or use the Set To Desktop / Set To Downloads shortcut buttons that resolve via `%USERPROFILE%` directly so they don't get redirected to OneDrive on Windows. Each recording creates its own `ScreenRecording_YYYYMMDD_HHMMSS/` project folder containing both the encoded MP4 and a JSON project stub the editor can open. The MP4 encode tries hardware encoders first (NVENC/QSV/AMF on Windows, VideoToolbox on macOS, NVENC/VAAPI on Linux) and caches the winning encoder so subsequent recordings finalize in 1-3 seconds instead of 10-20. The recording handler probes the encoded MP4 for actual duration and dimensions before writing the project file, and fires a `recording:saved` broadcast plus a Show in Folder reveal. Save progress is reported live to the UI so the user sees `Finalizing… 47%` instead of a frozen status.

## Annotation drawing

Lets you hold Ctrl and drag over the screen during recording to draw arrows in 7 shape styles (arrow, line, double-headed, curve, circle, box, highlight) using 15 color presets including outlined variants like "red + white" for visibility on busy backgrounds. Stroke thickness is adjustable 2-20px with a live preview pill showing the exact look in your selected color. All shapes share a unified `drawAnnotation` function in `arrowDraw.ts` so the live overlay window and the baked compositor produce identical output. Drawn arrows fade out automatically over 6 seconds in both the live overlay and the recorded video, and an annotation overlay window with click-through-when-not-Ctrl behavior keeps you from accidentally interrupting the apps you're recording. Curved arrows use a quadratic bezier with the arrowhead tangent-aligned to the curve's endpoint.

## Live recording UI

Shows a pulsing red timer pill in the toolbar (MM:SS or H:MM:SS over an hour) that excludes paused intervals from the displayed elapsed time. The status bar reflects the recording state (idle/recording/paused/finalizing) and the Start button is colored green to clearly invite you to start. Pause toggles via Ctrl+Shift+P globally, and the timer pill turns amber while paused. The webcam preview is hidden during the finalizing/saving phase to keep the UI uncluttered. Region selection results are forwarded back to the main window via IPC and re-render the live region preview with the cursor dot overlay.

## Floating control HUD

A tiny always-on-top window that mirrors the main recorder's state and exposes Start / Pause / Stop buttons so you can drive the recording without flipping back to the main app window. The main window pushes elapsed seconds and rec state to the HUD via a `control:state` IPC channel, and HUD button clicks travel back as `control:command` events that the main recorder consumes as the authoritative source of truth. The HUD uses `setContentProtection(true)` so it never appears inside the recorded video itself. It auto-hides when you switch to a non-Recorder tab and restores when you come back. The Idiot Board notes window automatically docks beneath this HUD whenever both are visible, following the HUD as you drag it around.
