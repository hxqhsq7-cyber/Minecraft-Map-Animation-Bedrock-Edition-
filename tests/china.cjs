'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {run,loadEngine,encrypt,decrypt}=require('../app/china-world.cjs');
const output=path.join(__dirname,'output','china-'+Date.now()),source=path.join(output,'source'),tempRoot=path.join(output,'temp');
fs.mkdirSync(source,{recursive:true});fs.mkdirSync(tempRoot);
const {C,D,A}=loadEngine();
async function tree(dir,base=dir){const result={};for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())Object.assign(result,await tree(p,base));else result[path.relative(base,p).split(path.sep).join('/')]=fs.readFileSync(p);}return result;}
const hash=b=>createHash('sha256').update(b).digest('hex');
async function main(){
  const ctx=require('node:vm').createContext({Uint8Array,Uint16Array,Uint32Array,Int32Array,ArrayBuffer,DataView,TextEncoder,TextDecoder,Blob,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,setImmediate,console});
  const html=fs.readFileSync(path.join(__dirname,'../app/MapCinema.html'),'utf8');for(const s of [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].slice(0,1))require('node:vm').runInContext(s[1],ctx);
  const world=new ctx.JSZip();world.file('level.dat',C.levelDat('Synthetic China world'));world.file('levelname.txt','Synthetic China world');
  const db=await C.databaseWriter(world);db.put('existing-test-record',Buffer.from('preserve'));db.finish();
  world.file('netease_world_behavior_packs.json','null\r\n');world.file('world_behavior_packs.json','[]');world.file('resource_packs/existing/readme.txt','existing pack preserved');
  for(const [name,entry]of Object.entries(world.files))if(!entry.dir){const p=path.join(source,name);fs.mkdirSync(path.dirname(p),{recursive:true});let bytes=Buffer.from(await entry.async('uint8array'));if(/^db\/(?:CURRENT|MANIFEST-\d+|\d+\.ldb)$/.test(name))bytes=encrypt(bytes);fs.writeFileSync(p,bytes);}
  const before=await tree(source),video=new ctx.JSZip();
  const pixels=(frame,tile)=>{const p=new Uint8Array(65536);for(let i=0;i<p.length;i+=4)p.set([frame*4,tile?190:40,255-frame*3,255],i);return p;};
  await C.writeVideoFrames(video,{options:{name:'China 20 FPS synthetic',output:'video',columns:2,rows:1,ticks:1,start:0,origin:[0,5,0],rotation:0,loop:true,dedupe:false,reuseTiles:false},count:60,id:'china_regression',frameAt:async i=>[pixels(i,0),pixels(i,1)],zipLib:null});
  const videoPath=path.join(output,'sample.mcvideo');fs.writeFileSync(videoPath,await video.generateAsync({type:'uint8array',compression:'DEFLATE'}));
  const target=path.join(output,'china-world.zip'),options={origin:[0,5,0],rotation:0,loop:true,visualOnly:false};
  const result=await run({source,videoPath,target,tempRoot,options});assert.equal(result.frameCount,60);assert.equal(result.mapCount,120);
  const zip=await ctx.JSZip.loadAsync(fs.readFileSync(target),{checkCRC32:true}),plain=path.join(output,'plain');
  for(const [name,entry]of Object.entries(zip.files))if(!entry.dir){const p=path.join(plain,name);fs.mkdirSync(path.dirname(p),{recursive:true});let b=Buffer.from(await entry.async('uint8array'));if(/^db\/(?:CURRENT|MANIFEST-\d+|\d+\.ldb)$/.test(name)){assert.equal(b.subarray(0,4).toString('hex'),'801d3001');b=decrypt(b);}fs.writeFileSync(p,b);}
  assert.equal(await zip.file('netease_world_behavior_packs.json').async('string'),'null\r\n');assert.equal(await zip.file('resource_packs/existing/readme.txt').async('string'),'existing pack preserved');
  assert.ok(!Object.keys(zip.files).some(n=>n.startsWith('behavior_packs/')||n.endsWith('.mcfunction')));
  for(const [name,b]of Object.entries(before))assert.equal(hash(fs.readFileSync(path.join(source,name))),hash(b),'source changed '+name);
  const oldLevel=C.readWorldNbt(before['level.dat'].subarray(8)).value,newLevel=C.readWorldNbt(fs.readFileSync(path.join(plain,'level.dat')).subarray(8)).value;
  for(const key of Object.keys(oldLevel))if(!['LevelName','cheatsEnabled','commandsEnabled','commandblocksenabled'].includes(key))assert.deepEqual(newLevel[key],oldLevel[key],'setting changed '+key);
  const current=fs.readFileSync(path.join(plain,'db/CURRENT'),'utf8').trim(),manifest=C.manifestInfo(fs.readFileSync(path.join(plain,'db',current)));assert.ok(manifest.sequence>0);
  const entries=new Map();for(const name of fs.readdirSync(path.join(plain,'db')).filter(n=>n.endsWith('.log')))for(const record of C.records(fs.readFileSync(path.join(plain,'db',name)))){
    let at=12;const b=Buffer.from(record),v=()=>{let n=0,s=0,t;do{t=b[at++];n+=(t&127)*2**s;s+=7;}while(t&128);return n;};
    for(let i=0;i<b.readUInt32LE(8);i++){assert.equal(b[at++],1);let size=v(),key=b.toString('utf8',at,at+size);at+=size;size=v();entries.set(key,b.subarray(at,at+size));at+=size;}
  }
  assert.equal(entries.get('existing-test-record').toString(),'preserve');
  const controller=C.readWorldNbt(entries.get('structuretemplate_'+result.namespace+':play')).value;
  assert.deepEqual([...controller.size],result.controllerSize);assert.equal(controller.structure.palette.default.block_palette[controller.structure.block_indices[0][0]].name,'minecraft:redstone_block');
  const entities=Object.values(controller.structure.palette.default.block_position_data).map(v=>v.block_entity_data);assert.equal(entities.length,60);
  assert.ok(entities.every(e=>e.Command.includes('structure load "'+result.namespace+':f')));assert.equal(entities[0].TickDelay,60);assert.equal(entities[0].x,1);
  for(let frame=0;frame<60;frame++){
    const scene=C.readWorldNbt(entries.get('structuretemplate_'+result.namespace+':f'+String(frame).padStart(6,'0'))).value;
    const blocks=Object.values(scene.structure.palette.default.block_position_data);
    for(let tile=0;tile<2;tile++){const id=String(blocks[tile].block_entity_data.Item.tag.map_uuid),map=C.readWorldNbt(entries.get('map_'+id)).value;assert.deepEqual(Buffer.from(map.colors),Buffer.from(pixels(frame,tile)));}
  }
  for(const count of [1,257,1900,16384])for(const loop of [false,true]){
    const ticks=Array.from({length:count},(_,i)=>i%2?3:1),c=C.controllerStructure(count,1,loop,()=> 'say frame',ticks,true),nbt=C.readWorldNbt(c.data).value;
    assert.equal(nbt.size[0],C.controllerLayout(count,true).width+1);assert.ok(nbt.size[0]<=16&&nbt.size[2]<=16);const e=Object.values(nbt.structure.palette.default.block_position_data).map(v=>v.block_entity_data);
    assert.equal(e[0].TickDelay,loop?ticks.reduce((a,b)=>a+b,0):0);assert.ok(e.every(n=>n.x>=1));
  }
  await assert.rejects(run({source,videoPath,target,tempRoot,options}),/已存在/);
  await assert.rejects(run({source,videoPath,target:path.join(output,'too-high.zip'),tempRoot,options:{...options,origin:[0,300,0]}}),/高度/);
  const cancellation=new SharedArrayBuffer(4);new Int32Array(cancellation)[0]=1;await assert.rejects(run({source,videoPath,target:path.join(output,'cancelled.zip'),tempRoot,options,cancellation}),/取消/);
  assert.ok(!fs.existsSync(path.join(output,'cancelled.zip')));assert.deepEqual(fs.readdirSync(tempRoot),[]);
  await assert.rejects(run({source,videoPath,target:path.join(source,'bad.zip'),tempRoot,options}),/之外/);
  const metadata=JSON.parse(await video.file('video.json').async('string'));metadata.prefetch={frames:3,height:12};metadata.version=6;video.file('video.json',JSON.stringify(metadata));
  // Invalid preload settings must be rejected before any world writes.
  const parsed={...metadata,anchor:{mode:'armor_stand',name:'test',offset:[0,2,0]}};
  await assert.rejects(require('../app/china-world.cjs').install(C,{},null,parsed,options,()=>{},()=>{}),/提前加载/);
  const {resolveWorld}=require('../app/china-path.cjs');
  assert.equal(await resolveWorld(path.join(source,'level.dat')),fs.realpathSync(source));assert.equal(await resolveWorld(path.join(source,'db')),fs.realpathSync(source));
  await assert.rejects(resolveWorld(output),/世界路径.*[\s\S]*缺少/);
  const rich=new ctx.JSZip(),anchor={mode:'armor_stand',name:'中国版测试屏幕',offset:[0,2,0]},samples=7200,wav=new Uint8Array(44+samples*2);wav.set(A.wavHeader(samples));
  for(let i=0;i<samples;i++)new DataView(wav.buffer).setInt16(44+i*2,Math.round(Math.sin(i/24000*2*Math.PI*440)*10000),true);
  await C.writeVideoFrames(rich,{options:{name:'China anchor and audio',output:'video',columns:2,rows:1,ticks:2,start:0,origin:[0,5,0],rotation:0,loop:true,dedupe:true,reuseTiles:true,anchor,audioData:{bytes:wav,sampleRate:24000,sampleCount:samples,channels:1,peak:10000/32768,paddedSeconds:0}},count:3,id:'china_feature',frameAt:async i=>[pixels(i,0),pixels(i,1)],zipLib:null});
  const featureVideoPath=path.join(output,'features.mcvideo');fs.writeFileSync(featureVideoPath,await rich.generateAsync({type:'uint8array',compression:'DEFLATE'}));
  const feature=await run({source:path.join(source,'level.dat'),videoPath:featureVideoPath,target:path.join(output,'features-world.zip'),tempRoot,options:{...options,anchorMode:'package',audioMode:'package'}});
  assert.deepEqual({...feature.anchor,offset:[...feature.anchor.offset]},anchor);assert.equal(feature.commandCount,17);assert.ok(feature.audio);assert.equal(feature.audio.chinaClientVerified,false);
  assert.ok(feature.commands.some(c=>c.text.startsWith('/summon armor_stand')));assert.ok(feature.commands.some(c=>c.text.startsWith('/playsound')));assert.ok(feature.commands.some(c=>c.text.startsWith('/stopsound')));
  const richZip=await ctx.JSZip.loadAsync(fs.readFileSync(feature.target),{checkCRC32:true}),featurePlain=path.join(output,'features-plain');
  const protectedStore=path.join(source,'audio-store');
  await assert.rejects(run({source,videoPath:featureVideoPath,target:path.join(output,'bad-audio-store.zip'),tempRoot,audioStore:protectedStore,options:{...options,audioMode:'package'}}),/原世界之外/);
  assert.ok(!fs.existsSync(protectedStore),'rejected audio store must not change source world');
  const lateStore=path.join(output,'late-audio-cancel');fs.mkdirSync(lateStore);fs.writeFileSync(path.join(lateStore,'keep.json'),'preserve');
  const lateCancellation=new SharedArrayBuffer(4),watch=fs.watch(lateStore,(_event,name)=>{if(String(name).startsWith('fy_cn_'))Atomics.store(new Int32Array(lateCancellation),0,1);});
  try{await assert.rejects(run({source,videoPath:featureVideoPath,target:path.join(output,'late-audio-cancel.zip'),tempRoot,audioStore:lateStore,cancellation:lateCancellation,options:{...options,audioMode:'package'}}),/取消/);}finally{watch.close();}
  assert.deepEqual(fs.readdirSync(lateStore),['keep.json']);assert.ok(!fs.existsSync(path.join(output,'late-audio-cancel.zip')));
  assert.deepEqual(Buffer.from(await richZip.file(feature.audio.path).async('uint8array')),Buffer.from(wav));
  for(const prefix of ['', 'netease_'])assert.ok(JSON.parse(await richZip.file(prefix+'world_resource_packs.json').async('string')).some(p=>p.pack_id===feature.audio.headerId && p.type==='Addon'));
  assert.equal(await richZip.file('netease_world_behavior_packs.json').async('string'),'null\r\n');
  for(const [name,e]of Object.entries(richZip.files))if(!e.dir){const p=path.join(featurePlain,name);fs.mkdirSync(path.dirname(p),{recursive:true});let b=Buffer.from(await e.async('uint8array'));if(/^db\/(?:CURRENT|MANIFEST-\d+|\d+\.(?:ldb|sst))$/.test(name))b=decrypt(b);fs.writeFileSync(p,b);}
  // Parse the persisted chain independently, including zero-delay commands within each frame.
  const richEntries=new Map();for(const name of fs.readdirSync(path.join(featurePlain,'db')).filter(n=>n.endsWith('.log')))for(const r of C.records(fs.readFileSync(path.join(featurePlain,'db',name)))){const b=Buffer.from(r);let at=12;const v=()=>{let n=0,s=0,t;do{t=b[at++];n+=(t&127)*2**s;s+=7;}while(t&128);return n;};for(let i=0;i<b.readUInt32LE(8);i++){assert.equal(b[at++],1);let size=v(),key=b.toString('utf8',at,at+size);at+=size;size=v();richEntries.set(key,b.subarray(at,at+size));at+=size;}}
  const richController=C.readWorldNbt(richEntries.get('structuretemplate_'+feature.namespace+':play')).value,commands=Object.values(richController.structure.palette.default.block_position_data).map(x=>x.block_entity_data);
  assert.equal(commands.length,17);assert.deepEqual(commands.map(c=>c.TickDelay),[6,0,0,0,0,0,0,0,0,2,0,0,0,2,0,0,0]);
  assert.equal(commands.filter(c=>c.Command.includes('run structure load')).length,12);assert.ok(commands.slice(5).every(c=>c.Command.includes('name="中国版测试屏幕"')));
  fs.writeFileSync(path.join(__dirname,'../logs/china-feature-results.json'),JSON.stringify({...feature,plain:featurePlain,featureVideoPath,checks:['level.dat selection and db parent normalization','three frames / four facing commands per frame','zero-delay intra-frame commands and preserved timings','audio PCM bytes preserved; both resource activation records; audio unverified flag','copyable summon, orientation, audio probe and stop commands']},null,2));
  for(const [name,b]of Object.entries(before))assert.equal(hash(fs.readFileSync(path.join(source,name))),hash(b),'source changed by features '+name);
  const report={...result,output,plain,checks:['all 120 map pixels and 60 full scene references','powered chain; 1/257/1900 frames; variable timings; loop/non-loop','original bytes and unrelated settings/pack activation preserved','ZIP CRC and default-XOR round trip','cancel; height; overwrite; source destination rejection'],chinaClientTested:false};
  fs.writeFileSync(path.join(__dirname,'../logs/china-test-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
