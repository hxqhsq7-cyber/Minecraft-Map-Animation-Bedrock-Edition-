'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const helpers = fs.readFileSync(path.join(__dirname, 'playback.cjs'), 'utf8').split('async function main()')[0];
const { modules, nbt } = new Function('require', '__dirname', helpers + '\nreturn { modules, nbt };')(require, __dirname);
const root = path.resolve(__dirname, '..'), context = modules(fs.readFileSync(path.join(root, 'app/MapCinema.html'), 'utf8'));
const C = context.MapCinemaCore, prefetch = { enabled: true, frames: 3, height: 12 };
const config = { namespace: 'mv_prefetch_test', objective: 'test', columns: 8, rows: 4, count: 10, controlZ: 6, loop: true, prefetch };
function mock(config, saved = new Map()) {
  let init, tick, event, score = { mc_active: 1, mc_frame: -1 }, players = [], unloaded = new Set();
  const blocks = new Map(), placements = [], id = p => [p.x, p.y, p.z].join(','), chunk = p => `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`;
  const dim = { id: 'minecraft:overworld', heightRange: { min: -64, max: 320 }, getEntities: () => [], getBlock(p) {
    if (unloaded.has(chunk(p))) return undefined;
    const key = id(p);
    return { get typeId() { return blocks.get(key) || 'minecraft:air'; }, get isAir() { return !blocks.has(key); },
      setType(type) { if (type === 'minecraft:air') blocks.delete(key); else blocks.set(key, type); } };
  } };
  const source = { typeId: 'minecraft:repeating_command_block', dimension: dim, location: { x: 0, y: 64, z: 6 } };
  blocks.set('0,64,6', source.typeId);
  const world = { getDimension: () => dim, getAllPlayers: () => players,
    scoreboard: { getObjective: () => ({ getScore: k => score[k] }) },
    getDynamicProperty: k => saved.get(k), setDynamicProperty: (k, v) => { if (v === undefined) saved.delete(k); else saved.set(k, v); },
    structureManager: { place(name, d, p) {
      assert.equal(d, dim); placements.push({ name, p: {...p} });
      for (let x = 0; x < config.columns; x++) for (let y = 0; y < config.rows; y++) for (let z = 0; z < 2; z++) {
        const pos = { x: p.x + x, y: p.y + y, z: p.z + z }; assert.ok(!unloaded.has(chunk(pos)), 'Queued an unloaded structure');
        blocks.set(id(pos), z ? 'minecraft:frame' : 'minecraft:stone');
      }
    } } };
  const system = { run: fn => { init = fn; }, runInterval: fn => { tick = fn; }, afterEvents: { scriptEventReceive: { subscribe: fn => { event = fn; } } } };
  const runtime = C.prefetchRuntime(config, world, system); init();
  return { world, system, dim, blocks, placements, saved, unloaded, runtime, source,
    tick: () => tick(), start: () => runtime.start(source),
    stop: () => event({ id: config.namespace + ':prefetch', message: 'stop' }),
    players: (...locations) => { players = locations.map(location => ({ dimension: dim, location })); },
    frame: n => { score.mc_frame = n; }, active: n => { score.mc_active = n; },
    walls: () => [...blocks].filter(([, v]) => ['minecraft:frame', 'minecraft:stone'].includes(v)) };
}
async function main() {
  for (const frames of [0, 201, 1.5]) assert.throws(() => C.normalizePrefetch({ ...prefetch, frames }));
  assert.equal(C.normalizePrefetch(null), null);
  const r = mock(config); r.players({ x: 15.9, y: 64, z: 2 }); r.start(); r.tick();
  assert.equal(r.placements.length, 3); assert.deepEqual(r.placements.map(v => v.p), [{x:-4,y:76,z:7},{x:4,y:76,z:7},{x:12,y:76,z:7}]);
  assert.equal(r.walls().length, 8 * 4 * 2 * 3);
  for (let frame = 0; frame < 10; frame++) { const before = r.placements.length; r.frame(frame); r.tick(); assert.equal(r.placements.length, before + 1, 'Ring must load only one future frame'); }
  r.frame(0); r.tick(); assert.ok(r.placements.at(-1).name.endsWith('p000003'), 'Loop should wrap lookahead');
  const before = r.placements.length;
  r.players({ x: 15.99, y: 67, z: 2 }); r.tick(); assert.equal(r.placements.length, before, 'Within-chunk motion rebuilt walls');
  r.players({ x: 32, y: 64, z: 2 }, { x: 15, y: 64, z: 2 }); r.tick();
  assert.equal(r.walls().length, 8 * 4 * 2 * 3 * 2, 'Same-chunk remaining viewer lost walls');
  r.players({ x: 32, y: 64, z: 2 }); r.tick(); assert.equal(r.walls().length, 8 * 4 * 2 * 3);
  assert.ok(r.walls().every(([key]) => +key.split(',')[0] >= 28), 'Old chunk was not cleaned');
  r.stop(); r.tick(); assert.equal(r.walls().length, 0); assert.equal(r.saved.size, 0);
  const n = mock(config); n.players({ x: -0.1, y: 64, z: -0.1 }); n.start(); n.tick();
  assert.deepEqual(n.placements[0].p, {x:-20,y:76,z:-9});
  n.unloaded.add('-1,-1'); n.players({ x: 32, y: 64, z: 2 }); n.tick(); n.stop(); n.tick();
  assert.ok(n.saved.size, 'Unloaded cleanup must survive restart');
  const oldBlocks = [...n.blocks];
  const restart = mock({ ...config, prefetch: null }, n.saved); oldBlocks.forEach(([k, v]) => restart.blocks.set(k, v));
  restart.tick(); assert.equal(restart.walls().length, 0); assert.equal(restart.saved.size, 0);
  const occupied = mock(config); occupied.blocks.set('-4,76,7', 'minecraft:diamond_block');
  occupied.players({ x: 1, y: 64, z: 1 }); occupied.start(); occupied.tick();
  assert.equal(occupied.placements.length, 2); assert.equal(occupied.blocks.get('-4,76,7'), 'minecraft:diamond_block');
  const ending = mock({ ...config, loop: false }); ending.players({ x: 1, y: 64, z: 1 }); ending.start(); ending.tick();
  ending.frame(9); ending.tick(); assert.equal(ending.walls().length, 0); ending.active(0); ending.tick(); assert.equal(ending.saved.size, 0);
  ending.active(1); ending.frame(-1); ending.start(); ending.tick(); assert.equal(ending.placements.length, 6, 'Replay failed');
  const towerConfig = { ...config, count: 400, prefetch: { ...prefetch, frames: 200 } };
  const tower = mock(towerConfig); tower.players({x: 1, y: 64, z: 1}); tower.start();
  for (let tick = 0; tick < 25; tick++) { const before = tower.placements.length; tower.tick(); assert.equal(tower.placements.length - before, 8, 'Construction must be batched'); }
  assert.equal(tower.placements.length, 200); assert.equal(tower.walls().length, 12800);
  for (let i = 0; i < 200; i++) assert.deepEqual(tower.placements[i].p, {x:-12 + i % 5 * 8, y:76 + Math.floor(i/5)*4, z:7});
  assert.equal(new Set(tower.walls().map(([key]) => key)).size, 12800, 'Stacked walls overlap');
  tower.frame(0); tower.tick(); assert.equal(tower.placements.length, 201, 'Full tower must refresh only one future frame');
  assert.ok(tower.placements.at(-1).name.endsWith('p000200'));
  tower.players({x: 16, y: 64, z: 1}); tower.tick();
  const pendingTower=JSON.parse(tower.saved.get(config.namespace+':prefetch')).stations.find(s=>s.pending);
  const ownedCount=pendingTower.owned.reduce((sum,word)=>sum+((word>>>0).toString(2).match(/1/g)||[]).length,0);
  assert.equal(ownedCount,192,'Chunk migration must clear eight old walls per tick');
  tower.stop(); for(let i=0;i<60;i++) tower.tick(); assert.equal(tower.walls().length, 0); assert.equal(tower.saved.size, 0);
  const short = mock({...towerConfig, count: 7}); short.players({x:1,y:64,z:1}); short.start(); short.tick();
  assert.equal(short.placements.length, 7); assert.deepEqual(short.placements[6].p, {x:-4,y:80,z:7});
  const high = mock(towerConfig); high.players({x:1,y:200,z:1});
  // Put the controller near the elevated viewer so the height check is actually reached.
  high.source.location.y=200; high.blocks.set('0,200,6',high.source.typeId); high.start(); high.tick(); assert.equal(high.placements.length,0);
  const crowded = mock(towerConfig); crowded.players({x:1,y:64,z:1});
  for (let i=0;i<40;i++) crowded.blocks.set(`${-12+i%5*8},${76+Math.floor(i/5)*4},7`, 'minecraft:diamond_block');
  crowded.start(); for(let i=0;i<30;i++) crowded.tick();
  assert.equal(crowded.placements.length, 160, 'Obstructed first slots must not starve the other walls');
  const crowdedSaved=JSON.parse(crowded.saved.get(config.namespace+':prefetch'));
  assert.ok(crowdedSaved.stations[0].owned.every(Number.isInteger));
  const crowdedReload=mock({...towerConfig,prefetch:null},new Map(crowded.saved)); for(const [key,value] of crowded.blocks) crowdedReload.blocks.set(key,value);
  for(let i=0;i<30;i++) crowdedReload.tick(); assert.equal(crowdedReload.walls().length,0,'Ownership words after an obstructed first word must survive reload');
  crowded.stop(); for(let i=0;i<30;i++) crowded.tick(); assert.equal(crowded.blocks.get('-12,76,7'),'minecraft:diamond_block');
  const legacyState = new Map([[config.namespace+':prefetch', JSON.stringify({controller:null,stations:[{id:'legacy',dim:'minecraft:overworld',x:4,y:76,z:5,columns:8,rows:4,slots:3}]})]]);
  const legacy = mock({...config,prefetch:null}, legacyState);
  for(let i=0;i<3;i++) for(let x=0;x<8;x++) for(let y=0;y<4;y++) for(let z=0;z<2;z++) legacy.blocks.set(`${4+x},${76+y},${5+i*2+z}`,z?'minecraft:frame':'minecraft:stone');
  legacy.tick(); assert.equal(legacy.walls().length,0); assert.equal(legacy.saved.size,0,'Old horizontal layout must still be cleaned after update');
  // Ownership of partially built 200-wall towers must survive a world reload.
  const partial = mock(towerConfig); partial.players({x:1,y:64,z:1}); partial.start(); partial.tick();
  const partialReload = mock({...towerConfig,prefetch:null}, partial.saved); for(const [key,value] of partial.blocks) partialReload.blocks.set(key,value);
  partialReload.tick(); assert.equal(partialReload.walls().length,0); assert.equal(partialReload.saved.size,0);
  const pixels = i => [new Uint8Array(65536).fill(i), new Uint8Array(65536).fill(7)];
  let sample;
  for (const reuseTiles of [false, true]) for (const anchor of [null, { mode: 'armor_stand', name: 'test', offset: [0, 2, 0] }]) {
    const video = new context.JSZip();
    const info = await C.writeVideoFrames(video, { options: { name: 'prefetch', output: 'video', columns: 2, rows: 1, ticks: 1, start: 0, origin: [0, 64, 0], rotation: 0, loop: true, dedupe: false, reuseTiles, anchor, prefetch }, count: 4, id: 'prefetch_test', frameAt: async i => pixels(i), zipLib: null });
    const metadata = await C.readVideoPackage(video); assert.equal(metadata.version, 6); assert.equal(metadata.frameTicks.length, 4);
    const manifest = JSON.parse(await video.file(info.dir + 'manifest.json').async('string'));
    assert.ok(manifest.dependencies.some(d => d.module_name === '@minecraft/server' && d.version === '2.0.0'));
    for (let frame = 0; frame < 4; frame++) {
      const tree = nbt(await video.file(`${info.dir}structures/${info.namespace}/p${String(frame).padStart(6, '0')}.mcstructure`).async('uint8array'));
      assert.equal(Object.keys(tree.structure.palette.default.block_position_data).length, 2, 'Preload structure was delta-only');
    }
    const world = new context.JSZip(); world.file('level.dat', C.levelDat('prefetch'));
    await C.installVideoPackage(world, video, {});
    const frame0 = await world.file(`${info.dir}structures/${info.namespace}/f000000.mcstructure`).async('uint8array');
    await C.installVideoPackage(world, video, { repairController: true, prefetchOverride: { ...prefetch, frames: 200 } });
    assert.deepEqual(await world.file(`${info.dir}structures/${info.namespace}/f000000.mcstructure`).async('uint8array'), frame0);
    await C.upgradeInstalledWorld(world, { prefetchOverride: null });
    const again = await C.upgradeInstalledWorld(world); assert.equal(again.prefetch, null, 'Disabled settings were resurrected');
    const cleanupScript = await world.file(info.dir + 'scripts/prefetch.js').async('string'); assert.ok(cleanupScript.includes('"prefetch":null'));
    await C.installVideoPackage(world, video, { optimizeExisting: true, prefetchOverride: prefetch });
    if (!reuseTiles && !anchor) sample = video;
  }
  const old = await context.JSZip.loadAsync(fs.readFileSync(path.join(__dirname, 'fixtures/direct-v13.mcworld')));
  const result = await C.upgradeInstalledWorld(old, { prefetchOverride: prefetch }); assert.ok(result.prefetch);
  assert.ok(old.file(`behavior_packs/${result.namespace}/structures/${result.namespace}/p000044.mcstructure`));
  await C.upgradeInstalledWorld(old); await C.upgradeInstalledWorld(old, { prefetchOverride: null });
  const fixture = path.join(root, 'tests/output/prefetch-fixture'); fs.mkdirSync(fixture, { recursive: true });
  for (const name of Object.keys(sample.files)) if (name.startsWith('behavior_packs/') && !sample.files[name].dir) {
    const target = path.join(fixture, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, await sample.file(name).async('uint8array'));
  }
  const preloadDir = path.join(fixture,'behavior_packs/mv_prefetch_test/structures/mv_prefetch_test');
  for(let i=4;i<200;i++) fs.copyFileSync(path.join(preloadDir,`p${String(i%4).padStart(6,'0')}.mcstructure`),path.join(preloadDir,`p${String(i).padStart(6,'0')}.mcstructure`));
  fs.writeFileSync(path.join(root, 'logs/prefetch-tests.json'), JSON.stringify({ chunkSize: [16, 16], customFrames: [1, 200], fiveCompleteFramesPerRow: true, upwardRows: 40, boundedCreateAndCleanup: true, oldLayoutCleanup: true, heightLimitChecked: true, obstructedSlotsDoNotStarve: true, negativeChunkMath: true, ringWritesOneFrame: true, sharedViewers: true, withinChunkStable: true, crossedChunkCleaned: true, unloadedCleanupPersistent: true, noTerrainOverwrite: true, nonLoopEndAndReplay: true, v6NewPackages: true, fixedAndAnchor: true, repairAndOptimize: true, worldOnlyWithoutVideo: true, disableAndRepeat: true, clientRenderingTested: false }, null, 2));
  console.log('PASS: 200-frame stacked prefetch, shared viewers, ring reuse, cleanup, persisted unloaded chunks and all export/upgrade paths.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
