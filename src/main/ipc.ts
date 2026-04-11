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

let annotationWin: BrowserWindow | null = null;
let regionWins: BrowserWindow[] = [];
let countdownWin: BrowserWindow | null = null;
let webcamWin: BrowserWindow | null = null;
let idiotWin: BrowserWindow | null = null;
let cursorTimer: NodeJS.Timeout | null = null;

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
    webcamWin.on('closed', () => (webcamWin = null));
    // Keep the idiot board docked beneath the webcam window as the user
    // drags it around the screen.
    webcamWin.on('move', dockIdiotBoardUnderControl);
    webcamWin.on('moved', dockIdiotBoardUnderControl);
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
}
