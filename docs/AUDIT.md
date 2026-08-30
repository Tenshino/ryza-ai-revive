# 实现核对（相对源 APK v1.0.2）

日期：2026-08-31（动作层 + 抽屉/多语/演出补完）  
对象：`D:\download\ai.gospiral.atelierryza.v1.0.2.apk`（613,761,884 字节）  
对照：`docs/reference/apk_asset_inventory.txt` + `web/assets/` 原始 JSON + `docs/dart_source_tree.txt`  
代码：`web/js/*.js`、`web/index.html`、`scripts/serve.py`

验收口径：**源 APK 里玩家侧能落地的功能，按源模块 + 原始数据实现**。官方登录/付费/分析/websocket 仍按 HANDOFF「明确不要做」剔除。没有 Dart 源码时，行为以 APK 内 JSON / 音频目录 / 骨骼 / UI 图为准。

**结论：** 素材拷贝仍是 3609 对 3609。玩家主路径已按源数据接上。抽屉已改成 `talk_drawer` 键（地图/委托从对话底栏进）。UI 语种补了 zh-TW / hi / id / pt-BR。场景 rim 用 FBO **加算轮廓**（角色仍画在默认 FB）。标题火/语音钮/委托彩纸按 Lottie JSON 的帧率用画布播（未引入 Lottie 运行时）。动作层 Occupancy + `MixBlend.replace` 已按源表接上。`MixDurationPoses.sourceHash` 仍对不上骨骼 hash，距离 mix 不接线。

本状态已在 `projects/ryza-ai-revive` 做 git 快照（不含 `config/providers.json` 密钥）。

---

## 1. 素材：与 APK 一比一（通过）

`apk_asset_inventory.txt` 里 `flutter_assets/assets/` 共 **3609** 个文件；`web/assets/` 去掉生成物 `_index/` 和转码产物 `voice/` 后也是 **3609**，路径集合一致。

之后请直接读 `web/assets/`，不要再假设 `temp/` 里还有一份完整包。

| 数据 | APK / 原始 JSON | 现状 |
|---|---|---|
| 世界层级 | 5 区域 / 38 场景块 / 120 舞台 | `world_hierarchy.json` 对得上 |
| 舞台→背景 | 121 条（含 `stage_00_000_00`）→ 50 套 | `stage_background_map.json` 对得上 |
| 场景骨骼 | 50 套 × mor/aft/eve/ngt | `_index/scenes.json` 齐全 |
| NPC | 34 人，含 bases / move / companions / resolveOrder | 文件完整；`world.js` 已按这些字段调度 |
| 可穿骨骼 | `crf_skn_002_0001_01`（坐）/ `_99`（站） | 两套 skel+atlas+gesture 都在 |
| 换装预览图 | 5 张 `images/skins/*.png` | UI 5 槽：2 套可穿，3 套预览不可穿 |
| 闹钟语音目录 | `<locale>/<normal\|whisper>/<type>/<tod>/` | 类型名与代码枚举一致 |
| 镜头表 | `posture_camera.json` sitting/standing × base/asmr | sitting zoom 1.93 / standing 1.45 / ASMR 3.5 都在用 |

**APK 里没有、因此无法一比一的：** `/v1/masters` 任务正文、额外皮肤骨骼（`0002/0003/0004` 只有预览）、marionette / yorisoi 实时口型流、官方 TTS。继续用本地 JSON / 玩家自填 LLM·TTS。

---

## 2. 源屏幕 vs 现在

