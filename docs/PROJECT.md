# Ryza Chat — 离线同人陪伴 App

一个**自己写的、纯前端、不联网官方服务的同人 AI 聊天 App**。整套代码从零编写，
素材来自本地已有的资源文件。目标是：打开就能聊，LLM 与 TTS 接口由玩家自己在设置里填；
玩法与演出**按源项目的模块划分和原始数据重新实现**（没有 Dart 源码可抄）。

状态（2026-09-01）：**玩家主路径已按源数据接上；动作抽动/不自然已修**（注视指针进出缓动、张力三带衰减、driver 循环、深眨、重掷加权、skel hash 签名解析——见 `docs/AUDIT.md` §3.7，行为回归在 `node`+vendor spine 上跑过 60s 双姿态无 NaN）。音景与源包两首 BGM 对齐：标题 `bgm_opening`、对话只有地点 ambient、地图 `bgm_world_map`。腮红 overlay 走普通 Alpha。动作 Physics 每帧只 `update` 一次。细目见 `docs/AUDIT.md`。

本目录已 `git init`，作为防错改快照。`config/providers.json` **不要提交**（含 API Key）；模板是 `config/providers.example.json`。

下一轮接手：把 `docs/HANDOFF.md` 整份粘贴给下一个 Agent。

---

## 1. 技术选型与总体结构

```
projects/ryza-ai-revive/
├── web/                    # 应用本体（纯静态，无构建步骤）
│   ├── index.html
│   ├── css/app.css
│   ├── js/                 # util / avatar / app / i18n / fx / world / audio / …
│   ├── vendor/spine-webgl.js  # Spine 4.2 官方运行时
│   └── assets/             # 素材（约 572 MB）
├── desktop/                # pywebview 桌面壳（本地 HTTP + 竖屏窗）
├── android/                # WebView 薄壳（AssetServer 起 127.0.0.1:8765）
├── src/                    # 早期 Python 原型（LLM/TTS 验证）
├── scripts/serve.py        # 静态站 + LLM/TTS CORS 代理（日常用这个）
├── scripts/build_indexes.py
├── scripts/motion_regression.js  # 立绘动作离线回归（node 直接跑，见 AUDIT §3.7）
├── config/providers.json
└── docs/                   # 本文件、接力提示词 HANDOFF.md、AUDIT.md、reference/
```

**为什么是网页内核**：同一套 HTML/JS 跑在浏览器、桌面壳、Android WebView 里。

**运行方式**（Spine 与 fetch 不允许 `file://`；跨域 LLM 必须走代理）：

```bash
cd projects/ryza-ai-revive
python scripts/serve.py
# 打开 http://127.0.0.1:8765/
```

不要用 `python -m http.server`：没有 `/_proxy`，浏览器打官方兼容接口会 CORS 失败。

桌面：`pip install -r desktop/requirements.txt && python desktop/app.py`  
安卓：用 Android Studio 打开 `android/`（本机若无 JDK/SDK 则打不出 APK）。

---

## 2. 代码路径逐项说明

### `web/js/config.js` — 设置存储

全部进 `localStorage`（键 `ryza.settings.v1`），**没有服务端**。
段：`llm` / `tts` / `chara` / `profile` / `app` / `state` / `audio`。

- `Config.get()` / `Config.set('llm.model', v)` / `reset()` / `exportJSON()` / `importJSON()`
- `Config.hydrate()`：从 `config/providers.json` 灌空 key，或覆盖已保存但 host 对不上的旧地址
- `state`：模式、服装、所在地、时段、同伴天数

### `web/js/api.js` — LLM 与 TTS

都走 OpenAI 兼容 `chat/completions`，经 `localProxy('/_proxy?u=')` 转发。

- `Api.buildSystemPrompt(mode, style)` — 性格、好恶、处境、玩家档案、模式、输出格式
- `Api.chat` → `{emotion, attitude, text}`
- `Api.speak` — `clone` 时把参考 wav 做成 `data:audio/wav;base64,...` 放进 `audio.voice`
- 情绪 9 种 × 态度 3 种：`EMOTIONS` / `ATTITUDES`

### `web/js/avatar.js` — Spine 渲染

路径：`ManagedWebGLRenderingContext` + 自建 `Matrix4` MVP + `PolygonBatcher` +
`SkeletonRenderer`。不要用 `SceneRenderer` 的 `OrthoCamera`（zoom 语义是乘不是除）。

