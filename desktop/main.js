/* Ryza Chat — frameless desktop shell (Electron).
 *
 * Serves web/ over a private 127.0.0.1 HTTP port (Spine/fetch cannot use
 * file://) and exposes POST /_proxy?u=... for CORS-free LLM/TTS calls, the
 * same contract as scripts/serve.py. The window has no title bar or borders
 * (frame:false) so the phone column reads as one object; always-on-top is
 * toggled from the app's own control strip (preload: window.ryzaShell).
 *
 * Privacy: nothing personal is bundled. providers.json is NOT shipped; the
 * user fills keys in Settings (localStorage under userData, survives
 * uninstall unless the user deletes it). */
'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT_PREFERENCE = 8765;

/* web/ lives in resources/web when packaged, ../web in a dev checkout. */
function webRoot() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'web')]
    : [path.join(__dirname, '..', 'web'), path.join(app.getAppPath(), '..', 'web')];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  throw new Error('web/index.html not found');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.webp': 'image/webp',
  '.atlas': 'text/plain; charset=utf-8', '.skel': 'application/octet-stream',
  '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.woff': 'font/woff', '.woff2': 'font/woff2'
};

function serveStatic(root, req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
  catch (e) { res.writeHead(400); res.end('bad url'); return; }
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' || ext === '.json' ? 'no-store' : 'public, max-age=3600'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

/* GET /_proxy?u=https://... — forwards a GET (Qwen TTS audio URLs). */
function handleProxyGet(rawUrl, res) {
  let target = '';
  try { target = new URL(rawUrl, 'http://127.0.0.1').searchParams.get('u') || ''; } catch (e) {}
  if (!target.startsWith('https://')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'proxy target must be https' } }));
    return;
  }
  https.get(target, (up) => {
    const out = [];
    up.on('data', (c) => out.push(c));
    up.on('end', () => {
      const buf = Buffer.concat(out);
      res.writeHead(up.statusCode || 502, {
        'Content-Type': up.headers['content-type'] || 'application/octet-stream',
        'Content-Length': buf.length
      });
      res.end(buf);
    });
  }).on('error', (e) => {
    const msg = Buffer.from(JSON.stringify({ error: { message: String(e && e.message || e) } }));
    res.writeHead(502, { 'Content-Type': 'application/json', 'Content-Length': msg.length });
    res.end(msg);
  });
}

/* POST /_proxy?u=https://... — body + auth headers forwarded verbatim. */
function handleProxy(req, res) {
  let target;
  try {
    target = new URL(req.url, 'http://127.0.0.1').searchParams.get('u') || '';
  } catch (e) { target = ''; }
  if (!target.startsWith('https://')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'proxy target must be https' } }));
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const up = new URL(target);
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'Content-Length': body.length
    };
    if (req.headers['authorization']) headers.Authorization = req.headers.authorization;
    if (req.headers['api-key']) headers['api-key'] = req.headers['api-key'];
    const upReq = https.request({
      method: 'POST', hostname: up.hostname, port: up.port || 443,
      path: up.pathname + up.search, headers, timeout: 180000
    }, (upRes) => {
      const out = [];
      upRes.on('data', (c) => out.push(c));
      upRes.on('end', () => {
        const buf = Buffer.concat(out);
        res.writeHead(upRes.statusCode || 502, {
          'Content-Type': upRes.headers['content-type'] || 'application/json',
          'Content-Length': buf.length
        });
        res.end(buf);
      });
    });
    upReq.on('error', (e) => {
      const msg = Buffer.from(JSON.stringify({ error: { message: String(e && e.message || e) } }));
      res.writeHead(502, { 'Content-Type': 'application/json', 'Content-Length': msg.length });
      res.end(msg);
    });
    upReq.on('timeout', () => upReq.destroy(new Error('upstream timeout')));
    upReq.end(body);
  });
}

function startServer(root) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, api-key');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
        res.writeHead(204); res.end(); return;
      }
      if (req.method === 'POST' && req.url.startsWith('/_proxy')) { handleProxy(req, res); return; }
      if (req.method === 'GET' && req.url.startsWith('/_proxy')) { handleProxyGet(req.url, res); return; }
      if (req.method === 'GET' || req.method === 'HEAD') { serveStatic(root, req, res); return; }
      res.writeHead(405); res.end();
    });
    let settled = false;
    server.once('listening', () => { settled = true; resolve(server); });
    server.on('error', () => {
      if (settled) return;
      /* preferred port busy — ephemeral fallback, once */
      settled = true;
      server.removeAllListeners('error');
      server.once('error', reject);
      server.once('listening', () => resolve(server));
      server.listen(0, '127.0.0.1');
    });
    server.listen(PORT_PREFERENCE, '127.0.0.1');
  });
}

let win = null;
let topmost = false;

function createWindow(url) {
  win = new BrowserWindow({
    width: 420,
    height: 860,
    minWidth: 340,
    minHeight: 560,
    frame: false,                 /* no title bar, no borders (桌宠美感) */
    transparent: false,
    backgroundColor: '#07050a',
    resizable: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadURL(url);
  /* Dev self-check: RYZA_SHOT=path captures the window and exits. */
  if (process.env.RYZA_SHOT) {
    const out = process.env.RYZA_SHOT;
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(out, img.toPNG());
          console.log('captured ' + out);
        } catch (e) { console.error('capture failed: ' + e.message); }
        app.quit();
      }, 9000);
    });
  }
  /* External links leave the shell; app links stay inside. */
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/i.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

/* ------------------------------- IPC (window chrome controls) --------- */
ipcMain.handle('shell:set-topmost', (_e, on) => {
  topmost = !!on;
  if (win) {
    win.setAlwaysOnTop(topmost, 'screen-saver');
    win.setFullScreenable(!topmost);
  }
  return topmost;
});
ipcMain.handle('shell:is-topmost', () => topmost);
ipcMain.on('shell:minimize', () => { if (win) win.minimize(); });
ipcMain.on('shell:close', () => { if (win) win.close(); });
ipcMain.on('shell:fullscreen', (e, on) => {
  if (win) win.setFullScreen(!!on);
});
ipcMain.on('shell:quit', () => app.quit());

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    try {
      const root = webRoot();
      const server = await startServer(root);
      const port = server.address().port;
      createWindow('http://127.0.0.1:' + port + '/');
      app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow('http://127.0.0.1:' + port + '/'); });
    } catch (e) {
      const { dialog } = require('electron');
      dialog.showErrorBox('Ryza Chat', '启动失败：' + (e && e.message || e));
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
}
