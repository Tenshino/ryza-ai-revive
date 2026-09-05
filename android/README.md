# Android WebView shell (no Flutter, no androidx)

Plain `android.app.Activity` + framework `WebView`. `web/` is bundled as
APK assets; `AssetServer` pre-binds an ephemeral loopback port and serves a
random per-process route prefix before JavaScript interfaces are attached.
The private route also forwards `POST <prefix>/_proxy?u=https://…` to the
LLM/TTS endpoint (same contract as `scripts/serve.py` / `desktop/main.js`).
`config/*` requests answer 404: providers.json never ships.

## Build the APK (no Gradle needed)

```powershell
powershell -File scripts/setup_android_tools.ps1   # one-time: JDK17 + SDK/NDK
powershell -File scripts/setup_rust_tools.ps1       # one-time: repo-local Rust
powershell -File scripts/build_apk.ps1              # -> output\android\RyzaChat-<ver>.apk
```

Pipeline: `aapt2 compile/link` → `javac --release 11` → `d8` →
`scripts/pack_apk_assets.py` (assets MUST go in with forward slashes —
`aapt2 -A` on Windows writes `assets\js\…` which AssetManager can't open) →
native `arm64-v8a` library packing → `zipalign` → `apksigner`. The self-signed
keystore and `signing.local.json` credentials live in `android/keystore/`
(gitignored); keep both for upgrade-compatible builds and never publish them.
The first clean build generates a random local password. Output is about 607 MB,
and installs like any APK (`adb install -r` or sideload).

The Gradle project still works for Android Studio users
(`assets.srcDirs = ["../../web"]`), but the script above is the maintained path.

## Privacy

- No providers.json / API keys / personal endpoints inside the package
  (verified by scanning every packaged js/css/html + zip listing).
- No analytics, no permissions beyond INTERNET + VIBRATE.
