param(
  [ValidateSet('windows', 'android', 'all')]
  [string]$Platform = 'windows'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Crate = Join-Path $Root 'native/ryza-tts'
$Tools = if ($env:RYZA_ANDROID_TOOLS) { $env:RYZA_ANDROID_TOOLS } else { Join-Path $Root '.android-tools' }
$CargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $Root '.rust-tools/cargo' }
$RustupHome = if ($env:RUSTUP_HOME) { $env:RUSTUP_HOME } else { Join-Path $Root '.rust-tools/rustup' }
$Cargo = Join-Path $CargoHome 'bin/cargo.exe'
$Rustup = Join-Path $CargoHome 'bin/rustup.exe'
if (-not (Test-Path $Cargo)) {
  $found = Get-Command cargo -ErrorAction SilentlyContinue
  if ($found) { $Cargo = $found.Source }
}
if (-not (Test-Path $Rustup)) {
  $found = Get-Command rustup -ErrorAction SilentlyContinue
  if ($found) { $Rustup = $found.Source }
}
if (-not (Test-Path $Cargo)) {
  throw 'Rust is missing. Run scripts/setup_rust_tools.ps1 first.'
}

$env:CARGO_HOME = $CargoHome
$env:RUSTUP_HOME = $RustupHome
$env:CARGO_NET_GIT_FETCH_WITH_CLI = 'true'
$env:Path = "$(Split-Path $Cargo -Parent);$env:Path"

function Copy-FirstMatch([string]$Pattern, [string]$Destination, [bool]$Required = $true) {
  $hit = Get-ChildItem (Join-Path $Crate 'target') -Recurse -File -Filter $Pattern -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $hit) {
    if ($Required) { throw "native dependency not found after build: $Pattern" }
    return
  }
  Copy-Item -Force $hit.FullName $Destination
}

function Import-VcVars {
  if (Get-Command cl.exe -ErrorAction SilentlyContinue) { return }
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
  if (-not (Test-Path $vswhere)) { throw 'Visual Studio C++ Build Tools are missing' }
  $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  $script:VcInstall = $install
  $vcvars = Join-Path $install 'VC/Auxiliary/Build/vcvars64.bat'
  if (-not (Test-Path $vcvars)) { throw 'vcvars64.bat was not found' }
  $commandLine = "`"$vcvars`" >nul && set"
  & $env:ComSpec /d /s /c $commandLine | ForEach-Object {
    $parts = $_ -split '=', 2
    if ($parts.Count -eq 2) { Set-Item -Path "env:$($parts[0])" -Value $parts[1] }
  }
}

if ($Platform -eq 'windows' -or $Platform -eq 'all') {
  Import-VcVars
  '== build native TTS for Windows x64 =='
  & $Cargo build --manifest-path (Join-Path $Crate 'Cargo.toml') --locked --release --features sidecar --bin ryza-tts
  if ($LASTEXITCODE) { throw 'native TTS Windows build failed' }
  $Dist = Join-Path $Crate 'dist/windows'
  Remove-Item -Recurse -Force $Dist -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $Dist | Out-Null
  Copy-Item -Force (Join-Path $Crate 'target/release/ryza-tts.exe') $Dist
  # ort links ONNX Runtime statically; DirectML remains a dynamic dependency.
  Copy-FirstMatch 'DirectML.dll' $Dist
  Copy-FirstMatch 'DirectML.Debug.dll' $Dist $false
  $VcCrt = Get-ChildItem (Join-Path $VcInstall 'VC/Redist/MSVC') -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'x64/Microsoft.VC143.CRT' } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $VcCrt) { throw 'Visual C++ x64 redistributable runtime was not found' }
  Copy-Item -Force (Join-Path $VcCrt '*.dll') $Dist
  Copy-Item -Force (Join-Path $Root 'THIRD_PARTY_NOTICES.md') $Dist
  Copy-Item -Recurse -Force (Join-Path $Crate 'licenses') (Join-Path $Dist 'licenses')
  "Staged: $Dist"
}

if ($Platform -eq 'android' -or $Platform -eq 'all') {
  if (-not (Test-Path $Rustup)) { throw 'rustup is required to install the Android Rust target' }
  $Sdk = Join-Path $Tools 'android-sdk'
  $NdkRoot = Join-Path $Sdk 'ndk'
  $Ndk = Get-ChildItem $NdkRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
  if (-not $Ndk) { throw 'Android NDK is missing. Run scripts/setup_android_tools.ps1.' }
  & $Rustup target add aarch64-linux-android
  if ($LASTEXITCODE) { throw 'could not install aarch64-linux-android Rust target' }
  $Toolchain = Join-Path $Ndk.FullName 'toolchains/llvm/prebuilt/windows-x86_64'
  $Clang = Join-Path $Toolchain 'bin/aarch64-linux-android24-clang.cmd'
  $Clangxx = Join-Path $Toolchain 'bin/aarch64-linux-android24-clang++.cmd'
  $Ar = Join-Path $Toolchain 'bin/llvm-ar.exe'
  foreach ($file in @($Clang, $Clangxx, $Ar)) {
    if (-not (Test-Path $file)) { throw "missing NDK tool: $file" }
  }
  $env:ANDROID_NDK_HOME = $Ndk.FullName
  $env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = $Clang
  $env:CC_aarch64_linux_android = $Clang
  $env:CXX_aarch64_linux_android = $Clangxx
  $env:AR_aarch64_linux_android = $Ar
  '== build native TTS for Android arm64-v8a =='
  & $Cargo build --manifest-path (Join-Path $Crate 'Cargo.toml') --locked --release `
    --target aarch64-linux-android --no-default-features --features android-jni --lib
  if ($LASTEXITCODE) { throw 'native TTS Android build failed' }
  $Jni = Join-Path $Root 'android/app/src/main/jniLibs/arm64-v8a'
  New-Item -ItemType Directory -Force $Jni | Out-Null
  Copy-Item -Force (Join-Path $Crate 'target/aarch64-linux-android/release/libryza_tts.so') $Jni
  # ort's Android distribution is also static and is linked into libryza_tts.so.
  $LibCpp = Join-Path $Toolchain 'sysroot/usr/lib/aarch64-linux-android/libc++_shared.so'
  if (Test-Path $LibCpp) { Copy-Item -Force $LibCpp $Jni }
  "Staged: $Jni"
}
