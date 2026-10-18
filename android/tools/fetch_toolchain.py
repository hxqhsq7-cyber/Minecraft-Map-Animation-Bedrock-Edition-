"""Install official SDK packages into ANDROID_HOME for the current operating system."""
from pathlib import Path
import os
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SDK = Path(os.environ.get('ANDROID_HOME', ROOT.parent / '.toolchain/android-sdk'))
PACKAGES = ['platforms/android-35', 'build-tools/35.0.0', 'platform-tools']


def main():
    android = SDK / 'cmdline-tools/latest/bin/android.exe'
    if os.name == 'nt' and android.is_file():
        # sdkmanager.bat 23.0 misparses SDK paths containing parentheses.
        command = [str(android), '--no-metrics', '--sdk=' + str(SDK), 'sdk', 'install', *PACKAGES]
    else:
        sdkmanager = SDK / 'cmdline-tools/latest/bin' / ('sdkmanager.bat' if os.name == 'nt' else 'sdkmanager')
        if not sdkmanager.is_file():
            raise SystemExit('Install official Android command-line tools into ' + str(sdkmanager.parent))
        command = [str(sdkmanager), '--sdk_root=' + str(SDK), *[p.replace('/', ';') for p in PACKAGES]]
    subprocess.run(command, check=True)


if __name__ == '__main__':
    main()
