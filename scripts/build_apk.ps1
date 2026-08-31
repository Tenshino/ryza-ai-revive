# Build the Android APK without Gradle: aapt2 -> javac -> d8 -> zipalign ->
# apksigner. Needs the portable toolchain from scripts/setup_android_tools.ps1
# (JDK 17 + android-34 platform + build-tools 34 on D:\agent\tools).
#
# Output: output\android\RyzaChat-<version>.apk  (debug-style self-signed;
# installs via adb / sideload, uninstalls like any app)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Tools = "D:\agent\tools"
$Jdk = Join-Path $Tools "jdk17"
$Sdk = Join-Path $Tools "android-sdk"
$BT = Join-Path $Sdk "build-tools\34.0.0"
$AJ = Join-Path $Sdk "platforms\android-34\android.jar"

foreach ($p in @((Join-Path $Jdk "bin\javac.exe"), (Join-Path $BT "aapt2.exe"), $AJ)) {
  if (-not (Test-Path $p)) { throw "missing $p — run scripts/setup_android_tools.ps1 first" }
}

$env:JAVA_HOME = $Jdk
$env:Path = "$Jdk\bin;$env:Path"

$And = Join-Path $Root "android"
$Web = Join-Path $Root "web"
$Work = Join-Path $Root "output\apk-work"
$Out = Join-Path $Root "output\android"
$Ver = "1.2.4"; $VC = 7

Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Work, $Out | Out-Null

"== compile resources =="
& (Join-Path $BT "aapt2.exe") compile --dir (Join-Path $And "app\src\main\res") -o (Join-Path $Work "res.zip")
if ($LASTEXITCODE) { throw "aapt2 compile failed" }

"== link base apk (manifest + resources) =="
# NB: no `-A $Web` here — aapt2 on Windows writes backslash entry names
# (assets\js\...) which AssetManager cannot open; assets are packed with
# scripts/pack_apk_assets.py (forward slashes) after the dex is added.
& (Join-Path $BT "aapt2.exe") link `
  -o (Join-Path $Work "base.apk") `
  --manifest (Join-Path $And "app\src\main\AndroidManifest.xml") `
  -I $AJ `
  (Join-Path $Work "res.zip") `
  --auto-add-overlay `
  --min-sdk-version 24 --target-sdk-version 34 `
  --version-code $VC --version-name $Ver
if ($LASTEXITCODE) { throw "aapt2 link failed" }

"== javac =="
$Cls = Join-Path $Work "classes"
New-Item -ItemType Directory -Force $Cls | Out-Null
$srcs = Get-ChildItem (Join-Path $And "app\src\main\java") -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& (Join-Path $Jdk "bin\javac.exe") -nowarn -encoding UTF-8 --release 11 -classpath $AJ -d $Cls @srcs
if ($LASTEXITCODE) { throw "javac failed" }

"== d8 =="
& (Join-Path $BT "d8.bat") --release --lib $AJ --output $Work `
  (Get-ChildItem $Cls -Recurse -Filter *.class | ForEach-Object { $_.FullName })
if ($LASTEXITCODE) { throw "d8 failed" }
if (-not (Test-Path (Join-Path $Work "classes.dex"))) { throw "classes.dex missing" }

"== add dex into apk =="
Push-Location $Work
& (Join-Path $BT "aapt.exe") add (Join-Path $Work "base.apk") "classes.dex"
$code = $LASTEXITCODE
Pop-Location
if ($code) { throw "aapt add failed" }

"== pack web assets (forward slashes) =="
python (Join-Path $PSScriptRoot "pack_apk_assets.py") (Join-Path $Work "base.apk") $Web
if ($LASTEXITCODE) { throw "asset packing failed" }

"== zipalign =="
& (Join-Path $BT "zipalign.exe") -f 4 (Join-Path $Work "base.apk") (Join-Path $Work "aligned.apk")
if ($LASTEXITCODE) { throw "zipalign failed" }

"== sign =="
$KsDir = Join-Path $And "keystore"
New-Item -ItemType Directory -Force $KsDir | Out-Null
$Ks = Join-Path $KsDir "ryza.keystore"
if (-not (Test-Path $Ks)) {
  & (Join-Path $Jdk "bin\keytool.exe") -genkeypair -v -keystore $Ks -alias ryza `
    -keyalg RSA -keysize 2048 -validity 10000 `
    -dname "CN=Ryza Chat, OU=offline rebuild" -storepass ryza-chat -keypass ryza-chat | Out-Null
}
$Apk = Join-Path $Out "RyzaChat-$Ver.apk"
& (Join-Path $BT "apksigner.bat") sign --ks $Ks --ks-pass pass:ryza-chat --key-pass pass:ryza-chat --out $Apk (Join-Path $Work "aligned.apk")
if ($LASTEXITCODE) { throw "apksigner failed" }

"== verify =="
& (Join-Path $BT "apksigner.bat") verify $Apk
if ($LASTEXITCODE) { throw "verify failed" }
$mb = [math]::Round((Get-Item $Apk).Length / 1MB, 1)
"Built: $Apk  ($mb MB)"
