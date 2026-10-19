// Appended to the unmodified runtime function by prefetch-engine.py.
const dimension = world.getDimension('overworld');
let viewers = [], began = false, runtime, objective;
const fakeWorld = {
  getDimension: id => world.getDimension(id), getAllPlayers: () => viewers,
  scoreboard: world.scoreboard, structureManager: world.structureManager,
  getDynamicProperty: key => world.getDynamicProperty(key),
  setDynamicProperty: (key, value) => world.setDynamicProperty(key, value),
};
const check = (ok, label) => { if (!ok) throw new Error('[PrefetchFAIL] ' + label); console.warn('[PrefetchPASS] ' + label); };
const player = x => ({ dimension, location: { x, y: 64, z: 2 } });
function walls(x) {
  let count = 0;
  for (let bx = x + 7; bx < x + 9; bx++) for (let z = 5; z < 11; z++) {
    const type = dimension.getBlock({ x: bx, y: 76, z }).typeId;
    if (type === 'minecraft:frame' || type === 'minecraft:stone') count++;
  }
  return count;
}
function stage(delay, fn) { system.runTimeout(() => { try { fn(); } catch (e) { console.error(String(e), e.stack); } }, delay); }
runtime = prefetchRuntime(config, fakeWorld, system);
system.afterEvents.scriptEventReceive.subscribe(e => {
  if (e.id === config.namespace + ':prefetch' && e.message === 'tick' && e.sourceBlock && !began) {
    began = true; check(e.sourceBlock.location.z === 6, 'actual command-block event source');
    stage(1, () => dimension.getBlock({ x: -1, y: 64, z: 6 }).setType('minecraft:air'));
    stage(5, () => { check(walls(0) === 12, 'three complete walls placed inside 16x16 chunk'); objective.setScore('mc_frame', 0); });
    stage(8, () => { viewers = [player(16), player(15.9)]; });
    stage(12, () => { check(walls(0) === 12 && walls(16) === 12, 'shared chunk retained while another viewer remains'); viewers = [player(16)]; });
    stage(16, () => { check(walls(0) === 0 && walls(16) === 12, 'crossing boundary cleans old chunk'); runtime.stop(); });
    stage(20, () => {
      check(walls(0) === 0 && walls(16) === 0, 'stop cleans every owned wall');
      check(dimension.getEntities({ type: 'minecraft:item' }).length === 0, 'cleanup does not drop map items');
      viewers = [player(1)];
      dimension.runCommand(`execute positioned 0 64 0 run function ${config.namespace}/play`);
    });
    stage(60, () => {
      console.warn('[PrefetchSTATE] walls=' + walls(0) + ' active=' + objective.getScore('mc_active') + ' frame=' + objective.getScore('mc_frame') + ' prefill=' + objective.getScore('mc_prefill') + ' controller=' + dimension.getBlock({ x: 0, y: 64, z: 6 }).typeId + ' power=' + dimension.getBlock({ x: -1, y: 64, z: 6 }).typeId + ' data=' + world.getDynamicProperty(config.namespace + ':prefetch'));
      check(walls(0) === 12, 'second playback rebuilds walls'); objective.setScore('mc_active', 0);
    });
    stage(64, () => {
      check(walls(0) === 0, 'end-of-playback scoreboard triggers cleanup');
      check(world.getDynamicProperty(config.namespace + ':prefetch') === undefined, 'persisted ownership removed after cleanup');
      console.warn('[PrefetchDONE] Official-engine placement and cleanup checks completed; no client connected.');
    });
  }
});
stage(100, () => {
  objective = world.scoreboard.getObjective(config.objective) || world.scoreboard.addObjective(config.objective, 'prefetch-test');
  objective.setScore('mc_frame', -1); objective.setScore('mc_wait', 20); objective.setScore('mc_active', 1); objective.setScore('mc_prefill', 1);
  viewers = [player(15.9)];
  world.structureManager.place(config.namespace + ':controller', dimension, { x: 0, y: 64, z: 6 });
  dimension.getBlock({ x: -1, y: 64, z: 6 }).setType('minecraft:redstone_block');
  console.warn('[PrefetchSETUP] Waiting for generated repeating-command-block tick.');
});
