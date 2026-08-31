# Build the Windows desktop package (Electron, frameless window).
# Run from the project root:  powershell -File scripts/build_desktop.ps1
#
# Downloads go through npmmirror by default (set RYZA_DIRECT=1 to use the
# upstream URLs). Output: output/desktop/RyzaChat-Setup-<ver>.exe
#
# The version is NOT written here: config/version.json is the single source of
# truth, stamped into desktop/package.json and android/app/build.gradle by this
# script, so an exe and an APK can never disagree. Two privacy gates run: one
# on the inputs before anything is staged, one on the staged package.
#
# NOTE ON PATHS: forward slashes throughout. PowerShell/Join-Path accept them,
# and it keeps this file free of backslash escapes that a text editor (or a
# scripted patch) can silently turn into control characters.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $Root "desktop")

"== version from config/version.json =="
$VerJson = Get-Content (Join-Path $Root "config/version.json") -Raw | ConvertFrom-Json
$Ver = $VerJson.version
node (Join-Path $PSScriptRoot "stamp_version.js") $Ver $VerJson.code
if ($LASTEXITCODE) { throw "could not stamp the version into the shell manifests" }
"Building RyzaChat-Setup-$Ver.exe (versionCode $($VerJson.code))"

"== privacy gate on everything that will be staged =="
python (Join-Path $PSScriptRoot "privacy_check.py") `
  (Join-Path $Root "web") "main.js" "preload.js" "package.json" `
  (Join-Path $Root "android/app/src")
if ($LASTEXITCODE) { throw "privacy check refused the build - nothing was packaged" }

if (-not $env:RYZA_DIRECT) {
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
}

if (-not (Test-Path "node_modules/electron/dist/electron.exe")) {
  npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
  node node_modules/electron/install.js
} else {
  "electron already present"
}

npx electron-builder --win --x64
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }

# The installer is a compressed NSIS container, so the artifact that can
# actually be inspected is the staged app directory it was built from.
$Unpacked = Join-Path $Root "output/desktop/win-unpacked"
if (Test-Path $Unpacked) {
  "== privacy gate on the staged package =="
  python (Join-Path $PSScriptRoot "privacy_check.py") $Unpacked
  if ($LASTEXITCODE) { throw "PRIVACY: the built package contains developer-identifying data - do not distribute it" }
} else {
  "WARN: $Unpacked not found; skipping the post-build scan"
}

Get-ChildItem (Join-Path $Root "output/desktop/*.exe") | ForEach-Object { "Built: $($_.FullName)" }
