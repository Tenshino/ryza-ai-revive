# Build the Windows desktop package (Electron, frameless window).
# Run from the project root:  powershell -File scripts/build_desktop.ps1
#
# Downloads go through npmmirror by default (set RYZA_DIRECT=1 to use the
# upstream URLs). Output: output\desktop\RyzaChat-Setup-<ver>.exe
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $Root "desktop")

if (-not $env:RYZA_DIRECT) {
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
}

if (-not (Test-Path "node_modules\electron\dist\electron.exe")) {
  npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
  node node_modules\electron\install.js
} else {
  "electron already present"
}

npx electron-builder --win --x64
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }

Get-ChildItem "..\output\desktop\*.exe" | ForEach-Object { "Built: $($_.FullName)" }
