'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('MapCinemaChina', {
  choose: kind => ipcRenderer.invoke('china:choose', kind),
  run: options => ipcRenderer.invoke('china:run', options),
  cancel: () => ipcRenderer.invoke('china:cancel'),
  reveal: () => ipcRenderer.invoke('china:reveal'),
  deployAudio: () => ipcRenderer.invoke('china:deploy-audio'),
  removeAudio: () => ipcRenderer.invoke('china:remove-audio'),
  deployWorld: () => ipcRenderer.invoke('china:deploy-world'),
  revealWorld: () => ipcRenderer.invoke('china:reveal-world'),
  revealBackup: () => ipcRenderer.invoke('china:reveal-backup'),
  onProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('china:progress', listener);
    return () => ipcRenderer.removeListener('china:progress', listener);
  },
});
