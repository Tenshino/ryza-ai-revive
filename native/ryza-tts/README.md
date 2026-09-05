# Ryza Native TTS

This optional runtime embeds the same MIT-licensed `sbv2_core` inference library used by LingChat. It is an independent host implementation and does not copy LingChat application code.

## Model layout

Models are not bundled. The host expects the following under the platform app-data directory:

```text
models/tts-local/
  assets/deberta/deberta.onnx
  assets/deberta/tokenizer.json
  voices/<voice-id>/model.sbv2
```

An unpacked ONNX voice is also accepted as `model.onnx` plus `style_vectors.json`. Use a CPU-compatible FP32 DeBERTa model. The upstream engine supports Japanese JP-Extra models only.

## Windows build

Visual Studio C++ Build Tools are required. Install the repo-local Rust toolchain and build:

```powershell
powershell -File scripts/setup_rust_tools.ps1
powershell -File scripts/build_native_tts.ps1 -Platform windows
```

The build stages `ryza-tts.exe`, ONNX Runtime, and license notices under `native/ryza-tts/dist/windows/`. The Electron shell launches that staged copy in development and packages it under `resources/tts/` for releases.

## Android build

The Android target is CPU-only and initially supports `arm64-v8a`. Run:

```powershell
powershell -File scripts/setup_android_tools.ps1
powershell -File scripts/setup_rust_tools.ps1
powershell -File scripts/build_native_tts.ps1 -Platform android
```

The scripts install NDK 27 and the Rust target, link the matching ONNX Runtime archive through `ort`, then stage `libryza_tts.so` and `libc++_shared.so` under `android/app/src/main/jniLibs/arm64-v8a/`.

## Provenance

- `sbv2_core` is vendored from commit `ffb0b591e55d82091c4db210772c069859be99e9`, MIT
- `esaxx-rs` 0.1.10 patch source is from the canonical `sbv2-api` dependency tree at the same commit, Apache-2.0
- Japanese preprocessing uses `jpreprocess` / NAIST-JDIC 0.13.2, BSD-3-Clause
- ONNX Runtime is supplied by `ort` 2.0.0-rc.13; complete dependency notices are staged with release binaries

See `THIRD_PARTY_NOTICES.md` in the project root. Voice and model files have separate licenses and are the user's responsibility.
