// main.js — Electron Main Process
'use strict';

const {
  app, BrowserWindow, ipcMain,
  Menu, Tray, nativeImage,
} = require('electron');
const path = require('path');

// ─── Single Instance Lock ──────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let mainWindow = null;
let tray       = null;

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:           400,
    height:          650,
    minWidth:        400,
    minHeight:       650,
    maxWidth:        400,
    maxHeight:       650,
    resizable:       false,
    frame:           false,      // Custom title bar
    transparent:     false,
    backgroundColor: '#0d1b2a',
    show:            false,
    webPreferences: {
      nodeIntegration:   false,
      contextIsolation:  true,
      sandbox:           false,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show only when ready — avoids white flash
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Hide instead of quit when closed
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // DevTools in dev mode only
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  let icon;
  try {
    icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
    if (icon.isEmpty()) throw new Error();
  } catch {
    // Fallback: tiny 1×1 transparent image so app doesn't crash without icon file
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    );
  }

  tray = new Tray(icon);
  tray.setToolTip('Noise Masker');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide',
      click: () => toggleWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.isQuitting = true; app.quit(); },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => toggleWindow());
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ─── IPC — Window Controls (called from renderer via preload) ─────────────────
ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:close',    () => mainWindow && mainWindow.hide());

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // Remove default menu bar
  createWindow();
  createTray();

  app.on('activate', () => {
    // macOS: clicking dock icon shows window
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
});

// Keep running when last window is closed (background app)
app.on('window-all-closed', () => { /* intentionally empty */ });

app.on('before-quit', () => { app.isQuitting = true; });

// Focus existing window on second launch
app.on('second-instance', () => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});
