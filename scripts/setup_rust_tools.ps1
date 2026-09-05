$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ToolHome = Join-Path $Root '.rust-tools'
$CargoHome = Join-Path $ToolHome 'cargo'
$RustupHome = Join-Path $ToolHome 'rustup'
$Installer = Join-Path $ToolHome 'rustup-init.exe'
New-Item -ItemType Directory -Force $ToolHome | Out-Null
if (-not (Test-Path $Installer)) {
  Invoke-WebRequest 'https://win.rustup.rs/x86_64' -OutFile $Installer
}
$env:CARGO_HOME = $CargoHome
$env:RUSTUP_HOME = $RustupHome
& $Installer -y --no-modify-path --profile minimal --default-toolchain stable
if ($LASTEXITCODE) { throw 'rustup installation failed' }
& (Join-Path $CargoHome 'bin/rustc.exe') --version
& (Join-Path $CargoHome 'bin/cargo.exe') --version
"Portable Rust installed under $ToolHome"
