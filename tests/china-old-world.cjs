'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const W=require('../app/china-world.cjs'),T=require('../app/china-transfer.cjs'),I=require('../app/china-install.cjs');
const root=path.resolve(__dirname,'..'),read=name=>JSON.parse(fs.readFileSync(path.join(root,'logs',name))),fixture=read('china-test-results.json'),feature=read('china-feature-results.json'),server=read('china-prefetch-engine.json');
const output=path.join(fixture.output,'old-world-'+Date.now()),source=path.join(output,'client/minecraftWorlds/old+progress='),tempRoot=path.join(output,'temp'),{C,D}=W.loadEngine();
const check=()=>{},options={origin:[128,5,0],rotation:90,loop:true,anchorMode:'package',audioMode:'package',prefetchMode:'on',prefetch:{enabled:true,frames:200,height:12}};
async function records(directory){
 const helpers=fs.readFileSync(path.join(__dirname,'playback.cjs'),'utf8').split('async function main()')[0],{modules}=new Function('require','__dirname',helpers+'\nreturn {modules};')(require,__dirname);
 const ctx=modules(fs.readFileSync(path.join(root,'app/MapCinema.html'),'utf8'));Object.assign(ctx,{Response,ReadableStream,WritableStream,DecompressionStream});
 vm.runInContext(fs.readFileSync(path.join(root,'app/reverse.js'),'utf8').replace(/function mapKey\(bytes\) \{[\s\S]*?\n  \}/,'function mapKey(bytes) { return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join(""); }'),ctx);
 const world=new W.DiskWorld(directory,await W.listFiles(directory),check),wanted=new Set();wanted.has=()=>true;
 const database=await new ctx.MapCinemaReverse.MapDatabase(world,wanted,check,async()=>{}).open(),out=new Map();
 for(const [key,loc]of database.index)if(!loc.deleted){const b=loc.batch===undefined?await database.readBlock(loc.path,loc.blockOffset,loc.blockSize):(await database.journal(loc.path,false))[loc.batch];out.set(key,Buffer.from(b.subarray(loc.at,loc.at+loc.length)));}
 return out;
}
async function unpack(target,name){const dir=path.join(output,name);await fsp.mkdir(dir);await I.extractWorld(target,dir);for(const n of(await W.listFiles(dir)).filter(W.databaseFile))await W.cryptFile(path.join(dir,n),false,check);return dir;}
async function main(){
 await fsp.mkdir(source,{recursive:true});await fsp.mkdir(tempRoot);await fsp.mkdir(path.join(output,'client/games/com.netease/resource_packs'),{recursive:true});
 await fsp.cp(path.join(server.world,'db'),path.join(source,'db'),{recursive:true});
 for(const n of fs.readdirSync(server.world).filter(n=>/^MapCinema-China-fy_cn_[a-f0-9]{12}\.json$/.test(n)))await fsp.copyFile(path.join(server.world,n),path.join(source,n));
 // Keep the server world's actor-ID/session counters. A fresh level.dat with an old DB
 // can alias new armor stands to saved actors even when Script API reports distinct positions.
 const oldSettings=Buffer.from(await fsp.readFile(path.join(server.world,'level.dat'))),label=Buffer.from('lastOpenedWithVersion'),versionAt=oldSettings.indexOf(label)+label.length;
 assert.equal(oldSettings[versionAt],3);assert.ok(oldSettings.readUInt32LE(versionAt+1)>=3);
 for(const [i,v]of [1,21,120,0,0].entries())oldSettings.writeInt32LE(v,versionAt+5+i*4);
 await fsp.writeFile(path.join(source,'level.dat'),W.patchLevel(C,oldSettings,'保留旧世界与玩家进度',0).bytes);
 await fsp.writeFile(path.join(source,'levelname.txt'),'保留旧世界与玩家进度\r\n');
 for(const name of ['world_behavior_packs.json','netease_world_behavior_packs.json','world_resource_packs.json','netease_world_resource_packs.json'])await fsp.writeFile(path.join(source,name),'null\r\n');
 await fsp.mkdir(path.join(source,'resource_packs/old-assets'),{recursive:true});await fsp.writeFile(path.join(source,'resource_packs/old-assets/keep.txt'),'old world resource');
 const world=new W.DiskWorld(source,await W.listFiles(source),check),db=await C.databaseWriter(world);
 db.put('~local_player',C.nbt({identifier:C.N.string('minecraft:player'),Inventory:C.N.list(10,[C.N.compound({Name:C.N.string('minecraft:diamond'),Count:C.N.byte(23)})]),PlayerLevel:C.N.int(47)}));
 db.put('map_42',C.mapRecord(42n,new Uint8Array(65536).fill(7)));db.finish();await world.drain();
 const before=await records(source);assert.ok([...before.keys()].some(k=>!Buffer.from(k,'hex').toString().startsWith('map_')));
 const oldFiles=new Map();for(const n of(await W.listFiles(source)).filter(W.databaseFile)){oldFiles.set(n,await fsp.readFile(path.join(source,n)));await W.cryptFile(path.join(source,n),true,check);}
 const fingerprint=await I.fingerprint(source,check),oldLevel=fs.readFileSync(path.join(source,'level.dat')),oldName=fs.readFileSync(path.join(source,'levelname.txt'));
 const jobs={source,videoPath:feature.featureVideoPath,tempRoot,options};
 const direct=await W.run({...jobs,target:path.join(output,'native.zip')});assert.equal(direct.keepWorldName,true);assert.equal(direct.worldName,'保留旧世界与玩家进度');
 const roundtrip=await T.run({...jobs,target:path.join(output,'roundtrip.zip'),audioStore:path.join(output,'audio')});
 assert.ok(roundtrip.internationalCoreUsed);assert.equal(roundtrip.players.length,1);assert.equal(roundtrip.audioTracks.length,1);assert.equal(roundtrip.players[0].prefetch.frames,3);
 const nativePlain=await unpack(direct.target,'native-plain'),roundtripPlain=await unpack(roundtrip.target,'roundtrip-plain');
 for(const dir of [nativePlain,roundtripPlain]){
   const after=await records(dir);for(const [key,bytes]of before)assert.deepEqual(after.get(key),bytes,'old logical record changed '+key);
   for(const [name,bytes]of oldFiles)if(!/CURRENT|MANIFEST-/.test(name))assert.deepEqual(fs.readFileSync(path.join(dir,name)),bytes,'old database file changed '+name);
   assert.deepEqual(fs.readFileSync(path.join(dir,'levelname.txt')),oldName);
   const previous=C.readWorldNbt(oldLevel.subarray(8)).value,next=C.readWorldNbt(fs.readFileSync(path.join(dir,'level.dat')).subarray(8)).value;
   for(const key of Object.keys(previous))if(!['cheatsEnabled','commandsEnabled','commandblocksenabled','maxcommandchainlength'].includes(key))assert.deepEqual(next[key],previous[key],'level field changed '+key);
   assert.equal(fs.readFileSync(path.join(dir,'resource_packs/old-assets/keep.txt'),'utf8'),'old world resource');
   for(const name of ['world_behavior_packs.json','netease_world_behavior_packs.json'])assert.equal(fs.readFileSync(path.join(dir,name),'utf8'),'null\r\n');
 }
 const after=await records(roundtripPlain),newMaps=[...after.keys()].filter(k=>Buffer.from(k,'hex').toString().startsWith('map_')&&!before.has(k));
 assert.equal(newMaps.length,roundtrip.players[0].mapCount,'native translation must reuse international map IDs');
 const m=JSON.parse(fs.readFileSync(path.join(roundtripPlain,'MapCinema-mv_china_feature.json'))),p=roundtrip.players[0];let previous;
 for(let f=0;f<m.frameCount;f++){
   previous=C.worldFrameIds(fs.readFileSync(path.join(roundtripPlain,`behavior_packs/${m.namespace}/structures/${m.namespace}/f${String(f).padStart(6,'0')}.mcstructure`)),m.columns,m.rows,previous).ids;
   const scene=after.get(Buffer.from('structuretemplate_'+p.namespace+':f'+String(f).padStart(6,'0')).toString('hex'));
   assert.deepEqual([...C.worldFrameIds(scene,m.columns,m.rows).ids].map(String),[...previous].map(String));
 }
 assert.equal(await I.fingerprint(source,check),fingerprint);
 await assert.rejects(W.run({...jobs,target:path.join(output,'collision.zip'),options:{...options,origin:[0,5,0]}}),/重叠/);
 const cancellation=new SharedArrayBuffer(4);await assert.rejects(T.run({...jobs,target:path.join(output,'cancel.zip'),audioStore:path.join(output,'cancel-audio'),cancellation},p=>{if(p.value>70)Atomics.store(new Int32Array(cancellation),0,1);}),/取消/);
 assert.ok(!fs.existsSync(path.join(output,'cancel.zip')));assert.deepEqual(fs.readdirSync(path.join(output,'cancel-audio')),[]);
 assert.equal(await I.fingerprint(source,check),fingerprint);
 const installed=await I.install({target:roundtrip.target,namespace:roundtrip.namespace,directory:source,sourceFingerprint:fingerprint,clientRoot:path.join(output,'client'),backupRoot:path.join(output,'backups')},async()=>{});
 assert.equal(await I.fingerprint(installed.backupDirectory,check),fingerprint);assert.ok(fs.existsSync(path.join(source,'resource_packs/old-assets/keep.txt')));
 await assert.rejects(T.run({...jobs,target:path.join(output,'repeat.zip')}),/已经包含/);
 // Chunk boundaries must not reset the XOR key offset.
 const bytes=Buffer.alloc(2*1024*1024+7);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;const cryptPath=path.join(output,'large-db-probe');await fsp.writeFile(cryptPath,bytes);
 await W.cryptFile(cryptPath,true,check);assert.deepEqual(await fsp.readFile(cryptPath),W.encrypt(bytes));await W.cryptFile(cryptPath,false,check);assert.deepEqual(await fsp.readFile(cryptPath),bytes);
 const report={output,source,target:roundtrip.target,nativePlayer:p,plain:roundtripPlain,sourceFingerprint:fingerprint,oldRecordsVerified:before.size,oldActiveTablesAndJournalPreserved:true,playerInventoryAndLevelPreserved:true,oldMap42Preserved:true,worldNameAndVersionPreserved:true,originalResourcesPreserved:true,oldNativePlayersPreserved:true,nativeAndRoundtripPaths:true,internationalCoreUsed:true,internationalMapIdsReused:true,anchorAudioAndPrefetchPreserved:true,backupVerified:true,overlapRejected:true,lateCancellationCleansAudio:true,streamingXorVerified:true,ordinaryChinaClientTested:false};
 await fsp.writeFile(path.join(root,'logs/china-old-world-results.json'),JSON.stringify(report,null,2));console.log('PASS: '+JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
