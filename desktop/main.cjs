// Super Serika Kart desktop app (Electron).
// Serves the bundled web build from app:// (offline single-player), plays online through the public relay
// (wss://kart.serika.dev/ws, see src/net/relay.js), and turns on the Chromium switches that make the game run
// much smoother than in a browser tab on laptops: the discrete GPU on hybrid-graphics machines, no GPU
// blocklist, and no background throttling.

const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ---- performance switches (must be set before the app is ready)
app.commandLine.appendSwitch('force_high_performance_gpu'); // dGPU on hybrid laptops (Windows / macOS)
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const ROOT = path.join(__dirname, 'app');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#1f8ff0',
    title: 'Super Serika Kart',
    icon: path.join(__dirname, 'app', 'icons', 'icon-512.png'),
    autoHideMenuBar: true,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  if (process.env.SSK_SMOKE) return smokeTest(win); // CI / packaging check: render hidden, screenshot, quit
  win.once('ready-to-show', () => win.show());
  // pass ?join=CODE through from a superserikakart:// deep link or the command line
  const join = process.argv.map((a) => /join=([A-Za-z0-9]{6})/.exec(a)?.[1]).find(Boolean);
  win.loadURL(`app://game/index.html${join ? `?join=${join}` : ''}`);
  // F11 / Alt+Enter fullscreen, F12 devtools, Ctrl+R reload
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (input.key === 'F12') win.webContents.toggleDevTools();
    else if (input.control && input.key.toLowerCase() === 'r') win.webContents.reload();
  });
  // external links (invite pages, credits) open in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
}

/** SSK_SMOKE=<png path>: load the game hidden, wait, save a screenshot + GPU info, quit. */
function smokeTest(w) {
  w.loadURL('app://game/index.html');
  setTimeout(async () => {
    try {
      const img = await w.webContents.capturePage();
      require('node:fs').writeFileSync(process.env.SSK_SMOKE, img.toPNG());
      const info = await w.webContents.executeJavaScript('({ fps: window.__ssk?.fps, screen: document.querySelector("#menu")?.dataset.screen, desktop: !!window.sskDesktop, gl: (() => { const c = document.querySelector("canvas"); const g = c && (c.getContext("webgl2") || c.getContext("webgl")); const d = g && g.getExtension("WEBGL_debug_renderer_info"); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : null; })() })');
      console.log('[smoke]', JSON.stringify({ ...info, gpu: app.getGPUFeatureStatus().webgl }));
    } catch (err) {
      console.log('[smoke] failed', err);
    }
    app.quit();
  }, Number(process.env.SSK_SMOKE_MS || 12000));
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(ROOT)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => app.quit());
