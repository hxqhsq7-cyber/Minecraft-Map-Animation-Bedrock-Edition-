'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),{run,decrypt}=require('../app/china-world.cjs');
const core=require('../app/china-world.cjs').loadEngine().C,fixture=JSON.parse(fs.readFileSync(path.join(root,'logs/china-test-results.json')));
async function main(){
 const context=vm.createContext({Uint8Array,Uint16Array,Uint32Array,Int32Array,ArrayBuffer,DataView,TextEncoder,TextDecoder,Blob,setTimeout,clearTimeout,setImmediate,console});
 vm.runInContext([...fs.readFileSync(path.join(root,'app/MapCinema.html'),'utf8').matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1],context);
 const zip=await context.JSZip.loadAsync(fs.readFileSync(path.join(fixture.output,'sample.mcvideo'))),m=JSON.parse(await zip.file('video.json').async('string'));
 const frames=205,columns=8,rows=4,refs=Buffer.alloc(frames*columns*rows*4);
 for(let i=0;i<frames;i++){const ids=[];for(let t=0;t<columns*rows;t++){const ref=(i*columns*rows+t)%m.maps.length;refs.writeUInt32LE(ref,(i*columns*rows+t)*4);ids.push(BigInt(m.maps[ref].id));}zip.file(`behavior_packs/${m.namespace}/structures/${m.namespace}/f${String(i).padStart(6,'0')}.mcstructure`,core.frameStructure(columns,rows,ids));}
 Object.assign(m,{version:4,name:'China native prefetch 200',columns,rows,frameCount:frames,sourceFrameCount:frames,ticks:1,frameTicks:Array(frames).fill(1),totalTicks:frames,mapRefs:'frames.bin',mapCount:m.maps.length,updateMode:'changed-tiles',tileThreshold:0});zip.file('video.json',JSON.stringify(m));zip.file('frames.bin',refs);
 const output=path.join(fixture.output,'prefetch-'+Date.now());fs.mkdirSync(output);const videoPath=path.join(output,'sample.mcvideo');fs.writeFileSync(videoPath,await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}));
 const modulePath=require.resolve('../app/china-prefetch.cjs'),original=require(modulePath),mock={exports:{}};
 const source=fs.readFileSync(modulePath,'utf8');if(!source.includes('as @a[r=64]'))throw Error('Viewer selector changed; update observer instrumentation');
 new Function('module',source.replace('as @a[r=64]','as @e[type=armor_stand,name=pf_test_viewer,r=64]'))(mock);require.cache[modulePath].exports=mock.exports;
 const nonloop=process.env.MAPCINEMA_PREFETCH_NONLOOP==='1';
 let info;try{info=await run({source:path.join(fixture.output,'source'),videoPath,target:path.join(output,'world.zip'),tempRoot:path.join(fixture.output,'temp'),options:{origin:[0,5,0],rotation:0,loop:!nonloop,prefetchMode:'on',prefetch:{enabled:true,frames:200,height:12}}});}finally{require.cache[modulePath].exports=original;}
 const archive=await context.JSZip.loadAsync(fs.readFileSync(info.target),{checkCRC32:true}),plain=path.join(output,'plain');
 for(const [name,e]of Object.entries(archive.files))if(!e.dir){const file=path.join(plain,name);fs.mkdirSync(path.dirname(file),{recursive:true});let bytes=Buffer.from(await e.async('uint8array'));if(/^db\/(?:CURRENT|MANIFEST-\d+|\d+\.(?:ldb|sst))$/.test(name))bytes=decrypt(bytes);fs.writeFileSync(file,bytes);}
 const report={...info,plain,output,videoPath,instrumentation:'Only viewer selector changes from players to named armor stands; all prefetch commands, AEC entities, structures, maps and timing remain the production algorithm.'};
 fs.writeFileSync(path.join(root,`logs/china-prefetch${nonloop?'-nonloop':''}-fixture.json`),JSON.stringify(report,null,2));console.log(JSON.stringify({output,frames,slots:info.prefetch.frames,wallSize:info.prefetch.wallSize}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
