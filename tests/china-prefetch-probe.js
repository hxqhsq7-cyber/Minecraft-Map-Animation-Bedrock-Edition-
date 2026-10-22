import { world, system } from '@minecraft/server';
const info = INFO;
system.run(() => {
  const dim=world.getDimension('overworld'), p=info.prefetch, obj=p.objective, ns=info.namespace;
  const score=name=>world.scoreboard.getObjective(obj)?.getScore(name), entities=tag=>dim.getEntities({type:'minecraft:area_effect_cloud',tags:[ns+'_'+tag]});
  let viewer,viewer2,errors=[],phase=0,copies=0,lastCursor=0,snapshots=[],startTick=0,awaitingReset=false;
  const fail=message=>{errors.push(message);console.error('[PrefetchFAIL] '+message);};
  function move(entity,x,z){dim.getBlock({x:Math.floor(x),y:4,z:Math.floor(z)}).setType('minecraft:stone');entity.teleport({x,y:5,z});}
  function snapshot(name){const station=entities('station').find(e=>!e.hasTag(ns+'_old'));if(!station){fail('missing station for snapshot '+name);return;}
    const a={x:Math.floor(station.location.x)-12,y:Math.floor(station.location.y),z:Math.floor(station.location.z)+7},b={x:a.x+39,y:a.y+159,z:a.z+1};
    dim.runCommand(`structure save "pf_probe:${name}" ${a.x} ${a.y} ${a.z} ${b.x} ${b.y} ${b.z} false disk true`);snapshots.push({name,copies,station:{...station.location},bounds:{a,b}});
  }
  const stops=()=>{for(const command of info.commands.filter(c=>c.label.startsWith('停止')))dim.runCommand(command.text.slice(1));};
  system.runTimeout(()=>{dim.getBlock({x:0,y:4,z:12}).setType('minecraft:stone');viewer=dim.spawnEntity('minecraft:armor_stand',{x:.5,y:5,z:12.5});viewer.nameTag='pf_test_viewer';startTick=system.currentTick;dim.runCommand(info.commands.find(c=>c.label==='播放／重新开始').text.slice(1));},100);
  system.runInterval(()=>{try{
    if(!viewer)return;
    if(system.currentTick-startTick<180&&(system.currentTick-startTick)%20===0)console.warn('[PrefetchDEBUG] '+JSON.stringify({t:system.currentTick-startTick,viewer:viewer.location,active:score('active'),init:score('init'),start:score('start'),count:score('count'),clouds:dim.getEntities({type:'minecraft:area_effect_cloud'}).map(e=>({p:e.location,t:e.getTags()})).slice(0,4),air:dim.getBlock({x:-12,y:17,z:7})?.typeId,ref:dim.getBlock({x:0,y:5,z:46})?.typeId}));
    if(awaitingReset&&score('init')===1){awaitingReset=false;lastCursor=0;}
    const cursor=score('cursor')||0,diff=(cursor-lastCursor+200)%200;if(phase===7||awaitingReset||phase===8&&score('init')===1){lastCursor=cursor;}else{if(diff>1)fail('cursor skipped '+diff);copies+=diff;lastCursor=cursor;}
    if(system.currentTick-startTick>220&&phase===0&&copies===0){fail('video never started '+JSON.stringify({active:score('active'),start:score('start'),init:score('init'),count:score('count'),clouds:entities('station').map(e=>({p:e.location,t:e.getTags()}))}));phase=99;}
    if(!info.loop){
      if(phase===0&&copies>=25){snapshot('first');phase=9;}
      if(phase===9&&score('active')===0&&score('count')===0){
        if(dim.getEntities({type:'minecraft:item'}).length)fail('nonloop map drops');
        if(dim.getBlock({x:-12,y:17,z:7}).typeId!=='minecraft:air')fail('nonloop wall remains');
        stops();copies=0;lastCursor=0;awaitingReset=true;phase=8;startTick=system.currentTick;
        dim.runCommand(info.commands.find(c=>c.label==='播放／重新开始').text.slice(1));
      }
      if(phase===8&&copies>=30){snapshot('restarted');stops();console.warn('[PrefetchRESULT] '+JSON.stringify({errors,snapshots,nonloopEndCleanup:true,stopAndRestart:true,mapDrops:false,chinaClientTested:false}));console.warn('[PrefetchDONE]');phase=100;}
      return;
    }
    if(phase===0&&copies>=25){snapshot('first');if(entities('station').length!==1)fail('initial station count');if(dim.getBlock({x:-12,y:17,z:7}).typeId!=='minecraft:barrier')fail('first backing not loaded');phase=1;}
    if(phase===1&&copies>=60){move(viewer,15.99,12.5);phase=2;}
    if(phase===2&&copies>=75){if(entities('station').length!==1||Math.floor(entities('station')[0].location.x)!==0)fail('15.99 unexpectedly changed chunk');move(viewer,16.01,12.5);phase=3;}
    if(phase===3&&copies>=140){if(entities('station').length!==1||Math.floor(entities('station')[0].location.x)!==16)fail('cross-chunk move did not migrate');if(dim.getBlock({x:-12,y:17,z:7}).typeId!=='minecraft:air')fail('old chunk wall not cleaned');snapshot('moved');phase=4;}
    if(phase===4&&copies>=220){viewer2=dim.spawnEntity('minecraft:armor_stand',{x:17.5,y:5,z:12.5});viewer2.nameTag='pf_test_viewer';move(viewer2,17.5,12.5);phase=5;}
    if(phase===5&&copies>=240){if(entities('station').length!==1)fail('same chunk not shared');snapshot('loop');phase=6;}
    if(phase===6&&copies>=420){snapshot('second_loop');stops();phase=7;startTick=system.currentTick;}
    if(phase===7&&system.currentTick-startTick>=12){if(entities('station').length)fail('stop left stations');if(dim.getEntities({type:'minecraft:item'}).length)fail('map item drops');if(dim.getBlock({x:4,y:17,z:7}).typeId!=='minecraft:air')fail('stop left wall');copies=0;lastCursor=0;awaitingReset=true;dim.runCommand(info.commands.find(c=>c.label==='播放／重新开始').text.slice(1));phase=8;startTick=system.currentTick;}
    if(phase===8&&copies>=30){snapshot('restarted');stops();console.warn('[PrefetchRESULT] '+JSON.stringify({errors,frames:info.frameCount,preloadSlots:200,layout:p.wallSize,snapshots,chunkEdgeAndMigration:true,sharedChunk:true,stopAndRestart:true,mapDrops:false,applicationBehaviorPackUsed:false,chinaClientTested:false}));console.warn('[PrefetchDONE]');phase=100;}
    if(phase===99||system.currentTick-startTick>1000&&phase!==100){console.warn('[PrefetchRESULT] '+JSON.stringify({errors,phase,copies,score:{active:score('active'),init:score('init'),start:score('start'),count:score('count')},clouds:entities('station').map(e=>({location:e.location,tags:e.getTags()}))}));console.warn('[PrefetchDONE]');phase=100;}
  }catch(error){fail(String(error));}},1);
});
