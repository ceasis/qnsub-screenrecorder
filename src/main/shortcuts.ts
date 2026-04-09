import { BrowserWindow, globalShortcut } from 'electron';

const PAUSE_ACCELERATOR = 'CommandOrControl+Shift+P';

export function registerShortcuts(getMainWindow: () => BrowserWindow | null) {
  globalShortcut.register(PAUSE_ACCELERATOR, () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('recording:toggle-pause');
    }
  });
}

export function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}
