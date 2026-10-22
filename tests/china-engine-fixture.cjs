'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{loadEngine,run,decrypt}=require('../app/china-world.cjs');
const root=path.resolve(__dirname,'..'),fixture=JSON.parse(fs.readFileSync(path.join(root,'logs/china-test-results.json'))),{C,D}=loadEngine();
const ctx=vm.createContext({Uint8Array,Uint16Array,Uint32Array,Int32Array,ArrayBuffer,DataView,TextEncoder,TextDecoder,Blob,setTimeout,clearTimeout,setImmediate,console});
vm.runInContext([...fs.readFileSync(path.join(root,'app/MapCinema.html'),'utf8').matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1],ctx);
async function main(){
 let info=process.argv.includes('--features')?JSON.parse(fs.readFileSync(path.join(root,'logs/china-feature-results.json'))):fixture,plain=info.plain;
 if(process.argv.includes('--roundtrip')){const old=JSON.parse(fs.readFileSync(path.join(root,'logs/china-old-world-results.json')));info=old.nativePlayer;plain=old.plain;}
 if(process.argv.includes('--long')){
  const video=await ctx.JSZip.loadAsync(fs.readFileSync(path.join(fixture.output,'sample.mcvideo'))),m=JSON.parse(await video.file('video.json').async('string'));
  Object.assign(m,{version:4,name:'Synthetic 95 seconds 8x4 20 FPS',columns:8,rows:4,frameCount:1900,sourceFrameCount:1900,ticks:1,frameTicks:Array(1900).fill(1),totalTicks:1900,mapRefs:'frames.bin',mapCount:120,updateMode:'changed-tiles',tileThreshold:0});
  const refs=Buffer.alloc(1900*32*4);
  for(let i=0;i<1900;i++){const ids=[];for(let j=0;j<32;j++){const ref=(i*32+j)%120;refs.writeUInt32LE(ref,(i*32+j)*4);ids.push(BigInt(m.maps[ref].id));}video.file(`behavior_packs/${m.namespace}/structures/${m.namespace}/f${String(i).padStart(6,'0')}.mcstructure`,C.frameStructure(8,4,ids));}
  video.file('video.json',JSON.stringify(m));video.file('frames.bin',refs);
  const videoPath=path.join(fixture.output,'long.mcvideo');fs.writeFileSync(videoPath,await video.generateAsync({type:'uint8array',compression:'DEFLATE'}));
  info=await run({source:path.join(fixture.output,'source'),videoPath,target:path.join(fixture.output,'long-world-'+Date.now()+'.zip'),tempRoot:path.join(fixture.output,'temp'),options:{origin:[0,5,0],rotation:0,loop:true,visualOnly:false}});
  const zip=await ctx.JSZip.loadAsync(fs.readFileSync(info.target),{checkCRC32:true});plain=path.join(fixture.output,'long-plain-'+Date.now());
  for(const [name,e]of Object.entries(zip.files))if(!e.dir){const dst=path.join(plain,name);fs.mkdirSync(path.dirname(dst),{recursive:true});let b=Buffer.from(await e.async('uint8array'));if(/^db\/(?:CURRENT|MANIFEST-\d+|\d+\.(?:ldb|sst))$/.test(name))b=decrypt(b);fs.writeFileSync(dst,b);}
 }
 const world=new ctx.JSZip();for(const e of fs.readdirSync(plain,{recursive:true,withFileTypes:true}))if(e.isFile()){const full=path.join(e.parentPath,e.name);world.file(path.relative(plain,full).split(path.sep).join('/'),fs.readFileSync(full));}
 const db=await C.databaseWriter(world),colors='white orange magenta light_blue yellow lime pink gray light_gray cyan purple blue brown green red black'.split(' '),names=['wool','concrete','terracotta','stained_glass'].flatMap(kind=>colors.map(color=>'minecraft:'+color+'_'+kind)).slice(0,60);
 const entries=new Map();for(const name of Object.keys(world.files).filter(n=>/^db\/\d+\.log$/.test(n)))for(const r of C.records(await world.file(name).async('uint8array'))){const b=Buffer.from(r);let at=12;const v=()=>{let n=0,s=0,t;do{t=b[at++];n+=(t&127)*2**s;s+=7;}while(t&128);return n;};for(let i=0;i<b.readUInt32LE(8);i++){const kind=b[at++];let size=v(),key=b.toString('utf8',at,at+size);at+=size;if(kind===0){entries.delete(key);continue;}if(kind!==1)throw Error('invalid journal kind');size=v();entries.set(key,b.subarray(at,at+size));at+=size;}}
 for(let i=0;i<info.frameCount;i++){
  const key='structuretemplate_'+info.namespace+':f'+String(i).padStart(6,'0'),b=entries.get(key),needle=Buffer.from('minecraft:stone'),at=b.indexOf(needle),text=Buffer.from(names[i%60]),size=Buffer.alloc(2);size.writeUInt16LE(text.length);
  if(at<2||b.readUInt16LE(at-2)!==needle.length)throw new Error('unexpected backing palette');
  db.put(key,Buffer.concat([b.subarray(0,at-2),size,text,b.subarray(at+needle.length)]));await db.flush(null,{raw:true});
 }
 db.finish();const target=path.join(fixture.output,'engine-input-'+Date.now());
 for(const [name,e]of Object.entries(world.files))if(!e.dir){const dst=path.join(target,name);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.writeFileSync(dst,await e.async('uint8array'));}
 fs.writeFileSync(path.join(root,'logs/china-engine-fixture.json'),JSON.stringify({...info,plain:target,markerNames:names,markerPeriod:60,instrumentation:'Only test backing block colours changed. Production map references, controller structure and commands preserved.'},null,2));
 console.log('Prepared official-engine input: '+info.frameCount+' frames; '+info.columns+'x'+info.rows+'; '+target);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
