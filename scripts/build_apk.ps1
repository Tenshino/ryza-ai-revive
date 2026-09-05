# Build the Android APK without Gradle: aapt2 -> javac -> d8 -> zipalign ->
# apksigner. Needs the portable toolchain from scripts/setup_android_tools.ps1
# (JDK 17 + android-34 platform + build-tools 34 via setup_android_tools.ps1).
#
# Output: output/android/RyzaChat-<version>.apk  (self-signed; installs via
# adb / sideload and uninstalls like any other app — see the notes at the end)
#
# Version comes from config/version.json (same file the desktop script reads).
# Privacy gates: on the web tree before it is packed, and on the signed APK.
param([switch]$SkipNativeBuild)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
# aapt2 on Windows cannot open non-ASCII absolute input paths. Keep repository
# inputs relative to a stable root working directory.
Set-Location $Root
$localTools = Join-Path $Root "config/android-tools.local.txt"
if ($env:RYZA_ANDROID_TOOLS) { $Tools = $env:RYZA_ANDROID_TOOLS }
elseif (Test-Path $localTools) { $Tools = (Get-Content $localTools -Raw).Trim() }
else { $Tools = Join-Path $Root ".android-tools" }
$Jdk = Join-Path $Tools "jdk17"
$Sdk = Join-Path $Tools "android-sdk"
$BT = Join-Path $Sdk "build-tools/34.0.0"
$AJ = Join-Path $Sdk "platforms/android-34/android.jar"

foreach ($p in @((Join-Path $Jdk "bin/javac.exe"), (Join-Path $BT "aapt2.exe"), $AJ)) {
  if (-not (Test-Path $p)) { throw "missing $p — run scripts/setup_android_tools.ps1 first" }
}

$env:JAVA_HOME = $Jdk
$env:Path = "$Jdk/bin;$env:Path"

$And = Join-Path $Root "android"
$Web = Join-Path $Root "web"
$Work = Join-Path $Root "output/apk-work"
$Out = Join-Path $Root "output/android"

"== version from config/version.json =="
$VerJson = Get-Content (Join-Path $Root "config/version.json") -Raw | ConvertFrom-Json
$Ver = $VerJson.version; $VC = $VerJson.code
node (Join-Path $PSScriptRoot "stamp_version.js") $Ver $VC
if ($LASTEXITCODE) { throw "could not stamp the version into the shell manifests" }
"Building RyzaChat-$Ver.apk (versionCode $VC)"

if (-not $SkipNativeBuild) {
  "== embedded Style-Bert-VITS2 runtime =="
  & (Join-Path $PSScriptRoot "build_native_tts.ps1") -Platform android
  if ($LASTEXITCODE) { throw "native TTS Android build failed" }
} else {
  "== reuse staged embedded TTS runtime =="
  $RequiredNative = @("libryza_tts.so", "libc++_shared.so")
  foreach ($name in $RequiredNative) {
    if (-not (Test-Path (Join-Path $Root "android/app/src/main/jniLibs/arm64-v8a/$name"))) {
      throw "missing staged native library: $name"
    }
  }
}

"== privacy gate on the tree that is about to be packed =="
python (Join-Path $PSScriptRoot "privacy_check.py") $Web `
  (Join-Path $And "app/src/main") (Join-Path $Root "native/ryza-tts/src") `
  (Join-Path $Root "THIRD_PARTY_NOTICES.md")
if ($LASTEXITCODE) { throw "privacy check refused the build - nothing was packaged" }

Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Work, $Out | Out-Null
# aapt2 also fails to stat android.jar through a non-ASCII absolute path.
Copy-Item -Force $AJ "output/apk-work/android.jar"

"== compile resources =="
& (Join-Path $BT "aapt2.exe") compile --dir "android/app/src/main/res" -o "output/apk-work/res.zip"
if ($LASTEXITCODE) { throw "aapt2 compile failed" }

