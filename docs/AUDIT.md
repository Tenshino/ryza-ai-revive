# 实现核对（相对源 APK v1.0.2）

日期：2026-08-31（音景与源包两首 BGM 对齐；腮红 Normal；Physics 单次 update）
增补：2026-09-01（动作抽动与不自然：注视/指针/张力/眨眼/重掷加权/hash；见 §3.7）  
对象：`D:\download\ai.gospiral.atelierryza.v1.0.2.apk`（613,761,884 字节）  
对照：`docs/reference/apk_asset_inventory.txt` + `web/assets/` 原始 JSON + `docs/dart_source_tree.txt`  
代码：`web/js/*.js`、`web/index.html`、`scripts/serve.py`

验收口径：**源 APK 里玩家侧能落地的功能，按源模块 + 原始数据实现**。官方登录/付费/分析/websocket 仍按 HANDOFF「明确不要做」剔除。没有 Dart 源码时，行为以 APK 内 JSON / 音频目录 / 骨骼 / UI 图为准。

**结论：** 素材拷贝仍是 3609 对 3609。玩家主路径已按源数据接上。音景与源 `BackgroundTrackId` 一致：标题 `bgmOpening`、对话只有 `amb*`、地图 `bgmWorldMap`（对话无 BGM 是源设计）。腮红/pale/tear 按 Normal overlay；`cheek_line`/`nose_hi` 仍摘掉。动作 `Physics.update` 每帧一次。`animPoses` 有骨头时走距离 mix。

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
| `audio` | 标题 opening BGM；对话 ambient；地图 world BGM；SE；分路；tap_voice | 两首 BGM + 地点 ambient；对话无 BGM | **对** |
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
- 场景 `updateWorldTransform(Physics.none)`；角色只 `Physics.update` **一次**。后面再 `Physics.none` 会丢掉物理、动作抖。
- 服装 id 是 outfit（如 `crf_skn_002_0001`）；坐/站后缀由场景 `midgroundPostures` 决定（`_01` / `_99`）。
- `fixedBasePoseMode`：换情绪**不换** track 0 的 `motion_A_*_idle`。一次性动作在 track 1 覆盖，播完 `addEmptyAnimation(..., fade, 0)` 从**片段结束**淡出（delay≤0）。切入时长 `mixDurationMin × mixDurationSaturationRatio`（约 0.1s），不是 1–2s 全身距离混合。
- 待机重掷：`poseRerollIntervalMin/Max`；`PoseTypeSets` 加权换姿势类型；同类短混合，跨类型才用 `mixDurationMin`–`Max`。一次性动作播放中不重掷。
- 手臂：`armInOutPartConfig.idleGroupIds.byPosture` 休息组 + `MotionGroups` / `armGroupWeightsByPoseType` 加权叠加；`enableArmInOutRouting` 时走 in/out clip。Occupancy：B 或 FG 互斥（轨 8–9，`MixBlend.replace`），E/EH 躯干（11–12），C 双腿否则 I 左 + J 右（13–14）。风仍是 `MixBlend.add`。`motion_add_*` 是完整肢体 pose，用 add 会叠出「手臂立柱」。
- 表情：`intensityProfiles.normal.expressionSets` + `mixDurationEye/Eyebrow`；眨眼 `closedEyeAnimation`。
- 特效：只认 intensity 的 `effectSets[].names`（加权抽 **一组**，组内 names 可叠）→ `fxOnAnimNames` / `fxOffAnimNames`。没有自造 `FX_BY_EMOTION`。setup 里 `037_face_cheek_line` / `032_face_nose_hi` 每帧摘掉。害羞等 ON 挂 `038_face_cheek`，**按 Normal 画**（槽虽然标了 Multiply）。
- 头发阴影等其余 Multiply 槽第二遍 PMA。腮红当 Multiply 会 `dst*(rgb+1−a)` 过曝。全局 PMA 会让普通网格接缝发黑。
- 注视：`emotionalGesture.DriverDefs` + `tensionProfiles`；`rigConfig.aimSlots/rollSlots`；`lockSittingAxis` 不滚 `body2`。眨眼间隔来自 `gaze.eyeModeEntries`。
- 指尖：`fingerTrackCenterBone` / `MaxRange` / Head·Body 阈值与 scale。
- 口型：`lipSyncClosure`（Analyser RMS → openness dB）+ 闹钟 `.env.json` envelope。
- 点击：`hitPartNames` 多边形/骨半径 → `TapReactions` 按 `PartName`。
- 风：`windAnimationPrefix`（`effect_wind*`）加在 track 10，`MixBlend.add`。
- 说话时用 `intensityProfiles.strong` 的表情/特效档，并把 `performanceConfig.intensitySpeedMultipliers.strong` 乘在待机 timeScale 上。

