const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notedown', {
    platform: process.platform,
    versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
    },
    storage: {
        defaultPath: () => ipcRenderer.invoke('notedown:storage:default-path'),
        chooseDirectory: () => ipcRenderer.invoke('notedown:storage:choose-directory'),
        info: (payload) => ipcRenderer.invoke('notedown:storage:info', payload),
        initialize: (payload) => ipcRenderer.invoke('notedown:storage:initialize', payload),
        loadNotes: (payload) => ipcRenderer.invoke('notedown:storage:load-notes', payload),
        saveNotes: (payload) => ipcRenderer.invoke('notedown:storage:save-notes', payload)
    },
    pdf: {
        saveNote: (payload) => ipcRenderer.invoke('notedown:pdf:save-note', payload)
    }
});