| 源模块 / 屏幕 | 源侧玩家该看到的 | 现在 | 判定 |
|---|---|---|---|
| `title_screen` | 标题再进游戏 | `overlay-title`，素材加载完才可「はじめる」 | **对** |
| `onboarding` + `prologue` + `tutorial_talk` | 问卷 + 序章语音 + 教程 | `onboarding.js` 问卷写入设定；`audio/prologue`；教程推进 | **对**（对白用本地/LLM，不是官方剧本接口） |
| `talk_screen` | 模式、气泡打字、日志、重置、输入条 | 五种模式 + 音声/文字；回忆日志；`talk.newTalkConfirm`；输入条 | **对**（模式仍是 HUD 药丸，源是 bottom sheet） |
| `talk_drawer` | welcome / alarm / language / profile / memory / newTalk / toggle / fullscreen / settings | 抽屉已是这些键；地图/委托/服装从底栏或角色页进 | **对** |
| `inventory_sheet` | 对话道具栏 | `#sheet-inv` + localStorage | **对** |
| `spine_avatar` | 见 §3 | 坐/站随场景、情绪叠层、点击部位、注视/指尖、口型、rim FBO | **对** |
| `audio` | BGM / ambient / se / 分路音量 / tap_voice | `audio.js` 四路 + 设置滑条 | **对** |
| `world_map_screen` | 区域钉 → 场景块钉 → 舞台；NPC 头像 | `world_map/ui/*.svg` 钉子图；可选到具体舞台 | **对** |
| `npc_scheduler` | bases + move + companions + resolveOrder | `npcsAt()` 已按这些字段、按天哈希 | **对** |
| `alarm_*` | 列表/编辑、贪睡、全屏响铃、`.env.json` | 三要素都有；locale 随 UI（zh→zh-tw） | **对**（仅前台轮询，无系统闹钟） |
| `mission` + `welcome_mission` | 委托板、完成 overlay、欢迎任务图 | 本地池/LLM + `quest_clear` overlay + 欢迎任务瓦片 | **偏**（无官方 mission-board 正文） |
| `chara` + `save_slot` | 角色卡、存档槽 | 设定表单 + 3 槽 localStorage | **对** |
| `user/profile_edit` | 生日性别姓名等 | onboarding 写入 + 设定页可改 | **对** |
| `skin_selection` | 5 预览；2 可穿；切换 veil | 5 槽 + veil；姿势由场景 `midgroundPostures` 选 `_01`/`_99` | **对** |
| `i18n` | UI 多语；闹钟 6 语目录 | UI zh / zh-TW / ja / en / hi / id / pt-BR；闹钟/点击/序章随语言选目录 | **对** |
| 包装 | 可安装包 | `desktop/` `android/` 壳在，本机未出 exe/apk | 非玩法 |

---

## 3. 立绘 `avatar.js`（2026-08-31）

### 3.1 已按源数据接上的

- **单 WebGL 画布**（`#scene-canvas`）+ `#avatar-hit` 点击层。两块叠 WebGL 在 Windows 上会闪。
- 场景只播一次 `anm_fade_in` / `anm_fade_in_all`（`loop: false`）。循环 fade_in 会每秒透明闪一次。
- 场景 `updateWorldTransform(Physics.none)`；角色 `Physics.update` 后再 `none` 贴 `chara_root`。
- 服装 id 是 outfit（如 `crf_skn_002_0001`）；坐/站后缀由场景 `midgroundPostures` 决定（`_01` / `_99`）。
- `fixedBasePoseMode`：换情绪**不换** track 0 的 `motion_A_*_idle`。一次性动作在 track 1 覆盖，播完 `addEmptyAnimation(..., fade, 0)` 从**片段结束**淡出（delay≤0）。切入时长 `mixDurationMin × mixDurationSaturationRatio`（约 0.1s），不是 1–2s 全身距离混合。
- 待机重掷：`poseRerollIntervalMin/Max`；`PoseTypeSets` 加权换姿势类型；同类短混合，跨类型才用 `mixDurationMin`–`Max`。一次性动作播放中不重掷。
- 手臂：`armInOutPartConfig.idleGroupIds.byPosture` 休息组 + `MotionGroups` / `armGroupWeightsByPoseType` 加权叠加；`enableArmInOutRouting` 时走 in/out clip。Occupancy：B 或 FG 互斥（轨 8–9，`MixBlend.replace`），E/EH 躯干（11–12），C 双腿否则 I 左 + J 右（13–14）。风仍是 `MixBlend.add`。`motion_add_*` 是完整肢体 pose，用 add 会叠出「手臂立柱」。
- 表情：`intensityProfiles.normal.expressionSets` + `mixDurationEye/Eyebrow`；眨眼 `closedEyeAnimation`。
- 特效：只认 intensity 的 `effectSets[].names` → `fxOnAnimNames` / `fxOffAnimNames`。没有自造 `FX_BY_EMOTION`。setup 里 `037_face_cheek_line` / `032_face_nose_hi` 每帧摘掉（Multiply 直通 Alpha 会过曝）；害羞等 ON 仍挂 `038_face_cheek`（如 `face_cheek_01`）。
- Multiply 槽第二遍用 PMA 画（图集无 `pma:true`，但这些槽按预乘作者）。全局 PMA 会让普通网格接缝发黑。
- 注视：`emotionalGesture.DriverDefs` + `tensionProfiles`；`rigConfig.aimSlots/rollSlots`；`lockSittingAxis` 不滚 `body2`。
- 指尖：`fingerTrackCenterBone` / `MaxRange` / Head·Body 阈值与 scale。
- 口型：`lipSyncClosure`（Analyser RMS → openness dB）+ 闹钟 `.env.json` envelope。
- 点击：`hitPartNames` 多边形/骨半径 → `TapReactions` 按 `PartName`。
- 风：`windAnimationPrefix`（`effect_wind*`）加在 track 10，`MixBlend.add`。
- 说话时 `performanceConfig.intensitySpeedMultipliers.strong` 乘在待机 timeScale 上。

