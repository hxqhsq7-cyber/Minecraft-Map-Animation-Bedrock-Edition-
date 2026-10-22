'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { install, fingerprint } = require('../app/china-install.cjs');
const { loadEngine, listFiles } = require('../app/china-world.cjs');
async function main() {
  const fixture = JSON.parse(await fs.readFile(path.join(__dirname, '../logs/china-feature-results.json'), 'utf8'));
  const source = path.join(path.dirname(fixture.target), 'source'), root = await fs.mkdtemp(path.join(path.dirname(fixture.target), 'world-replace-'));
  const clientRoot = path.join(root, 'client'), worlds = path.join(clientRoot, 'minecraftWorlds'), directory = path.join(worlds, 'new+slot='), backupRoot = path.join(root, 'backups'), closed = async () => {};
  await fs.mkdir(worlds, { recursive: true }); await fs.mkdir(path.join(clientRoot, 'games/com.netease/resource_packs'), { recursive: true });
  await fs.mkdir(path.join(worlds, 'other')); await fs.writeFile(path.join(worlds, 'other/keep.txt'), 'other world');
  async function reset() { assert.equal(path.dirname(directory), worlds); await fs.rm(directory, { recursive: true, force: true }); await fs.cp(source, directory, { recursive: true }); }
  await reset(); const originalFingerprint = await fingerprint(directory, closed);
  const opts = { target: fixture.target, namespace: fixture.namespace, clientRoot, directory, sourceFingerprint: originalFingerprint, backupRoot };
  let checks = 0; const deployed = await install(opts, async () => { checks++; }); assert.equal(checks, 3); assert.ok(deployed.ok); assert.equal(deployed.directory, directory);
  assert.deepEqual((await fs.readdir(worlds)).sort(), ['new+slot=', 'other']); assert.equal(await fingerprint(deployed.backupDirectory, closed), originalFingerprint);
  for (const name of await listFiles(source)) assert.deepEqual(await fs.readFile(path.join(deployed.backupDirectory, name)), await fs.readFile(path.join(source, name)));
  const { D } = loadEngine(), reader = await D.ZipReader.open(await require('node:fs').openAsBlob(fixture.target));
  for (const entry of reader.entries.values()) if (!entry.dir) assert.deepEqual(await fs.readFile(path.join(directory, entry.name)), Buffer.from(await reader.read(entry.name)));
  await fs.writeFile(path.join(directory, 'gameplay-saved.txt'), 'keep progress'); assert.ok((await install(opts, closed)).reused);
  assert.equal(await fs.readFile(path.join(directory, 'gameplay-saved.txt'), 'utf8'), 'keep progress');
  await assert.rejects(install({ ...opts, namespace: '../escape' }, closed), /标识/);
  await assert.rejects(install({ ...opts, directory: worlds }, closed), /目标存档/);
  await assert.rejects(install({ ...opts, backupRoot: path.join(directory, 'backups') }, closed), /备份必须/);
  await assert.rejects(install(opts, async () => { throw Error('客户端仍在运行'); }), /仍在运行/);
  const code = await fs.readFile(path.join(__dirname, '../app/china-install.cjs'), 'utf8'), child = { execFile: (_bin, _args, options, cb) => { assert.ok(options.windowsHide); cb(null, '1234\r\n', ''); } }, sandbox = { module: { exports: {} }, process };
  child.execFile[require('node:util').promisify.custom] = (...args) => new Promise(resolve => child.execFile(...args, (_error, stdout, stderr) => resolve({ stdout, stderr })));
  sandbox.require = name => name === 'node:child_process' ? child : require(require.resolve(name, { paths: [path.join(__dirname, '../app')] }));
  vm.runInNewContext(code, sandbox); await assert.rejects(sandbox.module.exports.assertClientClosed(), /仍在运行/);
  const helpers = (await fs.readFile(path.join(__dirname, 'playback.cjs'), 'utf8')).split('async function main()')[0];
  const { modules } = new Function('require', '__dirname', helpers + '\nreturn {modules};')(require, __dirname);
  const ctx = modules(await fs.readFile(path.join(__dirname, '../app/MapCinema.html'), 'utf8'));
  const original = await ctx.JSZip.loadAsync(await fs.readFile(fixture.target));
  async function altered(name, edit) { const zip = await ctx.JSZip.loadAsync(await fs.readFile(fixture.target)); edit(zip); const p = path.join(root, name + '.zip'); await fs.writeFile(p, await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })); return p; }
  await reset();
  const cancelled = new SharedArrayBuffer(4); await assert.rejects(install({ ...opts, cancellation: cancelled }, closed, () => { Atomics.store(new Int32Array(cancelled), 0, 1); }), /取消/);
  assert.equal(await fingerprint(directory, closed), originalFingerprint);
  for (const stopAt of [2, 3]) { let count = 0; await assert.rejects(install(opts, async () => { if (++count === stopAt) throw Error('客户端中途启动'); }), /中途启动/); assert.equal(await fingerprint(directory, closed), originalFingerprint); }
  const unsafe = await altered('unsafe', zip => zip.file('C:escape.txt', 'bad')); await assert.rejects(install({ ...opts, target: unsafe }, closed), /不安全/);
  const duplicate = await altered('duplicate', zip => zip.file('LEVEL.DAT', 'bad')); await assert.rejects(install({ ...opts, target: duplicate }, closed), /重复/);
  const missing = await altered('missing', zip => zip.remove('db/CURRENT')); await assert.rejects(install({ ...opts, target: missing }, closed), /缺少/);
  const wrong = await altered('wrong-namespace', zip => zip.file('MapCinema-China-' + fixture.namespace + '.json', JSON.stringify({ namespace: 'other' }))); await assert.rejects(install({ ...opts, target: wrong }, closed), /不匹配/);
  const stored = Buffer.from(await original.generateAsync({ type: 'uint8array', compression: 'STORE' })), storedPath = path.join(root, 'stored.zip'); await fs.writeFile(storedPath, stored);
  assert.ok((await install({ ...opts, target: storedPath }, closed)).ok); await reset();
  const corrupt = Buffer.from(stored), probe = await D.ZipReader.open(new Blob([corrupt])), e = probe.entries.get('level.dat');
  const at = e.localOffset + 30 + corrupt.readUInt16LE(e.localOffset + 26) + corrupt.readUInt16LE(e.localOffset + 28); corrupt[at] ^= 1;
  const corruptPath = path.join(root, 'corrupt.zip'); await fs.writeFile(corruptPath, corrupt); await assert.rejects(install({ ...opts, target: corruptPath }, closed), /校验失败/);
  await fs.writeFile(path.join(directory, 'new-progress.txt'), 'new'); await assert.rejects(install(opts, closed), /生成后发生变化/); assert.equal(await fs.readFile(path.join(directory, 'new-progress.txt'), 'utf8'), 'new'); await reset();
  let changed = false; await assert.rejects(install(opts, closed, () => { if (!changed) { changed = true; require('node:fs').writeFileSync(path.join(directory, 'new-progress.txt'), 'late'); } }), /校验失败|已变化/);
  assert.equal(await fs.readFile(path.join(directory, 'new-progress.txt'), 'utf8'), 'late'); await reset();
  const rename = fs.rename;
  fs.rename = async (from, to) => { if (path.basename(from).startsWith('.mapcinema-import-') && to === directory) throw Error('simulated publication failure'); return rename(from, to); };
  try { await assert.rejects(install(opts, closed), /自动还原/); } finally { fs.rename = rename; }
  assert.equal(await fingerprint(directory, closed), originalFingerprint);
  fs.rename = async (from, to) => { if (to === directory) throw Error('simulated rename failure'); return rename(from, to); };
  try { await assert.rejects(install(opts, closed), /原存档保留在/); } finally { fs.rename = rename; }
  const rollback = (await fs.readdir(clientRoot)).find(n => n.startsWith('.mapcinema-rollback-')); assert.ok(rollback);
  const saved = path.join(clientRoot, rollback, 'world'); assert.equal(await fingerprint(saved, closed), originalFingerprint); assert.equal(await fingerprint(deployed.backupDirectory, closed), originalFingerprint);
  await fs.rename(saved, directory); await fs.rmdir(path.dirname(saved));
  assert.equal(await fs.readFile(path.join(worlds, 'other/keep.txt'), 'utf8'), 'other world');
  assert.ok(!(await fs.readdir(clientRoot)).some(n => n.startsWith('.mapcinema-import-') || n.startsWith('.mapcinema-rollback-')));
  const report = { output: root, targetFolderNameRetained: true, noAdditionalWorldDirectory: true, replacementFilesMatchZip: true, originalBackupByteIdentical: true, retryPreservesGameplay: true, clientRunningBlocked: true, launchDuringCopyBlocked: true, staleTargetNotOverwritten: true, cancellationLeavesTargetIntact: true, corruptAndUnsafeZipRejected: true, commitFailureRestoresTarget: true, failedRestoreKeepsBothBackups: true, otherWorldUnchanged: true, gameClientTested: false };
  await fs.writeFile(path.join(__dirname, '../logs/china-install-results.json'), JSON.stringify(report, null, 2)); console.log('PASS: ' + JSON.stringify(report));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
