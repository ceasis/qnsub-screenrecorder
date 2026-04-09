import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';
import { listScreenSources } from './sources';
import {
  createAnnotationWindow,
  createCountdownWindow,
  createRegionWindows
} from './windows';
import { remuxWebmToMp4 } from './ffmpeg';

let annotationWin: BrowserWindow | null = null;
let regionWins: BrowserWindow[] = [];
let countdownWin: BrowserWindow | null = null;

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

  ipcMain.on('annotation:color', (_e, color: 'red' | 'green' | 'blue') => {
    if (annotationWin && !annotationWin.isDestroyed()) {
      annotationWin.webContents.send('annotation:color', color);
    }
  });

  ipcMain.on('annotation:arrow', (_e, arrow) => {
    // Forward live arrow strokes to the main window so the compositor
    // can bake them into the recorded canvas.
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('annotation:arrow', arrow);
  });

  // ---- Save recording ----
  ipcMain.handle('recording:save', async (_e, data: ArrayBuffer) => {
    const main = getMainWindow();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultName = `qnsub-${stamp}.mp4`;
    const videosDir = app.getPath('videos');

    const res = await dialog.showSaveDialog(main!, {
      title: 'Save recording',
      defaultPath: join(videosDir, defaultName),
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };

    const tmpWebm = join(app.getPath('temp'), `qnsub-${Date.now()}.webm`);
    await fs.writeFile(tmpWebm, Buffer.from(data));
    try {
      await remuxWebmToMp4(tmpWebm, res.filePath);
    } finally {
      fs.unlink(tmpWebm).catch(() => {});
    }
    return { canceled: false, path: res.filePath };
  });

  ipcMain.handle('dialog:error', async (_e, message: string) => {
    const main = getMainWindow();
    await dialog.showMessageBox(main!, { type: 'error', message });
  });
}
