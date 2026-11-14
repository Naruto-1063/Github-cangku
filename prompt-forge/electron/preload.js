'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

contextBridge.exposeInMainWorld('api', {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  chooseDataDir: () => ipcRenderer.invoke('app:choose-data-dir'),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  setHotkey: (slot, accelerator) =>
    ipcRenderer.invoke('hotkey:set', { slot, accelerator }),

  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),

  listProviders: () => ipcRenderer.invoke('providers:list'),
  listTemplates: () => ipcRenderer.invoke('templates:list'),
  listModels: (providerId) => ipcRenderer.invoke('models:list', { providerId }),

  setKey: (providerId, key) => ipcRenderer.invoke('key:set', { providerId, key }),
  clearKey: (providerId) => ipcRenderer.invoke('key:clear', { providerId }),
  testKey: (providerId) => ipcRenderer.invoke('key:test', { providerId }),

  enhance: (payload) => ipcRenderer.invoke('enhance:start', payload),
  cancelEnhance: (requestId) => ipcRenderer.invoke('enhance:cancel', requestId),

  onChunk: (cb) => subscribe('enhance:chunk', cb),
  onDone: (cb) => subscribe('enhance:done', cb),
  onError: (cb) => subscribe('enhance:error', cb),
  onPrefill: (cb) => subscribe('shortcut:prefill', cb),

  history: {
    list: () => ipcRenderer.invoke('history:list'),
    remove: (id) => ipcRenderer.invoke('history:remove', id),
    clear: () => ipcRenderer.invoke('history:clear')
  },

  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
    write: (text) => ipcRenderer.invoke('clipboard:write', text)
  },

  openExternal: (url) => ipcRenderer.invoke('shell:open', url)
})
