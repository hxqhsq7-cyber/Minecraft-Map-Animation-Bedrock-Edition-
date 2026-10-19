"""Check the generated runtime with actual BDS blocks and simulated viewer positions.

Requires the already installed official BDS; keeps its files/worlds unchanged.
"""
from pathlib import Path
import json
import os
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'Fangying_Diagnostics/server-1.26.30.5'
SERVER = ROOT / '.toolchain/prefetch-engine'
LOG = ROOT / 'logs/prefetch-engine.log'

def main():
    SERVER.mkdir(parents=True, exist_ok=True)
    # Hard-link only immutable official engine/assets; settings and test worlds are independent.
    for name in ['bedrock_server.exe', 'behavior_packs', 'resource_packs', 'definitions', 'data', 'config', 'profanity_filter.wlist']:
        src, dst = SOURCE / name, SERVER / name
        if dst.exists():
            continue
        if src.is_dir():
            shutil.copytree(src, dst, copy_function=os.link)
        else:
            os.link(src, dst)
    (SERVER / 'server.properties').write_text('server-name=MapCinema isolated engine test\nlevel-name=PrefetchTest\nlevel-type=FLAT\nlevel-seed=1\ngamemode=creative\nallow-cheats=true\nonline-mode=true\nallow-list=true\nserver-port=29145\nserver-portv6=29146\nenable-lan-visibility=false\ncontent-log-file-enabled=true\ncontent-log-console-output-enabled=true\n', encoding='utf-8')
    (SERVER / 'allowlist.json').write_text('[]', encoding='utf-8')
    test_world = SERVER / 'worlds/PrefetchTest'
    if test_world.exists():
        assert test_world.resolve().is_relative_to((ROOT / '.toolchain/prefetch-engine/worlds').resolve())
        assert test_world.resolve().name == 'PrefetchTest'
        shutil.rmtree(test_world)
    fixture = ROOT / 'tests/output/prefetch-fixture/behavior_packs/mv_prefetch_test'
    target = SERVER / 'worlds/PrefetchTest/behavior_packs/mv_prefetch_test'
    shutil.copytree(fixture, target, dirs_exist_ok=True)
    manifest = json.loads((target / 'manifest.json').read_bytes())
    next(m for m in manifest['modules'] if m['type'] == 'script')['entry'] = 'scripts/test.js'
    (target / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    (target.parent.parent / 'world_behavior_packs.json').write_text(json.dumps([{'pack_id': manifest['header']['uuid'], 'version': manifest['header']['version']}]), encoding='utf-8')
    script = (target / 'scripts/prefetch.js').read_text(encoding='utf-8')
    before, tail = script.rsplit(')(', 1)
    config = json.loads(tail.removesuffix(', world, system);\n'))
    runtime = before.split('\n(', 1)[1]
    test = 'import { world, system } from "@minecraft/server";\nconst prefetchRuntime = ' + runtime + ';\nconst config = ' + json.dumps(config) + ';\nsystem.run(() => {\n' + (ROOT / 'tests/prefetch-engine.js').read_text(encoding='utf-8') + '\n});\n'
    (target / 'scripts/test.js').write_text(test, encoding='utf-8')
    with LOG.open('wb') as output:
        child = subprocess.Popen([str(SERVER / 'bedrock_server.exe')], cwd=SERVER, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            deadline = time.monotonic() + 50
            while b'Server started.' not in LOG.read_bytes():
                if child.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError('Server startup failed; see ' + str(LOG))
                time.sleep(.1)
            child.stdin.write(b'tickingarea add -16 64 -16 47 64 31 prefetch_test true\ngamerule commandblocksenabled true\ngamerule commandblockoutput false\n')
            child.stdin.flush()
            deadline = time.monotonic() + 40
            while b'[PrefetchDONE]' not in LOG.read_bytes():
                if child.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError('Engine checks did not complete; see ' + str(LOG))
                time.sleep(.2)
            child.stdin.write(b'stop\n'); child.stdin.flush(); child.wait(timeout=20)
        finally:
            if child.poll() is None:
                child.stdin.write(b'stop\n'); child.stdin.flush()
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait()
    text = LOG.read_text(encoding='utf-8', errors='replace')
    errors = [line for line in text.splitlines() if any(s in line for s in ['[PrefetchFAIL]', '[Scripting][error]', 'failed to load correctly', 'Function mv_prefetch_test/tick not found'])]
    assert not errors, errors
    assert text.count('[PrefetchPASS]') == 15, text
    print('PASS: BDS 1.26.30.5, fifteen actual-engine assertions; simulated viewers, no client rendering test.')
    (ROOT / 'logs/prefetch-engine-results.json').write_text(json.dumps({'engine': '1.26.30.5', 'assertions': 15, 'maxFrames': 200, 'fivePerRowAndFortyRows': True, 'batchedConstructionAndCleanup': True, 'realBlocksAndStructureAPI': True, 'commandBlockSourceEvent': True, 'sharedViewerChunkCleanup': True, 'noDroppedItems': True, 'repeatPlayback': True, 'clientRenderingTested': False}, indent=2), encoding='utf-8')

if __name__ == '__main__':
    main()
