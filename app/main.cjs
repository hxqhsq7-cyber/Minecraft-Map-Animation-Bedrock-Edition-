'use strict';
const { app, BrowserWindow, Menu, dialog, session, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');

const base = app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
const temporaryRoots = [require('node:os').tmpdir(), process.env.TEMP, process.env.TMP].filter(root => root && path.isAbsolute(root));
if (app.isPackaged && !process.env.MAPCINEMA_DATA_DIR && temporaryRoots.some(root => {
  const relative = path.relative(path.resolve(root), base);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
})) {
  dialog.showErrorBox('请先完整解压方映', '当前程序从临时解压目录运行，音轨会随临时文件清理而失效。\n\n请将整个文件夹完整解压到 F 盘或 D 盘的固定目录，再运行“方映.exe”；不要直接在 ZIP 中双击运行。\n\n当前目录：' + base);
  app.exit(1);
}
const data = path.resolve(process.env.MAPCINEMA_DATA_DIR || path.join(base, 'Data'));
for (const name of ['Profile', 'Cache', 'Temp', 'Logs', 'Crashes']) fs.mkdirSync(path.join(data, name), { recursive: true });
app.setName('方映');
app.setPath('userData', path.join(data, 'Profile'));
app.setPath('sessionData', path.join(data, 'Cache'));
app.setPath('temp', path.join(data, 'Temp'));
app.setPath('crashDumps', path.join(data, 'Crashes'));
app.setAppLogsPath(path.join(data, 'Logs'));
process.env.TEMP = process.env.TMP = path.join(data, 'Temp');
app.setAppUserModelId('dev.mapcinema.desktop');

async function start({ show = true } = {}) {
  if (!app.requestSingleInstanceLock()) { app.quit(); return null; }
  await app.whenReady();
  const html = Buffer.from(fs.readFileSync(path.join(__dirname, 'MapCinema.html'), 'utf8')
    .replace('</body>', '<script src="china-ui.js"></script></body>'));
  const hashes = [...html.toString('utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => "'sha256-" + createHash('sha256').update(match[1].replace(/\r\n/g, '\n')).digest('base64') + "'");
  const csp = "default-src 'self'; script-src 'self' " + hashes.join(' ') +
    " 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob: data:;" +
    " connect-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
  let origin;
  const server = http.createServer((request, response) => {
    if (request.headers.host !== new URL(origin).host || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(403).end(); return;
    }
    const pathname = new URL(request.url, origin).pathname;
    if (['/media-bundle.js', '/reverse.js', '/china-ui.js'].includes(pathname)) {
      const script = fs.readFileSync(path.join(__dirname, pathname.slice(1)));
      response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Content-Length': script.length,
        'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : script); return;
    }
    if (!['/', '/MapCinema.html', '/favicon.ico'].includes(pathname)) { response.writeHead(404).end(); return; }
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length,
      'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + server.address().port;
  const local = url => { try { return new URL(url).origin === origin; } catch { return false; } };
  const ses = session.defaultSession;
  await ses.setProxy({ mode: 'direct' });
  const allowed = new Set(['fileSystem', 'clipboard-sanitized-write', 'fullscreen', 'wakeLockScreen']);
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin) => local(requestingOrigin) && allowed.has(permission));
  ses.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(local(details.requestingUrl || contents.getURL()) && allowed.has(permission)));
  ses.webRequest.onBeforeRequest((details, callback) => callback({
    cancel: !(local(details.url) || details.url.startsWith('blob:' + origin + '/') || details.url.startsWith('data:'))
  }));
  const win = new BrowserWindow({ width: 1280, height: 900, minWidth: 860, minHeight: 600,
    show: false, title: '方映 · 电脑版 v20.6 · 中国版存档替换', icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#f4f5ef', webPreferences: { nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, backgroundThrottling: false, spellcheck: false,
      preload: path.join(__dirname, 'china-preload.cjs') } });
  const china = require('./china-desktop.cjs').attach({ ipcMain, dialog, shell, win, data, local });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '退出', role: 'quit' }] },
    { label: '编辑', submenu: [{ label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
      { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }] },
    { label: '查看', submenu: [{ label: '实际大小', role: 'resetZoom' }, { label: '放大', role: 'zoomIn' },
      { label: '缩小', role: 'zoomOut' }, { type: 'separator' }, { label: '全屏', role: 'togglefullscreen' }] }
  ]));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!local(url)) event.preventDefault(); });
  win.webContents.on('page-title-updated', event => event.preventDefault());
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.show(); win.focus(); });
  let closing = false;
  win.on('close', async event => {
    if (closing) return;
    event.preventDefault();
    const busy = await win.webContents.executeJavaScript(
      "Boolean(document.getElementById('convert')?.disabled && document.getElementById('merge-button')?.disabled)"
    ).catch(() => false);
    if (busy || china.isBusy()) {
      const result = await dialog.showMessageBox(win, { type: 'warning', title: '正在处理',
        message: '退出会中断处理，可能留下未完成的输出文件。', buttons: ['继续处理', '停止并退出'], defaultId: 0, cancelId: 0 });
      if (result.response === 0) return;
    }
    closing = true; win.close();
  });
  app.once('will-quit', () => { china.dispose(); server.close(); });
  app.on('window-all-closed', () => app.quit());
  await win.loadURL(origin + '/MapCinema.html');
  if (show) win.show();
  return { win, server, origin, data };
}

module.exports = { start };
if (require.main === module) start({ show: !process.argv.includes('--smoke-test') }).catch(error => {
  dialog.showErrorBox('方映启动失败', error.message); app.exit(1);
});
