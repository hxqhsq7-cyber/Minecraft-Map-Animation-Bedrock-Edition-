$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'temp') | Out-Null
$env:TEMP = Join-Path $PSScriptRoot 'temp'
$env:TMP = $env:TEMP
$env:PYTHONPYCACHEPREFIX = Join-Path $PSScriptRoot 'temp\python-cache'
& python -X utf8 "$PSScriptRoot\tools\build.py"
if ($LASTEXITCODE -ne 0) { throw "Windows package failed: $LASTEXITCODE" }
