import { app, BrowserWindow, protocol, net, Tray, Menu, nativeImage, ipcMain } from 'electron';
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';
import { join } from 'path';
import { createMainWindow } from './windows';
import { registerIpc } from './ipc';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// True only when the user clicked Quit (or the app is quitting for any
// real reason). Used by the close-handler to distinguish "user wants to
// hide the window" from "we are actually shutting down".
let isQuitting = false;

// Custom scheme so the renderer can load arbitrary local video files for
// the editor even when the page itself is served over http:// in dev.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, stream: true, supportFetchAPI: true, bypassCSP: true, secure: true }
  }
]);

/**
 * Resolve the tray icon PNG path. We look in three places so the file is
 * found whether we're running from `npm run dev` (cwd = project root),
 * from a packaged build (file lives in `resources/`), or from somewhere
 * in between. Returns the first existing path or null if nothing matches.
 */
function resolveTrayIconPath(): string | null {
  const candidates = [
    join(process.cwd(), 'tray-icon.png'),                  // dev mode
    join(__dirname, '..', '..', 'tray-icon.png'),          // dist/main → project root
    join(process.resourcesPath || '', 'tray-icon.png'),    // packaged
    join(app.getAppPath(), 'tray-icon.png')                // packaged fallback
  ];
  for (const p of candidates) {
    try { if (p && existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    bootstrap();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Floating windows (webcam bubble + embedded HUD, idiot board) stay
  // on screen so the user can still drive the recorder without bringing
  // the main config window back.
  mainWindow.hide();
}

function createTray() {
  if (tray) return;
  // Load the tray icon from disk. The PNG lives at the project root in dev
  // and gets resolved through `resolveTrayIconPath` so it works in both
  // dev and packaged builds. If the file is missing for any reason we
  // fall back to an empty image — Electron will still draw a tray slot
  // (it just won't have a recognizable icon) so the user isn't locked
  // out of the tray menu.
  let icon = nativeImage.createEmpty();
  const path = resolveTrayIconPath();
  if (path) {
    icon = nativeImage.createFromPath(path);
  }
  tray = new Tray(icon);
  tray.setToolTip('QNSub Studio');
  const menu = Menu.buildFromTemplate([
    { label: 'Show QNSub Studio', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  // Single-click on the tray icon brings the window back.
  tray.on('click', () => showMainWindow());
}

function bootstrap() {
  mainWindow = createMainWindow();
  registerIpc(() => mainWindow);
  registerShortcuts(() => mainWindow);
  createTray();

  // Intercept the close event so the X just hides the window. The user
  // can quit explicitly via the in-app Quit button or the tray menu.
  mainWindow.on('close', (e) => {
    if (isQuitting) return; // real shutdown — let it close
    e.preventDefault();
    hideMainWindow();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Serve local files under media:// so <video src="media:///..."> works from
  // any origin (dev server or packaged renderer).
  protocol.handle('media', async (request) => {
    try {
      const u = new URL(request.url);
      let p = decodeURIComponent(u.pathname);
      if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(p)) p = p.slice(1);
      return net.fetch(pathToFileURL(p).toString());
    } catch (e: any) {
      return new Response('Not found', { status: 404 });
    }
  });

  bootstrap();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) bootstrap();
  });
});

// Don't quit on `window-all-closed` — the main window only hides, and we
// want the tray + background process to stay alive until the user
// explicitly picks Quit. The unregisterShortcuts call lives in `will-quit`
// instead so global shortcuts stay bound while the main window is hidden.
app.on('window-all-closed', () => {
  // Intentionally empty — staying alive in tray.
});

app.on('before-quit', () => {
  isQuitting = true;
  // Destroy any lingering floating windows so the process can exit.
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.destroy();
  }
});

app.on('will-quit', () => {
  unregisterShortcuts();
  if (tray && !tray.isDestroyed()) { tray.destroy(); tray = null; }
});

// Renderer can request a real quit via this channel (the in-app Quit button).
ipcMain.handle('app:quit', () => {
  isQuitting = true;
  app.quit();
});

// Allow getDisplayMedia / desktopCapturer loopback audio
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
