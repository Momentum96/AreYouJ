// Electron API types for renderer process
interface ElectronAPI {
  // Window controls
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  
  // App info
  getVersion: () => Promise<string>
  
  // Tray controls
  showInTray: () => Promise<void>
  hideFromTray: () => Promise<void>
  
  // System info
  platform: string
  
  // Development helpers
  isDev: boolean
  
  // Event listeners
  onWindowEvent: (event: string, callback: (...args: unknown[]) => void) => void
  removeAllListeners: (event: string) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export { }

