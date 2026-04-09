import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './windows';
import { registerIpc } from './ipc';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';

let mainWindow: BrowserWindow | null = null;

function bootstrap() {
  mainWindow = createMainWindow();
  registerIpc(() => mainWindow);
  registerShortcuts(() => mainWindow);
}

app.whenReady().then(() => {
  bootstrap();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) bootstrap();
  });
});

app.on('window-all-closed', () => {
  unregisterShortcuts();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  unregisterShortcuts();
});

// Allow getDisplayMedia / desktopCapturer loopback audio
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