**轨道：** 0 待机 / 1 一次性 / 2 眼 / 3 眉 / 4 嘴 / 5 特效 / 6 触摸 / 7+15+16 额外特效 / 8–9 手臂（B 或 FG，`MixBlend.replace`）/ 10 风（`MixBlend.add`）/ 11–12 躯干腰（E/EH）/ 13–14 腿（C 双腿，否则 I 左 + J 右）。

### 3.2 仍不是源公式、或做不到的

| 点 | 源 | 现在 |
|---|---|---|
| `MixDurationPoses` | APK 用骨骼距离算 mix | skel hash 有符号两半已被 `Util.hashHex` 正确解析，sourceHash 坐/站都精确命中 → 距离 mix 走正路；同类型短混合作下限 |
| 强度档 | `normal` / `strong` / `weak` 整套 profile | 说话时用 `strong`，否则 `normal` |
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
6. **成对手臂 delay：** 第二轨要等 `pairStartDelay` 时，把当前 looping clip 的 `trackEnd` 设成「现在 + delay」再 `addAnimation`。不要 empty mix=0（setup 闪一下），也不要往 looping 当前片段后面 `addAnimation`（下一段永远不开始）。
7. **物理：** 角色每帧只 `updateWorldTransform(Physics.update)`。先 place，后物理。不要再 `Physics.none`。

### 3.5 过曝说明（给下一个人）

白斑不是「永远关掉腮红」。setup 姿态里 Multiply 的颊线/鼻高光一直挂着，直通 Alpha 下 `dst*(rgb+1−a)` 会乘亮。idle 必须播 `facial_add_blush_000_off` 并摘掉这两槽。`effectSets` 里的 blush001 等仍会 ON，挂的是 `038_face_cheek`：**按 Normal 画**，不要走 Multiply / PMA 第二遍，否则腮红本身过曝。

### 3.6 音景（与源包对齐，不要「补」对话 BGM）


源 APK 的 `BackgroundTrackId` 只有：

- `bgmOpening` → `assets/audio/bgm/bgm_opening.m4a`（`title_screen`）
- `bgmWorldMap` → `assets/audio/bgm/bgm_world_map.m4a`（`world_map_screen`）
- `amb001Day` … `amb047Night` → `assets/audio/ambient/amb_NNN_{day,night}.m4a`（地点环境音）

没有第三首 talk BGM。路由文件是 `current_audio_route` / `resolve_background_track` / `ambient_band_tracks`；go_router 有 `/world_map?from=title` 和 `/world_map?from=talk`，地图是独立屏。

因此玩家听到的应该是：

| 屏幕 | BGM | ambient |
|---|---|---|
| 标题 | `bgm_opening` | 无 |
| 对话 | **无** | 当前舞台对应的 `amb_*` |
| 世界地图 | `bgm_world_map` | 同一条 ambient，压到约 0.35 以免抢音量 |
| 序章语音 | 无 | 无（只播 `prologue_*.m4a`） |

「进地图才听到那首曲子」是源设计。先前对话页没声，是 ambient 没起来，不是 BGM 出场时机错了。

实现约束（已修，不要退回去）：

1. 浏览器要用户手势才让 `audio.play()` 成功。`Sound.unlock` 用独立 `Audio` ping，不要动 BGM/ambient 两个循环元素。
2. 循环音源记在 `Sound._loopSrc.bgm/ambient`。**禁止** `Sound['_ambientSrc'] = url`：那会把 `_ambientSrc` 函数覆盖成字符串，之后地点音效永久消失。
3. 对话页 `setRoute('talk')` 必须开始 ambient。不要为了「对话也有 BGM」去播 `bgm_world_map` 或 opening。

### 3.7 动作抽动与不自然（2026-09-01 已修，不要退回去）

按原始数据核出来的根因，全部对坐/站两套 skel+gesture 做了离线行为回归（node + vendor spine 运行时驱 60s，无 NaN、轨道不卡死）：

