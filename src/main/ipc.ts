import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron';
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { listScreenSources } from './sources';
import {
  createAnnotationWindow,
  createCountdownWindow,
  createIdiotBoardWindow,
  createRegionWindows,
  createWebcamWindow
} from './windows';
import { remuxWebmToMp4 } from './ffmpeg';
import { streamStart, streamChunk, streamStop, streamCancel } from './streamingRecorder';
import ffmpegStaticImport from 'ffmpeg-static';

let annotationWin: BrowserWindow | null = null;
let regionWins: BrowserWindow[] = [];
let countdownWin: BrowserWindow | null = null;
let webcamWin: BrowserWindow | null = null;
let idiotWin: BrowserWindow | null = null;
let cursorTimer: NodeJS.Timeout | null = null;

// ---------- Cursor-aware webcam avoidance ----------
// The floating webcam window can either slide out of the cursor's way
// (autoRelocate) or fade translucent when the cursor nears it
// (autoOpacity). Both are driven by a single shared screen-cursor poll
// running at ~30 fps. Toggles can be enabled/disabled independently; the
// poll is only active while at least one of them is on.
let webcamAvoidTimer: NodeJS.Timeout | null = null;
let webcamAutoRelocate = false;
let webcamAutoOpacity = false;
// The original ("home") position the user dragged the window to. When the
// cursor moves away, we slide smoothly back to this spot.
let webcamHomePos: { x: number; y: number } | null = null;
// Smoothed current bounds / opacity used by the poll loop so transitions
// don't jump frame-to-frame.
let webcamSmoothX = 0;
let webcamSmoothY = 0;
let webcamSmoothOpacity = 1;
// When true, the next 'move' event on the webcam window was triggered by
// our own avoidance loop and must NOT be interpreted as a user drag.
let webcamSuppressMoveAsUser = false;

const AVOID_BUFFER = 60;       // px of padding around the window that counts as "near"
const OPACITY_FAR = 1.0;
const OPACITY_NEAR = 0.25;
const SMOOTH_POS = 0.18;       // exponential smoothing factor for position
const SMOOTH_OP  = 0.3;        // exponential smoothing factor for opacity

function captureWebcamHome() {
  if (webcamWin && !webcamWin.isDestroyed()) {
    const b = webcamWin.getBounds();
    webcamHomePos = { x: b.x, y: b.y };
    webcamSmoothX = b.x;
    webcamSmoothY = b.y;
  }
}

