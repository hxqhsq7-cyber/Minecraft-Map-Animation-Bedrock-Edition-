'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const run = String(Date.now());
const output = path.join(__dirname, 'output', run);
fs.mkdirSync(output, { recursive: true });
const profile = path.join(__dirname, 'runs', run);
const env = { ...process.env, MAPCINEMA_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const exe = path.join(root, 'release', '方映-电脑版-v18', '方映.exe');
const log = fs.openSync(path.join(root, 'logs', 'exe-smoke.log'), 'w');
const child = spawn(exe, ['--smoke-test', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
  { env, windowsHide: true, stdio: ['ignore', log, log] });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
const pending = new Map();
let sequence = 0;
function call(method, params = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, timeoutMs);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function main() {
  const active = path.join(profile, 'Cache', 'DevToolsActivePort');
  const deadline = Date.now() + 45000;
  while (!fs.existsSync(active)) {
    if (child.exitCode !== null) throw new Error('EXE exited: ' + child.exitCode);
    if (Date.now() > deadline) throw new Error('EXE did not expose a test debugging endpoint');
    await sleep(100);
  }
  const port = fs.readFileSync(active, 'utf8').split(/\r?\n/)[0];
  let targets;
  do { targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); if (!targets.some(t => t.type === 'page' && t.url.includes('MapCinema'))) await sleep(100); }
  while (!targets.some(t => t.type === 'page' && t.url.includes('MapCinema')) && Date.now() < deadline);
  const target = targets.find(t => t.type === 'page' && t.url.includes('MapCinema')); assert.ok(target, 'Application page did not open');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const job = pending.get(message.id); pending.delete(message.id); clearTimeout(job.timeout);
    if (message.error) job.reject(new Error(JSON.stringify(message.error))); else job.resolve(message.result);
  };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output, eventsEnabled: true });
  let ready = false;
  while (!ready && Date.now() < deadline) {
    ready = (await call('Runtime.evaluate', { expression: 'document.readyState === "complete" && typeof MapCinemaReverse === "object"', returnByValue: true })).result.value;
    if (!ready) await sleep(50);
  }
  assert.ok(ready, 'Application scripts did not finish loading');
  let screenshotCaptured = false;
  try {
    const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: false }, 5000);
    fs.writeFileSync(path.join(root, 'logs', 'desktop-preview.png'), Buffer.from(screenshot.data, 'base64'));
    screenshotCaptured = true;
  } catch { console.log('Hidden-window capture unavailable; continuing functional EXE checks.'); }
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'smoke.mp4')).toString('base64');
  const code = fs.readFileSync(path.join(__dirname, 'browser-smoke.js'), 'utf8');
  const legacy = { video: fs.readFileSync(path.join(__dirname, 'fixtures/legacy-v13.mcvideo')).toString('base64'),
    world: fs.readFileSync(path.join(__dirname, 'fixtures/legacy-v13.mcworld')).toString('base64'),
    direct: fs.readFileSync(path.join(__dirname, 'fixtures/direct-v13.mcworld')).toString('base64') };
  const result = await call('Runtime.evaluate', { expression: code + '(' + JSON.stringify(fixture) + ',' + JSON.stringify(legacy) + ')',
    awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
  const report = { executable: exe, downloadDirectory: output, screenshotCaptured, chromium: (await call('Browser.getVersion')).product,
    ...result.result.value, nativePickerManuallyTested: false, minecraftTested: false };
  fs.writeFileSync(path.join(root, 'logs', 'smoke-results.json'), JSON.stringify(report, null, 2));
  const downloads = ['smoke-memory.mcvideo', 'smoke-disk.mcvideo', 'smoke-world.mcworld', 'world-only-memory.mcworld', 'world-only-disk.mcworld', 'smoke-multi-anchor.mcvideo', 'smoke-multi-anchor.mcworld'];
  if (report.actualWorldUI) downloads.push(report.actualWorldUI.output);
  for (const name of downloads) {
    const file = path.join(output, name), deadline = Date.now() + 10000;
    while (!fs.existsSync(file) && Date.now() < deadline) await sleep(100);
    assert.ok(fs.existsSync(file) && fs.statSync(file).size > 0, 'Missing real download: ' + name);
  }
  console.log('PASS: packaged EXE launches; isolated offline renderer; H.264/AAC; PCM clip; memory + native-stream disk export; world folder and archive; real downloads.');
  console.log(JSON.stringify(report, null, 2));
  const stopped = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('EXE did not exit after Browser.close')); }, 10000);
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('EXE shutdown code: ' + code)); });
  });
  socket.send(JSON.stringify({ id: ++sequence, method: 'Browser.close' }));
  await stopped;
}
main().then(() => { socket?.close(); }).catch(error => { console.error(error); child.kill(); socket?.close(); process.exitCode = 1; });
