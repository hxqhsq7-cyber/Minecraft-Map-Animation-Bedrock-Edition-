'use strict';
const { Worker } = require('node:worker_threads');
const fs = require('node:fs'), path = require('node:path');
const { resolveWorld } = require('./china-path.cjs');
const audio = require('./china-audio.cjs');
const worlds = require('./china-install.cjs');
function attach({ ipcMain, dialog, shell, win, data, local }) {
  const selection = {}; let job = null, deploying = false, lastOutput, lastResult, clientInvalid = false;
  const isBusy = () => Boolean(job || deploying);
  const deployAudio = async () => {
    const tracks = lastResult?.audioTracks || (lastResult?.audio ? [{ namespace:lastResult.namespace, audio:lastResult.audio, audioDirectory:lastResult.audioDirectory }] : []);
    if (!tracks.length || tracks.some(t=>!t.audioDirectory)) throw new Error('请先生成包含音轨的世界副本。');
    try { if (clientInvalid) throw new Error('普通中国版数据目录无效，请重新选择。'); const results=[];for(const track of tracks)results.push(await audio.register({ directory: track.audioDirectory, namespace: track.namespace, headerId: track.audio.headerId, clientRoot: selection.client })); lastResult.audioDeployment={...results[0],tracks:results}; }
    catch (error) { lastResult.audioDeployment = { ok: false, error: error.message }; }
    return lastResult.audioDeployment;
  };
  const deployWorld = async () => {
    if (!lastResult) throw new Error('请先生成世界副本。');
    try {
      if (clientInvalid) throw new Error('普通中国版数据目录无效，请重新选择。');
      lastResult.worldDeployment = await worlds.install({ target: lastResult.target, namespace: lastResult.namespace, clientRoot: selection.client,
        directory: lastResult.sourceDirectory, sourceFingerprint: lastResult.sourceFingerprint, backupRoot: path.join(data, 'ChinaBackups'), cancellation: job?.cancellation }, undefined,
        progress => { if (!win.isDestroyed()) win.webContents.send('china:progress', progress); });
    } catch (error) { lastResult.worldDeployment = { ok: false, error: error.message }; }
    return lastResult.worldDeployment;
  };
  const guard = event => { if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !local(event.senderFrame.url)) throw new Error('无效的本地窗口请求。'); };
  const cancel = () => { if (job) Atomics.store(new Int32Array(job.cancellation), 0, 1); };
  ipcMain.handle('china:choose', async (event, kind) => {
    guard(event); if (isBusy()) throw new Error('请先等待当前导入结束。');
    if (!['video', 'world', 'level', 'output', 'client'].includes(kind)) throw new Error('无效的选择类型。');
    let picked;
    if (kind === 'output') {
      const result = await dialog.showSaveDialog(win, { title: '保存中国版世界副本', defaultPath: path.join(data, '..', '方映-中国版世界-' + Date.now() + '.zip'), filters: [{ name: '中国版世界 ZIP', extensions: ['zip'] }] });
      if (!result.canceled) picked = result.filePath;
    } else if (kind === 'client') {
      const result = await dialog.showOpenDialog(win, { title: '选择普通中国版数据目录（含 minecraftWorlds 和 games）', properties: ['openDirectory'], defaultPath: selection.client || audio.defaultClient() });
      if (!result.canceled) { clientInvalid = true; picked = await audio.clientDirectory(result.filePaths[0]); clientInvalid = false; }
    } else {
      const worlds = path.join(process.env.APPDATA || '', 'MinecraftPC_Netease_PB', 'minecraftWorlds');
      const result = await dialog.showOpenDialog(win, { title: kind === 'video' ? '选择方映 .mcvideo 视频包' : kind === 'level' ? '选择待添加视频存档的 level.dat 文件' : '选择中国版已有或新建的目标存档（此窗口只显示文件夹）',
        properties: [kind === 'world' ? 'openDirectory' : 'openFile'],
        ...(['world', 'level'].includes(kind) && fs.existsSync(worlds) ? { defaultPath: selection.world || worlds } : {}),
        ...(kind === 'video' ? { filters: [{ name: '方映视频包', extensions: ['mcvideo', 'zip'] }] } : kind === 'level' ? { filters: [{ name: '世界配置 level.dat', extensions: ['dat'] }, { name: '所有文件', extensions: ['*'] }] } : {}) });
      if (!result.canceled) picked = result.filePaths[0];
    }
    const key = kind === 'level' ? 'world' : kind;
    if (picked) { if (key === 'world') { delete selection.world; picked = await resolveWorld(picked); } selection[key] = picked; }
    return selection[key] || null;
  });
  ipcMain.handle('china:run', async (event, options) => {
    guard(event); if (isBusy()) throw new Error('已有中国版导入任务。');
    if (!selection.video || !selection.world) throw new Error('请先选择视频包和世界文件夹。');
    if (!options || typeof options !== 'object') throw new Error('导入设置缺失。');
    if (!['native','international'].includes(options.pipeline || 'native')) throw new Error('无效的处理方式。');
    let target = selection.output;
    if (!target) {
      if (options.deployWorld === false) throw new Error('仅导出时请先选择输出 ZIP。');
      const exports = path.join(data, 'Exports'); fs.mkdirSync(exports, { recursive: true });
      target = path.join(exports, '方映-中国版世界-' + Date.now() + '-' + require('node:crypto').randomBytes(3).toString('hex') + '.zip');
    }
    const cancellation = new SharedArrayBuffer(4);
    const worker = new Worker(path.join(__dirname, options.pipeline === 'international' ? 'china-transfer.cjs' : 'china-world.cjs'), { workerData: {
      source: selection.world, videoPath: selection.video, target, tempRoot: path.join(data, 'Temp'), audioStore: path.join(data, 'ChinaAudio'), cancellation,
      options: { origin: options.origin, rotation: options.rotation, loop: options.loop, visualOnly: options.visualOnly,
        anchorMode: options.anchorMode, anchor: options.anchor, audioMode: options.audioMode, dropPrefetch: options.dropPrefetch, prefetchMode:options.prefetchMode, prefetch:options.prefetch, keepWorldName:options.keepWorldName },
    } });
    job = { worker, cancellation };
    try {
      return await new Promise((resolve, reject) => {
        let finished = false;
        worker.on('message', async message => {
          if (message.progress && !win.isDestroyed()) win.webContents.send('china:progress', message.progress);
          if (message.result) { finished = true; lastOutput = message.result.target; lastResult = message.result; if ((lastResult.audio || lastResult.audioTracks?.length) && options.deployAudio !== false) await deployAudio(); if (options.deployWorld !== false) await deployWorld(); resolve(lastResult); }
          if (message.error) { finished = true; reject(new Error(message.error)); }
        });
        worker.once('error', reject);
        worker.once('exit', code => { if (!finished) reject(new Error('导入任务意外结束：' + code)); });
      });
    } finally { job = null; }
  });
  ipcMain.handle('china:cancel', event => { guard(event); cancel(); });
  ipcMain.handle('china:reveal', event => { guard(event); if (lastOutput) shell.showItemInFolder(lastOutput); });
  for (const [name, deploy] of [['world', deployWorld], ['audio', deployAudio]]) ipcMain.handle('china:deploy-' + name, async event => {
    guard(event); if (isBusy()) throw new Error('请等待当前任务结束。');
    deploying = true; try { return await deploy(); } finally { deploying = false; }
  });
  ipcMain.handle('china:reveal-world', event => { guard(event); if (lastResult?.worldDeployment?.ok) shell.showItemInFolder(path.join(lastResult.worldDeployment.directory, 'level.dat')); });
  ipcMain.handle('china:reveal-backup', event => { guard(event); if (lastResult?.worldDeployment?.ok) shell.showItemInFolder(path.join(lastResult.worldDeployment.backupDirectory, 'level.dat')); });
  ipcMain.handle('china:remove-audio', async event => {
    guard(event); if (isBusy()) throw new Error('请等待当前任务结束。');
    if (!lastResult?.audioDeployment?.ok) throw new Error('当前结果没有已部署的音轨。');
    deploying = true;
    try {
      const tracks=lastResult.audioTracks || [{namespace:lastResult.namespace,audio:lastResult.audio,audioDirectory:lastResult.audioDirectory}];
      for(const track of tracks)await audio.unregister({ directory: track.audioDirectory, namespace: track.namespace, headerId: track.audio.headerId, clientRoot: lastResult.audioDeployment.clientRoot });
      lastResult.audioDeployment={ok:false,removed:true};
      return lastResult.audioDeployment;
    } finally { deploying = false; }
  });
  return { isBusy, cancel, dispose() { cancel(); } };
}
module.exports = { attach };
