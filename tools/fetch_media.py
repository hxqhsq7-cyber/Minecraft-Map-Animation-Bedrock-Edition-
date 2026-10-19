"""Recreate the offline media bundle from pinned, unmodified npm distributions."""
from pathlib import Path
import base64
import hashlib
import io
import json
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def main():
    lock = json.loads((ROOT / 'tools/media-dependencies.json').read_bytes())
    cache = ROOT / '.toolchain/media-packages'
    cache.mkdir(parents=True, exist_ok=True)
    parts = []
    for component in lock['components']:
        target = cache / (component['package'].replace('@', '').replace('/', '-') + '-' + component['version'] + '.tgz')
        if not target.exists():
            with urllib.request.urlopen(component['url'], timeout=60) as response: target.write_bytes(response.read())
        data = target.read_bytes()
        assert 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode() == component['integrity'], 'npm integrity mismatch'
        with tarfile.open(fileobj=io.BytesIO(data)) as archive: bundle = archive.extractfile('package/' + component['file']).read()
        assert hashlib.sha256(bundle).hexdigest() == component['sha256'], 'Media component checksum mismatch'
        parts.append(bundle)
    bundle = b'\n'.join(parts)
    assert hashlib.sha256(bundle).hexdigest() == lock['bundle_sha256'], 'Media bundle checksum mismatch'
    (ROOT / 'app/media-bundle.js').write_bytes(bundle)
    print('Verified pinned offline media bundle; cache:', cache)

if __name__ == '__main__': main()
