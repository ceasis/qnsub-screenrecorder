import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('idiotApi', {
  close: () => ipcRenderer.send('idiotboard:close'),
  resize: (dims: { width: number; height: number }) =>
    ipcRenderer.send('idiotboard:resize', dims)
});