"== link base apk (manifest + resources) =="
# NB: no `-A $Web` here — aapt2 on Windows writes backslash entry names
# (assets\js\...) which AssetManager cannot open; assets are packed with
# scripts/pack_apk_assets.py (forward slashes) after the dex is added.
& (Join-Path $BT "aapt2.exe") link `
  -o "output/apk-work/base.apk" `
  --manifest "android/app/src/main/AndroidManifest.xml" `
  -I "output/apk-work/android.jar" `
  "output/apk-work/res.zip" `
  --auto-add-overlay `
  --min-sdk-version 24 --target-sdk-version 34 `
  --version-code $VC --version-name $Ver
if ($LASTEXITCODE) { throw "aapt2 link failed" }

"== javac =="
$Cls = Join-Path $Work "classes"
New-Item -ItemType Directory -Force $Cls | Out-Null
$srcs = Get-ChildItem (Join-Path $And "app/src/main/java") -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& (Join-Path $Jdk "bin/javac.exe") -nowarn -encoding UTF-8 --release 11 -classpath $AJ -d $Cls @srcs
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

"== pack native TTS libraries =="
python (Join-Path $PSScriptRoot "pack_apk_native.py") (Join-Path $Work "base.apk") `
  (Join-Path $And "app/src/main/jniLibs") (Join-Path $Root "THIRD_PARTY_NOTICES.md")
if ($LASTEXITCODE) { throw "native library packing failed" }

"== zipalign =="
& (Join-Path $BT "zipalign.exe") -p -f 4 (Join-Path $Work "base.apk") (Join-Path $Work "aligned.apk")
if ($LASTEXITCODE) { throw "zipalign failed" }

"== sign =="
# Self-signed for sideloading. Signing identity and credentials are local-only;
# the SAME key must be reused or Android refuses in-place upgrades.
$KsDir = Join-Path $And "keystore"
$SigningFile = Join-Path $KsDir "signing.local.json"
New-Item -ItemType Directory -Force $KsDir | Out-Null
if (-not (Test-Path $SigningFile)) {
  $LegacyKey = Join-Path $KsDir "ryza.keystore"
  if (Test-Path $LegacyKey) {
    throw "existing keystore has no signing.local.json; add its alias and passwords without committing that file"
  }
  $Secret = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
  @{ keystore = "ryza.keystore"; alias = "ryza"; storePass = $Secret; keyPass = $Secret } |
    ConvertTo-Json | Set-Content $SigningFile -Encoding UTF8
}
$Signing = Get-Content $SigningFile -Raw | ConvertFrom-Json
foreach ($field in @("keystore", "alias", "storePass", "keyPass")) {
  if (-not $Signing.$field) { throw "missing '$field' in $SigningFile" }
}
$Ks = if ([System.IO.Path]::IsPathRooted($Signing.keystore)) { $Signing.keystore } else { Join-Path $KsDir $Signing.keystore }
if (-not (Test-Path $Ks)) {
  & (Join-Path $Jdk "bin/keytool.exe") -genkeypair -v -keystore $Ks -alias $Signing.alias `
    -keyalg RSA -keysize 2048 -validity 10000 `
    -dname "CN=Ryza Chat, OU=offline rebuild" -storepass $Signing.storePass -keypass $Signing.keyPass | Out-Null
  if ($LASTEXITCODE) { throw "keytool failed" }
}
$Apk = Join-Path $Out "RyzaChat-$Ver.apk"
& (Join-Path $BT "apksigner.bat") sign --ks $Ks --ks-key-alias $Signing.alias `
  --ks-pass "pass:$($Signing.storePass)" --key-pass "pass:$($Signing.keyPass)" `
  --out $Apk (Join-Path $Work "aligned.apk")
if ($LASTEXITCODE) { throw "apksigner failed" }

"== verify =="
& (Join-Path $BT "apksigner.bat") verify $Apk
if ($LASTEXITCODE) { throw "verify failed" }

"== privacy gate on the signed APK (member names + text members) =="
python (Join-Path $PSScriptRoot "privacy_check.py") --quiet $Apk
if ($LASTEXITCODE) { throw "PRIVACY: the signed APK contains developer-identifying data - do not distribute it" }

# Install/uninstall contract (AndroidManifest.xml):
#   * normal <activity> with MAIN/LAUNCHER → appears in the launcher, uninstalls
#     from Settings ▸ Apps like any other package; no device-owner tricks.
#   * android:hasFragileUserData="true" → the system ASKS whether to keep the
#     app's data on uninstall, so a reinstall can restore saves.
#   * data lives in the app's private dir; nothing is written outside it.
$mb = [math]::Round((Get-Item $Apk).Length / 1MB, 1)
"Built: $Apk  ($mb MB)"
