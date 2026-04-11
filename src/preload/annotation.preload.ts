import { contextBridge, ipcRenderer } from 'electron';
import type { Arrow, AnnotationColor, ArrowStyle } from '../shared/types';

contextBridge.exposeInMainWorld('annotationApi', {
  setClickthrough: (clickthrough: boolean) =>
    ipcRenderer.send('annotation:set-clickthrough', clickthrough),
  sendArrow: (a: Arrow) => ipcRenderer.send('annotation:arrow', a),
  onColor: (cb: (c: AnnotationColor) => void) => {
    const l = (_: unknown, c: AnnotationColor) => cb(c);
    ipcRenderer.on('annotation:color', l);
    return () => ipcRenderer.removeListener('annotation:color', l);
  },
  onThickness: (cb: (t: number) => void) => {
    const l = (_: unknown, t: number) => cb(t);
    ipcRenderer.on('annotation:thickness', l);
    return () => ipcRenderer.removeListener('annotation:thickness', l);
  },
  onOutline: (cb: (c: AnnotationColor | null) => void) => {
    const l = (_: unknown, c: AnnotationColor | null) => cb(c);
    ipcRenderer.on('annotation:outline', l);
    return () => ipcRenderer.removeListener('annotation:outline', l);
  },
  onStyle: (cb: (s: ArrowStyle) => void) => {
    const l = (_: unknown, s: ArrowStyle) => cb(s);
    ipcRenderer.on('annotation:style', l);
    return () => ipcRenderer.removeListener('annotation:style', l);
  }
});
