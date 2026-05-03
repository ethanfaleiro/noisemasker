// preload.js — Context Bridge (renderer ↔ main process)
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Platform string so renderer can adjust UI (e.g., button placement)
  platform: process.platform,

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  close:    () => ipcRenderer.send('window:close'),
});
