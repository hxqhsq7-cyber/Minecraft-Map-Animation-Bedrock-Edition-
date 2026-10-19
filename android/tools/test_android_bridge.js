/* Contract tests for JS/native streaming protocol; not an Android device test. */
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
function fixture(){
  const files=new Map();let next=0,failWrite=false,cancel=false;
  const ctx={Uint8Array,ArrayBuffer,Blob,TextEncoder,Promise,Map,Error,TypeError,
    btoa:s=>Buffer.from(s,'binary').toString('base64'),
    document:{addEventListener(){},getElementById(){return null;}},
  };
  const reply=(id,value)=>queueMicrotask(()=>ctx.MapCinemaAndroid.onResult(id,value));
  ctx.MapCinemaNative={
    beginSave(id,name,mime){
      if(cancel){reply(id,{ok:false,name:'AbortError',message:'cancelled'});return;}
      const token='file'+(++next);files.set(token,{name,mime,chunks:[],closed:false,abort:false});
      reply(id,{ok:true,token,name});
    },
    write(id,token,b64){
      if(failWrite){reply(id,{ok:false,message:'disk full'});return;}
      const data=Buffer.from(b64,'base64');assert.ok(data.length<=49152);
      files.get(token).chunks.push(data);reply(id,{ok:true});
    },
    close(id,token,abort){const f=files.get(token);f.closed=true;f.abort=abort;reply(id,{ok:true,token,name:f.name,bytes:Buffer.concat(f.chunks).length});}
  };
  ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/android.js'),'utf8'),ctx);
  return {ctx,files,setFail:v=>failWrite=v,setCancel:v=>cancel=v};
}
(async()=>{
  const {ctx,files,setFail,setCancel}=fixture();
  const source=Uint8Array.from({length:210000},(_,i)=>i%251);
  const h=await ctx.showSaveFilePicker({suggestedName:'测试.mcvideo',types:[{accept:{'application/zip':['.mcvideo']}}]});
  const w=await h.createWritable();
  await Promise.all([w.write(source.subarray(0,100000)),w.write(source.subarray(100000)),w.write('结束')]);
  await w.close();
  const f=files.get('file1');assert.equal(f.name,'测试.mcvideo');assert.equal(f.abort,false);
  assert.deepEqual(Buffer.concat(f.chunks),Buffer.concat([Buffer.from(source),Buffer.from('结束')]));
  assert.equal(ctx.MapCinemaAndroid.outputs.length,1);
  await assert.rejects(w.write(source),/已关闭/);
  const abort=await (await ctx.MapCinemaAndroid.choose('取消.mcworld')).createWritable();
  await abort.write(new Blob(['partial']));await abort.abort();assert.equal(files.get('file2').abort,true);
  assert.equal(ctx.MapCinemaAndroid.outputs.length,1);
  const broken=await (await ctx.MapCinemaAndroid.choose('失败.mcworld')).createWritable();
  setFail(true);await assert.rejects(broken.write(source),/disk full/);
  await assert.rejects(broken.close(),/未保存完整结果/);assert.equal(files.get('file3').abort,true);
  setFail(false);setCancel(true);
  await assert.rejects(ctx.showSaveFilePicker({}),e=>e.name==='AbortError');
  setCancel(false);
  const mp4=await ctx.showSaveFilePicker({suggestedName:'导出.mp4',types:[{accept:{'video/mp4':['.mp4']}}]});
  const mp4Writer=await mp4.createWritable();await mp4Writer.write(Uint8Array.from([0,0,0,8,102,116,121,112]));await mp4Writer.close();
  assert.equal(files.get('file4').mime,'video/mp4');assert.equal(files.get('file4').abort,false);
  console.log('PASS: chunk size, byte order, queued writes, Blob writes, close, abort, write failure, picker cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
