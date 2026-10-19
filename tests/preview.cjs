'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const profile = path.join(root, 'tests/runs/preview-' + Date.now());
const env = { ...process.env, MAPCINEMA_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
const log = fs.openSync(path.join(root, 'logs/preview-exe.log'), 'w');
const child = spawn(path.join(root, 'release/方映-电脑版-v17/方映.exe'),
  ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
  { env, windowsHide: true, stdio: ['ignore', log, log] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let socket, sequence = 0;
const pending = new Map();
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 20000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function main() {
  const deadline = Date.now() + 45000, active = path.join(profile, 'Cache/DevToolsActivePort');
  while (!fs.existsSync(active) && Date.now() < deadline) await sleep(100);
  const port = fs.readFileSync(active, 'utf8').split(/\s+/)[0]; let pages = [];
  while (Date.now() < deadline) {
    pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    if (pages.some(p => p.type === 'page' && p.url.includes('MapCinema'))) break;
    await sleep(100);
  }
  socket = new WebSocket(pages.find(p => p.type === 'page' && p.url.includes('MapCinema')).webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data), p = pending.get(message.id);
    if (p) { pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result); }
  };
  await call('Runtime.enable'); await call('Page.enable');
  while (Date.now() < deadline) {
    const state = await call('Runtime.evaluate', { expression: 'document.readyState === "complete" && typeof MapCinemaCore?.upgradeInstalledWorld === "function"', returnByValue: true });
    if (state.result?.value === true) break;
    await sleep(100);
  }
  const selected = await call('Runtime.evaluate', { expression: `(() => {
    const action = document.getElementById('merge-action'); action.value = 'world'; action.dispatchEvent(new Event('change', { bubbles: true }));
    const panel = document.getElementById('merge-panel'); window.scrollTo({ top: panel.getBoundingClientRect().top + scrollY - 12, left: 0, behavior: 'instant' });
    return { badge: document.querySelector('.badge').textContent, label: action.selectedOptions[0].textContent,
      packageRequired: document.getElementById('import-video').required, scrollY };
  })()`, returnByValue: true });
  assert.ok(!selected.exceptionDetails, JSON.stringify(selected.exceptionDetails));
  assert.ok(selected.result.value.badge.includes('v17'));
  assert.ok(selected.result.value.scrollY > 100);
  assert.equal(selected.result.value.packageRequired, false);
  await sleep(500);
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(root, 'logs/仅用旧世界升级-入口.png'), Buffer.from(shot.data, 'base64'));
  fs.writeFileSync(path.join(root, 'logs/preview-state.json'), JSON.stringify(selected.result.value, null, 2));
  await call('Runtime.evaluate', { expression: `document.getElementById('anchor-mode').value='armor_stand'; document.getElementById('converter').dispatchEvent(new Event('input',{bubbles:true})); window.scrollTo({top:document.getElementById('anchor-options').getBoundingClientRect().top+scrollY-140,behavior:'instant'});` });
  await sleep(200);
  const settingsShot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(root, 'logs/多盔甲架与朝向设置.png'), Buffer.from(settingsShot.data, 'base64'));
  await call('Runtime.evaluate', { expression: `document.getElementById('prefetch-enabled').checked=true; document.getElementById('converter').dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('prefetch-enabled').scrollIntoView({block:'center'});` });
  await sleep(200);
  const preloadShot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(root, 'logs/区块上空提前加载设置.png'), Buffer.from(preloadShot.data, 'base64'));
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Runtime.evaluate', { expression: `document.getElementById('prefetch-enabled').scrollIntoView({block:'center'});` });
  await sleep(200);
  const small = await call('Runtime.evaluate', { expression: `({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})`, returnByValue: true });
  assert.ok(small.result.value.scrollWidth <= small.result.value.width, 'Mobile preload UI overflow');
  const narrowShot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(root, 'logs/区块上空提前加载设置-窄屏.png'), Buffer.from(narrowShot.data, 'base64'));
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Preview shutdown timeout')); }, 10000);
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Preview exit ' + code)); });
  });
  socket.send(JSON.stringify({ id: ++sequence, method: 'Browser.close' })); await exited;
  console.log('PASS: actual v17 EXE shows world-only upgrade and preload controls at desktop and 390px widths.');
}
main().then(() => socket?.close()).catch(error => { child.kill(); socket?.close(); console.error(error); process.exitCode = 1; });
