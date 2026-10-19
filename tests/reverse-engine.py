"""Have official BDS recover/compact synthetic map WALs, then retain a read-only export fixture."""
from pathlib import Path
import os
import shutil
import subprocess
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'Fangying_Diagnostics/server-1.26.30.5'
SERVER = ROOT / '.toolchain/reverse-engine'

def main():
    SERVER.mkdir(exist_ok=True)
    for name in ['bedrock_server.exe', 'behavior_packs', 'resource_packs', 'definitions', 'data', 'config', 'profanity_filter.wlist']:
        source, target = SOURCE / name, SERVER / name
        if not target.exists():
            if source.is_dir(): shutil.copytree(source, target, copy_function=os.link)
            else: os.link(source, target)
    world = SERVER / 'worlds/ReverseWorld'
    if world.exists():
        assert world.resolve().is_relative_to((SERVER / 'worlds').resolve()) and world.name == 'ReverseWorld'
        shutil.rmtree(world)
    world.mkdir(parents=True)
    with zipfile.ZipFile(ROOT / 'tests/output/reverse/source.mcworld') as archive:
        assert all(not name.startswith('/') and '..' not in name.split('/') for name in archive.namelist())
        archive.extractall(world)
    (SERVER / 'server.properties').write_text('server-name=MapCinema isolated reverse test\nlevel-name=ReverseWorld\nlevel-type=FLAT\ngamemode=creative\nallow-cheats=true\nonline-mode=true\nallow-list=true\nserver-port=29155\nserver-portv6=29156\nenable-lan-visibility=false\ncontent-log-console-output-enabled=true\n', encoding='utf-8')
    (SERVER / 'allowlist.json').write_text('[]', encoding='utf-8')
    log = ROOT / 'logs/reverse-engine.log'
    with log.open('wb') as output:
        process = subprocess.Popen([str(SERVER / 'bedrock_server.exe')], cwd=SERVER, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            deadline = time.monotonic() + 45
            while b'Server started.' not in log.read_bytes():
                if process.poll() is not None or time.monotonic() > deadline: raise RuntimeError('BDS startup failed; see logs/reverse-engine.log')
                time.sleep(.1)
            time.sleep(2)
            process.stdin.write(b'stop\n'); process.stdin.flush(); process.wait(timeout=20)
        finally:
            if process.poll() is None:
                process.stdin.write(b'stop\n'); process.stdin.flush()
                try: process.wait(timeout=15)
                except subprocess.TimeoutExpired: process.kill(); process.wait()
    tables = list((world / 'db').glob('*.ldb')) + list((world / 'db').glob('*.sst'))
    assert tables, 'Official engine did not produce a compacted table'
    target = ROOT / 'tests/output/reverse/engine-compacted.mcworld'
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for file in world.rglob('*'):
            if file.is_file() and file.name != 'LOCK': archive.write(file, file.relative_to(world).as_posix())
    print('PASS: official BDS 1.26.30.5 recovered synthetic map records into', len(tables), 'actual SST table(s).')

if __name__ == '__main__': main()
