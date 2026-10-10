// Offshore Studio — desktop shell (Electron main process).
//
// The app is the same static web app that runs in a browser. It is served from
// a private, privileged scheme (app://local/…) rather than file://, so ES
// modules, module workers and WebAssembly behave exactly as over https.
//
// Hardening: pages get no Node.js access (context isolation + sandbox), only
// files inside the app's own folders can be served, every page gets a
// Content-Security-Policy, navigation is confined to the app (http/https links
// open in the system browser), permission requests (camera, location, …) are
// refused, and new windows are never created by page content.

const { app, BrowserWindow, Menu, dialog, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const SCHEME = 'app';
const HOST = 'local';
const ORIGIN = `${SCHEME}://${HOST}`;
const ROOT = path.resolve(__dirname, '..');
const HOME = `${ORIGIN}/home.html`;
const PAGES = {
  home: HOME,
  calculator: `${ORIGIN}/index.html`,
  studio: `${ORIGIN}/studio/dist/index.html`,
  array: `${ORIGIN}/standalone.html`,
};

// Only these files and folders are served (the rest of the package is not web content).
const SERVED_FILES = new Set(['/home.html', '/index.html', '/standalone.html']);
const SERVED_DIRS = ['/css/', '/js/', '/vendor/', '/studio/dist/'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// Inline scripts are used by the calculator (theme before first paint) and by the
// self-contained array study; WebAssembly by the Rhino reader.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Without a usable GPU (virtual machines, remote desktops, blocklisted drivers)
// Chromium no longer falls back to software WebGL by default, and the 3-D views
// would be unavailable. The app only ever renders its own local content, so the
// software fallback is safe to allow here; js/framePacer.js keeps it from
// making the window sluggish.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
}]);

// rhino3dm's Emscripten bindings (embind) build functions with `new Function`.
// They run only in the .3dm import worker, which therefore gets 'unsafe-eval';
// the code it generates comes from the library, never from file contents, and
// every page and every other worker keeps the strict policy above.
const CAD_WORKER = /^\/studio\/dist\/assets\/cad\.worker-[\w-]+\.js$/;
const CSP_CAD_WORKER = CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'");

function isServed(pathname) {
  return SERVED_FILES.has(pathname) || SERVED_DIRS.some((d) => pathname.startsWith(d));
}

async function serve(request) {
  const url = new URL(request.url);
  if (url.host !== HOST) return new Response('Not found', { status: 404 });
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (pathname === '/' || pathname === '') pathname = '/home.html';
  const file = path.resolve(ROOT, `.${pathname}`);
  if (!file.startsWith(ROOT + path.sep) || !isServed(pathname)) return new Response('Not found', { status: 404 });
  try {
    const body = await fs.readFile(file);
    return new Response(body, {
      headers: {
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-security-policy': CAD_WORKER.test(pathname) ? CSP_CAD_WORKER : CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-cache',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

const isAppUrl = (u) => typeof u === 'string' && u.startsWith(`${ORIGIN}/`);
const isWebUrl = (u) => /^https?:\/\//i.test(u);

function openExternally(url) {
  if (isWebUrl(url)) shell.openExternal(url);
}

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Offshore Studio',
    backgroundColor: '#0b1118',
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Page content can never open new windows; web links go to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) win.loadURL(url);
    else openExternally(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternally(url);
  });

  // A page with unsaved work (the studio) asks before it is left or closed.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved changes',
      message: 'This project has unsaved changes.',
      detail: 'Leave anyway? Use Save in the studio to keep your work.',
    });
    if (choice === 0) event.preventDefault(); // ignore the page's beforeunload: leave
  });

  win.loadURL(HOME);
  return win;
}

function go(page) {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  win?.loadURL(PAGES[page]);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+0', click: () => go('home') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Go',
      submenu: [
        { label: '3-D Studio', accelerator: 'CmdOrCtrl+1', click: () => go('studio') },
        { label: 'Load calculator', accelerator: 'CmdOrCtrl+2', click: () => go('calculator') },
        { label: 'Array study', accelerator: 'CmdOrCtrl+3', click: () => go('array') },
        { type: 'separator' },
        { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => { const wc = BrowserWindow.getFocusedWindow()?.webContents; if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); } },
        { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => { const wc = BrowserWindow.getFocusedWindow()?.webContents; if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); } },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal('https://github.com/VENTIXG/first-app#readme') },
        { label: 'Developer tools', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools() },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'about' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One instance: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  // Defence in depth for any web contents (no <webview>, no permission grants).
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: 'Offshore Studio',
      applicationVersion: app.getVersion(),
      copyright: 'Verified against analytical benchmarks; not validated against measurements.',
      website: 'https://github.com/VENTIXG/first-app',
    });
    protocol.handle(SCHEME, serve);
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    // nothing in the app needs the network; refuse anything that is not the app itself
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const ok = details.url.startsWith(`${ORIGIN}/`) || details.url.startsWith('devtools://')
        || details.url.startsWith('data:') || details.url.startsWith('blob:');
      callback({ cancel: !ok });
    });
    buildMenu();
    mainWindow = createWindow();
    mainWindow.on('closed', () => { mainWindow = null; });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
        mainWindow.on('closed', () => { mainWindow = null; });
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = { serve, isServed, CSP, ORIGIN };
