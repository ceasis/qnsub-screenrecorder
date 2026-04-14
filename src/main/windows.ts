import { BrowserWindow, screen } from 'electron';
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
