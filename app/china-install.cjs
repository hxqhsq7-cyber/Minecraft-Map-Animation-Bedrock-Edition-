'use strict';
const fs = require('node:fs'), fsp = fs.promises, path = require('node:path');
const { Readable, Transform } = require('node:stream'), { pipeline } = require('node:stream/promises');
const { createInflateRaw } = require('node:zlib');
const { promisify } = require('node:util'), execFile = promisify(require('node:child_process').execFile);
const { clientDirectory } = require('./china-audio.cjs');
const { loadEngine, listFiles, digest } = require('./china-world.cjs');
const { createHash } = require('node:crypto');
const inside = (child, parent) => { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
async function fingerprint(directory, check) {
  const names = (await listFiles(directory, '', check)).filter(name => name !== 'db/LOCK'), hashes = [];
  for (const name of names) hashes.push([name, await digest(path.join(directory, name), check)]);
  return createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
}
async function assertClientClosed() {
  if (process.platform !== 'win32') throw new Error('自动替换中国版存档仅支持 Windows。');
  const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Get-Process | Where-Object {$_.ProcessName -eq 'Minecraft.Windows'} | Select-Object -ExpandProperty Id"],
  { windowsHide: true, timeout: 10000, encoding: 'utf8' });
  if (stdout.trim()) throw new Error('检测到 Minecraft 客户端仍在运行。请完全关闭游戏后点击重试；已生成的 ZIP 会保留。');
}
async function extractWorld(target, stage, check = () => {}, onProgress = () => {}, required = []) {
    const { D } = loadEngine(), reader = await D.ZipReader.open(await fs.openAsBlob(target));
    const entries = [...reader.entries.values()], names = new Set(); let total = 0;
    for (const entry of entries) {
      const name = entry.name.replace(/\/$/, ''), parts = name.split('/');
      if (parts.some(p => !p || p === '.' || p === '..' || /[<>:"\\|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) || names.has(name.toLowerCase())) throw new Error('ZIP 含不安全或重复的 Windows 路径。');
      names.add(name.toLowerCase()); total += entry.size;
      if (entries.length > 100000 || !Number.isSafeInteger(total) || total > D.MAX_RAW_BYTES) throw new Error('世界 ZIP 超过支持范围。');
    }
    for (const name of ['level.dat', 'db/CURRENT', ...required]) if (!reader.entries.has(name) || reader.entries.get(name).dir) throw new Error('世界 ZIP 缺少：' + name);
    let completed = 0;
    for (const entry of entries) {
      check(); const file = path.resolve(stage, entry.name);
      if (!file.startsWith(stage + path.sep)) throw new Error('ZIP 路径超出世界目录。');
      if (entry.dir) await fsp.mkdir(file, { recursive: true });
      else {
        await fsp.mkdir(path.dirname(file), { recursive: true }); let size = 0, crc = 0;
        const verify = new Transform({ transform(chunk, _encoding, next) {
          try { check(); size += chunk.length; if (size > entry.size) throw new Error('ZIP 文件长度超出记录：' + entry.name); crc = D.crc32(chunk, crc); next(null, chunk); } catch (error) { next(error); }
        } });
        const stream = Readable.fromWeb(await reader.compressedStream(entry));
        await pipeline(...[stream, entry.method === 8 ? createInflateRaw() : null, verify, fs.createWriteStream(file, { flags: 'wx' })].filter(Boolean));
        if (size !== entry.size || crc !== entry.crc) throw new Error('ZIP 文件校验失败：' + entry.name);
      }
      onProgress({ value: ++completed / entries.length * 80, label: '正在校验待替换的存档文件…' });
    }
    return reader;
}
async function install({ target, namespace, clientRoot, directory, sourceFingerprint, backupRoot, cancellation }, assertClosed = assertClientClosed, onProgress = () => {}) {
  if (!/^fy_cn_[0-9a-f]{12}$/.test(namespace)) throw new Error('世界标识无效。');
  if (!directory || !/^[0-9a-f]{64}$/.test(sourceFingerprint || '') || !backupRoot) throw new Error('缺少目标存档或生成前校验信息，请重新生成。');
  const check = () => { if (cancellation && Atomics.load(new Int32Array(cancellation), 0)) throw new Error('已取消存档替换，ZIP 保留。'); };
  check(); await assertClosed();
  clientRoot = await clientDirectory(clientRoot);
  const worlds = await fsp.realpath(path.join(clientRoot, 'minecraftWorlds'));
  const requestedDirectory = path.resolve(directory), targetStat = await fsp.lstat(requestedDirectory);
  directory = await fsp.realpath(requestedDirectory);
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink() || path.dirname(directory) !== worlds || inside(clientRoot, directory)) throw new Error('请选择普通中国版 minecraftWorlds 中的目标存档，不能选择目录链接或总目录。');
  await require('./china-path.cjs').resolveWorld(directory);
  const requestedBackup = path.resolve(backupRoot), backupParent = await fsp.realpath(path.dirname(requestedBackup));
  backupRoot = path.join(backupParent, path.basename(requestedBackup));
  if (inside(backupRoot, directory) || inside(backupRoot, worlds)) throw new Error('替换前备份必须保存在存档目录之外。');
  const backupStat = await fsp.lstat(backupRoot).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (backupStat?.isSymbolicLink()) throw new Error('备份目录不能是目录链接。');
  await fsp.mkdir(backupRoot, { recursive: true }); backupRoot = await fsp.realpath(backupRoot);
  const metadata = 'MapCinema-China-' + namespace + '.json', receiptPath = path.join(backupRoot, namespace + '.json');
  let receipt; try { receipt = JSON.parse(await fsp.readFile(receiptPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (receipt && (receipt.directory !== directory || receipt.sourceFingerprint !== sourceFingerprint || receipt.namespace !== namespace ||
    typeof receipt.backupDirectory !== 'string' || path.dirname(receipt.backupDirectory) !== backupRoot || !path.basename(receipt.backupDirectory).startsWith(namespace + '-'))) throw new Error('备份记录与目标存档不匹配，未替换。');
  let backupDirectory = receipt?.backupDirectory;
  const result = async reused => ({ ok: true, directory, clientRoot, backupDirectory, reused, replaced: !reused,
    worldName: (await fsp.readFile(path.join(directory, 'levelname.txt'), 'utf8')).trim(), restartRequired: true });
  let own; try { own = JSON.parse(await fsp.readFile(path.join(directory, metadata), 'utf8')); } catch {}
  if (own?.namespace === namespace) {
    if (!backupDirectory || await fingerprint(backupDirectory, check) !== sourceFingerprint) throw new Error('目标已包含本次视频，但替换前备份缺失或已变化，未重复替换。');
    return result(true); // Retry keeps gameplay saved after the first replacement.
  }
  if (await fingerprint(directory, check) !== sourceFingerprint) throw new Error('目标存档在生成后发生变化，未替换。请关闭游戏并重新生成，避免覆盖新进度。');
  // Stage on the target volume; commit back to the exact launcher-created folder name.
  const stage = await fsp.mkdtemp(path.join(clientRoot, '.mapcinema-import-'));
  let rollback, keepRollback = false;
  try {
    const reader = await extractWorld(target, stage, check, onProgress, ['levelname.txt', metadata]);
    const info = JSON.parse(Buffer.from(await reader.read(metadata, 4 * 1048576)).toString('utf8'));
    if (info.namespace !== namespace || info.format !== 'mapcinema-china-world') throw new Error('世界 ZIP 与当前生成结果不匹配。');
    const current = require('./china-world.cjs').decrypt(await fsp.readFile(path.join(stage, 'db/CURRENT'))).toString('utf8').trim();
    if (!/^MANIFEST-\d+$/.test(current) || !(await fsp.stat(path.join(stage, 'db', current)).catch(() => null))?.isFile()) throw new Error('世界数据库清单不完整。');
    check(); await assertClosed();
    if (!backupDirectory) {
      backupDirectory = await fsp.mkdtemp(path.join(backupRoot, namespace + '-'));
      for (const name of await listFiles(directory, '', check)) {
        check(); const file = path.join(backupDirectory, name); await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.copyFile(path.join(directory, name), file, fs.constants.COPYFILE_EXCL);
      }
    }
    if (await fingerprint(backupDirectory, check) !== sourceFingerprint || await fingerprint(directory, check) !== sourceFingerprint) throw new Error('备份校验失败或目标存档已变化，未替换。');
    if (!receipt) await fsp.writeFile(receiptPath, JSON.stringify({ directory, namespace, sourceFingerprint, backupDirectory }, null, 2), { flag: 'wx' });
    onProgress({ value: 95, label: '替换前备份已校验，正在写回所选目标存档…' });
    check(); await assertClosed();
    if (await fingerprint(directory, check) !== sourceFingerprint) throw new Error('目标存档已变化，未替换。');
    rollback = await fsp.mkdtemp(path.join(clientRoot, '.mapcinema-rollback-'));
    check();
    await fsp.rename(directory, path.join(rollback, 'world'));
    try { await fsp.rename(stage, directory); }
    catch (error) {
      try {
        if (await fsp.lstat(directory).catch(e => { if (e.code !== 'ENOENT') throw e; })) throw new Error('目标路径已被占用');
        await fsp.rename(path.join(rollback, 'world'), directory);
      } catch (restoreError) { keepRollback = true; throw new Error(`替换失败且自动还原未完成：${restoreError.message}。原存档保留在 ${path.join(rollback, 'world')}，校验备份在 ${backupDirectory}；ZIP 保留。`); }
      throw new Error('替换失败，目标存档已自动还原，ZIP 和备份保留：' + error.message);
    }
    onProgress({ value: 100, label: '所选目标存档已备份并替换完成' });
    return result(false);
  } finally {
    if (path.dirname(stage) !== clientRoot || !path.basename(stage).startsWith('.mapcinema-import-')) throw new Error('世界暂存路径检查失败。');
    await fsp.rm(stage, { recursive: true, force: true });
    if (rollback && !keepRollback) {
      if (path.dirname(rollback) !== clientRoot || !path.basename(rollback).startsWith('.mapcinema-rollback-')) throw new Error('回退目录路径检查失败。');
      // A complete, hash-verified backup stays in the workspace even after this temporary old copy is removed.
      await fsp.rm(rollback, { recursive: true, force: true });
    }
  }
}
module.exports = { install, assertClientClosed, fingerprint, extractWorld };
