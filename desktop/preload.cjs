// Tells the game it runs inside the desktop app (window.sskDesktop) - e.g. to hide the PWA install button.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('sskDesktop', { platform: process.platform, version: process.versions.electron });
