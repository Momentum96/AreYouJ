const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),

    getTasks: () => ipcRenderer.invoke('get-tasks'),

    // App info
    getVersion: () => ipcRenderer.invoke('app-version'),

    // Tray controls
    showInTray: () => ipcRenderer.invoke('show-in-tray'),
    hideFromTray: () => ipcRenderer.invoke('hide-from-tray'),

    // System info
    platform: process.platform,

    // Development helpers
    isDev: process.env.NODE_ENV === 'development',

    // Event listeners
    onWindowEvent: (event, callback) => {
        ipcRenderer.on(event, callback)
    },

    removeAllListeners: (event) => {
        ipcRenderer.removeAllListeners(event)
    }
})

// DOM Content Loaded event for initial setup
document.addEventListener('DOMContentLoaded', () => {
    // Add platform-specific classes to body
    document.body.classList.add(`platform-${process.platform}`)

    // Add development mode class
    if (process.env.NODE_ENV === 'development') {
        document.body.classList.add('development')
    }
}) 