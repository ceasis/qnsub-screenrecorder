import { contextBridge, ipcRenderer } from 'electron';

export type CountdownConfig = { seconds: number; style: 'numbers' | 'bar' };

contextBridge.exposeInMainWorld('countdownApi', {
  onStart: (cb: (cfg: CountdownConfig) => void) => {
    ipcRenderer.on('countdown:start', (_, cfg: CountdownConfig | number) => {
      // Back-compat: accept old bare-number messages.
      if (typeof cfg === 'number') cb({ seconds: cfg, style: 'numbers' });
      else cb(cfg);
    });
  },
  done: () => ipcRenderer.send('countdown:done')
});
