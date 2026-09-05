'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/* window.ryzaShell — the web layer shows its frameless-window controls
   (pin / minimize / close) only when this exists. */
contextBridge.exposeInMainWorld('ryzaShell', {
  platform: 'electron',
  setTopmost: (on) => ipcRenderer.invoke('shell:set-topmost', !!on),
  isTopmost: () => ipcRenderer.invoke('shell:is-topmost'),
  minimize: () => ipcRenderer.send('shell:minimize'),
  close: () => ipcRenderer.send('shell:close'),
  setFullscreen: (on) => ipcRenderer.send('shell:fullscreen', !!on),
  quit: () => ipcRenderer.send('shell:quit'),
  saveVoice: (name, base64) => ipcRenderer.invoke('shell:save-voice', name, base64),
  saveWebStorage: (obj) => ipcRenderer.send('storage:save', obj),
  saveWebStorageSync: (obj) => ipcRenderer.sendSync('storage:save-sync', obj)
});

/* Narrow native Style-Bert-VITS2 capability. The renderer never receives an
   executable path or arbitrary filesystem access. */
contextBridge.exposeInMainWorld('ryzaNativeTts', {
  status: (voiceId) => ipcRenderer.invoke('native-tts:status', voiceId),
  install: (kind, voiceId) => ipcRenderer.invoke('native-tts:install', kind, voiceId),
  openModelFolder: () => ipcRenderer.invoke('native-tts:open-model-folder'),
  synthesize: (request) => ipcRenderer.invoke('native-tts:synthesize', request),
  reset: () => ipcRenderer.invoke('native-tts:reset')
});
