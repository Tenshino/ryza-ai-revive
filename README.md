# Ryza Chat / 莱莎 Chat

**EN** Offline fan-made AI companion. One static web app, plus thin Windows and Android shells. You bring your own LLM and TTS keys — nothing talks to an official server.

**中文** 离线同人 AI 陪伴。同一套纯前端，外加 Windows / Android 薄壳。大模型和语音接口由你在设置里自填，不连接任何官方服务。

> Unofficial fan project for personal use. Not affiliated with Gust, Koei Tecmo, or the original publisher.  
> 非官方同人项目，仅供个人使用，与官方及原发行方无关。

Current version: **1.2.15** — source mirror: [Tenshino/ryza-ai-revive](https://github.com/Tenshino/ryza-ai-revive) (no binaries or GitHub Releases are published in this repository).

当前版本 **1.2.15**，源码同步仓库：[Tenshino/ryza-ai-revive](https://github.com/Tenshino/ryza-ai-revive)。本仓库不发布安装包 / APK，也不创建 GitHub Release。

---

## Features / 功能

| EN | 中文 |
|---|---|
| Talk modes (chat / story / immersive / ASMR / text) | 五种对话模式 |
| Spine 4.2 portrait + scenes, sit/stand, tap reactions | 立绘与场景、坐站切换、点击反应 |
| Local RPG layer (stamina, quests, inventory, daily login) | 体力 / 任务 / 背包 / 每日登录 |
| OpenAI/Qwen/GPT-SoVITS plus embedded SBV2 TTS | OpenAI/百炼/GPT-SoVITS，以及内置 SBV2 语音 |
| 7 UI languages | 界面七语 |
| Desktop frameless window + Android WebView APK | 无边框桌面窗 + 安卓 WebView |

---

## Additional changes in this repo / 本仓库的额外修改

This tree adds several local-first changes on top of the base project. No binaries, original-game media, trained voice models, or API keys are committed.

本仓库在原始项目之上做了这些本地优先的修改。二进制、原作素材、训练语音模型和 API Key 均不进入仓库。

- **LingChat-style embedded TTS provider (`lingchat`)** — a native Style-Bert-VITS2 JP-Extra inference engine (`Rust sbv2_core`) embedded in both Windows and Android shells. It does not call or copy the LingChat application.
- **Embedded voice import UI** — import `deberta.onnx`, `tokenizer.json`, and a `.sbv2` voice in Settings. Voice files stay in app-private storage and are never packaged into the repo.
- **Japanese speech hardening** — speech text strips protocol/dialogue labels, verifies kana before synthesis, forces translation for mixed/non-Japanese text, disables reasoning for DeepSeek translation requests, and rejects empty/non-Japanese translation output.
- **Optional local translation** — when the speech language differs from the reply language, translation can use an independent OpenAI-compatible local server (Ollama / LM Studio / vLLM) instead of the chat LLM. For qwen3/qwen3.5 models, requests send `reasoning_effort: none` to avoid slow hidden reasoning.
- **Ryza JP training tooling** — scripts and docs under `training/ryza-jp/` for dataset preparation, Whisper transcription, curated review, Style-Bert-VITS2 export, ONNX conversion, and `.sbv2` packaging. Audio and trained `.sbv2` artifacts are local-only and ignored.
- **Regression suite** — includes native TTS, DeepSeek/no-thinking translation, local-translation routing, mixed-language rejection, Android chunked audio, and other web-shell behaviors.

---

## Assets / 素材

This git repository is **source code only**. Original-game textures, Spine `.skel` binaries, voice / BGM / ambient / SE audio, and bundled fonts are **not** in the tree (including git history).

本仓库只放源码。原作贴图、Spine 骨骼二进制、语音 / BGM / 环境音 / SE、以及随包字体都不进 git，**历史提交里也没有**。

To run or rebuild from source, restore media into `web/assets/` (png / jpg / skel / m4a / wav / ttf). Do not commit them.

从源码运行或打包前，把素材放回 `web/assets/`，不要提交：

```powershell
python scripts/restore_media.py path\to\RyzaChat-1.2.15.apk
# or an unpacked desktop tree:
python scripts/restore_media.py path\to\win-unpacked\resources\web
```

JSON / atlas / SVG under `web/assets/` stay in git so the code still has structure tables. Raster, audio, and `.skel` do not.

`web/assets/` 里的 JSON、atlas、SVG 仍在仓库里；位图、音频、`.skel` 不在。

---

## Privacy / 隐私

- `config/providers.json` is **gitignored**. Copy `config/providers.example.json` and fill keys locally. Never commit it.
- Keys live in the app settings (localStorage / `%AppData%\RyzaChat`). They are not baked into exe/APK.
- Packaging runs `scripts/privacy_check.py` and **aborts** if a key-shaped secret or a personal machine path would ship.
- 打包产物里没有密钥。本仓库也不应出现账号、本机路径、个人网关。

---

## Run from source / 从源码运行

Restore media first (see **Assets / 素材** above), then start the bundled static server. Spine and `fetch` cannot use `file://`. The server also provides `/_proxy` for CORS:

```powershell
python scripts/serve.py
# open http://127.0.0.1:8765/
```

Do not use `python -m http.server` — there is no proxy, LLM/TTS will fail CORS.

### Desktop / 桌面

```powershell
# one-time portable Rust toolchain, then build the embedded TTS runtime
powershell -File scripts/setup_rust_tools.ps1
powershell -File scripts/build_native_tts.ps1 -Platform windows
cd desktop
npm install
npx electron .
```

Installer:

```powershell
powershell -File scripts/build_desktop.ps1
# -> output/desktop/RyzaChat-Setup-<version>.exe
```

### Android / 安卓

```powershell
# one-time JDK 17 + Android SDK/NDK and portable Rust
powershell -File scripts/setup_android_tools.ps1
powershell -File scripts/setup_rust_tools.ps1
powershell -File scripts/build_apk.ps1
# -> output/android/RyzaChat-<version>.apk
```

Toolchain directory: set `RYZA_ANDROID_TOOLS`, or put a single path in gitignored `config/android-tools.local.txt`. Default is `.android-tools/` inside this repo (also gitignored).

---

## Settings / 设置里要填什么

1. **LLM** — OpenAI-compatible base URL, model id, API key.
2. **TTS** (optional) — OpenAI-compatible, Qwen DashScope, GPT-SoVITS HTTP, or `LingChat embedded voice`.
3. **Embedded voice** — import a CPU-compatible FP32 `deberta.onnx`, matching `tokenizer.json`, and a JP-Extra `.sbv2` voice in Settings. Models stay in app-private data and are not packaged.

The embedded branch uses the same MIT `sbv2_core` engine and model layout as LingChat; it does not connect to or copy the LingChat application. Current upstream inference supports Japanese JP-Extra models only. See [`native/ryza-tts/README.md`](native/ryza-tts/README.md) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

开发水合：把填好的 `config/providers.json` 放在本地即可（已被 ignore）。内置语音模型请在设置页导入，不要提交到仓库。

---

## Tests / 测试

```powershell
node scripts/boot_smoke.js
node scripts/game_logic_regression.js
node scripts/memory_regression.js
node scripts/native_tts_regression.js
node scripts/motion_regression.js
node scripts/expression_coverage.js
python scripts/privacy_check.py web
```

---

## Layout / 目录

```
web/          app (static HTML/JS; media under assets/ is local-only)
desktop/      Electron shell (ryza://app)
android/      WebView + local AssetServer + native TTS JNI bridge
native/       MIT sbv2_core host (Windows sidecar / Android cdylib)
scripts/      serve, indexes, native/platform packaging, privacy gate
config/       version.json + providers.example.json
docs/         PROJECT / AUDIT / HANDOFF (implementation notes)
```

More detail: [`docs/PROJECT.md`](docs/PROJECT.md).

---

## Disclaimer / 声明

Character likenesses and original-game media originate from a copy of the game the author owns. They are not distributed via this git repository. This tree is a from-scratch client. Do not treat it as an official product, and do not use it for redistribution of paid services.

角色形象与原作媒体来自作者自有的游戏拷贝，不通过本 git 仓库分发。代码从零编写。请勿当成官方产品，也请勿拿去二次分发或接官方服务。
