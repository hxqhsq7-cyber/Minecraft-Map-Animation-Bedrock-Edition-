/* Android Storage Access Framework bridge. No server, network or all-files permission. */
(function(root){
  'use strict';
  if (!root.MapCinemaNative) return;
  const native=root.MapCinemaNative, requests=new Map(), outputs=[];
  let sequence=0;
  function request(method,...args){
    return new Promise((resolve,reject)=>{
      const id='mc_'+(++sequence);requests.set(id,{resolve,reject});
      try{native[method](id,...args);}catch(error){requests.delete(id);reject(error);}
    });
  }
  function onResult(id,value){
    const pending=requests.get(id);if(!pending)return;requests.delete(id);
    if(value.ok)pending.resolve(value);else{const e=new Error(value.message||'安卓文件操作未完成');e.name=value.name||'Error';pending.reject(e);}
  }
  function base64(bytes){return btoa(String.fromCharCode.apply(null,bytes));}
  async function bytesOf(value){
    if(value instanceof Uint8Array)return value;
    if(value instanceof ArrayBuffer)return new Uint8Array(value);
    if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
    if(value instanceof Blob)return new Uint8Array(await value.arrayBuffer());
    if(typeof value==='string')return new TextEncoder().encode(value);
    throw new TypeError('不支持的文件写入类型');
  }
  async function choose(name,mime){
    const selected=await request('beginSave',name,mime||'application/octet-stream');
    let done=false,failed=false,writing=Promise.resolve();
    const writer={
      write(value){
        if(done)return Promise.reject(new Error('输出文件已关闭'));
        const task=writing.then(async()=>{
          if(failed)throw new Error('上次文件写入失败');
          const bytes=await bytesOf(value);
          for(let at=0;at<bytes.length;at+=49152)await request('write',selected.token,base64(bytes.subarray(at,Math.min(at+49152,bytes.length))));
        });
        writing=task.catch(()=>{failed=true;});return task;
      },
      async close(){
        if(done)return;done=true;await writing;
        if(failed){await request('close',selected.token,true);throw new Error('文件写入失败，未保存完整结果');}
        const completed=await request('close',selected.token,false);outputs.push(completed);showExports();
      },
      async abort(){if(done)return;done=true;await writing;await request('close',selected.token,true);}
    };
    return {name:selected.name,async createWritable(){return writer;}};
  }
  // Reuse the streaming ZIP/ZIP64 path already implemented by MapCinemaLarge.
  root.showSaveFilePicker=async function(options){
    const types=options&&options.types;
    const mime=types&&types[0]&&types[0].accept?Object.keys(types[0].accept)[0]:'application/octet-stream';
    return choose(options&&options.suggestedName||'MapCinema.mcworld',mime);
  };
  async function saveDownload(link){
    const response=await fetch(link.href),blob=await response.blob();
    const handle=await choose(link.download||'MapCinema.mcworld',blob.type||'application/octet-stream'),writer=await handle.createWritable();
    try{
      for(let at=0;at<blob.size;at+=49152)await writer.write(new Uint8Array(await blob.slice(at,at+49152).arrayBuffer()));
      await writer.close();
    }catch(error){try{await writer.abort();}catch(_){}throw error;}
  }
  function showExports(){
    const reverse=document.getElementById('reverse-result');
    const result=reverse&&!reverse.hidden?reverse:document.getElementById('result');if(!result||!outputs.length)return;
    let area=document.getElementById('android-exports');
    if(!area){area=document.createElement('div');area.id='android-exports';result.append(area);}
    else if(area.parentElement!==result)result.append(area);
    area.replaceChildren();
    const heading=document.createElement('p');heading.className='hint';heading.textContent='文件已通过安卓系统保存。可选择应用打开／导入，或分享文件。';area.append(heading);
    for(const item of outputs.slice(-3)){
      const row=document.createElement('div');row.className='android-export-row';
      const label=document.createElement('span');label.textContent=item.name;row.append(label);
      for(const [text,share] of [['打开／导入',false],['分享文件',true]]){
        const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent=text;
        button.addEventListener('click',()=>native.openDocument(item.token,share));row.append(button);
      }
      area.append(row);
    }
  }
  function showError(message){
    const area=document.getElementById('error');if(area){area.textContent=message;area.hidden=false;}
    else alert(message);
  }
  document.addEventListener('click',event=>{
    const a=event.target.closest&&event.target.closest('a[download]');if(!a||!a.href||a.getAttribute('aria-disabled')==='true')return;
    event.preventDefault();saveDownload(a).catch(e=>{if(e.name!=='AbortError')showError('保存失败：'+e.message);});
  },true);
  document.addEventListener('DOMContentLoaded',()=>{
    let modernSyntax=true;try{new Function('return ({a:1})?.a ?? 0');}catch(_){modernSyntax=false;}
    if(!modernSyntax||typeof BigInt!=='function'||!root.crypto||!root.crypto.getRandomValues||!Blob.prototype.arrayBuffer){
      document.body.replaceChildren();
      const message=document.createElement('p');message.style.cssText='padding:32px;font:18px/1.8 sans-serif';
      message.textContent='请先更新手机的 Android System WebView／Chrome，再重新打开方映。此版本 WebView 缺少视频转换需要的浏览器功能。';document.body.append(message);return;
    }
    for(const id of ['output-type','merge-output']){
      const select=document.getElementById(id);if(select)for(const o of select.options)if(o.value==='folder')o.disabled=true;
    }
    const storage=document.getElementById('storage-mode');if(storage)storage.value='disk';
    const capacity=document.getElementById('capacity');if(capacity)capacity.value='4096';
    if(storage)storage.dispatchEvent(new Event('input',{bubbles:true}));
    const badge=document.querySelector('.badge');if(badge)badge.textContent='安卓离线应用 · v18';
    const footer=document.querySelector('footer a');if(footer){const label=document.createElement('span');label.textContent='全部资源已内置 · 无需联网';footer.replaceWith(label);}
    const busy=()=>{const a=document.getElementById('convert'),b=document.getElementById('merge-button');native.setBusy(!!(a&&b&&a.disabled&&b.disabled));};
    for(const id of ['convert','merge-button']){const button=document.getElementById(id);if(button)new MutationObserver(busy).observe(button,{attributes:true,attributeFilter:['disabled']});}
    for(const id of ['result','reverse-result']){const result=document.getElementById(id);if(result)new MutationObserver(showExports).observe(result,{attributes:true,attributeFilter:['hidden']});}
    busy();
  });
  root.MapCinemaAndroid={onResult,request,choose,saveDownload,outputs};
})(window);
