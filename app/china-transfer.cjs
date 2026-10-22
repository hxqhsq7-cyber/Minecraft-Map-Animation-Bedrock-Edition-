'use strict';
// Offline one-click China -> Bedrock merger -> native China playback; never opens or upgrades the world in a game client.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),{randomBytes}=require('node:crypto');
const {parentPort,workerData,isMainThread}=require('node:worker_threads');
const W=require('./china-world.cjs');
function level(C,bytes){
  if(bytes.length<8||bytes.readUInt32LE(4)!==bytes.length-8)throw Error('世界 level.dat 不完整。');
  const value=C.readWorldNbt(bytes.subarray(8)).value,v=value.lastOpenedWithVersion;
  if(!v||v[0]!==1||v[1]!==21)throw Error('往返入口仅支持中国版 1.21 世界；不能把高版本世界通过加密降级。');
  return value;
}
async function compatiblePlayers(C,R,world,check,progress,overrides){
  const results=[],names=Object.keys(world.files).filter(n=>/^MapCinema-mv_[a-z0-9_]+\.json$/.test(n));
  if(names.length>64)throw Error('世界中的方映播放器超过 64 个，不能自动转换。');
  for(let index=0;index<names.length;index++){
    check();const m=JSON.parse(await world.file(names[index]).async('string')),ns=m.namespace;
    if(!/^mv_[a-z0-9_]{1,64}$/.test(ns))throw Error('国际版播放器命名空间无效。');
    const binding=`MapCinema-China-Compatibility-${ns}.json`;
    if(world.file(binding)){
      const old=JSON.parse(await world.file(binding).async('string'));
      if(old.metadata===await world.file(names[index]).async('string')&&world.file('MapCinema-China-'+old.namespace+'.json'))continue;
      throw Error('已转换过的国际版播放器发生变化，请重新添加为一个新视频，避免覆盖旧播放点。');
    }
    const count=m.frameCount||m.frames,ticks=m.ticks||m.ticksPerFrame,base=`behavior_packs/${ns}/structures/${ns}/`;
    if(!Number.isInteger(count)||count<1||count>C.LIMITS.MAX_FRAMES||!world.file(base+'f000000.mcstructure'))throw Error('国际版播放器帧数或首帧缺失。');
    const first=C.readWorldNbt(await world.file(base+'f000000.mcstructure').async('uint8array')).value;
    const [columns,rows,depth]=first.size;
    if(depth!==2||![columns,rows].every(n=>Number.isInteger(n)&&n>=1&&n<=16))throw Error('国际版地图画面尺寸无效。');
    const timing=C.frameTiming(count,ticks,m.frameTicks);if(m.totalTicks!==undefined&&m.totalTicks!==timing.totalTicks)throw Error('国际版播放器时序不一致。');
    const saved=world.file(`MapCinema-${ns}-player.json`),player=saved?JSON.parse(await saved.async('string')):m;
    const frames=[],ids=new Set();let previous;
    for(let f=0;f<count;f++){
      check();const entry=world.file(base+'f'+String(f).padStart(6,'0')+'.mcstructure');if(!entry)throw Error('国际版播放器缺少帧 '+f);
      previous=C.worldFrameIds(await entry.async('uint8array'),columns,rows,previous).ids;frames.push(previous);for(const id of previous)ids.add(String(id));
    }
    // Validate actual persisted pixels, including journals and active compressed tables.
    const database=await new R.MapDatabase(world,ids,check,async()=>{}).open();
    for(const id of ids){check();await database.pixels(id);}
    const audioEntry=world.file(`MapCinema-${ns}-audio.json`),audio=audioEntry?JSON.parse(await audioEntry.async('string')):m.audio;
    if(audio){await C.readAudio(world,ns,audio,timing.totalTicks);W.loadEngine().A.validateWav(await world.file(audio.path).async('uint8array'),audio);}
    const info={...m,namespace:ns,columns,rows,frameCount:count,ticks,frameTicks:timing.durations,maps:[...ids].map(id=>({id})),audio,anchor:player.anchor??m.anchor,prefetch:player.prefetch??m.prefetch};
    const options={origin:m.origin,rotation:m.rotation??0,loop:m.loop,keepWorldName:true,anchorMode:'package',audioMode:overrides?.audioMode==='off'?'off':audio?'package':'off',prefetchMode:'package'};
    const result=await W.install(C,world,world,info,options,check,()=>{},frames);results.push(result);
    world.file(binding,JSON.stringify({sourceNamespace:ns,namespace:result.namespace,metadata:await world.file(names[index]).async('string')},null,2));await world.drain();
    progress((index+1)/Math.max(1,names.length));
  }
  return results;
}
async function run({source,videoPath,options,target,tempRoot,audioStore,cancellation},onProgress=()=>{}){
  const check=()=>{if(cancellation&&Atomics.load(new Int32Array(cancellation),0))throw Error('已取消；原存档未修改。');};
  check();const {C,D,R}=W.loadEngine();tempRoot=await fsp.realpath(tempRoot);
  source=await require('./china-path.cjs').resolveWorld(source);target=path.resolve(target);
  const parent=await fsp.realpath(path.dirname(target));target=path.join(parent,path.basename(target));
  if(!/\.zip$/i.test(target)||W.inside(target,source)||W.inside(tempRoot,source)||audioStore&&W.inside(path.resolve(audioStore),source))throw Error('请选择原世界之外的新 ZIP，临时目录及音轨目录也不能位于原世界中。');
  if(fs.existsSync(target))throw Error('输出文件已存在，请换一个名称。');
  const job=await fsp.mkdtemp(path.join(tempRoot,'china-transfer-'));let published=false;const storedAudio=[];
  let lastProgress=0,lastLabel='';const progress=(value,label)=>{const now=Date.now();if(value===100||label!==lastLabel||now-lastProgress>=100){lastProgress=now;lastLabel=label;onProgress({value,label});}};
  try{
    const captured=await W.snapshot(source,job,check,f=>progress(f*20,'正在复制旧存档并解密为国际版格式…'));
    const original=level(C,await fsp.readFile(path.join(job,'level.dat')));
    const world=new W.DiskWorld(job,captured.names,check),video=new D.Archive(await D.ZipReader.open(await fs.openAsBlob(videoPath)),null);
    if(!video.file('video.json'))throw Error('请选择完整的 .mcvideo 视频包。');
    const metadata=JSON.parse(await video.file('video.json').async('string'));
    const activation=new Map();
    for(const name of ['world_behavior_packs.json','world_resource_packs.json','netease_world_behavior_packs.json','netease_world_resource_packs.json']){
      const entry=world.file(name),bytes=entry?await entry.async('uint8array'):null;activation.set(name,bytes);
      // China commonly writes null for an empty list. The international merger requires [].
      if(bytes&&JSON.parse(Buffer.from(bytes).toString('utf8'))===null)world.file(name,'[]');
    }
    const adapted={files:video.files,file(name){if(name==='video.json')return{async:async()=>JSON.stringify({...metadata,origin:options.origin,rotation:options.rotation,loop:options.loop})};return video.file(name);}};
    W.validateImport(C,await C.readVideoPackage(adapted,{maxRawBytes:D.MAX_RAW_BYTES}),options);
    const anchorOverride=options.anchorMode==='fixed'?null:options.anchorMode==='armor_stand'?C.normalizeAnchor(options.anchor):undefined;
    const prefetchOverride=options.prefetchMode==='off'?null:options.prefetchMode==='on'?C.normalizePrefetch(options.prefetch):undefined;
    await C.installVideoPackage(world,adapted,{zipLib:null,anchorOverride,prefetchOverride,checkCancelled:check,onProgress:async f=>progress(20+f*30,'正在使用国际版核心加入地图视频…')});await world.drain();
    // Native China playback does not need the intermediate international behavior pack enabled.
    for(const [name,bytes]of activation)if(bytes)world.file(name,bytes);else world.remove(name);await world.drain();
    const players=await compatiblePlayers(C,R,world,check,f=>progress(50+f*20,'正在把国际版地图播放器转换为中国版原生命令…'),options);
    const namespace='fy_cn_'+randomBytes(6).toString('hex'),commands=players.flatMap(p=>p.commands.map(c=>({label:p.name+'：'+c.label,text:c.text})));
    const worldName=options.keepWorldName===false?'方映中国版-'+players.at(-1).name.replace(/[\x00-\x1f]/g,'').slice(0,32):original.LevelName;
    const info={format:'mapcinema-china-world',version:1,namespace,worldName,sourceDirectory:source,sourceFingerprint:captured.sourceFingerprint,players,commands,audioTracks:[],gameVerified:false,internationalCoreUsed:true};
    // Preserve the original title and engine version; encryption is not a version conversion.
    world.file('level.dat',W.patchLevel(C,await world.file('level.dat').async('uint8array'),worldName,0).bytes);
    if(options.keepWorldName===false||!world.file('levelname.txt'))world.file('levelname.txt',worldName);
    world.file('MapCinema-China-'+namespace+'.json',JSON.stringify({...info,sourceDirectory:undefined,sourceFingerprint:undefined},null,2));
    world.file('方映中国版往返播放命令.txt',commands.map(c=>c.label+'\n'+c.text).join('\n\n'));await world.drain();
    for(const player of players){const audio=await W.persistAudio(job,player,audioStore,source,check);if(audio){storedAudio.push(audio);info.audioTracks.push({namespace:player.namespace,audio:player.audio,audioDirectory:audio.directory});}}
    for(const name of(await W.listFiles(job,'',check)).filter(W.databaseFile))await W.cryptFile(path.join(job,name),true,check);
    const packed=await W.packWorld(D,job,target,check,f=>progress(70+f*29,'正在加密并生成原存档回写结果…'));published=true;
    progress(100,'一键往返结果已生成，待校验并备份后写回');return {...info,target,bytes:packed.bytes};
  }finally{
    if(!published)for(const audio of storedAudio){if(path.dirname(audio.directory)!==audio.root)throw Error('音轨清理路径无效。');await fsp.rm(audio.directory,{recursive:true,force:true});}
    if(path.dirname(job)!==tempRoot||!path.basename(job).startsWith('china-transfer-'))throw Error('往返临时目录路径无效。');
    await fsp.rm(job,{recursive:true,force:true});
  }
}
module.exports={run,compatiblePlayers};
if(!isMainThread&&require.main===module)run(workerData,p=>parentPort.postMessage({progress:p})).then(result=>parentPort.postMessage({result}),error=>parentPort.postMessage({error:error.message}));
