'use strict';
// Ordinary China PC: structures and native commands only. No application behavior pack or Script API.
function build(C, { namespace: ns, columns, rows, count, loop, origin, controlOrigin, prefetch }) {
  const slots = Math.min(prefetch.frames, count), width = Math.min(5, slots) * columns, height = Math.ceil(slots / 5) * rows;
  if (height > 256) throw new Error(`预加载墙需要 ${height} 格高度，超过中国版 256 格布局上限，请减少预加载帧数或屏幕行数。`);
  const helperOrigin = [controlOrigin[0], controlOrigin[1], controlOrigin[2] + 16];
  const ref = [helperOrigin[0], helperOrigin[1], helperOrigin[2] + 14];
  const objective = 'pf' + ns.slice(-12), tag = suffix => ns + '_' + suffix, station = `@e[type=area_effect_cloud,tag=${tag('station')}]`;
  const score = (name, range) => `if score ${name} ${objective} matches ${range}`, relative = n => '~' + (n || ''), at = (x, y, z) => [x, y, z].map(relative).join(' ');
  const xStart = Math.floor((16 - width) / 2), slotOffset = s => [xStart + s % 5 * columns, Math.floor(s / 5) * rows, 7];
  const clock = (commands, loopClock, delays = commands.map(() => 0)) => C.controllerStructure(commands.length, 1, loopClock, i => commands[i], undefined, true,
    { delays, totalTicks: delays.reduce((a,b) => a + b, 0) + 1 });
  const N = C.N, ints = a => N.list(3, a.map(N.int)), floats = a => N.list(5, a.map(N.float));
  function structure(size, indices, palette, entities = []) {
    return C.nbt({ format_version: N.int(1), size: ints(size), structure_world_origin: ints([0,0,0]), structure: N.compound({
      block_indices: N.list(9, [ints(indices), ints(indices.map(() => -1))]), entities: N.list(10, entities),
      palette: N.compound({ default: N.compound({ block_palette: N.list(10, palette), block_position_data: N.compound({}) }) }) }) });
  }
  const air = N.compound({ name: N.string('minecraft:air'), states: N.compound({}), version: N.int(18168865) });
  function marker(tags, duration, work = false) {
    const p = [.5, 0, .5];
    const entity = tags => N.compound({
      identifier: N.string('minecraft:area_effect_cloud'), Pos: floats(p), Rotation: floats([0,0]), Motion: floats([0,0,0]),
      Tags: N.list(8, tags.map(N.string)), Duration: N.int(duration), InitialRadius: N.float(.5), RadiusPerTick: N.float(0), RadiusOnUse: N.float(0),
      RadiusChangeOnPickup: N.float(0), DurationOnUse: N.int(0), ReapplicationDelay: N.int(20), ParticleColor: N.int(0), PotionId: N.short(-1), mobEffects: N.list(10, [])
    });
    return structure([1,1,1], [-1], [air], work ? [entity(tags), entity([tag('work')])] : [entity(tags)]);
  }
  const records = new Map(), put = (name, data) => records.set('structuretemplate_' + ns + ':' + name, data);
  put('pf_viewer', marker([tag('viewer')], 20));
  put('pf_air', structure([1,height,2], Array(height * 2).fill(0), [air]));
  put('pf_blank', structure([columns,rows,2], Array(columns * rows * 2).fill(0), [air]));
  const grid = [];
  for (let x = Math.floor((origin[0] - 64) / 16) * 16; x <= origin[0] + 64; x += 16) for (let z = Math.floor((origin[2] - 64) / 16) * 16; z <= origin[2] + 64; z += 16) {
    const id = grid.length, own = `@e[type=area_effect_cloud,tag=${tag('station'+id)}]`, viewers = `@e[type=area_effect_cloud,tag=${tag('viewer')},x=${x},y=-64,z=${z},dx=15,dy=383,dz=15]`;
    grid.push({ id, x, z, own, viewers }); put('pf_station' + id, marker([tag('station'), tag('station'+id), tag('unready')], 2147483647, true));
  }
  const commands = [], active = score('active', '1'), execute = (conditions, command) => `execute ${conditions} run ${command}`;
  const work = `@e[type=area_effect_cloud,tag=${tag('work')}]`, paired = `@e[type=area_effect_cloud,tag=${tag('work')},r=0.1,c=1]`;
  const op = (name, operator, source) => `scoreboard players operation ${name} ${objective} ${operator} ${source} ${objective}`;
  commands.push(op('snap_step','=', 'step'), op('snap_frame','=', 'frame'));
  commands.push(`kill @e[type=area_effect_cloud,tag=${tag('viewer')}]`, execute(active + ` positioned ${origin.join(' ')} as @a[r=64] at @s align xyz`, `structure load "${ns}:pf_viewer" ~ ~ ~ 0_degrees none true false`),
    `tag ${station} remove ${tag('seen')}`);
  for (const g of grid) commands.push(execute(`if entity ${g.viewers}`, `tag ${g.own} add ${tag('seen')}`));
  commands.push(`tag @e[type=area_effect_cloud,tag=${tag('station')},tag=!${tag('seen')}] add ${tag('old')}`,
    execute(`as ${station} unless score @s ${objective} = session ${objective}`, `tag @s add ${tag('old')}`),
    execute(`unless score active ${objective} matches 1`, `tag ${station} add ${tag('old')}`));
  const old = `@e[type=area_effect_cloud,tag=${tag('old')},c=1]`;
  const loaded = `if blocks ${at(xStart,0,7)} ${at(xStart+width-1,height-1,8)} ${at(xStart,0,7)} all`;
  commands.push(execute(`as ${old} at @s ${loaded}`, `tag @s add ${tag('clear')}`));
  const clearing = `@e[type=area_effect_cloud,tag=${tag('clear')}]`;
  for (const [z, block] of [[8,'frame'], [7,'barrier']]) commands.push(execute(`at ${clearing}`, `fill ${at(xStart,0,z)} ${at(xStart+width-1,height-1,z)} air replace ${block}`));
  commands.push(execute(`at ${clearing}`, `kill ${paired}`), execute(`if entity ${clearing}`, `scoreboard players remove count ${objective} 1`), `kill ${clearing}`, `scoreboard players set new ${objective} 0`);
  let airCheck = '';
  for (let x = xStart; x < xStart + width; x++) airCheck += ` if blocks ${at(x,0,7)} ${at(x,height-1,8)} ${ref.join(' ')} all`;
  for (const g of grid) {
    const firstViewer = g.viewers.slice(0,-1) + ',c=1]';
    commands.push(execute(`${active} ${score('new','0')} ${score('count','0..3')} unless entity ${g.own} as ${firstViewer} at @s positioned ${g.x} ~${prefetch.height} ${g.z}${airCheck}`,
      `structure load "${ns}:pf_station${g.id}" ~ ~ ~ 0_degrees none true false`));
    commands.push(execute(`as ${g.own} unless score @s ${objective} matches 0..`, `scoreboard players operation @s ${objective} = session ${objective}`),
      execute(`as ${g.own} unless score @s ${objective}_b matches 0..`, `scoreboard players set @s ${objective}_b 0`),
      execute(`as ${g.own} unless entity @s[tag=${tag('counted')}]`, `scoreboard players add count ${objective} 1`),
      execute(`as ${g.own} unless entity @s[tag=${tag('counted')}]`, `scoreboard players set new ${objective} 1`),
      `tag ${g.own} add ${tag('counted')}`);
  }
  // Read immutable frame structures. A monotonic step survives differing chunk tick order.
  function render(workTag) {
    const workers = `@e[type=area_effect_cloud,tag=${tag('work')},tag=${tag(workTag)}]`, todo = `${active} ${score('todo','1')}`;
    commands.push(op('ahead','=', 'snap_step'), op('ahead','%=', 'nslots'), op('target','=', 'slot'), op('target','-=', 'ahead'),
      `scoreboard players add target ${objective} ${slots}`, op('target','%=', 'nslots'), `scoreboard players add target ${objective} 1`, op('target','+=', 'snap_frame'));
    if(loop) commands.push(op('target','%=', 'nframes'));
    for(let s=0;s<slots;s++) commands.push(execute(`${todo} ${score('slot',s)} as ${workers} at @s`, `tp @s ${slotOffset(s).map(relative).join(' ')}`));
    for(let f=0;f<count;f++) commands.push(execute(`${todo} ${score('target',f)} at ${workers}`, `structure load "${ns}:pf_f${String(f).padStart(6,'0')}" ~ ~ ~`));
    if(!loop) commands.push(execute(`${todo} ${score('target',count+'..')} at ${workers}`, `structure load "${ns}:pf_blank" ~ ~ ~`));
    for(let s=0;s<slots;s++) commands.push(execute(`${todo} ${score('slot',s)} as ${workers} at @s`, `tp @s ${slotOffset(s).map(n=>relative(-n)).join(' ')}`));
  }
  commands.push(`tag ${work} remove ${tag('use')}`, execute(`as ${station} unless entity @s[tag=${tag('old')}] at @s ${loaded}`, `tag ${paired} add ${tag('use')}`),
    `scoreboard players set todo ${objective} 0`, execute(`${active} if score done ${objective} < snap_step ${objective}`, `scoreboard players set todo ${objective} 1`),
    op('slot','=', 'done'), op('slot','%=', 'nslots'));
  render('use');
  commands.push(execute(`${active} ${score('todo','1')}`, `scoreboard players add done ${objective} 1`), op('cursor','=', 'done'), op('cursor','%=', 'nslots'));
  commands.push(execute(`as @e[type=area_effect_cloud,tag=${tag('unready')},tag=!${tag('old')},c=1] at @s ${loaded}`, `tag @s add ${tag('job')}`));
  const job = `@e[type=area_effect_cloud,tag=${tag('job')}]`;
  commands.push(execute(`at ${job}`, `tag ${paired} add ${tag('wjob')}`));
  for(let i=0;i<4;i++) {
    commands.push(`scoreboard players set todo ${objective} 0`, execute(`${active} as ${job} if score @s ${objective}_b matches 0..${slots-1}`, `scoreboard players set todo ${objective} 1`),
      execute(`as ${job}`, `scoreboard players operation slot ${objective} = @s ${objective}_b`));
    render('wjob');
    commands.push(execute(`${active} ${score('todo','1')} as ${job}`, `scoreboard players add @s ${objective}_b 1`));
  }
  commands.push(`tag ${work} remove ${tag('wjob')}`,
    execute(`as ${job} if score @s ${objective}_b matches ${slots}..`, `tag @s remove ${tag('unready')}`), `tag ${station} remove ${tag('job')}`,
    execute(`${active} ${score('start','1')} unless entity @e[type=area_effect_cloud,tag=${tag('unready')},tag=!${tag('old')}]`, `structure load "${ns}:video" ${controlOrigin.join(' ')}`),
    execute(`${active} unless entity @e[type=area_effect_cloud,tag=${tag('unready')},tag=!${tag('old')}]`, `scoreboard players set start ${objective} 0`));
  const stop = `${score('active','0')} ${score('count','0')} ${score('init','0')} ${score('start','0')}`;
  commands.push(execute(stop, `fill ${ref.join(' ')} ${[ref[0],ref[1]+height-1,ref[2]+1].join(' ')} air`));
  const helperCount = commands.length + 1;
  if(helperCount>16384) throw new Error('中国版预加载辅助命令链超过单区块容量，请缩短视频或降低帧率。');
  const helperLayout = C.controllerLayout(helperCount, true), dimensions = [helperLayout.width+1,helperLayout.height,helperLayout.depth];
  commands.push(execute(stop, `fill ${helperOrigin.join(' ')} ${[helperOrigin[0]+dimensions[0]-1,helperOrigin[1]+dimensions[1]-1,helperOrigin[2]+dimensions[2]-1].join(' ')} air`));
  const helper = clock(commands, true); put('pf_tick', helper.data);
  const wrapper = [], delays = [], add = (command, delay = 0) => { wrapper.push(command); delays.push(delay); };
  add(`scoreboard objectives add ${objective} dummy`); add(`scoreboard objectives add ${objective}_b dummy`);
  add(execute(`unless score count ${objective} matches 0..`, `scoreboard players set count ${objective} 0`));
  for (const [name,value] of [['active',0],['init',1],['start',0],['cursor',0],['done',0],['step',0],['frame',-1],['nslots',slots],['nframes',count]]) add(`scoreboard players set ${name} ${objective} ${value}`);
  add(`scoreboard players add session ${objective} 1`); add(`structure load "${ns}:pf_tick" ${helperOrigin.join(' ')}`);
  add(`stopsound @a ${ns}.audio`);
  add(`structure load "${ns}:pf_air" ${ref.join(' ')}`, 5);
  for (const [name,value] of [['init',0],['start',1],['active',1]]) add(`scoreboard players set ${name} ${objective} ${value}`);
  const launch = clock(wrapper, false, delays); put('play', launch.data);
  const requiredHeight = Math.max(helper.height, launch.height, height);
  if (controlOrigin[1] + requiredHeight > 320) throw new Error(`中国版预加载控制区需要 ${requiredHeight} 格高度，请将屏幕原点 Y 调至 ${320-requiredHeight} 或更低。`);
  function preloadFrame(bytes) {
    const input = Buffer.from(bytes), old = Buffer.from('minecraft:stone'), at = input.indexOf(old), next = Buffer.from('minecraft:barrier'), length = Buffer.alloc(2); length.writeUInt16LE(next.length);
    if (at < 2 || input.readUInt16LE(at-2) !== old.length) throw new Error('预加载画面缺少预期背板。');
    return Buffer.concat([input.subarray(0,at-2), length, next, input.subarray(at+old.length)]);
  }
  return { records, objective, slots, preloadFrame, requiredHeight, maxNodes: Math.max(C.controllerNodes(helperCount,true).length,C.controllerNodes(wrapper.length,true).length),
    launchSize:[launch.width,launch.height,launch.depth], info: { ...prefetch, frames: slots, layout:'stacked', perRow:5, maxStations:4, viewerRange:64, helperOrigin, helperSize:[helper.width,helper.height,helper.depth], wallSize:[width,height,2], reference:ref, objective, tagPrefix:ns, prepareBeforePlayback:true, updateMode:'score-ring', gameVerified:false },
    frameCommands(frame) { return [`scoreboard players set frame ${objective} ${frame}`, `scoreboard players add step ${objective} 1`]; },
    stopCommands: ['active','start','init'].map(name => ({ label:'停止预加载'+name, text:`/scoreboard players set ${name} ${objective} 0` })) };
}
module.exports = { build };
