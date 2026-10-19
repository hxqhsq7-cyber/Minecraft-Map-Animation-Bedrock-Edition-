"""Verify the portable release and generated small test exports."""
from pathlib import Path
import hashlib
import io
import json
import wave
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    manifest = json.loads((ROOT / 'release/build-manifest.json').read_bytes())
    package = ROOT / 'release' / manifest['package']
    assert digest(package) == manifest['package_sha256']
    folder = '方映-电脑版-v17/'
    with zipfile.ZipFile(package) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == {folder + name for name in manifest['files']}
        for name, sha in manifest['files'].items():
            assert digest(ROOT / 'release' / folder / name) == sha, name
            assert hashlib.sha256(archive.read(folder + name)).hexdigest() == sha, name
        assert not any('/Data/' in n or '/tests/' in n for n in archive.namelist())
    assert digest(ROOT / 'app/MapCinema.html') == manifest['html_sha256']
    smoke = json.loads((ROOT / 'logs/smoke-results.json').read_bytes())
    assert smoke['uiConversionPassed'] and smoke['worldOnlyUI']['realFormSubmit']
    assert smoke['multiAnchorUI']['copyableSpawnAndOrientationCards']
    assert smoke['multiAnchorUI']['worldOnlyUpgradeWithoutVideoPackage']
    files = ['smoke-memory.mcvideo', 'smoke-disk.mcvideo', 'smoke-world.mcworld',
             'world-only-memory.mcworld', 'world-only-disk.mcworld',
             'smoke-multi-anchor.mcvideo', 'smoke-multi-anchor.mcworld']
    for name in files:
        with zipfile.ZipFile(Path(smoke['downloadDirectory']) / name) as archive:
            assert archive.testzip() is None, name
            for entry in archive.namelist():
                if entry.endswith('.mcfunction'):
                    text = archive.read(entry).decode('utf-8')
                    assert 'if score #' not in text, entry
                if entry.endswith('.wav'):
                    with wave.open(io.BytesIO(archive.read(entry))) as audio:
                        assert audio.getframerate() == 24000 and audio.getnframes() > 0
    print('PASS: release ZIP, all file hashes, source identity, real EXE exports and audio.')
    print('Release SHA256:', manifest['package_sha256'])


if __name__ == '__main__':
    main()
