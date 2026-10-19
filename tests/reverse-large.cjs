'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
// Reuse the native EXE/CDP harness; this optional check takes a user-selected path from the environment.
const code = fs.readFileSync(path.join(__dirname, 'reverse-smoke.cjs'), 'utf8');
const prefix = code.split('async function main()')[0].replace('tests/output/reverse-encoded', 'tests/output/reverse-large');
const setup = code.split('async function main() {')[1].split('  const names =')[0];
const run = `
  const source = process.env.MAPCINEMA_REVERSE_SOURCE; assert.ok(source && fs.existsSync(source), 'Set MAPCINEMA_REVERSE_SOURCE to a complete MapCinema world/video package.');
  const {root:doc}=await call('DOM.getDocument'); const {nodeId}=await call('DOM.querySelector',{nodeId:doc.nodeId,selector:'#reverse-file'});
  await call('DOM.setFileInputFiles',{nodeId,files:[source]});
  await call('Runtime.evaluate',{expression: '(async()=>{const d=await navigator.storage.getDirectory();globalThis.reverseSaved=await d.getFileHandle("restored-large.mp4",{create:true});window.showSaveFilePicker=async()=>reverseSaved;document.getElementById("reverse-storage").value="disk";document.getElementById("reverse-form").requestSubmit();})()',awaitPromise:true});
  let state, printed=0; const deadline=Date.now()+900000;
  for(;;){
    const r=await call('Runtime.evaluate',{expression:'({busy:document.getElementById("reverse-export").disabled,status:document.getElementById("reverse-status").textContent,info:document.getElementById("reverse-info").textContent,progress:document.getElementById("reverse-progress").value,done:!document.getElementById("reverse-result").hidden})',returnByValue:true});state=r.result.value;
    if(Date.now()-printed>10000){console.log(JSON.stringify(state));printed=Date.now();}
    if(!state.busy)break;assert.ok(Date.now()<deadline,'Large export timed out');await pause(500);
  }
  assert.ok(state.done,state.status);
  await call('Runtime.evaluate',{expression:'(async()=>{const f=await reverseSaved.getFile();const a=document.createElement("a");a.href=URL.createObjectURL(f);a.download="restored-large.mp4";a.click();return f.size;})()',awaitPromise:true,returnByValue:true});
  const file=path.join(output,'restored-large.mp4');while(!fs.existsSync(file)){await pause(100);}
  fs.writeFileSync(path.join(root,'logs/reverse-large-results.json'),JSON.stringify({output:file,...state},null,2));console.log('PASS: full-size world exported to '+file);
  const exited=new Promise(r=>child.once('exit',r));socket.send(JSON.stringify({id:++sequence,method:'Browser.close'}));await exited;
}
main().then(()=>socket?.close()).catch(e=>{console.error(e);socket?.close();child.kill();process.exitCode=1;});
`;
new Function('require', '__dirname', prefix + 'async function main(){' + setup + run)(require, __dirname);
