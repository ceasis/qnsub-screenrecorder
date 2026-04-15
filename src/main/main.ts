import { app, BrowserWindow, protocol, Tray, Menu, nativeImage, ipcMain, shell } from 'electron';
import { existsSync } from 'fs';
import * as fs from 'fs';
import { join } from 'path';

import { createMainWindow, createSplashWindow } from './windows';
import { registerIpc } from './ipc';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';

// Electron's default app name comes from package.json's `name` field
// ("qnsub-screenrecorder") unless overridden. That string shows up in
// the Windows taskbar jump-list and the macOS menu bar, so we force a
// human-readable name as early as possible — before any window is
// created and before `app.whenReady` fires. `productName` in
// package.json only applies to packaged builds (electron-builder), not
// the dev runtime, which is why we also call setName here.
app.setName('QNSub Screen Recorder');
// Windows groups taskbar icons by AppUserModelID. Without an explicit
// ID, Windows falls back to "Electron" for the grouping label on the
// right-click / jump list. Setting it to the same id as the installer
// makes the taskbar show the product name instead.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.qnsub.screenrecorder');
}

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
    privileges: {
      standard: true,
      stream: true,
      supportFetchAPI: true,
      bypassCSP: true,
      secure: true,
      // REQUIRED for <video src="media://..."> to actually load.
      // Without corsEnabled, Chromium's media URL safety check
      // rejects the load with "Media load rejected by URL safety
      // check" and the element errors out with code 4.
      corsEnabled: true
    }
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
      label: 'Buy me a coffee \u2615',
      click: () => {
        shell.openExternal('https://paypal.me/qnsub').catch(() => {});
      }
    },
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
  // Splash first so the user sees something immediately while the
  // main window's renderer bundles, React boots, and localStorage
  // rehydrates. The splash is closed in the main window's
  // `ready-to-show` handler (see below).
  const splashWin = createSplashWindow();
  const splashShownAt = Date.now();

  mainWindow = createMainWindow();
  registerIpc(() => mainWindow);
  registerShortcuts(() => mainWindow);
  createTray();

  // Close the splash once the main window is actually painted.
  // Minimum visible time is 5 seconds so the user has time to read
  // the brand + "100% open source" + GitHub URL + Twitter handle
  // — and to click through if they want. On slower machines the
  // splash stays up as long as the main window needs to boot.
  const MIN_SPLASH_MS = 5000;
  mainWindow.once('ready-to-show', () => {
    const elapsed = Date.now() - splashShownAt;
    const wait = Math.max(0, MIN_SPLASH_MS - elapsed);
    setTimeout(() => {
      try {
        if (!splashWin.isDestroyed()) splashWin.close();
      } catch {}
    }, wait);
  });
  // Also close the splash if the main window errors out during load
  // so we don't leave an orphan splash on the user's screen.
  mainWindow.webContents.once('did-fail-load', () => {
    try {
      if (!splashWin.isDestroyed()) splashWin.close();
    } catch {}
  });

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
  // Serve local files under media:// so <video src="media:///..."> works
  // from any origin (dev server or packaged renderer). This handler must
  // respond to HTTP Range requests — <video> elements issue partial
  // fetches for seeking, and a non-range response causes the video to
  // fail to load entirely (networkState=NO_SOURCE, readyState=HAVE_NOTHING).
  // `net.fetch(file://)` doesn't advertise Accept-Ranges on Electron 31, so
  // we serve the file manually with fs.
  protocol.handle('media', async (request) => {
    console.log('[media protocol]', request.method, request.url, 'range=', request.headers.get('range') || '-');
    try {
      const u = new URL(request.url);
      let p = decodeURIComponent(u.pathname);
      if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(p)) p = p.slice(1);
      console.log('[media protocol] resolved path', p);

      const stat = await fs.promises.stat(p);
      const total = stat.size;
      const range = request.headers.get('range') || request.headers.get('Range');

      const ext = (p.split('.').pop() || '').toLowerCase();
      const mime =
        ext === 'mp4' || ext === 'm4v' ? 'video/mp4' :
        ext === 'webm' ? 'video/webm' :
        ext === 'mov' ? 'video/quicktime' :
        ext === 'mkv' ? 'video/x-matroska' :
        ext === 'avi' ? 'video/x-msvideo' :
        'application/octet-stream';

      // Range path: buffer the slice into memory and return it as a
      // plain Response. Electron 31's `protocol.handle` doesn't reliably
      // accept Node streams — it expects a standard web `Response`, and
      // polyfilling via `Readable.toWeb` has produced silent hangs on
      // Windows in testing. Buffering each range chunk is simpler and
      // <video> only ever requests a few MB at a time.
      if (range) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
        if (m) {
          const start = parseInt(m[1], 10);
          const end = m[2] ? parseInt(m[2], 10) : total - 1;
          if (isNaN(start) || isNaN(end) || start >= total || end >= total || start > end) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${total}` }
            });
          }
          const length = end - start + 1;
          const fh = await fs.promises.open(p, 'r');
          try {
            const buf = Buffer.alloc(length);
            await fh.read(buf, 0, length, start);
            return new Response(buf, {
              status: 206,
              headers: {
                'Content-Type': mime,
                'Content-Length': String(length),
                'Content-Range': `bytes ${start}-${end}/${total}`,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-cache'
              }
            });
          } finally {
            await fh.close();
          }
        }
      }

      // No range header. For small files we buffer the whole thing; for
      // larger files we return a 200 with the entire contents but still
      // advertise Accept-Ranges so the next <video> request uses ranges.
      const buf = await fs.promises.readFile(p);
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        }
      });
    } catch (e: any) {
      console.error('[media protocol] error serving', request.url, e?.message || e);
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
