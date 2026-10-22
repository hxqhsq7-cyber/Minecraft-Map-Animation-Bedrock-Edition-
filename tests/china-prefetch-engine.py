"""Official BDS command integration; not ordinary China-client texture/render acceptance."""
from pathlib import Path
import json,os,shutil,subprocess,time,uuid
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parent/'Fangying_Diagnostics/server-1.26.30.5'
SERVER=ROOT/'.toolchain/china-prefetch-engine'
PREFIX='china-prefetch'+('-nonloop' if os.environ.get('MAPCINEMA_PREFETCH_NONLOOP')=='1' else '')
def main():
    subprocess.run(['node','tests/china-prefetch-fixture.cjs'],cwd=ROOT,check=True)
    info=json.loads((ROOT/'logs'/f'{PREFIX}-fixture.json').read_text(encoding='utf-8'))
    SERVER.mkdir(exist_ok=True)
    for name in ['bedrock_server.exe','behavior_packs','resource_packs','definitions','data','config','profanity_filter.wlist']:
        src,dst=SOURCE/name,SERVER/name
        if not dst.exists():
            if src.is_dir():shutil.copytree(src,dst,copy_function=shutil.copy2 if name=='config' else os.link)
            else:os.link(src,dst)
    name='ChinaPrefetch'+str(time.time_ns());target=SERVER/'worlds'/name;shutil.copytree(info['plain'],target)
    pack=target/'behavior_packs/probe';(pack/'scripts').mkdir(parents=True)
    header=str(uuid.uuid4());manifest={'format_version':2,'header':{'name':'Prefetch test observer','description':'Instrumentation only','uuid':header,'version':[1,0,0],'min_engine_version':[1,21,90]},'modules':[{'type':'script','language':'javascript','uuid':str(uuid.uuid4()),'version':[1,0,0],'entry':'scripts/probe.js'}],'dependencies':[{'module_name':'@minecraft/server','version':'2.0.0'}]}
    (pack/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8');(target/'world_behavior_packs.json').write_text(json.dumps([{'pack_id':header,'version':[1,0,0]}]),encoding='utf-8')
    (pack/'scripts/probe.js').write_text((ROOT/'tests/china-prefetch-probe.js').read_text(encoding='utf-8').replace('INFO',json.dumps(info)),encoding='utf-8')
    (SERVER/'server.properties').write_text('server-name=China native prefetch test\nlevel-name='+name+'\ngamemode=creative\nallow-cheats=true\nonline-mode=true\nallow-list=true\nserver-port=29285\nserver-portv6=29286\nenable-lan-visibility=false\ncontent-log-console-output-enabled=true\n',encoding='utf-8');(SERVER/'allowlist.json').write_text('[]',encoding='utf-8')
    log=ROOT/'logs'/f'{PREFIX}-engine.log'
    with log.open('wb') as output:
        child=subprocess.Popen([str(SERVER/'bedrock_server.exe')],cwd=SERVER,stdin=subprocess.PIPE,stdout=output,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            deadline=time.monotonic()+60
            while b'Server started.' not in log.read_bytes():
                if child.poll() is not None or time.monotonic()>deadline:raise RuntimeError('BDS failed to start')
                time.sleep(.1)
            child.stdin.write(b'tickingarea add -64 -60 -64 79 319 79 pf_test true\ngamerule commandblocksenabled true\ngamerule commandblockoutput false\n');child.stdin.flush()
            deadline=time.monotonic()+100
            while b'[PrefetchDONE]' not in log.read_bytes():
                if child.poll() is not None or time.monotonic()>deadline:raise RuntimeError('Prefetch test timeout: '+str(log))
                time.sleep(.2)
            child.stdin.write(b'stop\n');child.stdin.flush();child.wait(timeout=20)
        finally:
            if child.poll() is None:
                child.stdin.write(b'stop\n');child.stdin.flush()
                try:child.wait(timeout=15)
                except subprocess.TimeoutExpired:child.kill();child.wait()
    text=log.read_text(encoding='utf-8',errors='replace');result=json.loads(next(line for line in text.splitlines() if '[PrefetchRESULT]' in line).split('[PrefetchRESULT] ',1)[1]);result.update(engine='official BDS 1.26.30.5',world=str(target))
    (ROOT/'logs'/f'{PREFIX}-engine.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    assert not result['errors'],json.dumps(result)
    print('PASS: '+json.dumps(result),flush=True)
if __name__=='__main__':main()
