$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to a JDK 21 directory in your workspace.' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $repository '.toolchain\android-sdk' }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_USER_HOME = Join-Path $repository '.toolchain\android-user-home'
$env:ANDROID_PREFS_ROOT = $env:ANDROID_USER_HOME
$env:TEMP = Join-Path $repository 'temp\android'
$env:TMP = $env:TEMP
$env:PYTHONUTF8 = '1'
$env:PYTHONPYCACHEPREFIX = Join-Path $repository 'temp\android-python-cache'
$env:MAPCINEMA_OUTPUT = Join-Path $repository 'release\android'
foreach ($directory in @($env:TEMP, $env:ANDROID_USER_HOME, (Join-Path $repository '.toolchain\android-java-home'))) {
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
}
$env:JAVA_TOOL_OPTIONS = '-Djava.io.tmpdir="' + $env:TEMP + '" -Duser.home="' + (Join-Path $repository '.toolchain\android-java-home') + '" -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -Duser.language=en -Duser.country=US'
& python -X utf8 "$PSScriptRoot\tools\build.py"
if ($LASTEXITCODE -ne 0) { throw "Android APK build failed: $LASTEXITCODE" }
