'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'tests/output/reverse-encoded', String(Date.now())); fs.mkdirSync(output, { recursive: true });
const profile = path.join(root, 'tests/runs/reverse-' + Date.now());
const env = { ...process.env, MAPCINEMA_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
const exe = process.env.MAPCINEMA_TEST_EXE || path.join(root, 'release/方映-电脑版-v20.6/方映.exe');
const log = fs.openSync(path.join(root, 'logs/reverse-exe.log'), 'w');
const child = spawn(exe, ['--smoke-test', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], { env, windowsHide: true, stdio: ['ignore', log, log] });
let socket, sequence = 0; const pending = new Map(), pause = ms => new Promise(r => setTimeout(r, ms));
function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout ' + method)); }, 180000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); }
async function main() {
  const end = Date.now() + 45000, portFile = path.join(profile, 'Cache/DevToolsActivePort');
  while (!fs.existsSync(portFile)) { assert.equal(child.exitCode, null, 'EXE exited'); assert.ok(Date.now() < end, 'EXE did not start'); await pause(50); }
  const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]; let page;
  while (!page) { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page' && p.url.includes('MapCinema')); if (!page) await pause(50); }
  socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
  socket.onmessage = e => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output });
  for (;;) { const r = await call('Runtime.evaluate', { expression: 'document.readyState === "complete" && typeof MapCinemaReverse === "object"', returnByValue: true }); if (r.result.value) break; assert.ok(Date.now() < end); await pause(50); }
  const names = ['source.mcvideo', 'source.mcworld', 'compacted.mcworld'];
  if (fs.existsSync(path.join(root, 'tests/output/reverse/engine-compacted.mcworld'))) names.push('engine-compacted.mcworld');
  const fixtures = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(root, 'tests/output/reverse', name)).toString('base64')]));
  const code = fs.readFileSync(path.join(__dirname, 'reverse-browser.js'), 'utf8');
  const result = await call('Runtime.evaluate', { expression: code + '(' + JSON.stringify(fixtures) + ')', awaitPromise: true, returnByValue: true, userGesture: true });
  assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description || JSON.stringify(result.exceptionDetails));
  fs.writeFileSync(path.join(root, 'logs/reverse-smoke-results.json'), JSON.stringify({ executable: exe, outputDirectory: output, ...result.result.value }, null, 2));
  console.log('PASS:', JSON.stringify(result.result.value));
  const exited = new Promise(r => child.once('exit', r)); socket.send(JSON.stringify({ id: ++sequence, method: 'Browser.close' })); await exited;
}
main().then(() => socket?.close()).catch(e => { console.error(e); socket?.close(); child.kill(); process.exitCode = 1; });
