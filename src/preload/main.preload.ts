import { contextBridge, ipcRenderer } from 'electron';
import type { RegionResult, ScreenSource, Arrow, AnnotationColor } from '../shared/types';

const api = {
  listSources: (): Promise<ScreenSource[]> => ipcRenderer.invoke('sources:list'),

  openRegion: () => ipcRenderer.invoke('region:open'),
  onRegionResult: (cb: (r: RegionResult) => void) => {
    const listener = (_: unknown, r: RegionResult) => cb(r);
    ipcRenderer.on('region:result', listener);
    return () => ipcRenderer.removeListener('region:result', listener);
  },
  onRegionCancel: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('region:cancel', listener);
    return () => ipcRenderer.removeListener('region:cancel', listener);
  },

  showCountdown: (opts: { seconds: number; style: 'numbers' | 'bar' } = { seconds: 3, style: 'numbers' }): Promise<void> =>
    ipcRenderer.invoke('countdown:show', opts),

  openAnnotation: () => ipcRenderer.invoke('annotation:open'),
  closeAnnotation: () => ipcRenderer.invoke('annotation:close'),
  setAnnotationColor: (c: AnnotationColor) => ipcRenderer.send('annotation:color', c),
  setAnnotationThickness: (t: number) => ipcRenderer.send('annotation:thickness', t),
  setAnnotationOutline: (c: AnnotationColor | null) => ipcRenderer.send('annotation:outline', c),
  setAnnotationStyle: (s: string) => ipcRenderer.send('annotation:style', s),
  onAnnotationArrow: (cb: (a: Arrow) => void) => {
    const listener = (_: unknown, a: Arrow) => cb(a);
    ipcRenderer.on('annotation:arrow', listener);
    return () => ipcRenderer.removeListener('annotation:arrow', listener);
  },

  onTogglePause: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('recording:toggle-pause', listener);
    return () => ipcRenderer.removeListener('recording:toggle-pause', listener);
  },

  saveRecording: (buf: ArrayBuffer, folder?: string, openAfter: boolean = true): Promise<{ canceled: boolean; path?: string; projectPath?: string; folder?: string }> =>
    ipcRenderer.invoke('recording:save', buf, folder, openAfter),

  // Streaming recorder — pushes WebM chunks to a long-running ffmpeg
  // process so the H.264 encode happens in parallel with the recording.
  streamStart: (opts: { folder?: string; fps?: number }): Promise<{ ok: boolean; sessionId?: string; outputPath?: string; projectFolder?: string; error?: string }> =>
    ipcRenderer.invoke('recording:streamStart', opts),
  streamChunk: (sessionId: string, bytes: ArrayBuffer): Promise<boolean> =>
    ipcRenderer.invoke('recording:streamChunk', sessionId, bytes),
  streamStop: (sessionId: string, openAfter: boolean = true): Promise<{ ok: boolean; path?: string; folder?: string; error?: string }> =>
    ipcRenderer.invoke('recording:streamStop', sessionId, openAfter),
  streamCancel: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke('recording:streamCancel', sessionId),

  onSaveProgress: (cb: (percent: number) => void) => {
    const l = (_: unknown, p: number) => cb(p);
    ipcRenderer.on('recording:save-progress', l);
    return () => ipcRenderer.removeListener('recording:save-progress', l);
  },
  onRecordingSaved: (cb: (info: { folder: string; originalPath: string; projectPath: string }) => void) => {
    const l = (_: unknown, info: any) => cb(info);
    ipcRenderer.on('recording:saved', l);
    return () => ipcRenderer.removeListener('recording:saved', l);
  },

  getDefaultFolder: (): Promise<string> => ipcRenderer.invoke('settings:default-folder'),
  getDownloadsFolder: (): Promise<string> => ipcRenderer.invoke('settings:downloads-folder'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:pick-folder'),

  showError: (msg: string) => ipcRenderer.invoke('dialog:error', msg),
  toggleDevTools: () => ipcRenderer.invoke('devtools:toggle'),
  quitApp: () => ipcRenderer.invoke('app:quit'),

  toggleIdiotBoard: () => ipcRenderer.invoke('idiotboard:toggle'),
  closeIdiotBoard: () => ipcRenderer.invoke('idiotboard:close'),

  openWebcamOverlay: (cfg: any) => ipcRenderer.invoke('webcam:open', cfg),
  updateWebcamOverlay: (cfg: any) => ipcRenderer.invoke('webcam:update', cfg),
  closeWebcamOverlay: () => ipcRenderer.invoke('webcam:close'),
  hideWebcamOverlay: () => ipcRenderer.invoke('webcam:hide'),
  showWebcamOverlay: () => ipcRenderer.invoke('webcam:show'),
  setWebcamAvoidance: (opts: { autoRelocate?: boolean; autoOpacity?: boolean }) =>
    ipcRenderer.invoke('webcam:setAvoidance', opts),

  openControlPanel: () => ipcRenderer.invoke('control:open'),
  closeControlPanel: () => ipcRenderer.invoke('control:close'),
  hideControlPanel: () => ipcRenderer.invoke('control:hide'),
  showControlPanel: () => ipcRenderer.invoke('control:show'),
  sendControlState: (state: { recState: 'idle' | 'recording' | 'paused' | 'finalizing'; elapsedSec: number; finalizingPct?: number }) =>
    ipcRenderer.send('control:state', state),
  onControlCommand: (cb: (action: 'start' | 'pause' | 'stop') => void) => {
    const l = (_: unknown, a: 'start' | 'pause' | 'stop') => cb(a);
    ipcRenderer.on('control:command', l);
    return () => ipcRenderer.removeListener('control:command', l);
  },

  startCursorTracking: () => ipcRenderer.invoke('cursor:start'),
  stopCursorTracking: () => ipcRenderer.invoke('cursor:stop'),
  getCursorPos: () => ipcRenderer.invoke('cursor:get'),
  onCursorPos: (cb: (p: { x: number; y: number; displayX: number; displayY: number; displayW: number; displayH: number }) => void) => {
    const l = (_: unknown, p: any) => cb(p);
    ipcRenderer.on('cursor:pos', l);
    return () => ipcRenderer.removeListener('cursor:pos', l);
  },
  onWebcamLocalChange: (cb: (patch: any) => void) => {
    const l = (_: unknown, p: any) => cb(p);
    ipcRenderer.on('webcam:local-change', l);
    return () => ipcRenderer.removeListener('webcam:local-change', l);
  },

  // Face Blur
  pickBlurVideo: (): Promise<{ path: string; name: string } | null> =>
    ipcRenderer.invoke('faceblur:pick-video'),
  blurStreamStart: (opts: { outputPath: string; fps?: number }): Promise<{ ok: boolean; sessionId?: string; outputPath?: string; error?: string }> =>
    ipcRenderer.invoke('faceblur:streamStart', opts),
  blurStreamChunk: (sessionId: string, bytes: ArrayBuffer): Promise<boolean> =>
    ipcRenderer.invoke('faceblur:streamChunk', sessionId, bytes),
  blurStreamStop: (sessionId: string, openAfter: boolean = true): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('faceblur:streamStop', sessionId, openAfter),
  blurStreamCancel: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke('faceblur:streamCancel', sessionId),
  blurMuxAudio: (opts: { blurredPath: string; sourcePath: string }): Promise<boolean> =>
    ipcRenderer.invoke('faceblur:muxAudio', opts),
  readVideoFile: (path: string): Promise<ArrayBuffer | null> =>
    ipcRenderer.invoke('faceblur:read-video-file', path),
  imgStart: (opts: { outputPath: string; fps?: number; width: number; height: number }): Promise<{ ok: boolean; sessionId?: string; error?: string }> =>
    ipcRenderer.invoke('faceblur:imgStart', opts),
  imgFrame: (sessionId: string, jpegBytes: ArrayBuffer): Promise<boolean> =>
    ipcRenderer.invoke('faceblur:imgFrame', sessionId, jpegBytes),
  imgStop: (sessionId: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('faceblur:imgStop', sessionId),
  imgCancel: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('faceblur:imgCancel', sessionId),

  // Background image samples
  listBgSamples: (): Promise<{ name: string; dataUrl: string }[]> =>
    ipcRenderer.invoke('bg:list-samples')
};

contextBridge.exposeInMainWorld('api', api);

export type MainApi = typeof api;
