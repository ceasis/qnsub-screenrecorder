import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'path';

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

function rendererUrl(page: 'main' | 'region' | 'annotation' | 'countdown' | 'webcam' | 'idiotboard'): string {
  if (isDev) {
    const base = process.env['ELECTRON_RENDERER_URL']!;
    return page === 'main' ? `${base}/index.html` : `${base}/${page}.html`;
  }
  const file = page === 'main' ? 'index.html' : `${page}.html`;
  return `file://${join(__dirname, '../renderer', file)}`;
}

export function createWebcamWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay();
  const size = 360;
  const margin = 32;
  const win = new BrowserWindow({
    width: size,
    height: size,
    x: Math.round(primary.bounds.x + primary.bounds.width - size - margin),
    y: Math.round(primary.bounds.y + primary.bounds.height - size - margin),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    focusable: true,
    webPreferences: {
      preload: preload('webcam'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // The webcam overlay is already baked into the recorded canvas by the
  // compositor. Hide this floating window from screen-capture APIs so it
  // does NOT appear twice in the final recording.
  try { win.setContentProtection(true); } catch {}
  win.loadURL(rendererUrl('webcam'));
  return win;
}

function preload(name: 'main' | 'region' | 'annotation' | 'countdown' | 'webcam' | 'idiotboard'): string {
  return join(__dirname, '../preload', `${name}.preload.js`);
}

export function createIdiotBoardWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay();
  const width = 380;
  const height = 300;
  const margin = 32;
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(primary.bounds.x + margin),
    y: Math.round(primary.bounds.y + primary.bounds.height - height - margin),
    minWidth: 240,
    minHeight: 180,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    focusable: true,
    title: 'Idiot Board',
    webPreferences: {
      preload: preload('idiotboard'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Hide from screen capture so notes never appear in recordings.
  try { win.setContentProtection(true); } catch {}
  win.loadURL(rendererUrl('idiotboard'));
  return win;
}

/**
 * Lightweight splash window shown while the main window is booting.
 *
 * Implemented as a frameless always-on-top BrowserWindow loaded
 * from an inline `data:text/html` URL — no HTML file, no Vite
 * entry, no extra build step. The visual is pure CSS + one inline
 * SVG so there's nothing to fetch or decode: it paints in ~10ms
 * on first load, which is what the splash needs to do.
 *
 * Caller is responsible for closing this window once the main
 * window fires `ready-to-show`.
 */
export function createSplashWindow(): BrowserWindow {
  const width = 440;
  const height = 340;
  const primary = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(primary.bounds.x + (primary.bounds.width - width) / 2),
    y: Math.round(primary.bounds.y + (primary.bounds.height - height) / 2),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    overflow: hidden;
    -webkit-user-select: none;
    user-select: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: #e6edf3;
  }
  .card {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: 28px 32px 32px;
    border-radius: 18px;
    background: linear-gradient(160deg, #161b22 0%, #0d1117 100%);
    border: 1px solid #262d36;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    opacity: 0;
    transform: scale(0.98);
    animation: fade-in 220ms ease-out forwards;
  }
  @keyframes fade-in {
    to { opacity: 1; transform: scale(1); }
  }
  .logo {
    width: 92px;
    height: 92px;
    border-radius: 22px;
    background: linear-gradient(135deg, #FF3D5A 0%, #E11D48 55%, #9F1239 100%);
    box-shadow: 0 10px 30px rgba(225, 29, 72, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
  }
  .logo::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 30% 25%, rgba(255,255,255,0.35) 0%, transparent 55%);
    pointer-events: none;
  }
  .logo svg {
    width: 54px;
    height: 54px;
    color: #ffffff;
  }
  .title {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.2px;
    margin: 6px 0 0;
  }
  .subtitle {
    font-size: 12.5px;
    color: #6b7380;
    margin: 0;
    font-weight: 500;
  }
  .spinner {
    margin-top: 8px;
    width: 22px;
    height: 22px;
    border: 2px solid #262d36;
    border-top-color: #e11d48;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .credits {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid #262d36;
    width: 100%;
    text-align: center;
    font-size: 11px;
    color: #6b7380;
    letter-spacing: 0.1px;
    line-height: 1.8;
  }
  .credits .os {
    color: #e6edf3;
    font-weight: 600;
  }
  .credits .sep {
    color: #30363d;
    margin: 0 6px;
  }
  .credits a {
    color: #8b949e;
    font-size: 13.2px;
    text-decoration: none;
    border-bottom: 1px dotted #3a424e;
    padding-bottom: 1px;
    transition: color 0.12s ease, border-color 0.12s ease;
    cursor: pointer;
  }
  .credits a:hover {
    color: #ff6b7a;
    border-bottom-color: #ff6b7a;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="6" width="14" height="12" rx="2"/>
        <path d="M16 10 L22 6 L22 18 L16 14 Z" fill="currentColor" stroke="none"/>
      </svg>
    </div>
    <h1 class="title">QNSub Studio</h1>
    <p class="subtitle">Starting up…</p>
    <div class="spinner"></div>
    <div class="credits">
      <span class="os">100% open source</span>
      <br/>
      <a href="https://github.com/ceasis/qnsub-screenrecorder" target="_blank" rel="noopener">github.com/ceasis/qnsub-screenrecorder</a>
      <span class="sep">·</span>
      <a href="https://ceasis.github.io/qnsub-screenrecorder/" target="_blank" rel="noopener">website</a>
      <span class="sep">·</span>
      <a href="https://twitter.com/choloasis" target="_blank" rel="noopener">@choloasis</a>
    </div>
  </div>
</body>
</html>`;

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  // The splash is a sandboxed data: URL — `<a target="_blank">` clicks
  // would otherwise be silently dropped. Route http(s) URLs to the
  // user's default browser via shell.openExternal and deny the
  // in-Electron popup.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });
  win.once('ready-to-show', () => win.show());
  return win;
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    title: 'QNSub Screen Recorder',
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    // Start maximised. The `width`/`height` above are still needed
    // as the "restore" size — if the user unmaximises the window by
    // dragging the title bar, it falls back to 1100×760.
    show: false,
    webPreferences: {
      preload: preload('main'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  // Maximise before the first paint so the user never sees the
  // 1100×760 "restore size" flash, then show the window.
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  win.loadURL(rendererUrl('main'));

  return win;
}

export function createRegionWindows(): BrowserWindow[] {
  const displays = screen.getAllDisplays();
  return displays.map((d) => {
    const win = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      fullscreen: false,
      hasShadow: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: true,
      webPreferences: {
        preload: preload('region'),
        contextIsolation: true,
        sandbox: false,
        additionalArguments: [`--display-id=${d.id}`]
      }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadURL(rendererUrl('region'));
    return win;
  });
}

export function createCountdownWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay();
  const size = 360;
  const win = new BrowserWindow({
    width: size,
    height: size,
    x: Math.round(primary.bounds.x + (primary.bounds.width - size) / 2),
    y: Math.round(primary.bounds.y + (primary.bounds.height - size) / 2),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    webPreferences: {
      preload: preload('countdown'),
      contextIsolation: true,
      sandbox: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.loadURL(rendererUrl('countdown'));
  return win;
}

export function createAnnotationWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    x: primary.bounds.x,
    y: primary.bounds.y,
    width: primary.bounds.width,
    height: primary.bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    webPreferences: {
      preload: preload('annotation'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Start click-through; renderer will request toggle when CTRL is held
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadURL(rendererUrl('annotation'));
  return win;
}
