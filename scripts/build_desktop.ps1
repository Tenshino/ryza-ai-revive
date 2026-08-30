# Build a Windows onedir exe with pywebview.
# Run from the project root:  powershell -File scripts/build_desktop.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

python -m pip install -r desktop/requirements.txt
$Dist = Join-Path $Root "output\desktop"
$Work = Join-Path $Root "output\pyinstaller-work"
New-Item -ItemType Directory -Force -Path $Dist | Out-Null

$sep = ";"
python -m PyInstaller --noconfirm --clean --onedir --windowed `
  --name RyzaChat `
  --distpath $Dist `
  --workpath $Work `
  --specpath $Work `
  --add-data "web$sep`web" `
  desktop/app.py

Write-Host "Built: $Dist\RyzaChat\RyzaChat.exe"