- **一块** WebGL（`#scene-canvas`）。点击用 `#avatar-hit`，不要再给立绘开第二块 canvas。
- 上下文 `{ alpha: false, premultipliedAlpha: false }`。头发阴影等 Multiply 槽第二遍 PMA；腮红/pale/tear 在第一遍改成 Normal（不要当 Multiply，会过曝）。setup 的 `cheek_line` / `nose_hi` 每帧摘掉。
- 画布 backing store = CSS 尺寸 × `devicePixelRatio`
- 角色与场景**共用同一套正交镜头**。视野高度 `1720 / (cameraZoom / 1.93)`（sitting 1.93 为基准）。ASMR zoom 3.5 是表里的特写，不是比例算错。
- 角色放在场景骨骼 `chara_root` + `posture_camera.json` 的 offset/scale 上
- 坐/站骨骼：场景 `midgroundPostures[0]` → `_01` / `_99`；玩家选的是 outfit（`crf_skn_002_0001`），不是带后缀的目录名
- `setEmotion`：脸/特效/一次性动作；**不换** track 0 待机（`fixedBasePoseMode`）
- 待机重掷、`PoseTypeSets`、`MotionGroups` Occupancy 分层见 AUDIT §3
- **注视指针与张力（2026-09-01，见 AUDIT §3.7）**：`fingerTrack*` 的偏移必须乘 `_ptrW`（按 `gazeReturnToFront` entry/exit 进出缓动，平滑指针初值钉在 `rig_face`），禁止裸 `+=`；`ambientBindings.repeatMin/Max` 由 `_lookCyc` 兑现；`tensionConfig` 的三带速率驱动连续 `_tension`（high→mid→low 收尾约 2s），`_tensionBand()` 决定 gaze/torso/眨眼档，ASMR 用 `intensityProfiles.weak` + `onModeChange()`；`eyeModeEntries.closed`（闭眼 1.5s）在 blink 队列里用 delay 兑现；`_effectNames` 按 `emotion|band` memo
- `Util.hashHex` 把 skel 的**有符号两半** hash（`-2a81ab33-1db7ab26`）转成无符号 `d57e54cde24854da`，与 `MixDurationPoses.sourceHash` 精确相等（坐/站都已验证）——距离 mix 路径因此始终可走
- 特效只来自 `effectSets` → `fxOnAnimNames` / `fxOffAnimNames`
- 注视 `DriverDefs` + aim/roll（`followers[].delay` 用注视历史队列）；指尖 `fingerTrack*`；口型 `lipSyncClosure` 或 `.env.json`
- 轨道：0 待机 / 1 一次性 / 2 眼 / 3 眉 / 4 嘴 / 5 特效 / 6 触摸 / 7+15+16 额外特效 / 8–9 手臂（B 或 FG，`MixBlend.replace`）/ 10 风（`MixBlend.add`）/ 11–12 躯干 / 13–14 腿
- 场景 rim：角色先画到默认 framebuffer，FBO 只加算轮廓。不要把角色 blit 进 FBO 再当主画面（会变成黑剪影）
- `setHidden`：抽屉「显示/隐藏立绘」
- 页面收在竖屏 `#phone` 列（`min(100vw, 100vh * 9/19.5)`）

**Spine 4.2 硬约束**：`skeleton.updateWorldTransform(spine.Physics.update)` 必须传这个枚举；
每帧先 `skeleton.update(dt)`。场景用 `Physics.none`（视差是 transform constraint，不是物理）。
场景动画只播一次 `anm_fade_in`，不要 loop。

### `web/js/world.js` — 世界地图

- `world_hierarchy.json`：5 区域 / 38 场景块 / 120 舞台
- `npcsAt(stageId, day)`：bases + move(area/field/stage) + companions，按 `resolveOrder`、按天哈希
- `backgroundFor(stageId)`：120 → 50 套场景骨骼
- UI：`world_map/ui/*.svg` 钉子，区域 → 场景块 → 舞台

### `web/js/util.js`

- `clamp` / `lerp` / `pad3` / `hashHex` / `swapHashHalves` / `weighted`
- 不引用 App / Avatar / World，给 audio / avatar 共用

### `web/js/alarm.js` / `web/js/quest.js` / `web/js/onboarding.js` / `web/js/audio.js` / `web/js/fx.js`

- 闹钟：列表/编辑、类型/语气/星期、贪睡、全屏响铃、`pick()` + `.env.json`
- 委托：本地日文池或 LLM；完成 overlay + 画布彩纸；欢迎任务瓦片
- 问卷 / 序章 / 教程：`onboarding.js`
- 音景：与源 `current_audio_route` / `BackgroundTrackId` 对齐。包里 BGM 只有 `bgm_opening`（标题）和 `bgm_world_map`（地图）；对话页 **没有** BGM，播 `amb_NNN_day/night`。地图上 ambient 压到 0.35。`Sound` 不读 `World`（App 传入 scene keys / background id）。浏览器要手势才 `play()`，`Sound.unlock` 用独立 Audio。
- `fx.js`：按 `assets/animations/*.json` 的 `fr`/`op` 用 canvas 播语音钮、标题火、委托彩纸（没有 Lottie 运行时）

