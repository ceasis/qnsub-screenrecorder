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

  showCountdown: (seconds: number = 3): Promise<void> => ipcRenderer.invoke('countdown:show', seconds),

  openAnnotation: () => ipcRenderer.invoke('annotation:open'),
  closeAnnotation: () => ipcRenderer.invoke('annotation:close'),
  setAnnotationColor: (c: AnnotationColor) => ipcRenderer.send('annotation:color', c),
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

  saveRecording: (buf: ArrayBuffer): Promise<{ canceled: boolean; path?: string }> =>
    ipcRenderer.invoke('recording:save', buf),

  showError: (msg: string) => ipcRenderer.invoke('dialog:error', msg)
};

contextBridge.exposeInMainWorld('api', api);

export type MainApi = typeof api;
