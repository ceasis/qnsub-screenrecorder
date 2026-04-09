import { contextBridge, ipcRenderer } from 'electron';
import type { Arrow, AnnotationColor } from '../shared/types';

contextBridge.exposeInMainWorld('annotationApi', {
  setClickthrough: (clickthrough: boolean) =>
    ipcRenderer.send('annotation:set-clickthrough', clickthrough),
  sendArrow: (a: Arrow) => ipcRenderer.send('annotation:arrow', a),
  onColor: (cb: (c: AnnotationColor) => void) => {
    const l = (_: unknown, c: AnnotationColor) => cb(c);
    ipcRenderer.on('annotation:color', l);
    return () => ipcRenderer.removeListener('annotation:color', l);
  }
});