### `web/js/i18n.js` / `web/js/app.js`

- UI 文案 `zh` / `zh-tw` / `ja` / `en` / `hi` / `id` / `pt-br`（`I18n.LANGS`）；角色台词仍是日文
- 主控：标题、对话循环、代理水合、设置/角色/存档槽、服装 veil、抽屉（`talk_drawer` 键）与底栏 sheet、语言 sheet、全屏

### `desktop/` `android/`

壳只负责「本地 HTTP + 窗口/WebView」。资源路径：冻结后走 `sys._MEIPASS/web`；
安卓 `sourceSets` 指向 `../../web`，`AssetServer` 提供 `http://127.0.0.1:8765/`。

---

## 3. 源项目功能对照（验收用这一节）

模块名来自 `docs/dart_source_tree.txt`。没有 Dart 源码，行为以第 7 节的**原始数据**为准。

**不要做**（源项目有、本重建明确去掉）：登录/Firebase、订阅付费墙、代币/回合票、
体力苹果、皮肤内购、每日登录领奖、远程资源门、公告服、强制更新、分析/崩溃上报。

| 源模块 | 玩家侧应该有的 | 现在（2026-08-31） |
|---|---|---|
| `title` | 标题画面再进游戏 | `overlay-title` |
| `onboarding` | 问卷、序章语音、教程对话 | 有；对白本地/LLM |
| `talk` | 五种模式、气泡、日志、重置 | 有；模式是 HUD 药丸不是 bottom sheet |
| `spine_avatar` | 情绪叠层、表情、眨眼、分部位点击、注视、指尖、物理、站/坐、ASMR、视差、rim | 已接；见 AUDIT §3 |
| `audio` | 标题 opening BGM；对话 ambient；地图 world BGM；SE；分路；tap_voice | `audio.js`（对话无 BGM 是源设计） |
| `world_map` | 钉子图、选舞台、NPC 头像、时段 | 钉子三级；调度按 placement 全字段 |
| `alarm` | 列表+编辑、贪睡、响铃全屏、env 口型 | 有；仅前台 |
| `mission` + `welcome_mission` | 委托板、完成演出、欢迎任务 | 本地池 + overlay + 瓦片（无官方 master） |
| `chara` | 角色设定、存档槽 | 表单 + 3 槽 |
| `skin` | 5 预览、2 可穿、veil | 有；姿势跟场景 |
| `talk` 库存 | `inventory_sheet` | `#sheet-inv` |
| 口型 | env / RMS | `lipSyncClosure` + envelope |
| `i18n` | UI 多语言；闹钟 6 语 | UI zh / zh-TW / ja / en / hi / id / pt-BR；语音目录随语言 |
| 包装 | 可安装的桌面/安卓 | 壳已写，本环境未打出 exe/apk |

素材在包里、代码**故意未用或做不到**的：

- `web/assets/animations/`：标题火 / 语音钮 / 委托彩纸用画布按 JSON 帧率播
- `web/assets/spine/objects/`（场景 JSON 未引用）
- `MixDurationPoses.sourceHash` 可能对不上 `skeleton.hash`（`animPoses` 有骨头时仍用距离 mix）

---

## 4. 已跑通的部分

- 标题页 → 进游戏；问卷/序章/教程
- 角色骨骼（坐/站随场景）、单画布、场景 fade 一次、共享镜头、竖屏 `#phone`
- `gesture.json`：待机 / 一次性覆盖 / 表情 / 特效 / 注视 / 指尖 / Occupancy 肢体层 / 口型 / 点击部位
- 世界钉子图 + NPC 全字段调度；语音库 6 语目录；UI 7 语
- 抽屉 `talk_drawer` 键；地图/委托从对话底栏进
- LLM 经 `/_proxy`；TTS 用 `web/assets/voice/ryza_wav/` 克隆（须 wav/mp3）
- 闹钟响铃+贪睡+env；音景（标题 BGM / 对话 ambient / 地图 BGM）；5 槽换装+veil；欢迎任务；存档槽；道具栏

---

## 5. 已知问题 / 剩余

