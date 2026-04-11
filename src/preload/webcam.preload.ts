import { contextBridge, ipcRenderer } from 'electron';
import type { WebcamEffect, WebcamShape, WebcamSize } from '../shared/types';

export type WebcamOverlayConfig = {
  deviceId?: string;
  shape: WebcamShape;
  size: WebcamSize;
  bgMode: 'none' | 'blur' | 'image';
  effect: WebcamEffect;
  zoom: number;
  offsetX: number;
  offsetY: number;
  faceLight: number; // 0..100
  bgImageData?: string; // optional data: URL of custom background
  enabled?: boolean;    // false = hide camera bubble, keep toolbar + HUD shell
  autoCenter?: boolean; // when true, ignore offsetX/offsetY and track the
                        // segmentation-mask centroid so the face stays
                        // centered inside the shape automatically.
};

type CtrlState = {
  recState: 'idle' | 'recording' | 'paused' | 'finalizing';
  elapsedSec: number;
  finalizingPct?: number;
};

contextBridge.exposeInMainWorld('webcamApi', {
  onConfig: (cb: (c: WebcamOverlayConfig) => void) => {
    const l = (_: unknown, c: WebcamOverlayConfig) => cb(c);
    ipcRenderer.on('webcam:config', l);
    return () => ipcRenderer.removeListener('webcam:config', l);
  },
  resize: (sizeOrDims: number | { width: number; height: number }) =>
    ipcRenderer.send('webcam:resize', sizeOrDims),
  reportPosition: (pos: { x: number; y: number }) =>
    ipcRenderer.send('webcam:position', pos),
  notifyChange: (patch: Partial<WebcamOverlayConfig>) =>
    ipcRenderer.send('webcam:local-change', patch),

  // Embedded recording control HUD (was a separate window before).
  onControlState: (cb: (s: CtrlState) => void) => {
    const l = (_: unknown, s: CtrlState) => cb(s);
    ipcRenderer.on('control:state', l);
    return () => ipcRenderer.removeListener('control:state', l);
  },
  ctrlStart: () => ipcRenderer.send('control:command', 'start'),
  ctrlPauseToggle: () => ipcRenderer.send('control:command', 'pause'),
  ctrlStop: () => ipcRenderer.send('control:command', 'stop')
});
