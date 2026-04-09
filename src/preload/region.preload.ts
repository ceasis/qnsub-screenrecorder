import { contextBridge, ipcRenderer } from 'electron';
import type { RegionResult, ScreenSource } from '../shared/types';

// Parse --display-id=NNN that main process passes in.
const displayIdArg = process.argv.find((a) => a.startsWith('--display-id='));
const displayId = displayIdArg ? displayIdArg.split('=')[1] : '';

contextBridge.exposeInMainWorld('regionApi', {
  displayId,
  submit: (r: Omit<RegionResult, 'displayId'>) =>
    ipcRenderer.send('region:result', { ...r, displayId }),
  cancel: () => ipcRenderer.send('region:cancel')
});

contextBridge.exposeInMainWorld('api', {
  listSources: (): Promise<ScreenSource[]> => ipcRenderer.invoke('sources:list')
});