**轨道：** 0 待机 / 1 一次性 / 2 眼 / 3 眉 / 4 嘴 / 5 特效 / 6 触摸 / 7 额外特效 / 8–9 手臂（B 或 FG，`MixBlend.replace`）/ 10 风（`MixBlend.add`）/ 11–12 躯干腰（E/EH）/ 13–14 腿（C 双腿，否则 I 左 + J 右）。

### 3.2 仍不是源公式、或做不到的

| 点 | 源 | 现在 |
|---|---|---|
| `MixDurationPoses` | APK 用骨骼距离算 mix；`sourceHash` 对不上就 **random min–max** | 同类姿势用 saturation 短混合，跨类型 random min–max。没有复刻 `calculateMixDurationFromDistance` 的骨子集 |
| 强度档 | `normal` / `strong` / `weak` 整套 profile | 表情/姿势只用 `normal`；strong 只作语速倍率 |
| Driver 跟随 delay | `followers[].delay` | 注视历史队列按 delay 取样 |
| 镜头高度 | JSON 的 zoom/pan | 视野高度仍是 `1720 / (zoom/1.93)`；ASMR panY 会略抬以对着脸（zoom 3.5 特写是表里的） |
| `light.rim*` | rimEnabled / opacity / glow | 角色画到默认 FB；FBO 只加算轮廓（不是源 shader 像素级拷贝） |
| `spine/objects/` | 3 个物件骨骼 | 场景 JSON 未引用，代码未加载 |
| Lottie | `assets/animations/` | 画布按 JSON `fr`/`op` 播语音钮/标题火/委托彩纸；未引入 Lottie 运行时 |

### 3.4 动作切换坑（2026-08-31 已修，不要退回去）

1. **`MixBlend.add` vs `replace`：** Occupancy 的 `motion_add_*` 是完整肢体 pose，不是相对 bind 的增量。`replace` 叠在更高轨上只覆盖被 key 的骨头。`add` 会把待机手臂再加一遍，看起来像肉色立柱。只有 `effect_wind*` 用 `add`。
2. **不要每句对话 / 每次 idle 重掷都换手臂组。** 当前组仍适用、权重仍 >0 时保持。同 `AnimName_1/2` 不要走 out→in。
3. **一次性 `motion_oneshot_D_*` 不要 mute 8–14 轨。** mute 再重抽会让手臂每句对话跳一次。点击 `TapReactions` 仍可短暂 mute，结束要**还原同一组**，不要随机新组。
4. **姿势类型：** `_idlesForType` 必须用全局 `poseTypeIds` 映射过滤。未标类型的 A_* 不能当所有 `posetype_*` 的候选，否则会在 clasping / freehand 之间硬切。
5. **Occupancy 字母：** B 与 FG 互斥（都占手臂）；C 与 I/J 互斥（双腿 vs 左/右腿）；E/EH 是躯干，可与手臂同时播。

### 3.5 过曝说明（给下一个人）

白斑不是「永远关掉腮红」。setup 姿态里 Multiply 的颊线/鼻高光一直挂着，直通 Alpha 下 `dst*(rgb+1−a)` 会乘亮。idle 必须播 `facial_add_blush_000_off` 并摘掉这两槽。`effectSets` 里的 blush001 等仍会 ON，挂的是 `038_face_cheek`，用 PMA 第二遍画。

---

## 4. 其它模块（对照旧 AUDIT 已修）

- **NPC：** 不再写死莱莎到处出现。`bases` + area/field/stage `move` + `companions` + `resolveOrder`。
- **地图：** 钉子 SVG；区域 → 场景块 → 舞台，不是只进 `stages[0]`。
- **闹钟：** 贪睡、全屏响铃、`.env.json` 口型、locale 随 UI。
- **LLM：** `scripts/serve.py` 的 `POST /_proxy` 绕过 CORS；`Config.hydrate()` 在 key 空或 host 对不上时灌 `config/providers.json`。不要用 `python -m http.server`（没有代理）。
- **闪烁：** 单 GL 上下文 + 场景 fade 只播一次。

---

## 5. 还剩什么（可做 / 明确不做）

**可做但还没做完：**

1. `MixDurationPoses` 若以后对上 skeleton hash，再接线距离公式
2. 标题/语音钮是画布演出，不是官方 Lottie 运行时（包内没有运行时）

**明确不做：** 登录/Firebase、付费墙、代币、体力、皮肤内购、每日登录、远程资源门、公告、强制更新、分析、官方 marionette websocket。

**做不到像素级、屏幕要在：** 委托正文、教程对白 — 本地池 / 玩家 LLM。
