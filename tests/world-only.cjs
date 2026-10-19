'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const helperSource = fs.readFileSync(path.join(__dirname, 'playback.cjs'), 'utf8').split('async function main()')[0];
const { modules, nbt } = new Function('require', '__dirname', helperSource + '\nreturn { modules, nbt };')(require, __dirname);
const root = path.resolve(__dirname, '..');
const current = modules(fs.readFileSync(path.join(root, 'app/MapCinema.html'), 'utf8'));
const C = current.MapCinemaCore;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function pictures(zip, ns, count, columns, rows) {
  const result = []; let previous = Array(columns * rows).fill(null);
  for (let frame = 0; frame < count; frame++) {
    const tree = nbt(await zip.file(`behavior_packs/${ns}/structures/${ns}/f${String(frame).padStart(6, '0')}.mcstructure`).async('uint8array'));
    for (const entry of Object.values(tree.structure.palette.default.block_position_data)) {
      const item = entry.block_entity_data;
      previous[(rows - item.y - 1) * columns + item.x] = item.Item.tag.map_uuid;
    }
    assert.ok(previous.every(id => typeof id === 'bigint'));
    result.push([...previous]);
  }
  return result;
}
async function main() {
  const original = fs.readFileSync(path.join(__dirname, 'fixtures/direct-v13.mcworld'));
  const zip = await current.JSZip.loadAsync(original), old = await current.JSZip.loadAsync(original);
  const m = JSON.parse(await zip.file('MapCinema-world_only_test.json').async('string'));
  const preserved = Object.keys(zip.files).filter(name => !zip.files[name].dir && /^(db|resource_packs)\//.test(name));
  const hashes = new Map();
  for (const name of preserved) hashes.set(name, hash(await zip.file(name).async('uint8array')));
  const before = await pictures(old, m.namespace, m.frames, 8, 1);
  const info = await C.upgradeInstalledWorld(zip);
  assert.equal(info.worldOnlyUpgrade, true); assert.equal(info.fullFrameCount, 2);
  assert.equal(info.frameCount, 45); assert.equal(info.totalTicks, 45);
  assert.equal(info.controllerLayout, 'clock-v2'); assert.equal(info.control[2], 10);
  assert.deepEqual(await pictures(zip, m.namespace, 45, 8, 1), before);
  for (const name of preserved) assert.equal(hash(await zip.file(name).async('uint8array')), hashes.get(name), name);
  const frame40 = nbt(await zip.file(`behavior_packs/${m.namespace}/structures/${m.namespace}/f000040.mcstructure`).async('uint8array'));
  assert.equal(Object.keys(frame40.structure.palette.default.block_position_data).length, 8);
  const oldLevel = nbt(await old.file('level.dat').async('uint8array').then(b => b.subarray(8)));
  const newLevel = nbt(await zip.file('level.dat').async('uint8array').then(b => b.subarray(8)));
  assert.equal(newLevel.LevelName, oldLevel.LevelName + '（播放修复 v18）');
  assert.deepEqual({ ...newLevel, LevelName: oldLevel.LevelName }, oldLevel);
  const again = await C.upgradeInstalledWorld(zip);
  assert.equal(again.name, newLevel.LevelName, 'Repeated upgrade duplicated the world-name suffix');
  assert.deepEqual(await pictures(zip, m.namespace, 45, 8, 1), before);
  const broken = await current.JSZip.loadAsync(original);
  broken.remove(`behavior_packs/${m.namespace}/structures/${m.namespace}/f000001.mcstructure`);
  await assert.rejects(C.upgradeInstalledWorld(broken), /缺少帧结构/);
  const unknown = new current.JSZip(); unknown.file('level.dat', C.levelDat('unknown'));
  await assert.rejects(C.upgradeInstalledWorld(unknown), /一个完整方映播放器/);
  const cancelled = await current.JSZip.loadAsync(original);
  await assert.rejects(C.upgradeInstalledWorld(cancelled, { checkCancelled() { throw new Error('test-cancel'); } }), /test-cancel/);
  const summary = { worldOnlyCore: true, picturesAndTimingPreserved: true, databaseAndAudioPreserved: true,
    periodicFullFrames: true, shiftedRotatedController: true, repeatedUpgrade: true, levelDatOnlyNameChanged: true,
    missingFramesRejected: true, unrelatedWorldRejected: true, cancellation: true, minecraftTested: false };
  fs.writeFileSync(path.join(root, 'logs/world-only-tests.json'), JSON.stringify(summary, null, 2));
  console.log('PASS:', JSON.stringify(summary));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