1. ~~`MixDurationPoses.sourceHash` 仍可能对不上 `skeleton.hash`~~（2026-09-01 已解决：skel hash 是两个有符号 32 位半拼的字符串，`Util.hashHex` 已按签名解析，坐/站均精确命中，距离 mix 走正路）。
2. 闹钟只在应用前台触发。
3. 参考音频只接受 wav/mp3；克隆用 wav 在 `web/assets/voice/ryza_wav/`。
4. 桌面/安卓壳未在本机打出安装包。
5. 标题/语音钮/彩纸是画布按 Lottie JSON 帧率播，不是 Lottie 运行时。
6. `spine/objects/` 仍只有图集、没有完整 skel，无法加载。

---

## 6. 素材与脚本

素材分类见第 7 节。改了 `web/assets/` 下的文件后跑：

```bash
python scripts/build_indexes.py
```

生成 `web/assets/_index/*.json`。

---

## 7. 源包解包产物 —— 位置对照表（重要）

**接手时直接读这些文件，不要只看本节转述。**

### 7.1 什么有，什么没有

| | 情况 |
|---|---|
| ✅ 有 | 全部**原始素材**（图像、音频、骨骼、字体） |
| ✅ 有 | 全部**原始配置 JSON**（动作表、世界、NPC、镜头、场景 rig） |
| ✅ 有 | 抽取的字符串、源码**路径名**清单 |
| ❌ 没有 | 反编译 Dart 源码（AOT 快照不可逆） |
| ❌ 没有 | Java/Kotlin 业务逻辑（dex 是 Flutter/Firebase 样板） |

不能「对着原来的函数抄」，只能**按原始数据 + 模块划分重新实现**。

### 7.2 原始素材

| 路径 | 内容 |
|---|---|
| `web/assets/spine/crf_chr_002/crf_skn_002_0001_01/` | 坐姿服装：skel / atlas / png / `*_gesture.json` |
| `web/assets/spine/crf_chr_002/crf_skn_002_0001_99/` | 站姿服装，结构同上（`postureKey`: standing） |
| `web/assets/spine/scenes/<舞台>_<时段>/spine/` | 50 套 × 4 时段场景骨骼 |
| `web/assets/spine/scenes/<舞台>_<时段>/<同名>.json` | `constraintOverrides`、`light`、`midgroundPostures` |
| `web/assets/spine/objects/` | 3 个物件骨骼（当前未加载） |
| `web/assets/audio/alarm/<语种>/<语气>/<类型>/<时段>/` | 预录语音 + 同名 `.env.json` |
| `web/assets/audio/prologue/jp/` | 9 条开场白原声 |
| `web/assets/audio/tap_voice/` | 点击反应语音 |
| `web/assets/audio/ambient/` `bgm/` `se/` | 地点环境音（对话页背景）；BGM 仅 `bgm_opening.m4a` + `bgm_world_map.m4a`；SE |
| `web/assets/images/chara_icons/` `skins/` | 头像、服装预览 |
| `web/assets/world_map/ui/` | 地图钉子 SVG |
| `web/assets/welcome_mission/` | 欢迎任务 UI 图 |
| `web/assets/icons/` `animations/` `fonts/` | 图标、Lottie JSON（画布播）、字体 |
| `web/assets/voice/ryza_wav/` | 开场白转出的 24kHz 单声道 wav（TTS 克隆） |

### 7.3 原始配置 JSON（行为的权威来源）

| 路径 | 用途 | 当前读取者 |
|---|---|---|
| `web/assets/spine/crf_chr_002/*/…_gesture.json` | 情绪×态度、表情、特效、mix、aim/roll/gaze、手臂组 | `avatar.js` |
| `web/assets/world_map/world_hierarchy.json` | 区域 / 场景块 / 舞台 | `world.js` |
| `web/assets/world_map/npc_placement.json` | NPC 分布与同行 | `world.js` |
| `web/assets/data/stage_background_map.json` | 舞台→背景套 | `world.js` |
| `web/assets/data/posture_camera.json` | 站/坐镜头与 ASMR | `avatar.js` |

### 7.4 抽取产物（非原始文件，只当目录/文案索引）

| 路径 | 内容 |
|---|---|
| `docs/dart_source_tree.txt` | 479 条源码路径（无代码）——**功能清单以这个模块树为准** |
| `data/libapp_strings_ja.txt` | 抽取的日文 UI 原文 |
| `docs/reference/apk_asset_inventory.txt` | 源包 3609 个文件清单 |
| `docs/reference/strings_ja_ui.txt` | 清洗后的日文文案 |
| `docs/reference/spine_example.html` 等 | Spine 官方示例，渲染路径对照 |

源 App 结构分析（接口、包名）在 `D:\agent\backup\ryza-recon-report.md`，不放在本目录。

### 7.5 生成物

`web/assets/_index/*.json` 由 `scripts/build_indexes.py` 扫描素材生成。改素材就重跑。
