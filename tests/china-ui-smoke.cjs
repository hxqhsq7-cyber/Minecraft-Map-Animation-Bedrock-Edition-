'use strict';
// Run with the pinned official Electron runtime, not system Node.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {app,dialog}=require('electron');
const root=path.resolve(__dirname,'..'),fixture=JSON.parse(fs.readFileSync(path.join(root,'logs/china-test-results.json')));
const feature=JSON.parse(fs.readFileSync(path.join(root,'logs/china-feature-results.json')));
const stamp=Date.now(),targets=[path.join(fixture.output,`ui-audio-export-only-${stamp}.zip`),path.join(fixture.output,`ui-cancelled-${stamp}.zip`)];
const [exportOnlyTarget,cancelTarget]=targets;
const fakeClient=path.join(fixture.output,'ordinary-ui-client-'+stamp),fakePacks=path.join(fakeClient,'games/com.netease/resource_packs');
fs.mkdirSync(fakePacks,{recursive:true});fs.mkdirSync(path.join(fakeClient,'minecraftWorlds'),{recursive:true});
const old=process.env.MAPCINEMA_UI_PIPELINE==='international'?JSON.parse(fs.readFileSync(path.join(root,'logs/china-old-world-results.json'))):null;
const oldBackup=old&&path.join(old.output,'backups',fs.readdirSync(path.join(old.output,'backups')).find(n=>!n.endsWith('.json')));
const fakeTarget=path.join(fakeClient,'minecraftWorlds','fresh+slot=');fs.cpSync(oldBackup||path.join(fixture.output,'source'),fakeTarget,{recursive:true});
fs.mkdirSync(path.join(fakeClient,'minecraftWorlds','other'));fs.writeFileSync(path.join(fakeClient,'minecraftWorlds','other','keep.txt'),'other world');
let invalidClientChoice=false,blockWorld=false;
const mainPath=process.env.MAPCINEMA_APP_MAIN || path.join(root,'app/main.cjs');
const installer=require(path.join(path.dirname(mainPath),'china-install.cjs')),install=installer.install;
// Stub only process enumeration; use the real native installer and ZIP extraction in an isolated F-drive client.
installer.install=(options,_guard,progress)=>install(options,async()=>{if(blockWorld)throw Error('客户端仍在运行');},progress);
dialog.showOpenDialog=async(_win,options)=>({canceled:false,filePaths:[options.title.includes('普通中国版数据目录')?(invalidClientChoice?fixture.output:fakeClient):options.title.includes('.mcvideo')?feature.featureVideoPath:path.join(fakeTarget,options.title.includes('level.dat 文件')?'level.dat':'db')]});
dialog.showSaveDialog=async()=>({canceled:false,filePath:targets.shift()});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const {win,data}=await require(mainPath).start({show:false});
 const before=await installer.fingerprint(fakeTarget,()=>{});
 const evaluate=code=>win.webContents.executeJavaScript(code,true);
 for(let i=0;i<80;i++){if(await evaluate('Boolean(document.getElementById("china-panel"))'))break;await wait(50);}
 assert.ok(await evaluate('Boolean(document.getElementById("china-panel"))'),'China panel missing');
 assert.equal(await evaluate('typeof require'),'undefined');
 assert.ok(await evaluate('document.getElementById("china-keep-name").checked'));
 if(old)await evaluate('document.getElementById("china-pipeline").value="international";document.getElementById("china-x").value="128"');
 await evaluate('(async()=>{for(const k of ["video","world","client"])document.getElementById("china-pick-"+k).click();})()');
 for(let i=0;i<80;i++){if(await evaluate('document.getElementById("china-world-check").textContent.includes("检查通过") && document.getElementById("china-client-path").textContent === '+JSON.stringify(fakeClient)))break;await wait(50);}
 assert.ok(await evaluate('document.getElementById("china-deploy-world").checked'));
 await evaluate('document.getElementById("china-pick-level").click()');await wait(100);
 assert.ok(await evaluate('document.getElementById("china-world-check").textContent.includes("检查通过")'));
 assert.equal(await evaluate('document.getElementById("china-prefetch-mode").value'),'package');
 await evaluate('document.getElementById("china-prefetch-mode").value="on";document.getElementById("china-prefetch-mode").dispatchEvent(new Event("change"));document.getElementById("china-prefetch-frames").value="200"');
 assert.ok(await evaluate('!document.getElementById("china-prefetch-options").hidden && document.getElementById("china-prefetch-frames").max === "200"'));
 await evaluate('document.getElementById("china-audio-mode").value="package";document.getElementById("china-form").requestSubmit()');
 for(let i=0;i<300;i++){if(await evaluate('!document.getElementById("china-result").hidden'))break;await wait(50);}
 const first=await evaluate('({result:!document.getElementById("china-result").hidden,status:document.getElementById("china-status").textContent,commands:[...document.querySelectorAll("#china-commands textarea")].map(e=>e.value),message:document.getElementById("china-result-info").textContent})');
 assert.ok(first.result,JSON.stringify(first));const exports=fs.readdirSync(path.join(data,'Exports'));assert.equal(exports.length,1);const firstTarget=path.join(data,'Exports',exports[0]);assert.ok(fs.existsSync(firstTarget));assert.ok(first.commands.some(s=>s.includes('/structure load "fy_cn_')));
 const worldRoot=path.join(fakeClient,'minecraftWorlds');assert.deepEqual(fs.readdirSync(worldRoot).sort(),['fresh+slot=','other']);
 const installedWorld=fakeTarget;assert.ok(fs.existsSync(path.join(installedWorld,'db/CURRENT')));
 assert.ok(await evaluate('document.getElementById("china-world-status").textContent.includes("已备份并替换完成")'));
 const backupRoot=path.join(data,'ChinaBackups'),backupDirectory=path.join(backupRoot,fs.readdirSync(backupRoot).find(n=>!n.endsWith('.json')));
 assert.equal(await installer.fingerprint(backupDirectory,()=>{}),before);
 assert.ok(await evaluate('!document.getElementById("china-reveal-backup").hidden && typeof MapCinemaChina.revealBackup === "function"'));
 fs.writeFileSync(path.join(installedWorld,'gameplay-saved.txt'),'keep');
 blockWorld=true;await evaluate('document.getElementById("china-deploy-world-now").click()');
 for(let i=0;i<80;i++){if(await evaluate('document.getElementById("china-world-status").textContent.includes("仍在运行") && !document.getElementById("china-deploy-world-now").disabled'))break;await wait(50);}
 assert.ok(await evaluate('document.getElementById("china-world-status").textContent.includes("仍在运行")'));assert.ok(fs.existsSync(firstTarget));
 blockWorld=false;await evaluate('document.getElementById("china-deploy-world-now").click()');
 for(let i=0;i<80;i++){if(await evaluate('document.getElementById("china-world-status").textContent.includes("保留当前游戏进度") && !document.getElementById("china-deploy-world-now").disabled'))break;await wait(50);}
 assert.equal(fs.readdirSync(worldRoot).length,2);assert.equal(fs.readFileSync(path.join(installedWorld,'gameplay-saved.txt'),'utf8'),'keep');
 assert.ok(first.commands.some(s=>s.startsWith('/summon armor_stand')));assert.ok(first.commands.some(s=>s.startsWith('/playsound')));
 assert.ok(first.message.includes('已开启 3 帧预加载'));assert.ok(first.commands.some(s=>s.includes('scoreboard players set active')));
 assert.deepEqual(fs.readFileSync(path.join(fakeTarget,'levelname.txt')),fs.readFileSync(path.join(oldBackup||path.join(fixture.output,'source'),'levelname.txt')));
 if(old){assert.ok(first.message.includes('已完成解密'));assert.ok(fs.existsSync(path.join(fakeTarget,'resource_packs/old-assets/keep.txt')));}
 assert.ok(await evaluate('document.getElementById("china-audio-status").textContent.includes("本机音轨已部署")'));
 assert.ok(await evaluate('document.getElementById("china-audio-status").textContent.includes("退出整个游戏") && document.getElementById("china-audio-status").style.fontWeight === "700"'));
 const links=fs.readdirSync(fakePacks);assert.equal(links.length,1);const deployed=path.join(fakePacks,links[0]);assert.ok(fs.lstatSync(deployed).isSymbolicLink());
 const persistentAudio=fs.realpathSync(deployed);assert.ok(persistentAudio.includes('ChinaAudio'));assert.ok(fs.existsSync(path.join(persistentAudio,'manifest.json')));
 await evaluate('document.getElementById("china-remove-audio").click()');
 for(let i=0;i<80;i++){if(!fs.existsSync(deployed))break;await wait(50);}
 assert.ok(!fs.existsSync(deployed));assert.ok(fs.existsSync(path.join(persistentAudio,'manifest.json')));
 invalidClientChoice=true;await evaluate('document.getElementById("china-pick-client").click()');
 for(let i=0;i<80;i++){if(await evaluate('document.getElementById("china-client-path").textContent.includes("目录无效")'))break;await wait(50);}
 await evaluate('document.getElementById("china-deploy-now").click()');
 for(let i=0;i<80;i++){if(await evaluate('document.getElementById("china-audio-status").textContent.includes("目录无效")'))break;await wait(50);}
 assert.ok(await evaluate('document.getElementById("china-audio-status").textContent.includes("目录无效")'));assert.ok(!fs.existsSync(deployed));
 invalidClientChoice=false;await evaluate('document.getElementById("china-pick-client").click()');
 for(let i=0;i<80;i++){if(await evaluate('document.getElementById("china-client-path").textContent === '+JSON.stringify(fakeClient)))break;await wait(50);}
 fs.mkdirSync(deployed);fs.writeFileSync(path.join(deployed,'other-user.txt'),'preserve');
 await evaluate('document.getElementById("china-deploy-now").click()');
 for(let i=0;i<80;i++){if(await evaluate('document.getElementById("china-audio-status").textContent.includes("部署失败")'))break;await wait(50);}
 assert.ok(await evaluate('document.getElementById("china-audio-status").textContent.includes("部署失败")'));assert.ok(fs.existsSync(firstTarget));
 assert.equal(fs.readFileSync(path.join(deployed,'other-user.txt'),'utf8'),'preserve');fs.unlinkSync(path.join(deployed,'other-user.txt'));fs.rmdirSync(deployed);
 await evaluate('document.getElementById("china-deploy-now").click()');
 for(let i=0;i<80;i++){if(fs.existsSync(deployed))break;await wait(50);}
 assert.ok(fs.existsSync(deployed));
 await evaluate('document.getElementById("china-pick-output").click()');
 for(let i=0;i<80;i++){if(await evaluate('document.getElementById("china-output-path").textContent.endsWith('+JSON.stringify(path.basename(exportOnlyTarget))+')'))break;await wait(50);}
 await evaluate('document.getElementById("china-pipeline").value="native";document.getElementById("china-x").value="256";document.getElementById("china-prefetch-mode").value="off";document.getElementById("china-deploy-audio").checked=false;document.getElementById("china-deploy-world").checked=false;document.getElementById("china-form").requestSubmit()');
 for(let i=0;i<300;i++){if(await evaluate('!document.getElementById("china-result").hidden'))break;await wait(50);}
 assert.ok(fs.existsSync(exportOnlyTarget));assert.equal(fs.readdirSync(fakePacks).length,1);
 assert.ok(await evaluate('!document.getElementById("china-result-info").textContent.includes("已开启")'));
 assert.equal(fs.readdirSync(worldRoot).length,2);assert.ok(await evaluate('document.getElementById("china-world-status").textContent.includes("尚未替换")'));
 assert.ok(await evaluate('document.getElementById("china-audio-status").textContent.includes("尚未部署")'));
 await evaluate('document.getElementById("china-pick-output").click()');
 for(let i=0;i<80;i++){if(await evaluate('document.getElementById("china-output-path").textContent.endsWith('+JSON.stringify(path.basename(cancelTarget))+')'))break;await wait(50);}
 await evaluate('globalThis.stopChinaProbe=MapCinemaChina.onProgress(()=>document.getElementById("china-cancel").click());document.getElementById("china-form").requestSubmit()');
 for(let i=0;i<200;i++){if(await evaluate('document.getElementById("china-status").textContent.includes("已取消")'))break;await wait(50);}
 const cancelled=await evaluate('({status:document.getElementById("china-status").textContent,enabled:!document.getElementById("china-import").disabled})');
 assert.ok(cancelled.status.includes('已取消'),JSON.stringify(cancelled));assert.ok(cancelled.enabled);assert.ok(!fs.existsSync(cancelTarget));
 await evaluate('stopChinaProbe();document.getElementById("china-panel").scrollIntoView({behavior:"instant",block:"start"})'); await wait(500);
 // Isolate the actual panel for a readable hidden-window visual capture after the functional checks.
 await evaluate('document.querySelectorAll("main > :not(#china-panel),header,footer").forEach(e=>e.style.display="none");window.scrollTo(0,0)');await wait(300);
 let screenshot=false;try{const png=await win.webContents.capturePage();fs.writeFileSync(path.join(root,'logs/china-panel.png'),png.toPNG());screenshot=true;}catch{}
 assert.equal(fs.readFileSync(path.join(worldRoot,'other','keep.txt'),'utf8'),'other world');
 const report={nativeBridgeRealWorker:true,realFormSubmit:true,selectedWorldReplaced:true,noAdditionalWorldDirectory:true,originalTargetBackupVerified:true,targetDirectory:fakeTarget,backupDirectory,automaticBackupPath:true,worldDeploymentRetryPreservesGameplay:true,runningClientDeploymentFailureKeepsZip:true,worldExportWithoutDeployment:true,dbSelectionResolvesWorld:true,levelDatSelection:true,worldCheckVisible:true,anchorAndAudioImport:true,ordinaryAudioDeployment:true,audioRemovalKeepsFiles:true,audioRedeployment:true,invalidClientDoesNotFallBack:true,audioCollisionPreservesOtherFiles:true,deploymentFailureKeepsZip:true,exportWithoutDeployment:true,audioDirectory:persistentAudio,clientRoot:fakeClient,sourceOnlyThroughNativePicker:true,renderedQuotedCommands:true,cancellationRestoresForm:true,nodeIntegration:false,otherWorldUnmodified:true,screenshot,output:firstTarget,chinaClientTested:false};
 fs.writeFileSync(path.join(root,'logs/china-ui-results.json'),JSON.stringify(report,null,2));console.log('PASS: '+JSON.stringify(report));app.quit();
}
main().catch(error=>{console.error(error);app.exit(1);});
