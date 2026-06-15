const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notedown', {
    platform: process.platform,
    versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
    },
    app: {
        preferences: () => ipcRenderer.invoke('notedown:app:preferences'),
        setPreferences: (payload) => ipcRenderer.invoke('notedown:app:set-preferences', payload),
        showWindow: () => ipcRenderer.invoke('notedown:app:show-window')
    },
    storage: {
        defaultPath: () => ipcRenderer.invoke('notedown:storage:default-path'),
        chooseDirectory: () => ipcRenderer.invoke('notedown:storage:choose-directory'),
        info: (payload) => ipcRenderer.invoke('notedown:storage:info', payload),
        initialize: (payload) => ipcRenderer.invoke('notedown:storage:initialize', payload),
        loadNotes: (payload) => ipcRenderer.invoke('notedown:storage:load-notes', payload),
        saveNotes: (payload) => ipcRenderer.invoke('notedown:storage:save-notes', payload),
        saveAttachment: (payload) => ipcRenderer.invoke('notedown:storage:save-attachment', payload),
        chooseAttachments: (payload) => ipcRenderer.invoke('notedown:storage:choose-attachments', payload),
        openAttachment: (payload) => ipcRenderer.invoke('notedown:storage:open-attachment', payload)
    },
    sync: {
        health: (payload) => ipcRenderer.invoke('notedown:sync:health', payload),
        setupStatus: (payload) => ipcRenderer.invoke('notedown:sync:setup-status', payload),
        setup: (payload) => ipcRenderer.invoke('notedown:sync:setup', payload),
        login: (payload) => ipcRenderer.invoke('notedown:sync:login', payload),
        plan: (payload) => ipcRenderer.invoke('notedown:sync:plan', payload),
        runFull: (payload) => ipcRenderer.invoke('notedown:sync:run-full', payload),
        uploadNote: (payload) => ipcRenderer.invoke('notedown:sync:upload-note', payload),
        readFile: (payload) => ipcRenderer.invoke('notedown:sync:read-file', payload),
        resolveConflict: (payload) => ipcRenderer.invoke('notedown:sync:resolve-conflict', payload)
    },
    pdf: {
        saveNote: (payload) => ipcRenderer.invoke('notedown:pdf:save-note', payload)
    }
});