function startWebcamAvoidanceIfNeeded() {
  if (webcamAvoidTimer) return;
  if (!webcamAutoRelocate && !webcamAutoOpacity) return;
  if (!webcamWin || webcamWin.isDestroyed()) return;
  if (!webcamHomePos) captureWebcamHome();
  webcamAvoidTimer = setInterval(() => {
    try {
      if (!webcamWin || webcamWin.isDestroyed()) {
        stopWebcamAvoidance();
        return;
      }
      const pt = screen.getCursorScreenPoint();
      const b = webcamWin.getBounds();

      // "Near" is evaluated against the STABLE home rect, not the window's
      // current (possibly already-slid-away) position. If we used the
      // current bounds, the relocation created a feedback loop: window
      // slides away → cursor no longer near current bounds → target flips
      // back to home → window slides back → cursor near again → repeat.
      // Anchoring the hit-test to the home rect gives stable hysteresis
      // so the window stays displaced until the cursor actually leaves
      // the original area.
      const hx = webcamHomePos ? webcamHomePos.x : b.x;
      const hy = webcamHomePos ? webcamHomePos.y : b.y;
      const nearX = pt.x >= hx - AVOID_BUFFER && pt.x <= hx + b.width + AVOID_BUFFER;
      const nearY = pt.y >= hy - AVOID_BUFFER && pt.y <= hy + b.height + AVOID_BUFFER;
      const isNear = nearX && nearY;
      const targetOp = webcamAutoOpacity ? (isNear ? OPACITY_NEAR : OPACITY_FAR) : 1;
      webcamSmoothOpacity += (targetOp - webcamSmoothOpacity) * SMOOTH_OP;
      if (Math.abs(webcamSmoothOpacity - webcamWin.getOpacity()) > 0.01) {
        webcamWin.setOpacity(Math.max(0.1, Math.min(1, webcamSmoothOpacity)));
      }

      // Desired position: when the cursor invades the window, jump to the
      // anchor point farthest from the cursor. Anchors are the 8 "safe
      // spots" around the display perimeter:
      //   top-left   top-center   top-right
      //   mid-left                mid-right
      //   bot-left   bot-center   bot-right
      // (no center anchor — we never want the bubble floating in the
      // middle of the screen.) Once the cursor clears the home zone we
      // glide back to the user's original dropped position.
      if (webcamAutoRelocate && webcamHomePos) {
        let targetX = webcamHomePos.x;
        let targetY = webcamHomePos.y;
        if (isNear) {
          const d = screen.getDisplayNearestPoint(pt);
          const margin = 16;
          const leftX = d.bounds.x + margin;
          const rightX = d.bounds.x + d.bounds.width - b.width - margin;
          const midX = d.bounds.x + Math.round((d.bounds.width - b.width) / 2);
          const topY = d.bounds.y + margin;
          const botY = d.bounds.y + d.bounds.height - b.height - margin;
          const midY = d.bounds.y + Math.round((d.bounds.height - b.height) / 2);
          const anchors: { x: number; y: number }[] = [
            { x: leftX,  y: topY },   // top-left
            { x: midX,   y: topY },   // top-center
            { x: rightX, y: topY },   // top-right
            { x: leftX,  y: midY },   // mid-left
            { x: rightX, y: midY },   // mid-right
            { x: leftX,  y: botY },   // bot-left
            { x: midX,   y: botY },   // bot-center
            { x: rightX, y: botY }    // bot-right
          ];
          // Pick the anchor whose CENTER is farthest from the cursor —
          // that's the safest landing spot so the bubble doesn't end up
          // still under the user's hand after moving.
          let best = anchors[0];
          let bestDist = -1;
          for (const a of anchors) {
            const cx = a.x + b.width / 2;
            const cy = a.y + b.height / 2;
            const dx = cx - pt.x;
            const dy = cy - pt.y;
            const dist = dx * dx + dy * dy;
            if (dist > bestDist) { bestDist = dist; best = a; }
          }
          targetX = best.x;
          targetY = best.y;
        }
        webcamSmoothX += (targetX - webcamSmoothX) * SMOOTH_POS;
        webcamSmoothY += (targetY - webcamSmoothY) * SMOOTH_POS;
        const nx = Math.round(webcamSmoothX);
        const ny = Math.round(webcamSmoothY);
        if (nx !== b.x || ny !== b.y) {
          webcamSuppressMoveAsUser = true;
          webcamWin.setBounds({ x: nx, y: ny, width: b.width, height: b.height });
        }
      }
    } catch {}
  }, 33);
}

function stopWebcamAvoidance() {
  if (webcamAvoidTimer) {
    clearInterval(webcamAvoidTimer);
    webcamAvoidTimer = null;
  }
  // Return the window to full opacity and its home position so the user
  // isn't left staring at a faded or displaced bubble.
  if (webcamWin && !webcamWin.isDestroyed()) {
    webcamWin.setOpacity(1);
    webcamSmoothOpacity = 1;
    if (webcamHomePos && webcamAutoRelocate === false) {
      const b = webcamWin.getBounds();
      webcamWin.setBounds({ x: webcamHomePos.x, y: webcamHomePos.y, width: b.width, height: b.height });
    }
  }
}

// Pull the idiot board directly beneath the floating webcam window —
// the webcam window now contains the embedded recording HUD, so docking
// under it keeps both pieces visually anchored to one another.
const IDIOT_GAP = 10;
function dockIdiotBoardUnderControl() {
  if (!webcamWin || webcamWin.isDestroyed()) return;
  if (!idiotWin || idiotWin.isDestroyed() || !idiotWin.isVisible()) return;
  const c = webcamWin.getBounds();
  const i = idiotWin.getBounds();
  idiotWin.setBounds({
    x: Math.round(c.x + (c.width - i.width) / 2),
    y: Math.round(c.y + c.height + IDIOT_GAP),
    width: i.width,
    height: i.height
  });
}

