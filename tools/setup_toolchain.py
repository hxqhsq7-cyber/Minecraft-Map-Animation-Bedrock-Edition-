"""Download and verify official build tools inside this project only."""
from pathlib import Path
import hashlib
import json
import shutil
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.toolchain'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def prepare():
    lock = json.loads((ROOT / 'tools/toolchain-lock.json').read_bytes())
    for name, info in lock.items():
        target = CACHE / 'downloads' / info['url'].rsplit('/', 1)[1]
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or digest(target) != info['sha256']:
            temporary = target.with_suffix(target.suffix + '.partial')
            print('Downloading official', name, info['version'], flush=True)
            request = urllib.request.Request(info['url'], headers={'User-Agent': 'MapCinema-Build'})
            with urllib.request.urlopen(request, timeout=120) as source, temporary.open('wb') as output:
                shutil.copyfileobj(source, output, 1024 * 1024)
            if digest(temporary) != info['sha256']:
                raise RuntimeError('Official tool checksum mismatch: ' + name)
            temporary.replace(target)
        if name == 'rcedit':
            exe = CACHE / 'tools/rcedit-x64.exe'
            exe.parent.mkdir(parents=True, exist_ok=True)
            if not exe.exists() or digest(exe) != info['exe_sha256']:
                with tarfile.open(target) as archive, exe.open('wb') as output:
                    source = archive.extractfile('package/bin/rcedit-x64.exe')
                    if source is None:
                        raise RuntimeError('rcedit executable missing from official archive')
                    with source:
                        shutil.copyfileobj(source, output)
            if digest(exe) != info['exe_sha256']:
                raise RuntimeError('rcedit executable checksum mismatch')
    print('Official toolchain checksums verified; cache:', CACHE, flush=True)


if __name__ == '__main__':
    prepare()