1. **指针进/出立绘区一帧瞬移（偶发抽动的主因）**。`fingerTrack*` 的偏移最大 ±514 世界单位，直接 `+=` 在 `control_aim_eye/head/body` 上；鼠标一进 `#avatar-hit` 就把眼睛/头/身 IK 目标瞬移过去，离开时又瞬移回来。源数据里 **`projectConfig.gazeReturnToFront`（entry/exit：min 0.4 / max 0.8 / secondsPerDistance 0.8）就是管这个的**，之前没人读。现在 `_ptrW` 权重按该配置进出缓动，且平滑指针初值钉在脸上（偏移从 0 起步），不再 teleport。
2. **注视驱动没有循环**。`ambientBindings` 每条带 `repeatMin/repeatMax`（同一 driver 连做 2–8 次再换），之前每次随机换 driver，头部模式跳、显得「眼神乱飘」。现在 `_lookCyc` 按 band 记住重复次数。
3. **driver 的 `eye` 与 `head` 两种不再混用**。98 个 DriverDefs 里 21 个是纯眼球小动作（yaw 窗口 0.4–1.0 rad），此前统一按 head 幅度乘 `unit=110` 打眼睛（作者关键帧眼睛位移只有 ±7–20 单位，之前打出去大一个量级）。现在 eye 驱动走眼睛为主、头只轻微带。`lookAtUser:true` 的 78 个驱动窗口本身跨 0（朝前=朝玩家），保持原窗口即为「看着你」。
4. **张力档只用了一半**。源有 `tensionConfig`（defaultDecayRate 0.02 + low/mid/high decayRates 0.022/0.033/0.044）和三档 `tensionProfiles.low/mid/high`；之前说话↔不说话在 high/low 之间硬切（mid 带、weak 档永远用不到），说完话手臂/躯干/注视瞬间掉档。现在是 0..1 连续张力：说话拉满、按档位速率衰减（约 2s 收尾），band 阈值 0.66/0.33。ASMR 模式用 `intensityProfiles.weak` + `performanceConfig.intensitySpeedMultipliers.weak`（0.9×），切换走 `Avatar.onModeChange()`。
5. **眨眼只做了 blink/blinkFast，漏了 `closed`**。`eyeModeEntries` 里 weight 0.1 的 `closed`（闭眼 1.5s）没实现 → 眼睛长时间不眨的「死鱼眼」观感。现在按权重抽三种模式，closed 用 `addAnimation(open, delay=1.5)` 保持闭眼再回开（0 长度 pose 片段 + 延迟队列，回归里验证过不卡死）。
6. **待机重掷是均匀随机**。站姿 `basePoses` 带 `weight`（如 A_007=0.05 稀有姿势），坐/站的 `PoseTypeSets` 结构不同（站姿的 poseType 就是动画 ID 本身）。现在 `_idlesForType` 返回 `{name,w}` 走 `Util.weighted`。
7. **`MixDurationPoses.sourceHash` 其实一直对得上**。skel 头里的 hash 是**两个有符号 32 位半**拼出来的字符串（`-2a81ab33` + `-1db7ab26` = `"-2a81ab33-1db7ab26"`），无符号化 = `d57e54cde24854da`，与坐/站两份 gesture 的 sourceHash 完全一致（站姿 `-248f57f7`+`6b63f08c` → `db70a8096b63f08c` 同样一致）。`Util.hashHex` 之前只是剥字符 → 永不命中，只能靠 `_hasPoseBones` 兜底。已按签名解析修正，**AUDIT 旧文「sourceHash 可能对不上」这条作废**。
8. **FX 名一次回复重摇两次**。setEmotion 与 setTalking 都会 `_syncFx`，`effectSets` 每次重新加权抽 → 同一句话腮红/泪可能换配方。现在 `_effectNames` 按 `emotion|intensityBand` memo；`_syncFx` 的 key 去掉说话标志。
9. 小修：`samePartDetourDirection` 在 `armInOutPartConfig` 里（之前读 projectConfig 顶层，永远 fallback 'up'，与源值巧合同款）；followers `scale` 缺失时 NaN 防护；口型 `.env.json` 优先于实时 RMS（预录语音用作者包络）。

**App 侧连带**：TTS 失败/无音频不再把 `setTalking(true)` 卡死（说话改在音频就绪、`playUrl` 真正开播时才进 strong 档）；序章旁白改走 `App.playFile(src, null, true)`（吃口型 analyser、语音开关不吞序章）。

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

1. 标题/语音钮是画布演出，不是官方 Lottie 运行时（包内没有运行时）
2. `spine/objects/` 仍只有图集、没有完整 skel

**明确不做：** 登录/Firebase、付费墙、代币、体力、皮肤内购、每日登录、远程资源门、公告、强制更新、分析、官方 marionette websocket。

**做不到像素级、屏幕要在：** 委托正文、教程对白 — 本地池 / 玩家 LLM。
