const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

// Keep a global reference of the window object
let mainWindow = null
let tray = null
let isQuiting = false

// Check if we're in development mode
const isDev = process.env.NODE_ENV === 'development'

// IPC Handlers
function setupIPC() {
    // Window controls
    ipcMain.handle('window-minimize', () => {
        if (mainWindow) {
            mainWindow.minimize()
        }
    })

    ipcMain.handle('window-maximize', () => {
        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize()
            } else {
                mainWindow.maximize()
            }
        }
    })

    ipcMain.handle('window-close', () => {
        if (mainWindow) {
            mainWindow.close()
        }
    })

    // App info
    ipcMain.handle('app-version', () => {
        return app.getVersion()
    })

    // Read tasks.json
    ipcMain.handle('get-tasks', async () => {
        // Both Development and Production: 'docs/tasks.json'
        const tasksPath = path.join(app.getAppPath(), 'docs/tasks.json')

        try {
            const data = await fs.promises.readFile(tasksPath, 'utf-8')
            return JSON.parse(data)
        } catch (error) {
            console.error('Failed to read tasks.json', error)
            return null
        }
    })

    // Tray controls
    ipcMain.handle('show-in-tray', () => {
        if (mainWindow) {
            mainWindow.hide()
        }
    })

    ipcMain.handle('hide-from-tray', () => {
        if (mainWindow) {
            mainWindow.show()
            mainWindow.focus()
        }
    })
}

function createWindow() {
    // Get the display bounds
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.workAreaSize

    // Create the browser window
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        x: Math.floor((width - 1200) / 2),
        y: Math.floor((height - 800) / 2),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.cjs')
        },
        show: false, // Don't show initially
        frame: true, // Keep frame for now, can be customized later
        autoHideMenuBar: true, // Hide menu bar
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
    })

    // Remove menu bar completely
    mainWindow.setMenuBarVisibility(false)

    // Load the app
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173')
        // Open DevTools in development
        mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    }

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show()

        // Focus the window
        if (process.platform === 'darwin') {
            app.dock.show()
        }
    })

    // Handle window closed
    mainWindow.on('closed', () => {
        mainWindow = null
    })

    // Handle minimize to tray
    mainWindow.on('minimize', (event) => {
        if (process.platform !== 'darwin') {
            event.preventDefault()
            mainWindow.hide()
        }
    })

    // Handle close to tray
    mainWindow.on('close', (event) => {
        if (!isQuiting) {
            event.preventDefault()
            mainWindow.hide()

            // Show notification on first minimize
            if (process.platform === 'win32') {
                tray.displayBalloon({
                    iconType: 'info',
                    title: 'AI Project Dashboard',
                    content: 'Application was minimized to tray'
                })
            }
        }
        return false
    })
}

function createTray() {
    // 기본 아이콘 사용 (빈 아이콘)
    tray = new Tray(nativeImage.createEmpty())

    // 툴크과 메뉴는 그대로
    tray.setToolTip('Dashboard')

    // Create context menu
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show Dashboard',
            click: () => {
                if (mainWindow) {
                    if (mainWindow.isMinimized()) {
                        mainWindow.restore()
                    }
                    mainWindow.show()
                    mainWindow.focus()
                } else {
                    createWindow()
                }
            }
        },
        {
            label: 'Hide Dashboard',
            click: () => {
                if (mainWindow) {
                    mainWindow.hide()
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Reload',
            click: () => {
                if (mainWindow) {
                    mainWindow.reload()
                }
            }
        },
        {
            label: 'Toggle DevTools',
            click: () => {
                if (mainWindow) {
                    mainWindow.webContents.toggleDevTools()
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuiting = true
                app.quit()
            }
        }
    ])

    tray.setContextMenu(contextMenu)

    // Handle tray click
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide()
            } else {
                if (mainWindow.isMinimized()) {
                    mainWindow.restore()
                }
                mainWindow.show()
                mainWindow.focus()
            }
        } else {
            createWindow()
        }
    })

    // Handle double click on tray (Windows/Linux)
    tray.on('double-click', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore()
            }
            mainWindow.show()
            mainWindow.focus()
        } else {
            createWindow()
        }
    })
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
    setupIPC() // Setup IPC handlers
    createWindow()
    createTray()

    // macOS specific: Show dock icon when window is shown
    if (process.platform === 'darwin') {
        app.dock.show()
    }
})

// Quit when all windows are closed
app.on('window-all-closed', () => {
    // On macOS, keep the app running even when all windows are closed
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS, re-create a window when the dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

// Handle app quitting
app.on('before-quit', () => {
    isQuiting = true
})

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
    contents.on('new-window', (event, navigationUrl) => {
        event.preventDefault()
    })
})

// Prevent navigation to external URLs
app.on('web-contents-created', (event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
        const parsedUrl = new URL(navigationUrl)

        if (parsedUrl.origin !== 'http://localhost:5173' && !navigationUrl.startsWith('file://')) {
            event.preventDefault()
        }
    })
}) 