'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
function modules(html) {
  const context = vm.createContext({ Uint8Array, Uint16Array, Uint32Array, Int32Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder, Blob, crypto: webcrypto, setTimeout, clearTimeout, setImmediate, console });
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  for (const code of scripts.slice(0, 3)) vm.runInContext(code, context);
  return context;
}
function nbt(input) {
  const b = Buffer.from(input); let at = 0;
  const text = () => { const n = b.readUInt16LE(at); at += 2; const s = b.toString('utf8', at, at + n); at += n; return s; };
  function read(type) {
    let n;
    if (type === 1) return b.readInt8(at++);
    if (type === 2) { n = b.readInt16LE(at); at += 2; return n; }
    if (type === 3) { n = b.readInt32LE(at); at += 4; return n; }
    if (type === 4) { n = b.readBigInt64LE(at); at += 8; return n; }
    if (type === 5) { n = b.readFloatLE(at); at += 4; return n; }
    if (type === 6) { n = b.readDoubleLE(at); at += 8; return n; }
    if (type === 7) { n = b.readInt32LE(at); at += 4; const value = b.subarray(at, at + n); at += n; return value; }
    if (type === 8) return text();
    if (type === 9) { const child = b[at++]; n = b.readInt32LE(at); at += 4; return Array.from({ length: n }, () => read(child)); }
    if (type === 10) { const value = {}; while (b[at] !== 0) { const child = b[at++], name = text(); value[name] = read(child); } at++; return value; }
    if (type === 11 || type === 12) { n = b.readInt32LE(at); at += 4; return Array.from({ length: n }, () => read(type === 11 ? 3 : 4)); }
    throw new Error('Unexpected NBT type: ' + type);
  }
  assert.equal(b[at++], 10); text(); const result = read(10); assert.equal(at, b.length); return result;
}
function store() {
  const files = new Map();
  return { files, file(name, value) {
    if (arguments.length > 1) { files.set(name, value); return this; }
    return files.has(name) ? { async: async () => files.get(name) } : null;
  } };
}
function simulate(zip, ns, ticks) {
  const states = new Map(), frames = []; let time = 0, power = true, commands = 0, maxCommands = 0;
  const get = (name, objective) => states.get(name + ' ' + objective);
  function command(line, depth = 0) {
    assert.ok(depth < 50, 'Function recursion runaway'); commands++;
    let m;
    if ((m = /^execute if score (\S+) (\S+) matches (\S+) run (.+)$/.exec(line))) {
      const value = get(m[1], m[2]), range = m[3].split('..');
      const ok = range.length === 1 ? value === +range[0] : value !== undefined &&
        (range[0] === '' || value >= +range[0]) && (range[1] === '' || value <= +range[1]);
      if (ok) command(m[4], depth + 1); return;
    }
    if ((m = /^scoreboard players (set|add|remove) (\S+) (\S+) (-?\d+)$/.exec(line))) {
      const key = m[2] + ' ' + m[3], old = states.get(key) || 0;
      states.set(key, m[1] === 'set' ? +m[4] : old + (m[1] === 'add' ? +m[4] : -m[4])); return;
    }
    if ((m = /^function (\S+)$/.exec(line))) {
      const file = 'behavior_packs/' + ns + '/functions/' + m[1] + '.mcfunction';
      assert.ok(zip.files.has(file), file);
      for (const next of zip.files.get(file).trim().split('\n')) if (next) command(next, depth + 1);
      return;
    }
    if ((m = /^structure load \S+:f(\d+)/.exec(line))) frames.push([time, +m[1]]);
    else if (line === 'setblock ~-1 ~ ~ air') power = false;
    else assert.ok(/^scoreboard objectives add |^structure load \S+:controller |^setblock ~-1 ~ ~6 redstone_block$/.test(line), line);
  }
  command('function ' + ns + '/clock_begin');
  for (time = 1; time <= ticks && power; time++) { commands = 0; command('function ' + ns + '/tick'); maxCommands = Math.max(maxCommands, commands); }
  return { frames, power, maxCommands, states };
}
async function main() {
  const current = modules(fs.readFileSync(path.join(root, 'app/MapCinema.html'), 'utf8'));
  const old = modules(fs.readFileSync(path.join(root, 'tests/fixtures/reference-v13.html'), 'utf8'));
  const C = current.MapCinemaCore;
  const options = { namespace: 'mv_clock_test', columns: 8, rows: 4, ticks: 1, loop: false, origin: [0, 64, 0], rotation: 0 };
  let largest = 0;
  for (const count of [1, 2, 15, 16, 17, 128, 129, 1900, 16384]) {
    const zip = store(), player = C.playerFiles(zip, { ...options, count });
    assert.equal(player.totalTicks, count);
    const structure = nbt(zip.files.get('behavior_packs/' + options.namespace + '/structures/' + options.namespace + '/controller.mcstructure'));
    assert.deepEqual(structure.size, [1, 1, 1]);
    const entities = structure.structure.palette.default.block_position_data;
    assert.equal(Object.keys(entities).length, 1);
    assert.equal(entities['0'].block_entity_data.TickDelay, 1);
    assert.equal(entities['0'].block_entity_data.ExecuteOnFirstTick, 0);
    const result = simulate(zip, options.namespace, 20 + count);
    assert.equal(result.frames.length, count);
    result.frames.forEach(([time, frame], i) => assert.deepEqual([time, frame], [20 + i, i]));
    assert.equal(result.power, false);
    assert.ok(result.maxCommands < 100, result.maxCommands);
    largest = Math.max(largest, result.maxCommands);
  }
  const variable = [3, 7, 1, 40, 2], zip = store();
  C.playerFiles(zip, { ...options, count: variable.length, frameTicks: variable, loop: true });
  const total = variable.reduce((a, b) => a + b), result = simulate(zip, options.namespace, 20 + total * 2);
  let expected = 20;
  for (let i = 0; i < result.frames.length; i++) {
    assert.deepEqual(result.frames[i], [expected, i % variable.length]); expected += variable[i % variable.length];
  }
  assert.equal(result.frames.length, variable.length * 2 + 1);
  const oldController = old.MapCinemaCore.controllerStructure(1900, 1, false, i => 'say ' + i);
  const oldNBT = nbt(oldController.data);
  assert.equal(Object.keys(oldNBT.structure.palette.default.block_position_data).length, 1914);
  for (const rotation of [0, 90, 180, 270]) {
    const rotated = store(), player = C.playerFiles(rotated, { ...options, rotation, count: 3 });
    const offset = [90, 270].includes(rotation) ? 10 : 6;
    assert.equal(player.control[2], offset);
    const fn = 'behavior_packs/' + options.namespace + '/functions/' + options.namespace + '/';
    assert.ok(rotated.files.get(fn + 'stop.mcfunction').includes('~' + offset));
    assert.ok(rotated.files.get(fn + 'clock_begin.mcfunction').includes(`~ ~ ~${offset}`));
    assert.ok(rotated.files.get(fn + 'frames_0_2.mcfunction').includes(`~-${offset} ${rotation}_degrees`));
    const play = rotated.files.get(fn + 'play.mcfunction');
    assert.ok(play.lastIndexOf(' air\n') < play.indexOf(`function ${options.namespace}/place\n`), 'Clear old controller before restoring the screen');
  }
  const video = new current.JSZip();
  const frameOptions = { columns: 3, rows: 1, ticks: 1, loop: false, origin: [0, 64, 0], rotation: 0,
    output: 'video', name: 'refresh-test', capacityMiB: 128, reuseTiles: true, tileThreshold: 0, dedupe: true, start: 0 };
  await C.writeVideoFrames(video, { options: frameOptions, count: 121, id: 'refresh_test', frameAt: async frame =>
    [0, 1, 2].map((tile) => { const b = new Uint8Array(65536); b.fill(255); b[0] = tile === 2 ? frame : tile; return b; }) });
  for (const [frame, count] of [[0, 3], [1, 1], [39, 1], [40, 3], [80, 3], [120, 3]]) {
    const bytes = await video.file('behavior_packs/mv_refresh_test/structures/mv_refresh_test/f' + String(frame).padStart(6, '0') + '.mcstructure').async('uint8array');
    const value = nbt(bytes); assert.equal(Object.keys(value.structure.palette.default.block_position_data).length, count);
  }
  const legacyVideo = new old.JSZip();
  await old.MapCinemaCore.writeVideoFrames(legacyVideo, { options: { ...frameOptions, columns: 1 }, count: 3, id: 'legacy_test',
    frameAt: async frame => { const b = new Uint8Array(65536); b.fill(255); b[0] = frame; return [b]; } });
  const legacyWorld = new old.JSZip(); legacyWorld.file('level.dat', old.MapCinemaCore.levelDat('legacy-test')); legacyWorld.file('levelname.txt', 'legacy-test');
  await old.MapCinemaCore.installVideoPackage(legacyWorld, legacyVideo, {});
  const fixtures = path.join(__dirname, 'fixtures');
  const rotatedVideo = new current.JSZip();
  await C.writeVideoFrames(rotatedVideo, { options: { ...frameOptions, columns: 8, rotation: 90 }, count: 2, id: 'rotated_test',
    frameAt: async frame => Array.from({ length: 8 }, () => { const b = new Uint8Array(65536); b.fill(255); b[0] = frame; return b; }) });
  const rotatedWorld = new current.JSZip(); rotatedWorld.file('level.dat', C.levelDat('rotated-test')); rotatedWorld.file('levelname.txt', 'rotated-test');
  const installed = await C.installVideoPackage(rotatedWorld, rotatedVideo, {});
  for (let repair = 0; repair < 2; repair++) {
    await C.installVideoPackage(rotatedWorld, rotatedVideo, { repairController: true });
    const saved = JSON.parse(await rotatedWorld.file(`MapCinema-${installed.namespace}-player.json`).async('string'));
    assert.equal(saved.controlOffsetZ, 10);
    const stop = await rotatedWorld.file(installed.dir + `functions/${installed.namespace}/stop.mcfunction`).async('string');
    assert.ok(stop.includes('fill ~-1 ~ ~10 ~0 ~0 ~10 air'));
    assert.ok(!stop.includes('~6'), 'Repeated repair must retain the shifted controller coordinates');
  }
  const summary = { clockBoundaryCases: 9, longestFrameCount: 16384, maxCommandsPerTick: largest,
    userCase: { seconds: 95, fps: 20, tiles: 32, frames: 1900, oldCommandBlocks: 1914, newCommandBlocks: 1 },
    variableFrameDurationsAndLoop: true, nonLoopPreservesLastFrame: true,
    fourRotationsKeepControllerOutsideScreen: true,
    rotatedControllerSurvivesRepeatedRepair: true, cleanupPrecedesScreenPlacement: true,
    periodicFullFramesAtTicks: [0, 40, 80, 120], staticTilesStillSkippedBetweenRefreshes: true,
    minecraftRuntimeTested: false };
  fs.writeFileSync(path.join(root, 'logs/playback-tests.json'), JSON.stringify(summary, null, 2));
  console.log('PASS:', JSON.stringify(summary));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
