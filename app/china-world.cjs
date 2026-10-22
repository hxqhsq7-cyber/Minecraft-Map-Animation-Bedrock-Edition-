'use strict';
// China PC's ordinary XOR world format; no add-on/resource-centre decryption.
const fs = require('node:fs'), fsp = fs.promises, path = require('node:path'), vm = require('node:vm');
const { createHash, randomBytes, webcrypto } = require('node:crypto');
const { parentPort, workerData, isMainThread } = require('node:worker_threads');
const { resolveWorld } = require('./china-path.cjs');
const MAGIC = Buffer.from([0x80, 0x1d, 0x30, 0x01]), KEY = Buffer.from('88329851');
const databaseFile = name => /^db\/(?:CURRENT|MANIFEST-\d+|\d+\.(?:ldb|sst))$/.test(name);
function encrypted(bytes) { return bytes.subarray(0, 4).equals(MAGIC); }
function decrypt(bytes) {
  if (!encrypted(bytes)) return bytes;
  const result = Buffer.from(bytes.subarray(4));
  for (let i = 0; i < result.length; i++) result[i] ^= KEY[i % 8];
  return result;
}
function encrypt(bytes) {
  const result = Buffer.alloc(bytes.length + 4); MAGIC.copy(result);
  for (let i = 0; i < bytes.length; i++) result[i + 4] = bytes[i] ^ KEY[i % 8];
  return result;
}
function loadEngine() {
  const html = fs.readFileSync(path.join(__dirname, 'MapCinema.html'), 'utf8');
  const context = vm.createContext({ Uint8Array, Uint16Array, Uint32Array, Int32Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder, Blob, Response, ReadableStream, WritableStream, CompressionStream, DecompressionStream,
    crypto: webcrypto, setTimeout, clearTimeout, setImmediate, console });
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  for (const code of scripts.slice(0, 4)) vm.runInContext(code, context);
  if (!context.MapCinemaCore || !context.MapCinemaDisk) throw new Error('方映核心文件不完整。');
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'reverse.js'), 'utf8'), context);
  return { C: context.MapCinemaCore, D: context.MapCinemaDisk, A: context.MapCinemaAudio, R: context.MapCinemaReverse };
}
async function listFiles(directory, prefix = '', check = () => {}) {
  const result = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    check(); const name = prefix + entry.name, target = path.join(directory, entry.name), stat = await fsp.lstat(target);
    if (stat.isSymbolicLink()) throw new Error('世界包含符号链接／目录联接，不能安全生成副本。');
    if (stat.isDirectory()) result.push(...await listFiles(target, name + '/', check));
    else if (stat.isFile()) result.push(name);
    else throw new Error('世界包含不支持的特殊文件。');
  }
  if (result.length > 100000) throw new Error('世界文件数量过多。');
  return result.sort();
}
async function digest(file, check) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) { check(); hash.update(chunk); }
  return hash.digest('hex');
}
class DiskWorld {
  constructor(directory, names, check) {
    this.directory = directory; this.files = Object.fromEntries(names.map(name => [name, { dir: false }]));
    this.pending = new Map(); this.removed = new Set(); this.check = check;
  }
  file(name, value) {
    if (arguments.length > 1) { this.files[name] = { dir: false }; this.pending.set(name, typeof value === 'string' ? Buffer.from(value) : Buffer.from(value)); return this; }
    if (!this.files[name]) return null;
    return { async: async type => { const b = this.pending.get(name) || await fsp.readFile(path.join(this.directory, name)); return type === 'string' ? b.toString('utf8') : new Uint8Array(b); } };
  }
  remove(name) { delete this.files[name]; this.pending.delete(name); this.removed.add(name); }
  async drain() {
    for (const [name, bytes] of this.pending) {
      this.check(); await fsp.mkdir(path.dirname(path.join(this.directory, name)), { recursive: true });
      await fsp.writeFile(path.join(this.directory, name), bytes); this.pending.delete(name);
    }
    for (const name of this.removed) { this.check(); await fsp.rm(path.join(this.directory, name), { force: true }); this.removed.delete(name); }
  }
}
const inside = (child, parent) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
async function cryptFile(file, encode, check) {
  const input = await fsp.open(file, 'r'), magic = Buffer.alloc(4); let encoded;
  try { await input.read(magic,0,4,0); encoded = encrypted(magic); } finally { await input.close(); }
  if (!encode && !encoded) return;
  if (encode && encoded) throw new Error('数据库已加密，不能重复加密。');
  const temporary = file + '.crypt-' + randomBytes(6).toString('hex'); let output;
  try {
    output = await fsp.open(temporary,'wx'); if(encode) await output.writeFile(MAGIC);
    let offset=0;
    for await(const chunk of fs.createReadStream(file,{start:encoded?4:0})) {
      check(); const bytes=Buffer.from(chunk); for(let i=0;i<bytes.length;i++) bytes[i]^=KEY[(offset+i)%8];
      offset+=bytes.length; await output.writeFile(bytes);
    }
    await output.sync(); await output.close(); output=null; check(); await fsp.rename(temporary,file);
  } finally { if(output) await output.close(); await fsp.rm(temporary,{force:true}); }
}
async function validateDatabase(directory, names, check) {
  for(const name of names.filter(n=>/^db\/\d+\.(?:ldb|sst)$/.test(n))) {
    check(); const file=await fsp.open(path.join(directory,name),'r');
    try { const {size}=await file.stat(),tail=Buffer.alloc(8); if(size<48) throw Error('数据库表不完整：'+name); await file.read(tail,0,8,size-8); if(tail.readBigUInt64LE()!==0xdb4775248b80fb57n) throw Error('数据库表的密钥或格式不支持：'+name); }
    finally { await file.close(); }
  }
  const current=(await fsp.readFile(path.join(directory,'db/CURRENT'),'utf8')).trim();
  if(!/^MANIFEST-\d+$/.test(current)||!(await fsp.stat(path.join(directory,'db',current)).catch(()=>null))?.isFile()) throw Error('数据库加密格式不支持或密钥不同；仅支持普通默认密钥世界。');
}
async function snapshot(source, directory, check, progress = () => {}) {
  const names=await listFiles(source,'',check);
  if(!names.includes('level.dat')||!names.includes('db/CURRENT')) throw Error('请选择完整世界目录。');
  if(names.some(n=>n.startsWith('netease_config/'))) throw Error('此入口不支持资源中心／二次加密地图。');
  const hashes=[];let total=0;
  for(const name of names.filter(n=>n!=='db/LOCK')) {
    check(); const src=path.join(source,name),dst=path.join(directory,name); total+=(await fsp.stat(src)).size;
    if(total>64*1024**3) throw Error('世界超过 64 GiB 支持范围。');
    const hash=await digest(src,check); await fsp.mkdir(path.dirname(dst),{recursive:true}); await fsp.copyFile(src,dst,fs.constants.COPYFILE_EXCL);
    if(await digest(dst,check)!==hash) throw Error('复制期间世界发生变化，请完全关闭游戏后重试。');
    hashes.push([name,hash]); progress(hashes.length/names.length);
  }
  const current=(await listFiles(source,'',check)).filter(n=>n!=='db/LOCK');
  if(JSON.stringify(current)!==JSON.stringify(hashes.map(([name])=>name))) throw Error('世界文件列表发生变化，请完全关闭游戏后重试。');
  for(const [name,hash]of hashes) if(await digest(path.join(source,name),check)!==hash) throw Error('游戏正在保存世界，请完全关闭游戏后重试。');
  const copied=hashes.map(([name])=>name);
  for(const name of copied.filter(databaseFile)) await cryptFile(path.join(directory,name),false,check);
  await validateDatabase(directory,copied,check);
  return {names:copied,sourceFingerprint:createHash('sha256').update(JSON.stringify(hashes)).digest('hex')};
}
async function packWorld(D, directory, target, check, progress = () => {}) {
  const temporary=target+'.partial-'+randomBytes(6).toString('hex'); let output;
  try {
    output=await fsp.open(temporary,'wx');
    const writer=new D.ZipWriter({async write(b){await output.writeFile(b);},async close(){await output.sync();await output.close();output=null;}},{checkCancelled:check});
    const names=await listFiles(directory,'',check);let total=0;
    for(let i=0;i<names.length;i++) {
      check();const name=names[i],file=path.join(directory,name);let crc=0,size=0;
      for await(const chunk of fs.createReadStream(file)){check();crc=D.crc32(chunk,crc);size+=chunk.length;}
      total+=size;if(total>D.MAX_RAW_BYTES)throw Error('世界结果超过 64 GiB 支持范围。');
      await writer.addCompressed(name,{method:0,crc,size,compressedSize:size},(await fs.openAsBlob(file)).stream());progress((i+1)/names.length);
    }
    const packed=await writer.close();check();
    try{await fsp.link(temporary,target);}catch(error){if(error.code==='EEXIST')throw Error('输出文件已存在，请换一个名称。');throw Error('无法发布输出文件，请选择本地 NTFS 磁盘：'+error.message);}
    return packed;
  } finally {if(output)await output.close().catch(()=>{});await fsp.rm(temporary,{force:true});}
}
async function persistAudio(directory, info, audioStore, source, check) {
  if(!info.audio||!audioStore)return null;
  const requested=path.resolve(audioStore),parent=await fsp.realpath(path.dirname(requested)),location=path.join(parent,path.basename(requested));
  if(inside(location,source))throw Error('音轨数据目录必须在原世界之外。');
  const stat=await fsp.lstat(location).catch(error=>{if(error.code!=='ENOENT')throw error;});
  if(stat?.isSymbolicLink())throw Error('音轨数据目录不能是目录链接。');
  await fsp.mkdir(location,{recursive:true});const root=await fsp.realpath(location);
  if(inside(root,source))throw Error('音轨数据目录必须在原世界之外。');
  const destination=path.join(root,info.namespace+'_audio');await fsp.mkdir(destination);
  try {
    for(const name of await fsp.readdir(path.join(directory,info.audio.dir))){check();await fsp.cp(path.join(directory,info.audio.dir,name),path.join(destination,name),{recursive:true,force:false,errorOnExist:true});}
    check();return {directory:destination,root};
  } catch(error){await fsp.rm(destination,{recursive:true,force:true});throw error;}
}
function patchLevel(C, input, title, nodeCount) {
  let level = Buffer.from(input); const before = C.readWorldNbt(level.subarray(8)).value;
  const version = before.lastOpenedWithVersion;
  if (!version || version[0] !== 1 || version[1] !== 21) throw new Error('实验入口仅支持中国版 1.21 世界；不会降级其他版本。');
  for (const [key, value, type] of [['cheatsEnabled', 1, 1], ['commandsEnabled', 1, 1], ['commandblocksenabled', 1, 1],
    ...(before.maxcommandchainlength !== undefined && before.maxcommandchainlength < nodeCount ? [['maxcommandchainlength', nodeCount, 3]] : [])]) {
    const label = Buffer.from(key), tag = Buffer.alloc(label.length + 3); tag[0] = type; tag.writeUInt16LE(label.length, 1); label.copy(tag, 3);
    const at = level.indexOf(tag, 8);
    if (at < 8 || level.indexOf(tag, at + 1) !== -1) throw new Error('世界设置缺失或不明确：' + key);
    if (type === 1) level[at + tag.length] = value; else level.writeInt32LE(value, at + tag.length);
  }
  if (title !== undefined) {
    const { levelNameSpan: span } = C.readWorldNbt(level.subarray(8)), text = Buffer.from(title), length = Buffer.alloc(2); length.writeUInt16LE(text.length);
    level = Buffer.concat([level.subarray(0, 8 + span[0]), length, text, level.subarray(8 + span[1])]); level.writeUInt32LE(level.length - 8, 4);
  }
  return { bytes: level, version: Array.from(version) };
}
function validateImport(C, m, options) {
  const { origin, rotation, loop } = options;
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isInteger) ||
    Math.abs(origin[0]) > 29999000 || Math.abs(origin[2]) > 29999000 || origin[1] < -64 ||
    ![0, 90, 180, 270].includes(rotation) || typeof loop !== 'boolean') throw new Error('请填写有效的整数坐标、朝向和循环设置。');
  const prefetchMode = options.dropPrefetch ? 'off' : (options.prefetchMode || 'package');
  if (!['off','package','on'].includes(prefetchMode)) throw new Error('预加载模式无效。');
  const prefetch = C.normalizePrefetch(prefetchMode === 'off' ? null : prefetchMode === 'on' ? options.prefetch : m.prefetch);
  if (!['package', 'fixed', 'armor_stand'].includes(options.anchorMode || 'package') || !['off', 'package'].includes(options.audioMode || 'off')) throw new Error('无效的盔甲架或音频导入设置。');
  const anchor = options.visualOnly || options.anchorMode === 'fixed' ? undefined : C.normalizeAnchor(options.anchorMode === 'armor_stand' ? options.anchor : m.anchor);
  const withAudio = !options.visualOnly && options.audioMode === 'package' && Boolean(m.audio);
  const slots = m.frameCount * ((anchor ? 4 : 1) + (prefetch ? 2 : 0)) + (withAudio ? anchor ? 5 : 2 : 0) + (prefetch && !loop ? 1 : 0);
  if (slots > C.LIMITS.MAX_FRAMES) throw new Error(`此组合需要 ${slots} 条命令，超过单区块命令链 ${C.LIMITS.MAX_FRAMES} 条上限；请减少帧数或改用固定坐标。`);
  const layout = C.controllerLayout(slots, true), offset = C.playbackControlOffset({ columns: m.columns, rotation });
  const requiredHeight = Math.max(layout.height, anchor ? 1 : m.rows);
  if (origin[1] + requiredHeight > 320) throw new Error(`命令链高度为 ${layout.height} 格，请将 Y 调至 ${320 - requiredHeight} 或更低。`);
  return { offset, anchor, withAudio, slots, prefetch };
}
async function install(C, world, video, m, options, check, progress, existingFrames) {
  const { origin, rotation, loop } = options, { offset, anchor, withAudio, slots, prefetch } = validateImport(C, m, options);
  const namespace = 'fy_cn_' + randomBytes(6).toString('hex'), title = options.keepWorldName === false ? '方映中国版-' + m.name.replace(/[\x00-\x1f]/g, '').slice(0, 32) : undefined;
  const controlOrigin = [Math.floor(origin[0] / 16) * 16, origin[1], Math.ceil((origin[2] + offset) / 16) * 16];
  const pf = prefetch ? require('./china-prefetch.cjs').build(C, { namespace, columns:m.columns, rows:m.rows, count:m.frameCount, loop, origin, controlOrigin, prefetch }) : null;
  const level = patchLevel(C, await world.file('level.dat').async('uint8array'), title, Math.max(C.controllerNodes(slots, true).length,pf?.maxNodes||0));
  const timing = C.frameTiming(m.frameCount, m.ticks, m.frameTicks), binding = anchor ? C.anchorSelectors(namespace, anchor) : null;
  let audio;
  if (withAudio) {
    check(); audio = C.audioFiles(world, { namespace, name: m.name, totalTicks: timing.totalTicks }, { ...m.audio, bytes: await video.file(m.audio.path).async('uint8array') });
    world.file(audio.dir + 'textures/.keep', ''); world.file(audio.dir + 'pack_icon.png', fs.readFileSync(path.join(__dirname, 'icon.png')));
    for (const prefix of ['', 'netease_']) {
      const name = prefix + 'world_resource_packs.json', entry = world.file(name);
      let refs; try { refs = entry ? JSON.parse(await entry.async('string')) || [] : []; } catch { throw new Error('原世界资源包启用记录损坏，未生成副本。'); }
      if (!Array.isArray(refs)) throw new Error('原世界资源包启用记录格式不支持。');
      refs.unshift({ pack_id: audio.headerId, version: [1, 0, 0], type: 'Addon' });
      world.file(name, JSON.stringify(refs, null, 2));
    }
    await world.drain();
  }
  const db = await C.databaseWriter(world), base = BigInt('0x' + randomBytes(8).toString('hex')) % 0x3fffffffffffffffn + 1n;
  for (let i = 0; !existingFrames && i < m.maps.length; i++) {
    check(); const pixels = await video.file(m.maps[i].pixels).async('uint8array');
    if (pixels.length !== 65536) throw new Error('视频包地图像素不完整。');
    db.put('map_' + (base + BigInt(i)), C.mapRecord(base + BigInt(i), pixels));
    await db.flush(null, { raw: true }); await world.drain();
    progress(25 + 35 * (i + 1) / m.maps.length, '正在写入地图像素…');
  }
  for (let frame = 0; frame < m.frameCount; frame++) {
    check(); const ids = existingFrames ? existingFrames[frame] : Array.from({ length: m.columns * m.rows }, (_, tile) => {
      const ref = frame * m.columns * m.rows + tile;
      return base + BigInt(m.mapIndices ? m.mapIndices[ref] : ref);
    });
    const scene = C.frameStructure(m.columns, m.rows, ids);
    db.put('structuretemplate_' + namespace + ':f' + String(frame).padStart(6, '0'), scene);
    if (pf) {
      const preload = pf.preloadFrame(scene); db.put('structuretemplate_' + namespace + ':pf_f' + String(frame).padStart(6,'0'), preload);
    }
    await db.flush(null, { raw: true }); await world.drain();
    progress(60 + 15 * (frame + 1) / m.frameCount, '正在保存完整画面结构…');
  }
  // Delayed chains crossing chunk borders can advance twice during one game tick.
  // All 16,384 supported frames fit in a single, aligned 16 x 16 chunk footprint.
  const plan = [], delays = [];
  for (let frame = 0; frame < m.frameCount; frame++) {
    const commands = [];
    if (frame === 0 && audio) {
      commands.push(`stopsound @a ${audio.event}`);
      if (anchor) {
        const tag = namespace + '_listeners';
        commands.push(`tag @a remove ${tag}`, `execute at ${binding.named} align xyz positioned ${binding.offset} run tag @a[r=64] add ${tag}`,
          `execute as @a[tag=${tag}] at @s run playsound ${audio.event} @s ~ ~ ~ 1 1 1`, `tag @a[tag=${tag}] remove ${tag}`);
      } else commands.push(`execute positioned ${origin.join(' ')} as @a[r=64] at @s run playsound ${audio.event} @s ~ ~ ~ 1 1 1`);
    }
    if (anchor) {
      for (const [angle, condition] of [[0,'if entity @s[rym=-45,ry=45]'],[90,'if entity @s[rym=45,ry=135] unless entity @s[rym=45,ry=45]'],[270,'if entity @s[rym=-135,ry=-45] unless entity @s[rym=-45,ry=-45]'],[180,'unless entity @s[rym=-135,ry=135]']])
        commands.push(`execute as ${binding.named} at @s align xyz positioned ${binding.offset} ${condition} run structure load "${namespace}:f${String(frame).padStart(6, '0')}" ~ ~ ~ ${angle}_degrees none`);
    } else commands.push(null);
    if (pf) commands.push(...pf.frameCommands(frame));
    if (pf && !loop && frame === m.frameCount-1) commands.push(`scoreboard players set active ${pf.objective} 0`);
    commands.forEach((command, index) => { plan.push({ frame, command }); delays.push(index === 0 && frame > 0 ? timing.durations[frame-1] : 0); });
  }
  const controller = C.controllerStructure(plan.length, 1, loop, (slot, [x, y, z]) => plan[slot].command ||
    `structure load "${namespace}:f${String(plan[slot].frame).padStart(6, '0')}" ~${origin[0]-controlOrigin[0]-x} ~${y ? -y : ''} ~${origin[2]-controlOrigin[2]-z} ${rotation}_degrees none`, undefined, true, { delays, totalTicks: timing.totalTicks });
  db.put('structuretemplate_' + namespace + (pf ? ':video' : ':play'), controller.data);
  if (pf) for (const [name,data] of pf.records) { check(); db.put(name,data); await db.flush(null,{raw:true}); await world.drain(); }
  db.finish(); await world.drain();
  const [x, y, z] = origin, commands = [
    ...(!anchor ? [{ label: '到达播放区域（先执行，等待区块加载）', text: `/tp @s ${x + .5} ${Math.min(319, y + m.rows + 2)} ${z + m.columns + 8} 180 15` }] : []),
    { label: '播放／重新开始', text: `/structure load "${namespace}:play" ${controlOrigin.join(' ')}` },
  ];
  if (anchor) commands.unshift({ label: '新增同名盔甲架播放点', text: `/summon armor_stand ${JSON.stringify(anchor.name)} ~ ~ ~` },
    { label: '最近播放点与我同向', text: `/execute as ${binding.named.slice(0,-1)},c=1] positioned as @s run tp @s ~ ~ ~ ~ 0` },
    { label: '检查命名盔甲架', text: `/testfor ${binding.named}` });
  if (audio) commands.push({ label: '检测音轨资源包（应听到声音）', text: `/playsound ${audio.event} @s ~ ~ ~ 1 1 1` },
    { label: '停止音轨', text: `/stopsound @a ${audio.event}` });
  if (pf) commands.push(...pf.stopCommands);
  const controllerSize = [controller.width,controller.height,controller.depth].map((n,i) => Math.max(n,pf?.launchSize[i]||0));
  const controls = [{at:controlOrigin,size:controllerSize}, ...(pf?[{at:pf.info.helperOrigin,size:pf.info.helperSize}]:[])];
  for(const name of Object.keys(world.files).filter(n=>/^MapCinema-China-fy_cn_[0-9a-f]{12}\.json$/.test(n))){
    const previous=JSON.parse(await world.file(name).async('string'));
    if(!previous.controlOrigin||!previous.controllerSize)continue;
    const old=[{at:previous.controlOrigin,size:previous.controllerSize},...(previous.prefetch?[{at:previous.prefetch.helperOrigin,size:previous.prefetch.helperSize}]:[])];
    if(controls.some(a=>old.some(b=>a.at.every((v,i)=>v<b.at[i]+b.size[i]&&b.at[i]<v+a.size[i]))))throw Error('新控制区与已有方映播放器重叠，请调整屏幕原点后重试；原播放器未修改。');
  }
  const slice = Math.floor(32768 / (controllerSize[0] * controllerSize[2]));
  for (let row = 0; row < controllerSize[1]; row += slice) commands.push({ label: '停止并清理命令链' + (controllerSize[1] > slice ? `（${row + 1}）` : ''),
    text: `/fill ${controlOrigin[0]} ${y + row} ${controlOrigin[2]} ${controlOrigin[0] + controllerSize[0] - 1} ${y + Math.min(row + slice, controllerSize[1]) - 1} ${controlOrigin[2] + controllerSize[2] - 1} air` });
  const info = { format: 'mapcinema-china-world', version: 1, namespace, name: m.name, origin, rotation, loop,
    frameCount: m.frameCount, frameTicks: m.frameTicks || Array(m.frameCount).fill(m.ticks), ticks: m.ticks,
    mapCount: m.maps.length, columns: m.columns, rows: m.rows, controllerSize,
    controlOrigin, controlOffset: controlOrigin[2]-origin[2], clientVersion: level.version, commands, visualOnly: !audio && !anchor, gameVerified: false,
    anchor: anchor || null, commandCount: plan.length, audioRequested: !options.visualOnly && options.audioMode === 'package', audio: audio ? { ...audio, chinaClientVerified: false } : null,
    prefetch: pf?.info || null, worldName: C.readWorldNbt(level.bytes.subarray(8)).value.LevelName, keepWorldName: title === undefined,
    discardedOptions: ['audio', 'anchor', 'prefetch'].filter(key => m[key] && (key === 'audio' ? !audio : key === 'anchor' ? !anchor : !prefetch)) };
  world.file('level.dat', level.bytes); if (title !== undefined || !world.file('levelname.txt')) world.file('levelname.txt', info.worldName);
  world.file('MapCinema-China-' + namespace + '.json', JSON.stringify(info, null, 2));
  world.file('方映中国版播放命令.txt', `选择中国版已有或新建的目标存档并关闭整个游戏客户端，再用方映自动备份并替换所选目标存档；仅导出时请先备份，再将 ZIP 全部内容（包括 db）写回本次所选的原存档中。\n生成 ZIP 阶段只读取存档；自动替换会写回同一个目标路径，替换前备份保存在方映旁 Data/ChinaBackups。\n需开启作弊和命令方块，进入主世界，在目标区域附近播放。\n屏幕原点：${origin.join(' ')}，屏幕 ${m.columns}×${m.rows} 张地图，旋转 ${rotation} 度。\n控制区原点：${controlOrigin.join(' ')}，占用 ${info.controllerSize.join('×')} 格。\n画面和命令链会覆盖所示区域，请选择空地。\n播放结束后重新执行完整“播放／重新开始”命令，不要只给命令链通红石。\n` +
    (anchor ? `命名盔甲架：${anchor.name}；所有同名盔甲架按各自朝向播放，偏移 ${anchor.offset.join(' ')}。移动或转向会留下旧画面。\n` : '') +
    commands.map(c => '\n' + c.label + '\n' + c.text).join('\n') + '\n\n不安装方映行为包。\n' +
    (pf ? `已启用中国版预加载：${pf.slots} 帧，每排 5 幅向上堆叠，上方 ${prefetch.height} 格，最多 4 个观看区块；覆盖屏幕原点周围 64 格。准备完成后自动启动正片和音轨。预加载控制区 ${pf.info.helperOrigin.join(' ')}，请与主控制区一并保持加载；高度或空中空间不足时跳过建墙。额外地图刷新和命令执行会增加开销，客户端实际缺图改善仍需验证。停止预加载命令会清理已加载的旧墙；未加载旧区块返回后再清理。\n` : '') +
    (audio ? '包含音轨资源包及标准／中国版启用记录。普通中国版还需通过方映部署本机音轨，并完全重启客户端；只复制 ZIP 内资源包可能无声。另一台电脑需重新部署，勿删除或移动音轨数据目录。全局部署方式已在普通中国版 1.21.120 小样中确认可发声；当前视频及音画同步仍需实测。音频按真实时间、画面按游戏刻，卡顿可能导致不同步。\n' : '') +
    '仅 1.21.120 固定坐标小样有中国版客户端循环播放反馈；当前生成的世界及盔甲架、音频仍需游戏验收。\n');
  await world.drain(); return info;
}
async function run({ source, videoPath, target, tempRoot, audioStore, options, cancellation }, onProgress = () => {}) {
  const check = () => { if (cancellation && Atomics.load(new Int32Array(cancellation), 0)) throw new Error('已取消；原世界未修改。'); };
  source = await resolveWorld(source); tempRoot = await fsp.realpath(tempRoot); target = path.resolve(target);
  const inside = (child, parent) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
  const targetParent = await fsp.realpath(path.dirname(target)); target = path.join(targetParent, path.basename(target));
  if (!/\.zip$/i.test(target) || inside(target, source) || inside(tempRoot, source)) throw new Error('请选择原世界目录之外的新 ZIP 文件作为输出。');
  if (fs.existsSync(target)) throw new Error('输出文件已存在，请换一个名称，保留现有文件。');
  const job = await fsp.mkdtemp(path.join(tempRoot, 'china-world-'));
  let audioDirectory, audioStorageRoot, published = false;
  let lastProgress = 0; const progress = (value, label) => { const now = Date.now(); if (now - lastProgress >= 100 || value === 100) { lastProgress = now; onProgress({ value, label }); } };
  try {
    const { C, D } = loadEngine(), video = new D.Archive(await D.ZipReader.open(await fs.openAsBlob(videoPath)), null);
    const m = await C.readVideoPackage(video, { maxRawBytes: D.MAX_RAW_BYTES }); check(); validateImport(C, m, options);
    const captured = await snapshot(source, job, check, fraction => progress(fraction * 15, '正在读取并核对世界副本…'));
    const world = new DiskWorld(job, captured.names, check);
    const info = await install(C, world, video, m, options, check, progress);
    const savedAudio = await persistAudio(job, info, audioStore, source, check);
    audioDirectory = savedAudio?.directory; audioStorageRoot = savedAudio?.root;
    const outputNames = await listFiles(job, '', check);
    for (const name of outputNames.filter(databaseFile)) await cryptFile(path.join(job, name), true, check);
    const packed = await packWorld(D, job, target, check, fraction => progress(78 + fraction * 21, '正在加密并打包世界副本…'));
    published = true;
    progress(100, '中国版世界副本已生成');
    return { target, ...info, audioDirectory, bytes: packed.bytes, sourceUnchangedAtSnapshot: true,
      sourceDirectory: source, sourceFingerprint: captured.sourceFingerprint };
  } finally {
    if (audioDirectory && !published) {
      if (path.dirname(path.resolve(audioDirectory)) !== audioStorageRoot || !/^fy_cn_[0-9a-f]{12}_audio$/.test(path.basename(audioDirectory))) throw new Error('音轨临时数据路径检查失败。');
      await fsp.rm(audioDirectory, { recursive: true, force: true });
    }
    const resolved = path.resolve(job);
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('china-world-')) throw new Error('临时目录路径检查失败。');
    await fsp.rm(resolved, { recursive: true, force: true });
  }
}
module.exports = { run, loadEngine, encrypt, decrypt, install, patchLevel, listFiles, digest, DiskWorld, snapshot, cryptFile, databaseFile, validateDatabase, packWorld, persistAudio, inside, validateImport };
if (!isMainThread && require.main === module) run(workerData, progress => parentPort.postMessage({ progress })).then(result => parentPort.postMessage({ result }), error => parentPort.postMessage({ error: error.message }));
