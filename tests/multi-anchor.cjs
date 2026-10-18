'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const helper = fs.readFileSync(path.join(__dirname, 'playback.cjs'), 'utf8').split('async function main()')[0];
const { modules, store } = new Function('require', '__dirname', helper + '\nreturn { modules, store };')(require, __dirname);
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'app/MapCinema.html'), 'utf8');
const current = modules(html), C = current.MapCinemaCore;
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
require('node:vm').runInContext(script[5], current);
const anchor = { mode: 'armor_stand', name: '影 院,一号', offset: [0, 2, 0] };
const ns = 'mv_multi_test', zip = store();
C.playerFiles(zip, { namespace: ns, count: 3, ticks: 1, loop: true, origin: [0, 64, 0], rotation: 180,
  columns: 8, anchor, audio: { event: ns + '.audio' } });
const fn = `behavior_packs/${ns}/functions/${ns}/`;
const selectors = C.anchorSelectors(ns, anchor);
assert.ok(!selectors.named.includes('c=') && selectors.bound === selectors.named);

// Independently evaluate the emitted selector intervals; every yaw must choose exactly one direction.
function choose(command, yaw) {
  const constraints = [...command.matchAll(/(if|unless) entity @s\[rym=(-?\d+),ry=(-?\d+)\]/g)];
  return constraints.every(([, type, min, max]) => type === 'if' ? yaw >= +min && yaw <= +max : !(yaw >= +min && yaw <= +max));
}
const first = zip.files.get(fn + 'first_frame.mcfunction').trim().split('\n');
const renders = first.filter(line => line.includes(' run structure load '));
assert.equal(renders.length, 4);
assert.ok(renders.every(line => line.startsWith(`execute as ${selectors.named} at @s align xyz positioned ~ ~2 ~ `)));
const angle = line => +line.match(/ (\d+)_degrees none$/)[1];
for (let yaw = -180; yaw <= 180; yaw += 0.125) {
  const chosen = renders.filter(line => choose(line, yaw));
  assert.equal(chosen.length, 1, 'Yaw ambiguity: ' + yaw);
  const actual = angle(chosen[0]);
  const circular = value => Math.abs(((value + 180) % 360 + 360) % 360 - 180);
  assert.ok(circular(actual - yaw) <= 45, `Wrong facing: ${yaw} -> ${actual}`);
}
const stands = [
  { name: anchor.name, yaw: 0, position: [0, 64, 0], loaded: true },
  { name: anchor.name, yaw: 90, position: [8, 64, 0], loaded: true },
  { name: anchor.name, yaw: 180, position: [200, 64, 0], loaded: true },
  { name: anchor.name, yaw: -90, position: [300, 64, 0], loaded: true },
  { name: 'different-video', yaw: 0, position: [0, 64, 0], loaded: true },
  { name: anchor.name, yaw: 0, position: [0, 64, 0], loaded: false },
];
const display = () => stands.filter(s => s.name === anchor.name && s.loaded).flatMap(s => renders.filter(line => choose(line, s.yaw)).map(line => ({ stand: s, rotation: angle(line) })));
assert.deepEqual(display().map(s => s.rotation), [0, 90, 180, 270]);
stands[0].yaw = 90;
stands.push({ name: anchor.name, yaw: -90, position: [400, 64, 0], loaded: true });
assert.deepEqual(display().map(s => s.rotation), [90, 90, 180, 270, 270]);
const page = zip.files.get(fn + 'frames_0_2.mcfunction').trim().split('\n');
assert.ok(page.every(line => /^execute if score mc_frame \S+ matches [012] run /.test(line)), 'Multiline rendering escaped its frame condition');
assert.equal(page.filter(line => /matches 1 run execute as /.test(line)).length, 4);
assert.equal(first.filter(line => line === `function ${ns}/audio_start`).length, 1);
const audio = zip.files.get(fn + 'audio_start.mcfunction').trim().split('\n');
assert.equal(audio.filter(line => line.startsWith('stopsound ')).length, 1);
assert.ok(audio[2].startsWith(`execute at ${selectors.named} align xyz positioned ~ ~2 ~ run tag @a[r=64] add `));
assert.ok(audio[3].startsWith('execute as @a[tag=') && audio[3].includes(' at @s run playsound '));
const players = [[4, 66, 0], [200, 66, 0], [1000, 66, 0]];
const listeners = new Set();
for (const s of display()) for (let i = 0; i < players.length; i++) {
  const screen = s.stand.position.map((n, axis) => Math.floor(n) + anchor.offset[axis]);
  if (Math.hypot(...players[i].map((n, axis) => n - screen[axis])) <= 64) listeners.add(i);
}
assert.deepEqual([...listeners], [0, 1], 'Overlapping screens must play once per player');
assert.ok(!zip.files.get(fn + 'place_bound.mcfunction').includes(`function ${ns}/screen_area`));
assert.ok(zip.files.get(fn + 'screen_area.mcfunction').startsWith('#'));
const list = current.MapCinemaCommands.commandList([0, 64, 0], ns, anchor);
assert.ok(list.some(c => c.text === `/summon armor_stand ${JSON.stringify(anchor.name)} ~ ~ ~`));
assert.ok(list.some(c => c.text.includes('positioned as @s run tp @s ~ ~ ~ ~ 0')));
assert.ok(list.some(c => c.text === `/testfor ${selectors.named}`));
assert.equal(current.MapCinemaCommands.commandList([0, 64, 0], ns, null).length, 4);
const summary = { allMatchingStands: true, independentFacing: true, yawCases: 2881,
  noYawBoundaryOverlap: true, newlyLoadedStandJoinsNextFrame: true, changedYawAppliedNextFrame: true,
  otherNamesAndUnloadedExcluded: true, multilineCommandsKeepFrameGuards: true,
  oneAudioRestartPerVideoCycle: true, unionOfNearbyPlayers: true, noPerStandTickingAreas: true,
  copyableSpawnAndOrientationCommands: true, fixedCommandListPreserved: true, minecraftTested: false };
