// Desktop shell: starts the unchanged local server inside the app and shows it in a window.
import {app, BrowserWindow, shell, dialog, clipboard, ClipboardItem, ipcMain} from 'electron';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join, delimiter, dirname} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';

const PREFERRED_PORT = 4321;
// Only these destinations may leave the app, and only into the system browser.
const EXTERNAL = [/^https:\/\/auth\.openai\.com\//, /^https:\/\/chatgpt\.com\/settings\/usage$/, /^https:\/\/claude\.ai\/settings\/usage$/];
const isExternal = url => EXTERNAL.some(pattern => pattern.test(url));
const MAX_CLIPBOARD = 4_000_000;

// Apps started from Finder get a minimal PATH, so the user's own `claude` CLI would not be found.
function userPath() {
  const parts = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  const shellPath = process.env.SHELL || '/bin/zsh';
  try {
    const result = spawnSync(shellPath, ['-ilc', 'printf %s "$PATH"'], {encoding: 'utf8', timeout: 5000});
    if (result.status === 0 && result.stdout) parts.push(...result.stdout.trim().split(delimiter));
  } catch {}
  parts.push(...(process.env.PATH || '').split(delimiter));
  return [...new Set(parts.filter(Boolean))].join(delimiter);
}

async function listen(server) {
  for (const port of [PREFERRED_PORT, 0]) {
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      return server.address().port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('Kein freier lokaler Port.');
}

function createWindow(origin) {
  const win = new BrowserWindow({
    width: 1040, height: 820, minWidth: 360, minHeight: 520,
    title: 'Transcrilator', backgroundColor: '#ffffff', show: false,
    webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: true, preload: join(dirname(fileURLToPath(import.meta.url)), 'preload.cjs')}
  });
  win.on('page-title-updated', event => event.preventDefault());
  win.once('ready-to-show', () => win.show());
  // The main window never navigates away from the local app.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin + '/')) { event.preventDefault(); if (isExternal(url)) shell.openExternal(url); }
  });
  win.webContents.setWindowOpenHandler(({url}) => {
    if (url === 'about:blank') return {action: 'allow', overrideBrowserWindowOptions: {show: false}};
    if (isExternal(url)) shell.openExternal(url);
    return {action: 'deny'};
  });
  // The ChatGPT sign-in opens a blank popup and then points it at OpenAI. That sign-in belongs in the
  // system browser; the callback reaches the local server there, and refocusing the app refreshes the status.
  win.webContents.on('did-create-window', child => {
    const hand = (event, url) => {
      event.preventDefault();
      if (isExternal(url)) shell.openExternal(url);
      child.close();
    };
    child.webContents.on('will-navigate', hand);
    child.webContents.on('will-redirect', hand);
  });
  win.loadURL(origin + '/');
  return win;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  let mainWindow = null, origin = '';
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    try {
      process.env.PATH = userPath();
      // Import after PATH is set: the Claude adapter captures the environment when it is created.
      const {createApp} = await import('../src/server.js');
      const runtime = pathToFileURL(join(app.getPath('userData'), 'runtime') + '/');
      const server = await createApp({runtime});
      origin = `http://127.0.0.1:${await listen(server)}`;
      // The native clipboard works even when the window lost focus during a long translation.
      ipcMain.handle('transcrilator:copy', async (event, {text, html} = {}) => {
        if (!event.senderFrame?.url.startsWith(origin + '/')) throw new Error('Nicht erlaubt.');
        if (typeof text !== 'string' || typeof html !== 'string' || text.length + html.length > MAX_CLIPBOARD) throw new Error('Ungültiger Inhalt.');
        // Electron 44+: asynchronous, W3C-style clipboard items carrying plain text and formatting.
        await clipboard.write([new ClipboardItem({'text/plain': text, 'text/html': html})]);
        return true;
      });
      app.on('before-quit', () => { server.closeAllConnections(); server.close(); });
      mainWindow = createWindow(origin);
      app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) mainWindow = createWindow(origin); });
    } catch (error) {
      dialog.showErrorBox('Transcrilator konnte nicht starten', error.message);
      app.quit();
    }
  });
}