export function registerIpc(getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle('sources:list', () => listScreenSources());

  // ---- Region selection ----
  ipcMain.handle('region:open', async () => {
    regionWins.forEach((w) => !w.isDestroyed() && w.close());
    regionWins = createRegionWindows();
    return true;
  });

  ipcMain.on('region:result', (_e, result) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('region:result', result);
    regionWins.forEach((w) => !w.isDestroyed() && w.close());
    regionWins = [];
  });

  ipcMain.on('region:cancel', () => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('region:cancel');
    regionWins.forEach((w) => !w.isDestroyed() && w.close());
    regionWins = [];
  });

  // ---- Countdown ----
  ipcMain.handle('countdown:show', async (_e, seconds: number = 3) => {
    if (countdownWin && !countdownWin.isDestroyed()) countdownWin.close();
    countdownWin = createCountdownWindow();
    return new Promise<void>((resolve) => {
      countdownWin!.webContents.once('did-finish-load', () => {
        countdownWin!.webContents.send('countdown:start', seconds);
      });
      ipcMain.once('countdown:done', () => {
        if (countdownWin && !countdownWin.isDestroyed()) countdownWin.close();
        countdownWin = null;
        resolve();
      });
    });
  });

  // ---- Annotation overlay ----
  ipcMain.handle('annotation:open', async () => {
    if (annotationWin && !annotationWin.isDestroyed()) return true;
    annotationWin = createAnnotationWindow();
    annotationWin.on('closed', () => (annotationWin = null));
    return true;
  });

  ipcMain.handle('annotation:close', async () => {
    if (annotationWin && !annotationWin.isDestroyed()) annotationWin.close();
    annotationWin = null;
    return true;
  });

  ipcMain.on('annotation:set-clickthrough', (_e, clickthrough: boolean) => {
    if (annotationWin && !annotationWin.isDestroyed()) {
      annotationWin.setIgnoreMouseEvents(clickthrough, { forward: true });
    }
  });

  ipcMain.on('annotation:color', (_e, color: string) => {
    if (annotationWin && !annotationWin.isDestroyed()) {
      annotationWin.webContents.send('annotation:color', color);
    }
  });

  ipcMain.on('annotation:thickness', (_e, thickness: number) => {
    if (annotationWin && !annotationWin.isDestroyed()) {
      annotationWin.webContents.send('annotation:thickness', thickness);
    }
  });

  ipcMain.on('annotation:outline', (_e, outline: string | null) => {
    if (annotationWin && !annotationWin.isDestroyed()) {
      annotationWin.webContents.send('annotation:outline', outline);
    }
  });

  ipcMain.on('annotation:style', (_e, style: string) => {
    if (annotationWin && !annotationWin.isDestroyed()) {
      annotationWin.webContents.send('annotation:style', style);
    }
  });

  ipcMain.on('annotation:arrow', (_e, arrow) => {
    // Forward live arrow strokes to the main window so the compositor
    // can bake them into the recorded canvas.
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('annotation:arrow', arrow);
  });

  // ---- Webcam floating overlay ----
  ipcMain.handle('webcam:open', async (_e, config) => {
    if (webcamWin && !webcamWin.isDestroyed()) {
      webcamWin.webContents.send('webcam:config', config);
      return true;
    }
    webcamWin = createWebcamWindow();
    webcamWin.on('closed', () => {
      webcamWin = null;
      stopWebcamAvoidance();
      webcamHomePos = null;
    });
    // Keep the idiot board docked beneath the webcam window as the user
    // drags it around the screen, and keep our "home" position in sync
    // with wherever the user drops the bubble. Programmatic moves from
    // the avoidance loop set webcamSuppressMoveAsUser=true so we don't
    // treat those as a new home position.
    const onWebcamMove = () => {
      dockIdiotBoardUnderControl();
      if (!webcamWin || webcamWin.isDestroyed()) return;
      if (webcamSuppressMoveAsUser) {
        webcamSuppressMoveAsUser = false;
        return;
      }
      const b = webcamWin.getBounds();
      webcamHomePos = { x: b.x, y: b.y };
      webcamSmoothX = b.x;
      webcamSmoothY = b.y;
    };
    webcamWin.on('move', onWebcamMove);
    webcamWin.on('moved', onWebcamMove);
    // Capture initial home once the window renders.
    webcamWin.once('ready-to-show', captureWebcamHome);
    webcamWin.webContents.once('did-finish-load', () => {
      webcamWin!.webContents.send('webcam:config', config);
    });
    return true;
  });

  ipcMain.handle('webcam:update', async (_e, config) => {
    if (webcamWin && !webcamWin.isDestroyed()) {
      webcamWin.webContents.send('webcam:config', config);
    }
    return true;
  });

  ipcMain.handle('webcam:close', async () => {
    if (webcamWin && !webcamWin.isDestroyed()) webcamWin.close();
    webcamWin = null;
    return true;
  });

  // Hide / show without destroying the window — used when the user flips
  // away from the Screen Recorder tab so the floating preview doesn't
  // linger over other tabs.
  ipcMain.handle('webcam:hide', async () => {
    if (webcamWin && !webcamWin.isDestroyed() && webcamWin.isVisible()) webcamWin.hide();
    return true;
  });
  ipcMain.handle('webcam:show', async () => {
    if (webcamWin && !webcamWin.isDestroyed() && !webcamWin.isVisible()) webcamWin.show();
    return true;
  });

  // Cursor-aware webcam avoidance toggles. Called by the main renderer
  // when the user flips either checkbox; either can be on independently.
  ipcMain.handle('webcam:setAvoidance', async (_e, opts: { autoRelocate?: boolean; autoOpacity?: boolean }) => {
    if (opts.autoRelocate !== undefined) webcamAutoRelocate = !!opts.autoRelocate;
    if (opts.autoOpacity !== undefined) webcamAutoOpacity = !!opts.autoOpacity;
    if (webcamAutoRelocate || webcamAutoOpacity) {
      startWebcamAvoidanceIfNeeded();
    } else {
      stopWebcamAvoidance();
    }
    return true;
  });

  ipcMain.on('webcam:resize', (_e, arg: number | { width: number; height: number }) => {
    if (webcamWin && !webcamWin.isDestroyed()) {
      const [x, y] = webcamWin.getPosition();
      let width: number, height: number;
      if (typeof arg === 'number') {
        // Legacy shape: caller passed only the bubble width, so derive
        // the chrome-included height the old way.
        const CHROME = 40;
        width = arg;
        height = arg + CHROME;
      } else {
        width = Math.round(arg.width);
        height = Math.round(arg.height);
      }
      webcamWin.setBounds({ x, y, width, height });
    }
  });

  // Settings changed from inside the floating window — forward to main window
  // so the App.tsx state stays in sync with whatever the user picked there.
  ipcMain.on('webcam:local-change', (_e, patch) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('webcam:local-change', patch);
  });

  // ---- Idiot Board floating notes window ----
  ipcMain.handle('idiotboard:toggle', async () => {
    if (idiotWin && !idiotWin.isDestroyed()) {
      if (idiotWin.isVisible()) {
        idiotWin.hide();
      } else {
        idiotWin.show();
        idiotWin.focus();
        dockIdiotBoardUnderControl();
      }
      return true;
    }
    idiotWin = createIdiotBoardWindow();
    idiotWin.on('closed', () => (idiotWin = null));
    // Dock once the window has its final bounds.
    idiotWin.once('ready-to-show', dockIdiotBoardUnderControl);
    return true;
  });

  ipcMain.handle('idiotboard:close', async () => {
    if (idiotWin && !idiotWin.isDestroyed()) idiotWin.close();
    idiotWin = null;
    return true;
  });

  ipcMain.on('idiotboard:close', () => {
    if (idiotWin && !idiotWin.isDestroyed()) idiotWin.hide();
  });

  ipcMain.on('idiotboard:resize', (_e, dims: { width: number; height: number }) => {
    if (idiotWin && !idiotWin.isDestroyed()) {
      const [x, y] = idiotWin.getPosition();
      idiotWin.setBounds({ x, y, width: Math.round(dims.width), height: Math.round(dims.height) });
    }
  });

  // ---- Floating control HUD (now embedded inside the webcam window) ----
  // The standalone control window is gone. The recorder still drives state
  // through the same `control:state` channel; we just forward it to the
  // webcam window's renderer instead. The open/close/show/hide handlers
  // are kept as no-ops so the existing renderer wiring continues to work.
  ipcMain.handle('control:open', async () => true);
  ipcMain.handle('control:close', async () => true);
  ipcMain.handle('control:hide', async () => true);
  ipcMain.handle('control:show', async () => true);

  // Main window pushes recording state/elapsed seconds into the embedded
  // HUD inside the webcam window.
  ipcMain.on('control:state', (_e, state: { recState: 'idle' | 'recording' | 'paused' | 'finalizing'; elapsedSec: number; finalizingPct?: number }) => {
    if (webcamWin && !webcamWin.isDestroyed()) {
      webcamWin.webContents.send('control:state', state);
    }
  });

  // HUD button → forward to main window as the authoritative recorder
  // lives there.
  ipcMain.on('control:command', (_e, action: 'start' | 'pause' | 'stop') => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('control:command', action);
  });

  // ---- Save recording into a project folder ----
  // Layout:
  //   <root>/ScreenRecording_YYYYMMDD_HHMMSS/
  //     original_YYYYMMDD_HHMMSS.mp4
  //     project_YYYYMMDD_HHMMSS.xml
  // ---- Streaming recording (parallel ffmpeg encode during capture) ----
  // The renderer pushes WebM chunks via `recording:streamChunk` as the
  // MediaRecorder produces them; ffmpeg consumes from stdin in real time.
  // By the time `recording:streamStop` is called, ffmpeg has already
  // encoded almost everything and just needs to finish the trailing
  // bytes + moov atom. The legacy `recording:save` handler below is
  // kept as a fallback for cases where the streaming pipeline fails.
  ipcMain.handle('recording:streamStart', async (_e, opts: { folder?: string; fps?: number }) => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const root = opts?.folder && opts.folder.trim() ? opts.folder : app.getPath('desktop');
    const projectFolder = join(root, `ScreenRecording_${stamp}`);
    try {
      await fs.mkdir(projectFolder, { recursive: true });
    } catch (e: any) {
      return { ok: false, error: 'mkdir failed: ' + (e?.message || String(e)) };
    }
    const outputPath = join(projectFolder, `original_${stamp}.mp4`);
    const sessionId = streamStart({ outputPath, projectFolder, fps: opts?.fps });
    if (!sessionId) return { ok: false, error: 'Failed to spawn ffmpeg' };
    return { ok: true, sessionId, outputPath, projectFolder };
  });

  ipcMain.handle('recording:streamChunk', async (_e, sessionId: string, bytes: ArrayBuffer) => {
    return streamChunk(sessionId, bytes);
  });

  ipcMain.handle('recording:streamStop', async (_e, sessionId: string, openAfter: boolean = true) => {
    const result = await streamStop(sessionId);
    if (result.ok && result.path && openAfter) {
      shell.showItemInFolder(result.path);
    }
    return result;
  });

  ipcMain.handle('recording:streamCancel', async (_e, sessionId: string) => {
    streamCancel(sessionId);
    return true;
  });

  ipcMain.handle('recording:save', async (
    _e,
    data: ArrayBuffer,
    folder?: string,
    openAfter: boolean = true
  ) => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const root = folder && folder.trim() ? folder : app.getPath('desktop');
    const projectFolder = join(root, `ScreenRecording_${stamp}`);
    await fs.mkdir(projectFolder, { recursive: true });

    const originalPath = join(projectFolder, `original_${stamp}.mp4`);

    const tmpWebm = join(app.getPath('temp'), `qnsub-${Date.now()}.webm`);
    await fs.writeFile(tmpWebm, Buffer.from(data));
    try {
      await remuxWebmToMp4(tmpWebm, originalPath, (pct) => {
        const main = getMainWindow();
        if (main && !main.isDestroyed()) {
          main.webContents.send('recording:save-progress', pct);
        }
      });
    } finally {
      fs.unlink(tmpWebm).catch(() => {});
    }

    // Reveal the saved file in the OS folder view so the user can find it.
    // Controlled by the "Open folder after recording" setting in the main UI.
    if (openAfter) {
      shell.showItemInFolder(originalPath);
    }

    return { canceled: false, path: originalPath, folder: projectFolder };
  });

  // On Windows with OneDrive, app.getPath('desktop') often returns the
  // redirected OneDrive\Desktop path. The user wants the literal local
  // profile desktop, so we build it from USERPROFILE directly and fall
  // back to app.getPath only if that's missing.
  ipcMain.handle('settings:default-folder', async () => {
    if (process.platform === 'win32' && process.env.USERPROFILE) {
      return join(process.env.USERPROFILE, 'Desktop');
    }
    return app.getPath('desktop');
  });
  ipcMain.handle('settings:downloads-folder', async () => {
    if (process.platform === 'win32' && process.env.USERPROFILE) {
      return join(process.env.USERPROFILE, 'Downloads');
    }
    return app.getPath('downloads');
  });

  // ---- Cursor tracking (for cursor-zoom effect) ----
  ipcMain.handle('cursor:start', async () => {
    if (cursorTimer) return true;
    cursorTimer = setInterval(() => {
      try {
        const pt = screen.getCursorScreenPoint();
        const d = screen.getDisplayNearestPoint(pt);
        const main = getMainWindow();
        if (main && !main.isDestroyed()) {
          main.webContents.send('cursor:pos', {
            x: pt.x,
            y: pt.y,
            displayX: d.bounds.x,
            displayY: d.bounds.y,
            displayW: d.bounds.width,
            displayH: d.bounds.height
          });
        }
      } catch {}
    }, 16);
    return true;
  });
  ipcMain.handle('cursor:stop', async () => {
    if (cursorTimer) { clearInterval(cursorTimer); cursorTimer = null; }
    return true;
  });

  // One-shot cursor position lookup — used by the idle region preview so
  // we can draw a cursor dot without keeping a 16ms tracker running.
  ipcMain.handle('cursor:get', async () => {
    try {
      const pt = screen.getCursorScreenPoint();
      const d = screen.getDisplayNearestPoint(pt);
      return {
        x: pt.x,
        y: pt.y,
        displayX: d.bounds.x,
        displayY: d.bounds.y,
        displayW: d.bounds.width,
        displayH: d.bounds.height,
        displayId: String(d.id)
      };
    } catch {
      return null;
    }
  });

  ipcMain.handle('devtools:toggle', async () => {
    const main = getMainWindow();
    if (!main || main.isDestroyed()) return false;
    if (main.webContents.isDevToolsOpened()) main.webContents.closeDevTools();
    else main.webContents.openDevTools({ mode: 'detach' });
    return true;
  });

  ipcMain.handle('settings:pick-folder', async () => {
    const main = getMainWindow();
    const res = await dialog.showOpenDialog(main!, {
      title: 'Choose save folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: app.getPath('desktop')
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('dialog:error', async (_e, message: string) => {
    const main = getMainWindow();
    await dialog.showMessageBox(main!, { type: 'error', message });
  });

  // ---------- Face Blur ----------
  // Let the renderer pick a local video file and hand back an
  // absolute path. Loaded via the custom `media://` protocol already
  // registered in main.ts so the renderer can `<video src="media://...">`
  // without tripping the file:// CSP.
  ipcMain.handle('faceblur:pick-video', async () => {
    const main = getMainWindow();
    const res = await dialog.showOpenDialog(main!, {
      title: 'Choose video to blur',
      properties: ['openFile'],
      filters: [
        { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] },
        { name: 'All files', extensions: ['*'] }
      ],
      defaultPath: app.getPath('videos')
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const p = res.filePaths[0];
    return { path: p, name: basename(p) };
  });

  // Ask the user where to save the blurred result and hand back a
  // fully-qualified output path (no file yet). The renderer then
  // drives faceblur:streamStart()/Chunk/Stop to write into it.
  ipcMain.handle('faceblur:pick-output', async (_e, suggestedName: string) => {
    const main = getMainWindow();
    const res = await dialog.showSaveDialog(main!, {
      title: 'Save blurred video as…',
      defaultPath: join(app.getPath('videos'), suggestedName),
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    });
    if (res.canceled || !res.filePath) return null;
    return res.filePath;
  });

  // Spawn an ffmpeg session that writes to a user-chosen absolute
  // path. Mirrors recording:streamStart but without the auto-generated
  // ScreenRecording_<stamp> folder — face-blur export picks its own
  // target so we hand it the exact path instead.
  ipcMain.handle('faceblur:streamStart', async (_e, opts: { outputPath: string; fps?: number }) => {
    if (!opts?.outputPath) return { ok: false, error: 'No output path' };
    const projectFolder = join(opts.outputPath, '..');
    const sessionId = streamStart({ outputPath: opts.outputPath, projectFolder, fps: opts?.fps });
    if (!sessionId) return { ok: false, error: 'Failed to spawn ffmpeg' };
    return { ok: true, sessionId, outputPath: opts.outputPath };
  });

  ipcMain.handle('faceblur:streamChunk', async (_e, sessionId: string, bytes: ArrayBuffer) => {
    return streamChunk(sessionId, bytes);
  });

  ipcMain.handle('faceblur:streamStop', async (_e, sessionId: string, openAfter: boolean = true) => {
    const result = await streamStop(sessionId);
    if (result.ok && result.path && openAfter) {
      shell.showItemInFolder(result.path);
    }
    return result;
  });

  ipcMain.handle('faceblur:streamCancel', async (_e, sessionId: string) => {
    streamCancel(sessionId);
    return true;
  });

  // Read a local video file's bytes and hand them back to the renderer
  // so it can wrap them in a Blob + object URL. We use this instead of
  // a custom protocol (`media://` used to do this job) because
  // Chromium's media URL safety check rejects custom schemes for
  // `<video>` in Electron 31 regardless of the privileges we register —
  // the rejection happens before our protocol handler is even called,
  // so we can't fix it from the main side. Blob URLs sidestep the
  // whole problem: they're a native browser primitive and <video>
  // trusts them unconditionally. Tradeoff: the full file is loaded
  // into renderer memory, so this isn't great for 10 GB files, but
  // it's fine for normal screen recordings (usually under 500 MB).
  ipcMain.handle('faceblur:read-video-file', async (_e, path: string) => {
    try {
      const buf = await fs.readFile(path);
      // Return as an ArrayBuffer over IPC. Electron will serialise
      // Buffer as `Uint8Array` in the renderer; we hand back the
      // underlying ArrayBuffer so the renderer can feed it straight
      // into `new Blob([...])`.
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch (e: any) {
      console.error('[faceblur:read-video-file] failed', path, e?.message || e);
      return null;
    }
  });

  // Second-pass audio mux. The face-blur export pipeline writes a
  // video-only MP4 via the streaming ffmpeg session, then calls this
  // to copy the audio track from the original source file into the
  // blurred output. ffmpeg reads from both files, copies both
  // streams, and writes to a temp sibling which we atomically rename
  // over the original blurred file.
  ipcMain.handle('faceblur:muxAudio', async (_e, opts: { blurredPath: string; sourcePath: string }) => {
    if (!opts?.blurredPath || !opts?.sourcePath) return false;
    const bin = (ffmpegStaticImport as unknown as string || '').replace('app.asar', 'app.asar.unpacked');
    if (!bin) return false;
    const tmpPath = opts.blurredPath.replace(/\.mp4$/i, '') + '.tmp.mp4';
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', opts.blurredPath,   // video (no audio)
      '-i', opts.sourcePath,    // audio (and video we ignore)
      '-map', '0:v:0',
      '-map', '1:a:0?',         // optional audio stream
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-movflags', '+faststart',
      tmpPath
    ];
    const { spawn: spawnChild } = await import('child_process');
    const ok: boolean = await new Promise((resolve) => {
      let err = '';
      const proc = spawnChild(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      proc.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => {
        if (code !== 0) {
          console.warn('[faceblur:muxAudio] ffmpeg failed', code, err.slice(-500));
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
    if (!ok) {
      try { await fs.unlink(tmpPath); } catch {}
      return false;
    }
    try {
      await fs.unlink(opts.blurredPath);
      await fs.rename(tmpPath, opts.blurredPath);
      return true;
    } catch (e) {
      console.warn('[faceblur:muxAudio] rename failed', e);
      return false;
    }
  });
}