async function legacyUpgrade() {
  const legacy = modules(fs.readFileSync(path.join(root, 'tests/fixtures/reference-v15.1.html'), 'utf8'));
  const video = new legacy.JSZip();
  const options = { namespace: ns, name: 'legacy-anchor', output: 'video', columns: 1, rows: 1, ticks: 1,
    loop: true, origin: [0, 64, 0], rotation: 180, reuseTiles: true, tileThreshold: 0, dedupe: true,
    capacityMiB: 128, anchor, start: 0 };
  await legacy.MapCinemaCore.writeVideoFrames(video, { options, count: 3, id: 'legacy_anchor',
    frameAt: async frame => { const b = new Uint8Array(65536); b.fill(255); b[0] = frame; return [b]; } });
  const world = new legacy.JSZip(); world.file('level.dat', legacy.MapCinemaCore.levelDat('legacy-anchor'));
  const before = await legacy.MapCinemaCore.installVideoPackage(world, video, {});
  const framePath = before.dir + `structures/${before.namespace}/f000001.mcstructure`;
  const original = Buffer.from(await world.file(framePath).async('uint8array'));
  const upgraded = await C.installVideoPackage(world, video, { repairController: true });
  assert.equal(upgraded.totalTicks, before.totalTicks);
  assert.deepEqual(Buffer.from(await world.file(framePath).async('uint8array')), original);
  const updatedPage = await world.file(before.dir + `functions/${before.namespace}/frames_0_2.mcfunction`).async('string');
  assert.ok(!updatedPage.includes('c=1') && updatedPage.includes('rym=-45,ry=45'));
  summary.legacyAnchorPackageRepairPreservesFramesAndTiming = true;
  const withoutPackage = await C.upgradeInstalledWorld(world);
  assert.equal(withoutPackage.anchor.name, anchor.name);
  assert.equal(withoutPackage.frameCount, 3);
  await C.upgradeInstalledWorld(world);
  assert.deepEqual(Buffer.from(await world.file(framePath).async('uint8array')), original);
  summary.worldOnlyAnchorUpgradeAndRepeat = true;
  fs.writeFileSync(path.join(root, 'logs/multi-anchor-tests.json'), JSON.stringify(summary, null, 2));
  console.log('PASS:', JSON.stringify(summary));
}
legacyUpgrade().catch(error => { console.error(error); process.exitCode = 1; });
