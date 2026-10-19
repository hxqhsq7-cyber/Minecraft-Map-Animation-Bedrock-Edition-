"""Build and verify a release APK with the official Android SDK on Windows/Linux."""
from pathlib import Path
import hashlib
import json
import locale
import os
import re
import secrets
import shutil
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
APP = ROOT / 'app/src/main'
SDK = Path(os.environ.get('ANDROID_HOME', ROOT.parent / '.toolchain/android-sdk'))
TOOLS = SDK / 'build-tools/35.0.0'
ANDROID = SDK / 'platforms/android-35/android.jar'
JAVA = Path(os.environ['JAVA_HOME']) / 'bin' if 'JAVA_HOME' in os.environ else None
OUT = Path(os.environ.get('MAPCINEMA_OUTPUT', ROOT.parent / 'release/android'))
PRIVATE = Path(os.environ.get('MAPCINEMA_SIGNING_DIR', ROOT / 'private')).resolve()
EXE = '.exe' if os.name == 'nt' else ''


def main():
    from sync_assets import sync
    sync()
    aapt = TOOLS / ('aapt2' + EXE)
    align = TOOLS / ('zipalign' + EXE)
    java = JAVA / ('java' + EXE) if JAVA else 'java'
    keytool = JAVA / ('keytool' + EXE) if JAVA else 'keytool'
    apksigner = TOOLS / 'lib/apksigner.jar'
    lambda_stubs = TOOLS / 'core-lambda-stubs.jar'
    for path in [aapt, align, ANDROID, lambda_stubs, TOOLS / 'lib/d8.jar', apksigner]:
        if not path.is_file():
            raise SystemExit(f'Missing official SDK dependency: {path}; run tools/fetch_toolchain.py.')
    if BUILD.exists():
        if BUILD.resolve() != ROOT / 'build':
            raise SystemExit('Refusing to clean a redirected build directory.')
        shutil.rmtree(BUILD)
    for path in [BUILD, BUILD / 'generated', BUILD / 'classes', BUILD / 'dex', OUT]:
        path.mkdir(parents=True, exist_ok=True)
    log = (BUILD / 'build.log').open('w', encoding='utf-8')

    def run(args):
        args = [str(arg) for arg in args]
        print('RUN:', subprocess.list2cmdline(args), flush=True)
        result = subprocess.run(args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        try:
            output = result.stdout.decode('utf-8')
        except UnicodeDecodeError:
            output = result.stdout.decode(locale.getencoding(), errors='replace')
        log.write(subprocess.list2cmdline(args) + '\n' + output + '\n')
        log.flush()
        print(output, end='', flush=True)
        result.check_returncode()
        return output

    run([aapt, 'compile', '--dir', APP / 'res', '-o', BUILD / 'compiled-res.zip'])
    run([aapt, 'link', '-o', BUILD / 'resources.apk', '-I', ANDROID,
         '--manifest', APP / 'AndroidManifest.xml', '-R', BUILD / 'compiled-res.zip',
         '--java', BUILD / 'generated', '--min-sdk-version', '26',
         '--target-sdk-version', '35', '--auto-add-overlay'])
    sources = sorted((APP / 'java').rglob('*.java')) + sorted((BUILD / 'generated').rglob('*.java'))
    run([java, '-m', 'jdk.compiler/com.sun.tools.javac.Main', '-encoding', 'UTF-8',
         '-source', '8', '-target', '8', '-bootclasspath', str(ANDROID) + os.pathsep + str(lambda_stubs),
         '-d', BUILD / 'classes', *sources])
    with zipfile.ZipFile(BUILD / 'classes.jar', 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted((BUILD / 'classes').rglob('*.class')):
            archive.write(path, path.relative_to(BUILD / 'classes').as_posix())
    run([java, '-Xmx768m', '-cp', TOOLS / 'lib/d8.jar', 'com.android.tools.r8.D8',
         '--release', '--min-api', '26', '--lib', ANDROID,
         '--output', BUILD / 'dex', BUILD / 'classes.jar'])
    unsigned = BUILD / 'unsigned.apk'
    with zipfile.ZipFile(unsigned, 'w') as archive, zipfile.ZipFile(BUILD / 'resources.apk') as resources:
        for entry in resources.infolist():
            archive.writestr(entry.filename, resources.read(entry),
                             compress_type=zipfile.ZIP_STORED if entry.filename == 'resources.arsc' else zipfile.ZIP_DEFLATED)
        for path in sorted((BUILD / 'dex').glob('*.dex')):
            archive.write(path, path.name, compress_type=zipfile.ZIP_STORED)
        for path in sorted((APP / 'assets').rglob('*')):
            if path.is_file():
                archive.write(path, 'assets/' + path.relative_to(APP / 'assets').as_posix(), compress_type=zipfile.ZIP_DEFLATED)
    aligned = BUILD / 'aligned.apk'
    run([align, '-f', '-v', '4', unsigned, aligned])

    PRIVATE.mkdir(mode=0o700, exist_ok=True)
    if os.name == 'nt':
        sid = run(['whoami', '/user', '/fo', 'csv', '/nh']).strip().split(',')[-1].strip('"')
        run(['icacls', PRIVATE, '/inheritance:r', '/grant:r', f'*{sid}:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'])
    key = PRIVATE / 'mapcinema-release.p12'
    password = PRIVATE / 'keystore-password.txt'
    if key.exists() != password.exists():
        raise SystemExit('Signing key/password pair is incomplete; restore the original pair before building.')
    if not key.exists():
        password.write_text(secrets.token_urlsafe(32) + '\n', encoding='ascii')
        password.chmod(0o600)
        run([keytool, '-genkeypair', '-alias', 'mapcinema', '-keyalg', 'RSA', '-keysize', '3072',
             '-validity', '10000', '-dname', 'CN=MapCinema Offline,O=MapCinema', '-storetype', 'PKCS12',
             '-keystore', key, '-storepass:file', password, '-keypass:file', password])
        key.chmod(0o600)
    release = OUT / 'MapCinema-Android-v19.apk'
    run([java, '-jar', apksigner, 'sign', '--ks', key, '--ks-key-alias', 'mapcinema',
         '--ks-pass', 'file:' + str(password),
         '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
         '--v3-signing-enabled', 'true', '--v4-signing-enabled', 'false', '--out', release, aligned])
    signature = run([java, '-jar', apksigner, 'verify', '--verbose', '--print-certs', '--min-sdk-version', '26', release])
    certificate = re.search(r'Signer #1 certificate SHA-256 digest: ([a-f0-9]+)', signature).group(1)
    expected_certificate = os.environ.get('MAPCINEMA_EXPECTED_CERT_SHA256')
    if expected_certificate and certificate != expected_certificate.lower():
        raise RuntimeError('Signing certificate differs from the expected update certificate.')
    (OUT / 'signature-verification.txt').write_text(signature, encoding='utf-8')
    # Force a legacy verifier to check v1 too; this does not change minSdk 26.
    legacy = run([java, '-jar', apksigner, 'verify', '--verbose', '--print-certs',
                  '--min-sdk-version', '23', '--max-sdk-version', '23', release])
    (OUT / 'v1-signature-verification.txt').write_text(legacy, encoding='utf-8')
    alignment = run([align, '-c', '-v', '4', release])
    (OUT / 'alignment-verification.txt').write_text(alignment, encoding='utf-8')
    badging = run([aapt, 'dump', 'badging', release])
    (OUT / 'apk-badging.txt').write_text(badging, encoding='utf-8')
    assets = []
    with zipfile.ZipFile(release) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('APK ZIP CRC check failed')
        for name in ['AndroidManifest.xml', 'resources.arsc', 'classes.dex']:
            archive.getinfo(name)
        for name in ['resources.arsc', 'classes.dex']:
            entry = archive.getinfo(name)
            with release.open('rb') as stream:
                stream.seek(entry.header_offset)
                n, x = struct.unpack_from('<HH', stream.read(30), 26)
            if entry.compress_type != zipfile.ZIP_STORED or (entry.header_offset + 30 + n + x) % 4:
                raise RuntimeError(name + ' must be stored and 4-byte aligned')
        for path in sorted((APP / 'assets').rglob('*')):
            if not path.is_file():
                continue
            name = 'assets/' + path.relative_to(APP / 'assets').as_posix()
            if archive.read(name) != path.read_bytes():
                raise RuntimeError('APK asset differs from source: ' + name)
            assets.append(name)
    sha = hashlib.sha256(release.read_bytes()).hexdigest()
    (OUT / 'MapCinema-Android-v19.sha256.txt').write_text(sha + '  ' + release.name + '\n', encoding='utf-8')
    (OUT / 'package-verification.json').write_text(json.dumps({
        'apk': release.name, 'bytes': release.stat().st_size, 'sha256': sha,
        'package': 'dev.mapcinema.offline', 'version_code': 5, 'version_name': '19',
        'min_sdk': 26, 'target_sdk': 35, 'signing_certificate_sha256': certificate,
        'zip_crc_ok': True, 'stored_resources_and_dex_aligned': True,
        'assets_identical_to_source': assets, 'device_runtime_tested': False,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    log.close()
    print('Built and verified signed APK:', release, 'SHA256=', sha, flush=True)


if __name__ == '__main__':
    main()
