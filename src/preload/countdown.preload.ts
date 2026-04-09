import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('countdownApi', {
  onStart: (cb: (seconds: number) => void) => {
    ipcRenderer.on('countdown:start', (_, s: number) => cb(s));
  },
  done: () => ipcRenderer.send('countdown:done')
});
