'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),prefix='china-prefetch'+(process.argv.includes('--nonloop')?'-nonloop':''),reportPath=path.join(root,'logs/'+prefix+'-engine.json'),report=JSON.parse(fs.readFileSync(reportPath)),fixture=JSON.parse(fs.readFileSync(path.join(root,'logs/'+prefix+'-fixture.json')));
async function main(){
 const helpers=fs.readFileSync(path.join(__dirname,'playback.cjs'),'utf8').split('async function main()')[0],{modules}=new Function('require','__dirname',helpers+'\nreturn {modules};')(require,__dirname);
 const ctx=modules(fs.readFileSync(path.join(root,'app/MapCinema.html'),'utf8'));Object.assign(ctx,{Response,ReadableStream,WritableStream,DecompressionStream});
 vm.runInContext(fs.readFileSync(path.join(root,'app/reverse.js'),'utf8').replace(/function mapKey\(bytes\) \{[\s\S]*?\n  \}/,'function mapKey(bytes) { return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join(""); }'),ctx);
 const archive=new ctx.JSZip();for(const n of fs.readdirSync(path.join(report.world,'db')))if(n!=='LOCK')archive.file('db/'+n,fs.readFileSync(path.join(report.world,'db',n)));
 const wanted=new Set();wanted.has=()=>true;const db=await new ctx.MapCinemaReverse.MapDatabase(archive,wanted,()=>{},async()=>{}).open();
 const cache=new Map();async function read(name){if(cache.has(name))return cache.get(name);const loc=db.index.get(Buffer.from('structuretemplate_'+name).toString('hex'));assert.ok(loc&&!loc.deleted,'Structure missing '+name);const b=loc.batch===undefined?await db.readBlock(loc.path,loc.blockOffset,loc.blockSize):(await db.journal(loc.path,false))[loc.batch];const n=ctx.MapCinemaCore.readWorldNbt(b.subarray(loc.at,loc.at+loc.length)).value;cache.set(name,n);return n;}
 let verified=0;
 for(const shot of report.snapshots){const wall=await read('pf_probe:'+shot.name),data=wall.structure.palette.default.block_position_data,height=fixture.prefetch.wallSize[1];
  for(let s=0;s<200;s++){const step=s+200*Math.floor((shot.copies-1-s)/200),rawFrame=step+200,frame=fixture.loop?((rawFrame%fixture.frameCount+fixture.frameCount)%fixture.frameCount):rawFrame,expected=frame<fixture.frameCount?(await read(fixture.namespace+':pf_f'+String(frame).padStart(6,'0'))).structure.palette.default.block_position_data:null;
   for(let x=0;x<8;x++)for(let y=0;y<4;y++){const index=((s%5*8+x)*height+Math.floor(s/5)*4+y)*2+1,actual=data[index]?.block_entity_data?.Item?.tag?.map_uuid,want=expected?.[(x*4+y)*2+1].block_entity_data.Item.tag.map_uuid;assert.equal(String(actual),String(want),`${shot.name} copies=${shot.copies} slot=${s} tile=${x},${y} expected future frame=${frame}`);if(!expected)assert.equal(wall.structure.palette.default.block_palette[wall.structure.block_indices[0][index]].name,'minecraft:air');verified++;}
  }
 }
 report.preloadedMapReferencesVerified=verified;report.nativeFutureWindowVerified=true;fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log('PASS: '+verified+' native saved map references match the future ring ('+prefix+').');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
