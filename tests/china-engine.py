"""Official 1.26 BDS check of the new world backend, separate from China client acceptance."""
from pathlib import Path
import json,os,shutil,subprocess,time,uuid,sys
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parent/'Fangying_Diagnostics/server-1.26.30.5'
SERVER=ROOT/'.toolchain/china-import-engine'

def main():
    subprocess.run(['node',str(ROOT/'tests/china-engine-fixture.cjs')]+(['--roundtrip'] if '--roundtrip' in sys.argv else ['--long'] if '--long' in sys.argv else ['--features'] if '--features' in sys.argv else []),cwd=ROOT,check=True)
    info=json.loads((ROOT/'logs/china-engine-fixture.json').read_text(encoding='utf-8'))
    SERVER.mkdir(exist_ok=True)
    for name in ['bedrock_server.exe','behavior_packs','resource_packs','definitions','data','config','profanity_filter.wlist']:
        src,dst=SOURCE/name,SERVER/name
        if not dst.exists():
            if src.is_dir():shutil.copytree(src,dst,copy_function=shutil.copy2 if name=='config' else os.link)
            else:os.link(src,dst)
    world_name='ChinaImport'+str(time.time_ns());target=SERVER/'worlds'/world_name
    shutil.copytree(info['plain'],target)
    pack=target/'behavior_packs/probe';(pack/'scripts').mkdir(parents=True)
    header=str(uuid.uuid4());manifest={'format_version':2,'header':{'name':'China import observer','description':'Test instrumentation only','uuid':header,'version':[1,0,0],'min_engine_version':[1,21,90]},'modules':[{'type':'script','language':'javascript','uuid':str(uuid.uuid4()),'version':[1,0,0],'entry':'scripts/probe.js'}],'dependencies':[{'module_name':'@minecraft/server','version':'2.0.0'}]}
    (pack/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8');(target/'world_behavior_packs.json').write_text(json.dumps([{'pack_id':header,'version':[1,0,0]}]),encoding='utf-8')
    source="""import {world,system} from '@minecraft/server';
const info=INFO;
system.run(()=>{
 const dim=world.getDimension('overworld'),names=info.markerNames,count=info.frameCount,start=info.commands.find(c=>c.label==='播放／重新开始').text.slice(1),stops=info.commands.filter(c=>c.label.startsWith('停止')).map(c=>c.text.slice(1));
 let phase='idle',last='',observed=[],first=[],errors=[],lastTick=0,gaps=[],stands=[],wrong;
 function fail(text){errors.push(text);console.error('[ChinaFAIL] '+text);}
 function markerAt(entity){const p=entity.location,y=Math.floor(p.y)+2;for(let x=Math.floor(p.x)-2;x<=Math.floor(p.x)+2;x++)for(let z=Math.floor(p.z)-2;z<=Math.floor(p.z)+2;z++){const name=dim.getBlock({x,y,z})?.typeId;if(names.includes(name))return true;}return false;}
 function facing(entity){const p=entity.location,y=Math.floor(p.y)+2,result=[];for(let x=Math.floor(p.x)-2;x<=Math.floor(p.x)+2;x++)for(let z=Math.floor(p.z)-2;z<=Math.floor(p.z)+2;z++)if(dim.getBlock({x,y,z})?.typeId==='minecraft:frame')for(const [dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]])if(names.includes(dim.getBlock({x:x-dx,y,z:z-dz})?.typeId))result.push(dx+','+dz);return result;}
 function checkStands(turned=true){if(!info.anchor)return;const expected=['0,1','-1,0','0,-1','1,0','0,1'];for(let i=0;i<stands.length;i++){if(!markerAt(stands[i]))fail('same-name stand missing '+i);const want=i===1&&turned?'0,-1':expected[i];if(!facing(stands[i]).includes(want))fail('stand facing mismatch '+i+' expected '+want+' got '+facing(stands[i]));}if(markerAt(wrong))fail('different name incorrectly rendered');}
 function sample(){try{if(phase==='idle')return;const name=dim.getBlock({x:0,y:info.anchor?7:5,z:0})?.typeId;if(phase==='restart_wait'){if(name!==names[0])return;phase='restart';last='';}
 if(name!==last&&names.includes(name)){const index=names.indexOf(name),position=observed.length%count,expected=position%60;if(index!==expected)fail('frame '+observed.length+' expected '+expected+' got '+index+' tick '+system.currentTick);if(lastTick)gaps.push(system.currentTick-lastTick);lastTick=system.currentTick;observed.push(index);last=name;}}catch(e){fail(String(e));}}
 system.runInterval(sample,1);
 system.runTimeout(()=>{if(info.anchor){for(const [x,z]of[[0,0],[12,0],[0,12],[12,12],[24,0],[24,12]])dim.getBlock({x,y:4,z}).setType('minecraft:stone');for(const [x,z,yaw]of[[0,0,0],[12,0,90],[0,12,180],[12,12,270]]){const e=dim.spawnEntity('minecraft:armor_stand',{x:x+.5,y:5,z:z+.5});e.nameTag=info.anchor.name;e.setRotation({x:0,y:yaw});stands.push(e);}wrong=dim.spawnEntity('minecraft:armor_stand',{x:24.5,y:5,z:.5});wrong.nameTag='different name';system.runTimeout(()=>checkStands(false),20);system.runTimeout(()=>stands[1].setRotation({x:0,y:180}),30);system.runTimeout(()=>{const e=dim.spawnEntity('minecraft:armor_stand',{x:24.5,y:5,z:12.5});e.nameTag=info.anchor.name;stands.push(e);},40);}
 phase='first';dim.runCommand(start);system.runTimeout(()=>{checkStands();first=[...observed];if(first.length<count+10)fail('did not complete full cycle: '+first.length);for(const c of stops)dim.runCommand(c);const stopped=observed.length;
 system.runTimeout(()=>{if(observed.length!==stopped)fail('stop failed');phase='restart_wait';observed=[];last='';lastTick=0;
 // Clear only the observer's backing marker so a paused frame 0 cannot masquerade as a fresh restart.
 dim.getBlock({x:0,y:info.anchor?7:5,z:0}).setType('minecraft:stone');dim.runCommand(start);
 system.runTimeout(()=>{checkStands();if(observed.length<20)fail('restart failed');if(dim.getEntities({type:'minecraft:item'}).length)fail('map item drops');console.warn('[ChinaRESULT] '+JSON.stringify({frameCount:count,columns:info.columns,rows:info.rows,firstRunChanges:first.length,restartChanges:observed.length,minGameTicksPerFrame:Math.min(...gaps),maxGameTicksPerFrame:Math.max(...gaps),frameOrderErrors:errors.length,stopAndRestart:true,allNamedStands:info.anchor?stands.length:0,independentFacingAndTurn:!!info.anchor,lateStandAndDifferentName:!!info.anchor,audioResourcePackIncluded:!!info.audio,audioAudiblyTested:false,applicationBehaviorPackUsed:false,chinaClientTested:false}));console.warn('[ChinaDONE]');},50);
 },20);},count+90);},100);
});""".replace('INFO',json.dumps(info))
    if '--roundtrip' in sys.argv:
        # Existing screen at x=0 is occupied. Observe new stands beside their new control area.
        source=source.replace('x:0,y:info.anchor?7:5','x:info.origin[0],y:info.anchor?7:5').replace('dim.getBlock({x,y:4,z})','dim.getBlock({x:x+info.origin[0],y:4,z})').replace('x:x+.5,y:5','x:x+.5+info.origin[0],y:5').replace('x:24.5,y:5','x:24.5+info.origin[0],y:5').replace('},50);','},80);')
        source=source.replace("system.runTimeout(()=>{if(info.anchor)","system.runTimeout(()=>{dim.runCommand('fill 126 5 -3 155 10 15 air');dim.runCommand('fill 126 4 -3 155 4 15 stone');if(info.anchor)")
    (pack/'scripts/probe.js').write_text(source,encoding='utf-8')
    (SERVER/'server.properties').write_text('server-name=China backend test\nlevel-name='+world_name+'\ngamemode=creative\nallow-cheats=true\nonline-mode=true\nallow-list=true\nserver-port=29175\nserver-portv6=29176\nenable-lan-visibility=false\ncontent-log-console-output-enabled=true\n',encoding='utf-8');(SERVER/'allowlist.json').write_text('[]',encoding='utf-8')
    log=ROOT/('logs/china-engine-roundtrip.log' if '--roundtrip' in sys.argv else 'logs/china-engine-long.log' if '--long' in sys.argv else 'logs/china-engine-features.log' if '--features' in sys.argv else 'logs/china-engine.log')
    with log.open('wb') as out:
        child=subprocess.Popen([str(SERVER/'bedrock_server.exe')],cwd=SERVER,stdin=subprocess.PIPE,stdout=out,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            deadline=time.monotonic()+90
            while b'Server started.' not in log.read_bytes():
                if child.poll() is not None or time.monotonic()>deadline:raise RuntimeError('BDS failed to start')
                time.sleep(.1)
            child.stdin.write(('tickingarea add -16 -60 -16 '+str(max(47,info['controlOrigin'][0]+31))+' 319 '+str(max(47,info['controlOrigin'][2]+31))+' china_import true\ngamerule commandblocksenabled true\ngamerule commandblockoutput false\n').encode());child.stdin.flush()
            deadline=time.monotonic()+info['frameCount']/20+65
            while b'[ChinaDONE]' not in log.read_bytes():
                b=log.read_bytes()
                if b'[ChinaFAIL]' in b or b'ran with error:' in b or child.poll() is not None or time.monotonic()>deadline:raise RuntimeError('Engine probe failed: '+str(log))
                time.sleep(.2)
            child.stdin.write(b'stop\n');child.stdin.flush();child.wait(timeout=20)
        finally:
            if child.poll() is None:
                child.stdin.write(b'stop\n');child.stdin.flush()
                try:child.wait(timeout=15)
                except subprocess.TimeoutExpired:child.kill();child.wait()
    text=log.read_text(encoding='utf-8',errors='replace');assert '[ChinaFAIL]' not in text
    result=json.loads(next(line for line in text.splitlines() if '[ChinaRESULT]' in line).split('[ChinaRESULT] ',1)[1]);result['engine']='official BDS 1.26.30.5'
    (log.with_suffix('.json')).write_text(json.dumps(result,indent=2),encoding='utf-8');print('PASS: '+json.dumps(result),flush=True)

if __name__=='__main__':main()
