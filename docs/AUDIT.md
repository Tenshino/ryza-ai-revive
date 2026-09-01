# 实现核对（相对源 APK v1.0.2）

日期：2026-08-31（音景与源包两首 BGM 对齐；腮红 Normal；Physics 单次 update）
增补：2026-09-01（动作抽动与不自然：注视/指针/张力/眨眼/重掷加权/hash；见 §3.7）
增补：2026-09-02（**游戏系统补全**：GameState/体力苹果/主线 8 段/每日登录/背包/NPC
上下文；桌面壳换 Electron 无边框；点击热区修复。见 §6；§5 的「不做」清单已改）
增补：2026-09-03（**点击退出平滑 + 热区精确化**：§3.9；死代码清理；
exe/APK 统一重出 1.2.3（含 TTS 端点/密钥分离，见 §6.9））
增补：2026-09-04（**全视口布局 + 桌面等比缩放 + TTS 模型字段**：§7，重出 1.2.4）
增补：2026-09-05（**模式化 TTS 提示词 + 气泡自动淡出**：§8，重出 1.2.5）
增补：2026-09-06（**姿态/相机/表情补全**：§9，重出 1.2.6；§3.2 的镜头行已改写）
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
| `talk_screen` | 模式、气泡打字、日志、重置、输入条 | 五种模式（`#sheet-mode` 底栏 sheet，HUD 药丸只是当前档显示）+ 气泡打字（typing 指示）+ 回忆日志 + `talk.newTalkConfirm` + 输入条 + 对话页 glow 背景 | **对** |
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
| 镜头高度 | JSON 的 zoom/pan | 视野高度先按 `1720 / (zoom/1.93)` 取**表里的**值，再被 `_coverFor` 钳进场景美术的绘制框（§9.2）；ASMR panY 仍按表抬向脸部，双姿态舞台再对齐视线 |
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
10. **说话不再重摇表情**（2026-09-01 二批）：normal↔strong 的 `expressionSets` 在 9 个情绪里有 7 个内容完全相同（只有 shy/tease 不同），按强度档重抽 60 个 set 是抖动不是源行为。`setTalking` 现在只在两档集合真的不同时才 `_applyFace`。
11. **说话时看向你（gazeEntries）**：每个情绪×band 的 `gaze.gazeEntries` 都是 `{direction:lookAtUser, holdSeconds:3.0, speed:normal, weight:1}`，配合 `gazeReturnToFront.entry`（0.4–0.8s）。之前完全没读。现在 `setTalking(true)` 锁正脸 3 秒（转台时长按 gazeReturnToFront），到点后环境注视循环自然恢复。
12. **rollFollowSpeed:5.0**：DriverDefs 每条都有 —— 头部滚转对 yaw/pitch 应有独立指数跟随（滞后显得"活"）。现在 `look.roll` 经 `_rollSm` 滤波后才进骨骼与注视历史。
13. **站/坐（`_01`↔`_99`）什么时候切**：唯一开关是场景 JSON 的 `midgroundPostures`。实测 200 组场景：196 组只有 posture_sitting，**只有 stage_01_002_01 四个时段同时列了 posture_sitting + posture_standing**。旧代码取 m[0] → 站姿骨骼 `crf_skn_002_0001_99` **在游戏中永远不会被加载**。现在双姿态舞台顶栏出现「坐下/站起」chip（#btn-posture），选择记 `state.posture`（仅该场景生效），换姿走 skin-veil + loadSkin（镜头 zoom 1.93↔1.45 同表切换）。
14. **touch_ripple_overlay.dart（源模块，已补）**：点击立绘在触点画 86px 金色波纹环（0.7s），与 tap SE / 反应语音同时。之前只接了 tap_voice，落下了这个 overlay。

**App 侧连带**：TTS 失败/无音频不再把 `setTalking(true)` 卡死（说话改在音频就绪、`playUrl` 真正开播时才进 strong 档）；序章旁白改走 `App.playFile(src, null, true)`（吃口型 analyser、语音开关不吞序章）。

### 3.8 注视/指尖跟随的瞬变平滑（2026-09-02 已修，不要退回去）

用户报告「某些特定位置卡模型→重影」。扫掠回归定位到**三个单帧瞬变源**，全部收口到一个机制：

1. `fingerTrackHeadThreshold=0.11 / BodyThreshold=0.3` 是硬门：指针距离比跨过
   门槛的那一帧，head 目标从 0 跳到 `dx*0.7`（≈40 单位）、body 跳 `dx*0.55`
   （≈85 单位）。→ `Avatar._ptrRamp(n, thr, sc)`：门槛 ±40% 窗口 smoothstep 渐入。
2. **eye↔head 驱动增益**（`eyeK/headK` 0.18↔1）在 `_pickLook` 换驱动时单帧切换，
   大 yaw 下头目标跳 ~50 单位。
3. **followers[].delay 随驱动改变**：`_lookAt(delay)` 采样历史，delay 从 0.4→0
   等于一次性追认 ~0.35s 的注视运动（≈48 单位/帧）。

修复：`_applyLook` 改为「先算每根骨骼的**目标偏移**（ambient×gain×unit + finger×ramp×_ptrW×mul），
再经 `Avatar._aimSm` 逐骨骼指数平滑（τ=0.12s）施加」；NaN 目标直接跳过不污染平滑器。
单点平滑覆盖所有输入瞬变源（含以后新增的），不再逐处打补丁。
回归：`motion_regression.js` 新增「指针径向扫掠（10s 出+10s 回，越 1.05×maxR 钳位边）
+ 60s 环境驱动重掷」，断言 `_aimSm` 每帧变化 <12u——实测两姿态 10.0/10.3u 通过。
**注意**：断言对象是 `_aimSm`（注视系统自己的输出），不是骨骼位置（含动画基底，
idle 重掷本身有合法位移，别改回测骨骼）。

### 3.9 点击退出平滑 + 热区精确化（2026-09-03 已修，不要退回去）

用户报告「切换到非点击状态突兀」「点其他区域也触发」，后追加「连续点击衔接变差」。
根因全部实测定位（`motion_regression.js` 新增 4 组守门断言）：

1. **误触主因不是半径兜底**（那半确实删了）：`poke(null)` 旧代码有
   `list = reactions` 兜底——没命中部位也随机放反应；App 层无条件画波纹/播 SE/振动。
   现在：`hitPartAt` = **BB_\* 多边形 ∩ 可见轮廓**（`_onCharacter` 逐槽
   Region/Mesh 世界顶点 point-in-poly），多边形按
   `_PART_PRIORITY`（head>breast>weast>arm_l>arm_r>body，作者盒子互相覆盖）取
   最specific者；miss 一律 null（骨根半径 140/220 兜底**已删**，别加回来）。
   App 只在命中时才有波纹/SE/语音；`poke` 只认映射到该 PartName 的反应。
   实测：BB 盒中心 4/6 落在轮廓内（手臂盒本来就画得比手臂大——这是作者数据，
   断言只锁「盒内∧轮廓内⇔可命中」的一致性，不锁数量）。
2. **退出两段弹**：肢体层（8–14）旧时在 track 6 淡出**完全结束后**才还原，
   身体先落到裸 idle 再被叠层拽一次。现在 `_pokeUnmuteReady()`：淡出到 60% 即
   开始还原，`_lookMul`（注视/指针跟随增益）同一时机、τ=0.3s 回升——所有量
   一次收敛。
3. **手臂鞭甩**：7 条 `motion_touch_A_*` 的**结束帧停在动作中途**（末帧 vs idle
   实测位移 170–490u），固定 0.3s 淡出＝手臂 ~1600u/s 抽回去。现在
   `_pokeExitMix(anim)` 按末帧位移线性放大淡出（源 `tapReactionExitMix=0.3` 是
   **下限**，上限 0.65s；每 clip 缓存）。实测 001→0.43s、005→0.46s。
4. **指针参考摆动**：`_applyLook` 的 finger-track 偏移量是「光标 − face 骨骼
   当前位置」，反应动画把脸拖走时偏移跟着甩、退出再甩回来。现在一次性动作期间
   参考点冻结（`_faceRef`），几何不随动画摆。
5. **连点衔接**：源 `tapReactionEnterMix=0`（首发瞬切，保留）；但新反应叠在
   仍活跃/淡出中的旧反应上时**瞬切＝从动作中途硬跳新 clip 首帧**（用户报告的
   「连续点击不流畅」）。现在 `_trackBusy(6)` 时改用 0.15s 交叉淡化。

回归断言：`tap hit-test`（轮廓门控+miss→null+角点 null）、`poke exit: single
settle`（淡出 70% 处肢体已还原且 `_aimSm` 每帧 <25u）、`tap chaining`
（rest→cut-in / overlap→crossfade）、`tap exit mix scales`（005>001、区间钳制）。

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
3. 闹钟仅前台
4. ~~鼠标注视特定位置卡模型/重影~~ **【2026-09 已修，见 §3.8】**
5. ~~【新·待修】点击反应结束回待机略突兀~~ **【2026-09-03 已修，见 §3.9】**
   （肢体层还原与 `_lookMul` 已重叠进淡出、退出时长按末帧位移放大、
   指针参考冻结；`motion_regression` 有 single-settle 断言守门）
6. ~~【新·待修】点击区域判定太粗~~ **【2026-09-03 已修，见 §3.9】**
   （BB_\* 多边形 ∩ 可见轮廓，miss→null，半径兜底已删；
   `poke(null)` 不再兜底放随机反应；App 只在命中时出波纹/SE）

7. ~~【新·待修】塔奥家门前（stage_01_002_01）黑边 / 切换姿态背景跳位 / 默认姿态错~~
   **【2026-09-06 已修，见 §9】**（板内钳制相机 + 姿态无关的背景窗口 + 视线对齐；
   `motion_regression` 有 300 组「舞台×视口×姿态」钳制断言守门）
8. ~~【新·待修】ASMR 档独有表情几乎不触发~~ **【2026-09-06 已修，见 §9.4】**
   （周期性表情重掷 + `expression_coverage.js` 全量核对）

**明确不做（官方服务端/商业能力）：** 登录/Firebase、订阅付费墙、代币/回合票购买、
皮肤内购、远程资源门、公告、强制更新、分析、官方 marionette websocket。
**2026-09-02 起「体力」「每日登录」移出此清单**——按用户决定作为玩法约束本地实现，
付费解除换成设置里的作弊模式（§6.6）。

**做不到像素级、屏幕要在：** 委托正文、教程对白 — 本地池 / 玩家 LLM。

---

## 6. 游戏系统补全（2026-09-02）

### 6.1 证据：源包里到底有什么

`data/libapp_strings_ascii.txt`（AOT 快照字符串）里游戏系统的键名是完整的：

| 键 | 含义 | 落地 |
|---|---|---|
| `exp_total`、`stamina`、`money_delta` | 数值态 | `Game.s.exp_total/stamina/money` |
| `stamina_delta` | 体力增减事件 | `applyDelta.stamina_delta` |
| `inventory_added/removed`、`ryza_inventory_added/removed` | 双背包事件 | `applyDelta` 双列表 |
| `states.inventory/ryza_inventory/memory/met_charas/met_pairs/quest_desc/quest_complete/quest_activity` | `GameStates.fromJson` 的字段 | `Game.s` 同名字段 + 提示词注入 |
| `staminaMaxForExpTotal`、`staminaAppleFills`、`StaminaAppleRow`、`stamina_apple_*.svg` | 苹果条体力、上限随总经验 | `Game.apples()/max()` |
| `dynamic_quest{_type,_goal,_obstacle,_cost,_no}`、`need_quest_gen`、`quest_pending_advance`、`quest_step_changed`、`quest8_goal/earned`、`talk.quest.title/active/cost/costValue/complete/empty/summary/button`、`talk.questClear.praises.0..2`、`audio/se/se_quest_clear.m4a`、`quest_clear_ef/icon.svg` | 动态任务 + 完成演出 | `quests.js` 全套 |
| `dailyLogin.title/subtitle/cta/progressLabel/nextGoal*/weekday.mon..sun`、`5日連続ログインで報酬獲得`（ja 文案） | 每日登录 | `daily.js` |
| `talk.inventory.bag.small/normal/large/huge`、`talk.inventory.you/ryza/emptySlot/title`、`talk.initialGameState.ryzaInventory` | 双背包 + 四档容量 | 背包面板 + `BAGS` |
| `onboarding.tutorialTalk.drama1.explain*` + ja 原句（`画面の見方を説明するね`、`無くなると気絶しちゃうから 気をつけて`、`安全な場所で寝ると回復するよ`、`手に入れたアイテムは ここにしまわれるよ`、`この世界のお金だよ`、`クエストを進めてみて`、`まずは船を手に入れて`、`船で自由に旅へ出よう`） | 教程/序章文案 | `onboarding.js` TUTORIAL 重建 |
| 图标 `cauldron/shop/hud_coin/fire/bag/present/quest_map_ai/asterisk/lock` | 任务类型/金币/奖励/锁定 | HUD 与任务卡图标 |

**没有的**：官方任务表正文、数值曲线、等级表——都在 `/v1/masters`（服务器）。
所以「形制照抄、数值本地定」，定值全部列在 §6.3，不许当成官方数值传。

### 6.2 结构（高内聚低耦合）

- `game.js`：唯一的状态存储 + reducer（`applyDelta` 全钳位，敌意输入打不崩——
  回归里有 `-1e9/+1e9/垃圾类型` 用例）。不认识任务，`quest` 块转发给 `Quests.onQuestDelta`。
- `quests.js`：任务生命周期 + 离线行动表 + 动态生成 + 完成演出 + Welcome 瓦片。
- `daily.js`：连续登录。奖励只通过 `Game` 发放。
- `api.js`：只认协议（拼提示词、剥 `<state>`），不认识玩法。
- `app.js`：编排层。上下文注入 = `Game.promptBlock + App._peopleBlock + Quests.promptBlock`，
  人物块由 App 拼（World 的名字表只有 App 会同时拿到 World 和 Game，模块间不互相 import）。
- 事件：`Game.on(cb)` 单向广播，HUD/面板只读不写。

**2026-09-03 整理**（为后续加内容腾结构）：删除全仓零引用的死函数
`Avatar._measure/_mixFor/_idles`、`Daily.cheatSetStreak`、`Welcome.allDone`、
`World.stagesInArea/hasScene`（`backgroundFor` 有 8 处引用，保留）、
`Avatar` 的 `_addGroup/_torsoGroup/_legGroup/_legLGroup/_legRGroup` 遗留字段；
TTS `language_type` 映射收口为唯一出口 `Langs.ttsLangType`
（api.js 不再直读 `I18n.TTS_LANGS`，该导出已删）。
`motion_regression` 的 poke 出口条件与 `_loop` 共用 `Avatar._pokeUnmuteReady()`，
不再两处各写一份。

### 6.3 本地定值（≠ 官方数值）

- 等级 `1+⌊√(exp/30)⌋`；体力上限 `50+10×Lv`（≤140）；苹果 5 格。
- 每轮对话体力：文字 1 / 语音 +1 / 物語・没入 2 / ASMR 3。
- 背包 6/12/24/40 格；扩容 150/600/1500G。
- 主线 8 段的目标/消耗/奖励、采集表、配方、战斗概率、店铺价、出航 200G。
- 每日奖励 7 档（第 5 天里程碑按源文案）。

### 6.4 与源流程的对应与偏差

- 官方：状态服务器权威（`appserver_progress`、`GameStateAuthorityMirror`、
  `AppServer response game_state cursor mismatch`），LLM 走 marionette/yorisoi
  websocket，`*"Stamina"*` 等内联样式段。
  **本地**：localStorage 权威；玩家自填 OpenAI 兼容接口；机器块换成回复尾部
  `<state>{json}</state>`（显示/朗读前剥除）。协议在系统提示词里给了白名单和
  「无事发生不要发」约束，实测弱模型漏发/错发时 reducer 钳位兜底。
- 官方任务推进主要靠 LLM 回包；本地双通道（LLM `<state>` + 离线行动按钮），
  talk 类同轮不双计（`app.js say()` 里判 `reply.state.quest`）。

### 6.5 UI 修复（截图走查发现，全部有回归截图）

1. **顶栏换行压视图头**：单行 topbar 塞 7 个 chip 在 420px 下换行，盖住
   view-head 与气泡 → 拆成 `#topbar` + `#subbar` 两行定高，视图统一
   `padding-top: var(--bars-h)`；chip `nowrap+ellipsis`，长地名收缩。
2. **视图透明底**：非对话视图原本透出立绘，文字打架 → `.view:not(#view-talk)`
   加暗底（源各 screen 独立页的观感）。
3. **气泡层吃掉点击**：`#bubble-wrap` 是 `pointer-events:auto` 的全宽 flex 容器，
   挡住立绘上半身热区（点击无波纹/无反应）→ 改 `pointer-events:none`。
   验证：点击脸部 → 捂嘴反应动作 + 金色波纹环（`tap2.png`）。
4. toast 从底部移到顶栏下方（源 `top_toast.dart`），每日登录提示延后 3.2s 错峰。
5. 标题页 `body.boot` 隐藏 chrome，但 Electron 的 `#winctl`（📌/—/✕）保留，
   否则无边框窗在标题页关不掉。
6. 日历格苹果图标被通用 sepia 滤镜染绿 → `src*='apple'` 豁免 `filter:none`。

### 6.6 作弊模式（用户拍板的付费替代）

设置→游戏性→`app.cheat`：体力无限（不掉晕、行动不扣）、每日登录七格随便领、
背包满不挡路；配套按钮「全恢复」「解锁世界地图」。默认关，随时可关回去。

### 6.7 打包与隐私

- 桌面：Electron `frame:false` + `setAlwaysOnTop('screen-saver')` 开关 + 顶栏拖拽；
  NSIS 安装/卸载走系统「应用和功能」，存档在 `%AppData%\RyzaChat`（卸载默认保留）。
  产物 `output/desktop/RyzaChat-Setup-1.2.4.exe`（612MB，含全部素材；
  win-unpacked 自检截图=标题页正常渲染）。
- 安卓：`AssetServer` 补 `/_proxy`（缺它手机端对话必 CORS 挂）、`config/*` 一律 404；
  去 androidx；`scripts/build_apk.ps1` 无 Gradle 直出签名 APK；正常安装/卸载。
- 隐私：包内**无** `providers.json`；`config.js` 默认端点中立化（不再内置个人地址）；
  `src/` 原型、`data/*.wav` 测试音频、`output/*.png` 截图已从仓库删除；
  keystore 目录 gitignore。1.2.4 产物内嵌文件逐包扫描：**零** `bmh05/token-plan/
  xiaomimimo/sk-*/D:\agent` 私人标识（`api.js` 内置的 `dashscope.aliyuncs.com` 是
  百炼**公共**默认端点，等同 api.openai.com，属功能必需，不是私人信息）。

### 6.8 回归

- `scripts/game_logic_regression.js`：体力/等级/苹果/价目、cheat、背包与扩容、
  `<state>` 解析→reducer、敌意输入钳位、**主线 1→8 全程通关到出航**、每日登录
  连续/重复领取、快照往返。
- `scripts/boot_smoke.js`：真实 `index.html` 的 id 集 + 真模块假 DOM 假 Avatar，
  App.init 全链路 + 渲染面（任务卡/日历/状态/设置表单）不抛错。
- `scripts/motion_regression.js`：立绘 60s×2 姿态 + §3.8 指针扫掠断言。

### 6.9 语言矩阵与内容本地化（2026-09-02）

- **四槽独立**：`app.lang`（界面）/ `voice.lang`（tap_voice/alarm/prologue 目录）/
  `llm.lang`（回复）/ `tts.lang`（朗读）。`Langs`（i18n.js）统一解析，auto 逐级回落。
  朗读≠回复时 `Api.translate` 先翻译再合成，显示文字不变。
- **提示词策略（用户拍板）**：persona 保持原版日文，只追加「## 出力言語（厳守）」段。
  实测 token-plan qwen 通道：标签行保留、正文按指定语言输出。
- **TTS 双提供商**：`openai`（MiMo 克隆，实测 200 返回 RIFF wav）；`qwen`
  （百炼 DashScope `multimodal-generation`，`language_type` 跟随朗读槽，
  音频 URL 走新增的 `GET /_proxy` 回拉转 blob——口型 analyser 需同源）。
  声音复刻 `voice-enrollment` 接受 **base64 data URI**（本地莱莎原声直接注册，
  无需公网托管）→ voice_id 自动填入。
  **实测边界**：Token Plan 个人版 key 在 dashscope 401（其条款亦禁止 API 调用），
  token-plan maas 主机无 TTS 模型（404）→ Qwen 槽必须用普通百炼 sk- key。
- **TTS 端点/密钥按 provider 分离（2026-09-03）**：qwen 用自己的
  `tts.qwenBaseUrl`/`tts.qwenApiKey`（设置页 Qwen 区块绑定这两个字段；
  baseUrl 留空回落公共 DashScope），openai 用 `tts.baseUrl`/`tts.apiKey`。
  切换提供商**互不残留**——此前两端共享字段，把 MiMo 的 URL/key 发给
  DashScope 会 401/404（用户担心的「跨端找不到」实际发生在这里，不是音色上）。
  旧配置一次性迁移：`Config.load` 里 provider=qwen 且 qwen 字段为空时
  把共享字段值搬过去。音色字段本来就分离（`qwenVoice` vs
  `presetVoice`/`reference`），voice_id 不会跨端串用。
- **参考音频跨端解析（已核）**：`tts.reference='assets/voice/ryza_wav/prologue_08.wav'`
  是页面相对路径，经三端同源 HTTP 服务解析：serve.py（web/ 根）、Electron
  （resources/web 根）、APK AssetServer（`assets.open("assets/voice/...")` →
  APK 条目 `assets/assets/voice/...`，pack 脚本对 web/ 整体加 `assets/` 前缀，
  映射一致）。ryza_wav 九个 wav 由 git 跟踪、随两包打包（APK 内已验证 9 个
  entry）；换机 clone 后文件仍在。`_fetchAsDataUrl` 失败只 toast
  「无法读取参考音频」，不崩。
- **命名硬规则**：人名/地名/物品名只用**源包内验证过**的官方译名。验证方法：
  从 APK 提取 `libapp.so`，Dart 双字节字符串是 **UTF-16LE** 存储——按两种对齐
  扫 CJK 串（`D:\agent\temp\apk-l10n\dump_ordered.py`，temp 会清，方法在案）；
  英文名直接扫 ASCII 串。已验证并入库：18 个繁中人名（萊莎/卡爾/塔奧/米奧/
  莫里茨/安佩爾/莉拉/羅密/賽莉/丹尼斯/科洛蒂婭/菲德麗卡/薩維里奧/迪安/多爾特/
  安娜/沃爾卡/古老）、27 个英文名、地名（庫肯島周邊地區/克萊莉亞地區/王都周邊地區/
  萊莎家/塔奧家門前/回復藥（草豆））、官方繁中教程句（點一下和萊莎聊天/點一下叫醒萊莎/
  這裡是萊莎的夢中世界 等）。**未验证的一律保留日文原名**——早期自行发明的
  尼梅德地方/冥界奥利姆/克劳迪娅 等已全部撤销。
- 出口收敛：内容文本只经 `I18n.tc/tf`、`World.npcName/placeLabel`、
  `Quests.titleOf/descOf/goalOf`，语言切换调 `App._relocalize()` 全量重绘。

---

## 7. 全视口布局 + 桌面缩放 + TTS 模型字段（2026-09-04，不要退回去）

用户报告三连：①桌面缩小窗口后固定像素 UI 挤压/字溢出；②背景不铺满——
桌面宽窗口和手机异形屏都出黑边；③手机上把小米端点填进去报
「unsupported model tts-model」。

### 7.1 黑边与缩放的根因与修法

- 根因：`#phone{width:min(100vw, 100vh*9/19.5)}` 强制竖屏列，比例不是
  19.5:9 时两侧漏出 body 底色；UI 全固定 px，窗口变小不会缩。
- **`#phone` 现在占满视口**（`position:fixed;inset:0`）。Spine 相机本来就按
  画布宽高推导 world 宽（`worldW = worldH × cssW/cssH`），场景美术覆盖任意
  比例（340×560 / 393×851 / 900×380 / 1000×700 截图验证无黑边）。
- **桌面等比缩放**：`App._fitUi`（仅 Electron，`window.ryzaShell` 门控）设
  `#phone` 的 CSS `zoom = clamp(min(vw/420, vh/860), 0.8, 1.25)`。
  ⚠ 必须用 `innerWidth/innerHeight`，**不能**用 `#phone.clientWidth`——
  clientWidth 被 zoom 除过，会形成反馈在 z 与 1.0 之间来回震荡。
- **坐标换算**：`Avatar._cssZoom(el) = rect.width/clientWidth`（自测量，
  对新旧 zoom 语义都成立；Edge 实测 0.814/0.800 与设定值精确一致）。
  所有 `clientX-rect.left` → 布局 px 的换算（注视指针 `_bindPointer`、
  点击 `hitPartAt`/波纹）一律除以它；画布 backing store 的 dpr 乘它。
  Android/浏览器 zoom 恒 1，走流式布局。
- kbd.js 删掉 9/19.5 宽度钉（公式已不存在）；`.sheet` 加
  `max-width:min(600px,100%);margin:0 auto`（宽窗口可读性）。
- **Android 刘海**：manifest activity 补
  `android:windowLayoutInDisplayCutoutMode="shortEdges"`（API27+，旧系统忽略）。
  没有它，刘海机型在 NoTitleBar.Fullscreen 下被系统垫黑边——与 web 布局无关，
  是黑边问题在手机端的另一半。viewport-fit=cover + env(safe-area) 顶栏内边距
  此前已就位。

### 7.2 手机端 TTS「unsupported model tts-model」

- 根因：**设置页 openai TTS 区块没有模型名输入框**。`modelClone/modelPreset`
  平时靠 `config/providers.json` 水合填真值，但打包壳里 config/* 一律 404
  （隐私设计），手机端永远停在占位符 `'tts-model'/'voice-clone-model'`，
  原样发给小米端点 → 服务端回「unsupported model」。
- 修复：clone/preset 两模式各加一个「模型名」输入框（绑
  `tts.modelClone`/`tts.modelPreset`）；`Api.speak` 对空/占位符模型本地拦截，
  抛 `NO_MODEL` → 走 `toast.needModel`（「请先在设置里填写 TTS 模型名」，
  zh/zh-tw/ja/en 有词条，其余语言按 `I18n.t` 回落 en）。
- **手机端 TTS 可用配置**（小米 MiMo 为例）：提供商=OpenAI 兼容、
  接口地址=你的小米端点、API Key、模式（克隆/预设）下把**服务端给的模型 id**
  填进新出现的「模型名」框；参考音频默认指向包内
  `assets/voice/ryza_wav/`（wav 已在 APK/exe 内，无需公网）。

---

## 8. 模式化 TTS 提示词 + 气泡自动淡出 + 轻量整理（2026-09-05，不要退回去）

用户三连：①ASMR 模式的 TTS 没有 ASMR 感——所有模式共用一条 `tts.styleHint`，
LLM 的模式提示词（MODES）只进了文字生成，TTS 引擎根本看不到；②顶部回复气泡
显示后永不消失、背景近不透明，挡住身后的莱莎；③要求高内聚低耦合轻量整理。

### 8.1 模式化 TTS 语音指导（api.js）

修复=三层机制：

1. **`MODE_TTS`**（api.js，与 MODES 并列、故意分开）：每模式一段日文
   「怎么说」指导（story=讲书人节奏、immersive=耳边低语留白、
   asmr=耳语/低速/气声/长停顿）。`ttsStyleFor(mode, tts)` = 用户的
   `styleHint`（「谁在说话」）+ 模式层；`tts.modeHints[mode]` 可整段覆盖
   某模式（设置→导入/导出 JSON 里填，UI 不占格子）。
2. **通道映射**：openai/MiMo 路径=合成后的风格串发给 user 角色消息；
   qwen 路径=仅 `qwen3-tts-instruct-*` 模型加 `input.instructions`
   （官方文档：flash/vc 不接指令，`/instruct/i` 判定后才加。
   参考 help.aliyun.com/zh/model-studio/qwen-tts-api 的 input.instructions）。
3. **`MODE_PLAY_FX` 播放整形**：端点不吃指导时（flash/vc/未知 MiMo 行为）
   ASMR 仍有保底=播放 0.93× 速 + 0.82× 音量，沉浸 0.97×/0.95×。
   `App.playUrl(url, fx)` 带可选 fx，onended 复位 playbackRate。

`Api.speak(text, lang, mode)`：mode 缺省读 `state.mode`；App 侧 `speakThen`
显式传模式。**ASMR 想要明显效果：Qwen 槽选 `qwen3-tts-instruct-flash`。**
回归：boot_smoke 新增 7 断言（chat=纯基底、asmr 叠加耳语层、modeHints 覆盖、
播放整形存在、占位符检查收口、气泡定时器装填/取消）。

### 8.2 气泡生命周期（app.js + css）

- `App._bubbleHold(ms)` 装填淡出定时器 → `.fade-out`（CSS opacity/transform
  .45s）→ 520ms 后补 `.hidden`；`_bubbleKeep()` 取消（说话期间钉住）；
  `_bubbleReveal()` 复位显示。
- 时机表：打字完成后——无语音路线 5.2s 淡出；有语音路线由 `playUrl` 接管
  （开播 Keep、onended 1.6s 后 Hold），另加 12s 兜底（TTS 永不回包时）；
  `showBubble`（问候/任务台词/闹钟）6.5s。
- 透明度：背景 alpha .9→.52 + `text-shadow` 保可读；blur 12→10px。
- **没动的**：`#bubble-wrap` 依旧 `pointer-events:none`（立绘热区依赖它，
  HANDOFF 坑 12）；`app.showBubble` 开关依旧一票否决；淡出只作用在
  `#bubble` 本体。截图验证：出图 shots/bubble-shown.png / bubble-faded.png。

### 8.3 轻量整理（配合「以后加内容」的边界）

- **收口重复**：占位符模型检查手写两处（api.speak / _testTts）→
  `Api.isPlaceholderModel()` 唯一出口。
- **修不合理**：`App.esc` 名为转义实为 `String()`，任务标题（LLM 生成）
  经它进 innerHTML → 改成真 HTML 转义（& < > " '）。
- **删零引用死代码**（全仓 grep 核过）：`Avatar._aimRest`、
  `Onboarding._qs` 导出、`app.pet` 配置键、`.caret` CSS + 其 keyframes。
  其余「疑似零引用」全部核实为动态取用（`Quests['act_'+type]`）、
  内部局部名引用（REWARDS/CHAIN/BAGS）或对象表键名误报——**没删**。
- DOM id 交叉核对：JS 引用的 id 除 onboarding 动态生成的 6 个（自建自取）
  外全部存在于 index.html；index.html 无未引用孤儿 id。

产物：exe/APK 统一重出 **1.2.5**（版本号三处同步：desktop/package.json、
build_apk.ps1 `$Ver/$VC=8`、android Gradle）。

---

## 9. 姿态 / 相机 / 表情（2026-09-06，本轮，不要退回去）

用户报的三件事——塔奥家门前能切坐站但**有黑边**、**切换后背景换位置**、
**默认站立和坐立模型搞反**——加上后续实测的「换场景后出现放大的坐姿模型」
「横屏任何模型都有黑边」，根因全部实测定位。§HANDOFF 里那份「只调查未实施」
的结论有两条是错的，下面以**原始数据 + 浏览器实测**为准。

### 9.1 皮肤↔姿态：数据是清楚的，错的是默认值和标签

`crf_skn_002_0001_01/crf_skn_002_0001_01_gesture.json` 与 `_99` 各自带
`projectConfig.postureKey`，这是权威：

| 皮肤 | `name` | `projectConfig.postureKey` | 观感 |
|---|---|---|---|
| `_01` | 座りライザ（普通座り） | `posture_sitting` | 赤脚、背心+短裤、腿骨折叠 |
| `_99` | ライザ(3の通常)_立ち | `posture_standing` | 黄外套+长袜+靴、腿骨直筒 |

所以 `resolveSkel` 的 standing→`_99` **从来就没反**。真正反的是三处：

1. `config.js` 的 `state.posture` 默认 `posture_sitting` → 原版开局是站姿，我们开局是坐姿。
   **已改**：默认 `posture_standing` + 旧存档一次性迁移（`state.postureMigrated`）。
2. 姿态 chip 用的是**状态语义**（站着显示「立つ」），玩家读成「按下去才站」→
   按了变坐，就成了「模型搞反」。
   **已改**：`app.js` 用**动作语义**——站着显示 `posture.sit`（座る/坐下），坐着显示 `posture.stand`。
3. `postureKey()` 旧逻辑「场景只列一个姿态就取 m[0]」，而 200 组场景里
   **196 组只列 `posture_sitting`**（`sofa_root` 那类中景家具是按坐着画的）。
   拿它当皮肤约束，等于全游戏永远穿 `_01`——这就是「改了默认还是坐着」的直接原因。
   **已改**：`midgroundPostures` 只决定**哪里提供切换**（`supportsBothPostures()`），
   不再决定穿哪套；其余场景走默认站姿。

补充（用户复现的第二轮）：离开塔奥家门前**换场景先出现坐姿、再换一次才恢复站立**。
两个独立成因，都已修：

* `App._loadSceneFor` 的姿态复位跑在 `loadScene` 回调里，而皮肤在回调之前就已经按
  `postureKey()` 解析完了 → 复位晚了一整个场景。现在 `postureKey()` 自己 gate
  （非双姿态场景直接返回 standing），复位只负责把存档值写干净。
* `loadScene` 会先 `resize()` 重算相机、**之后**才 `loadSkin()` 换骨骼，中间那一帧
  用「新姿态的相机」摆「旧皮肤」→ 坐着的网格被按 `_99` 的 `scale 1.488` 放大，
  就是用户看到的「放大的坐着」。现在 `_placeCharacter`/`_applyCamera` 一律按
  **屏幕上实际是哪套皮肤**（`_loadedPosture()`，从 `_loadedSkelId` 读）取相机参数。

### 9.2 黑边与背景跳位：把相机钳进美术的绘制框

实测（真浏览器、真图集，420×860）：

| | 站姿 | 坐姿 |
|---|---|---|
| 相机窗口（世界 Y） | −57 … 2232（高 2289） | 359 … 2079（高 1720） |
| `far_bg` 绘制区 | 629 … 2701（高 2072） | 同左 |
| `floor` 绘制区 | −2701 … −1064 | 同左 |
| 露出的未绘制带 | **底部 686u（屏高 30%）** | 底部 270u（被输入条挡住） |

关键事实：塔奥家门前的美术**不是一张全覆盖图**——`far_bg`（屋内石墙/炉子/大锅）
和 `floor`（前景木地板）之间 **1693u 是空的**；而且站姿窗口高 2289 **比整块
`far_bg`（2072）还高**，所以「往哪挪都不黑」在这个舞台是不可能的，只能收缩窗口。
横屏是同一个洞的另一半：`worldW = worldH × 画布宽高比`，视口一宽就走出美术左右边界。

修法（`avatar.js`，一处收口，不给每个舞台打补丁）：

* `_coverFor(L)`：**最大**绘制 quad 的世界框（不是并集——并集会把 `floor` 拉进来，
  假装中间那条空带是画了的），按骨架缓存，`_loadSpine` 时失效。
  * 忽略 `slot.color.a`：场景唯一的动画就是淡入，淡入中途量一次会把整块美术判空。
  * `RegionAttachment` 的四角缓存在**首帧绘制前**可能是空的（headless 下一定是空的），
    所以加了「附件尺寸 × 骨骼矩阵」的兜底框；没有这条，49 个单 region 场景永远测不出
    美术框，钳制对它们形同不存在。
* `_applyCamera()`：背景窗口取**场景自身姿态**（`_primaryPosture()`）的表内窗口，
  **只缩不涨**地塞进 `_coverFor`（`h = min(表内h, min(板高, 板宽/宽高比))`），
  再把上下左右钳进板内。窗口与玩家选的姿态无关 ⇒ **切坐/站背景一动不动**。
* `_placeCharacter()`：角色按 `k = 解出窗口高 / 表内窗口高` 映射进同一个窗口，
  所以她的**屏幕大小与屏幕位置仍是表里那套**，钳相机不会把她缩掉。

实测结果（同 420×860）：站/坐窗口都是 `629…2349`（完全一致），露出区 0；
900×420 横屏同样 0；`motion_regression.js` 里 **50 舞台 × 3 视口 × 2 姿态 = 300 组
解算全部落在绘制框内**，这是「黑边」的总闸门。

### 9.3 视线对齐（站立相机数据与 shipped 美术不匹配）

`posture_camera.json` 把**坐着**的头画在窗口 0.70 处（所有家的场景都按这个构图），
却把**站着**的头放在 0.37（ASMR：坐 0.49 / 站 0.10）——站姿那组是照更高的一块底板调的，
配这块美术就变成「人沉在画面底部 + 底下全黑」。所以：

* 只挪**垂直位置**，`scale`/`zoom`（她和房间的相对大小）一个数字都不改；
* 目标线：普通镜头 0.68、ASMR 特写 0.50；
* **偏差超过 0.10 才动**，所以 196 个单姿态场景的既有构图原样保留；
* 头的局部高度从骨架 setup pose 现算（`_measureHeadLocal`），不按舞台写死。

实测：塔奥家门前站 268px / 坐 270px（同一视线），切姿态不再上下滑；
轮廓顶端两姿态都是 −55px（和原来坐着的取景一致，不是新引入的裁切）。

### 9.4 表情：把被当成 bug 删掉的 ASMR 触发找回来

先说结论：**9 情绪 × 3 态度 × 3 强度档全部可达**，`scripts/expression_coverage.js`
（本轮新增，第四套回归）逐条核对：

| 皮肤 | expressionSets | 作者显式 `weight:0`（=关掉） | 每档有效 set |
|---|---|---|---|
| `_01` | 1646 | 0 | normal 622 / strong 622 / weak 402 |
| `_99` | 322 | **30**（全在 happy/weak 18、tease/weak 12） | 108 / 108 / 76 |

* `weight` 是**可选**字段：不写=1，写 0=作者禁用。旧 `_pickExpr` 的兜底
  `live.length ? live : sets` 在「整档都被禁用」时会把禁用过的脸放出来；
  现在返回 `null`，由 `_applyFace` 退回该档的 `eyeBase/eyebrowBase/mouthBase`。
* 用户说的「不小心把 ASMR 的一个表情当 bug 删了」= AUDIT §3.7 第 10 条
  「说话不再重摇表情」的副作用：`_intensityBand()` 在 ASMR 下只在**不说话的间隙**
  才是 `weak`，而 `weak` 独有的口型（`facial_mouth_010` / `_015`，即 HANDOFF 说的
  「鸡嘴」）只有换表情时才可能出现，于是几乎永远看不到。
  源包 AOT 里有 `IntensitySettings.ExpressionRerollMin` 和
  `expressionRerollIntervalMin/Max` 这两个字段名，但 JSON 里**没有值**
  → 按「源里有就用源的、没有就按常理」：在姿势重掷的同一 tick（5–8s）
  `_rerollIdle` 顺带 `_applyFace(false)`，且**只在没说话时**（不打断口型）。
  实测（坐姿皮肤、ASMR、各 300 次重掷）：neutral 出现 015、laughing 出现 010+015、
  tease 出现 010/011/012/015。
* 骨架里存在但数据不引用的只有 `_scrub_01` 口型变体（`_01` 3 个、`_99` 2 个
  `_scrub_02`）——源数据每情绪只指一个 `lipSyncScrubClip`，不是我们的漏接。

### 9.5 移植完整性：逐目录核对与「故意不用」的素材

按 `docs/dart_source_tree.txt` 的 22 个 `features/*` 目录（423 个 .dart 名）和
`docs/reference/apk_asset_inventory.txt` 的图片清单过了一遍。玩家侧可落地的
都已在 §2/§3/§6 判定为「对」；本轮补/查清的点：

* **序章背景**：包里 `images/onboarding_prologue_bg.png`（黄昏山坡海景）一直没被引用，
  我们的序章屏是自己编的径向渐变 + 一个占位圆圈。已改用真素材 + 压暗层，占位圆圈删掉。
* **模式名本地化**：源包有 `conversationMode.{chat,story,asmr,text,…}` 这套键，
  而 HUD 那颗 chip 之前是 `app.js` 里写死的 `{chat:'雑談',…}` → 英文界面也显示日文。
  已补 `mode.*` / `style.*` 七语键，模式 sheet 的按钮文字包进 `<span data-i18n>`
  （以前直接 `data-i18n` 会把图标 `<img>` 吃掉）。
* **闹钟**：`day_selector`（每周重复）、`speech_style_picker`（normal/whisper）、
  `volume_vibration_row`、`snooze_settings`、`alarm_time_picker`、`alarm_type_picker`
  在 `app.js _alarmForm` + `alarm.js` 里都已落地。
* **音量**：`volume_settings_dialog`（bgm/ambient/voice/se 四路）在设置页有。
* **故意不用**（下一轮别再当漏做去补）：
  | 素材 | 源里的用途 | 为什么不接 |
  |---|---|---|
  | `images/onboarding/roulette_*`（5 张）+ `_RouletteWheel` + 「ルーレットを回して」 | 付费墙前的**折扣转盘**（「最大59%の割引を永久にゲット」「ラッキー割引のチャンス」） | 订阅/付费，明确不做 |
  | `images/login_background_*.jpg`（6 语） | `features/auth` 登录页背景 | 登录不做 |
  | `paywall_banner*.png`、`special_offer_sparkles.svg`、`subscription.svg`、`tokushoho/tos/privacypolicy.svg`、`voicetoken_*`、`logout/link/report*` | 付费墙/法务/账号 | 同上 |
  | `images/talk_background.png`（虚化工坊） | 对话页底图 | 我们的对话页底是**每舞台的 spine 实景**，比一张虚化图更贴源；这张留着当备用 |
  | `nospine_chat_background.png` | spine 加载失败的兜底底图 | 失败走 toast；真要做兜底再接 |
  | `spine/objects/`（3 个物件） | 只有图集没有 skel | 加载不了（§3.2） |
  | `SittingSets` 里的 `sitting_agura` | 盘腿坐 | 权重 99999/0：**作者自己关了**，不是漏接 |

### 9.6 顺手修掉的真问题

* `audio.js fadeVolume`：rAF 回调给的是**帧起始时间戳**，可能早于取 `t0` 的
  `performance.now()` → `u` 变成小负数 → `el.volume = -0.002` 抛 `IndexSizeError`，
  淡入淡出循环当场死掉（环境音可能就此静音）。现在 `u` 和音量都钳到 [0,1]。
* `Quests.advance()` 是个没人调的死别名，注释还写着「reducer 用它」——reducer 入口
  是 `onQuestDelta`。删。
* `Avatar._fxNames` 只写不读，删；`poke()` 里绕过 `_pc()` 直接读 `projectConfig` 改成走 `_pc()`。
* `Avatar._findGroup()` 保留，但注释写明它是给 `motion_regression` 核对
  occupancy 字母↔轨道用的，运行时的选组入口是 `_pickLayerGroup`。
* `config.js` 头注释里写了原厂的接口域名，改成中性描述（`privacy_check.py`
  现在会因此把构建拦下来，注释里也说明了这点）。

### 9.7 打包：版本单一来源 + 隐私闸门

* `config/version.json`（`{"version":"1.2.6","code":9}`）是**唯一**版本源；
  `scripts/stamp_version.js` 把它盖进 `desktop/package.json` 与
  `android/app/build.gradle`，两个 build 脚本都调用它。以前是三处手改（AUDIT §8 末），
  最容易出「exe 和 APK 版本不一致」。
* `scripts/privacy_check.py` 是**构建闸门不是报告**：命中即非 0 退出，构建中止。
  查两类东西——① 路径名（`providers.json`、`*.keystore`、`*.pem`…）
  ② 文本内容（`bmh05`、`d:\agent`、`c:\users`、`token-plan`、`xiaomimimo`、
  `gospiral`、`api.craft.spiral`，外加 `sk-[A-Za-z0-9]{16,}` / JWT / Bearer 三个形状）。
  二进制扩展名只查名字不查内容，所以 570MB 素材树秒级过。
  调用点：`build_desktop.ps1`（暂存前 + `win-unpacked` 暂存包）、
  `build_apk.ps1`（打包前 + 签名后的 APK，按 zip 成员逐个查）。
* 卸载语义：NSIS `deleteAppDataOnUninstall:false`（存档留在 `%AppData%\RyzaChat`，
  要彻底清就用设置页的「抹除全部本地数据」）；APK 侧新增
  `android:hasFragileUserData="true"`（API29+ 卸载时询问是否保留数据），
  并且 keystore 必须复用——换 key 就不能原地升级，只能先卸载（丢存档）。

### 9.8 回归

四套，全绿才算改完：

```
node scripts/motion_regression.js      # + §9.1/9.2/9.3 的姿态·相机断言（含 300 组钳制）
node scripts/game_logic_regression.js
node scripts/boot_smoke.js
node scripts/expression_coverage.js    # 新增：表情/动作可达性与引用解析全量核对
```

---

## 10. 图集变体（NSFW）+ 按源表取景（2026-09-07）

源 APK **有**换装逻辑（`features/skin`：`SkinSwitchController` / `switchSkin` /
`skin_switch_veil` / 5 槽预览），但那是 **整包 skel+atlas 切换**，不是同一骨架
热换 PNG。包内可穿骨骼只有 `0001_01`（坐）和 `0001_99`（站）；`0002–0004` 只有
预览图。因此「LLM 在标签行写 `nsfw:on` 才换贴图」是**本地加的演出**，
不能接到源 `switchSkin` 上，否则会和 5 槽换装、坐/站后缀抢同一条 `loadSkin`。

### 10.1 模块边界（以后加别的服装的 nsfw 版只丢文件）

| 模块 | 职责 | 不做什么 |
|---|---|---|
| `web/js/nsfw.js` `Nsfw` | 画面着衣；`screenFact` 一行；只套用回复里的 `nsfw` 字段 | 不扫关键词、不写规则长文、不写服装 id、不碰 GL |
| `Avatar.variantPageUrls` / `setAtlasVariant` | 按**当前已加载皮肤**解析变体页并换 GLTexture | 不认关键词、不 reload skel |
| `api.js` | 标签行解析 `nsfw:on\|off`（与 emotion 同一行）；出力形式里写一次规则 | 不决定贴图 |
| `app.js` | `say()` 传入 `screenFact`，回复后 `Nsfw.onTurn(reply)`；新对话 `reset` | 不解析路径 |

路径约定（对任何 `crf_skn_*` 都一样，坐/站/未来 0002 通用）：

1. `skins.json` 的 `entry.variants[name]`（`build_indexes.py` 扫描 `{id}{tag}.png`）
2. 同目录 `{pageBase}{name}.png`（现有站姿：`crf_skn_002_0001_99nsfw.png`）
3. 同目录 `{pageBase}_{name}.png`

没有文件 → 保持默认页，**状态仍保持**；切到有文件的那套皮肤时 `loadSkin` 末尾
再 `_applyAtlasVariant`。变体加载走自己的 `Image`+`GLTexture`，**不**走
`AssetManager.loadTexture`（404 会脏 `errors`，下次 `loadSkin` 会误报素材失败）。

**谁决定脱衣**：LLM，不是关键词。方式与 emotion 相同——回复第一行
`[emotion:shy|nsfw:on]`，解析字段、台词里剥掉，不是扫「脱掉」也不是 OpenAI tools
（自填的兼容接口不一定有 function call，且会多一套协议）。省略标签＝画面不变。
`screenFact` 每轮告诉模型现在穿着还是已经裸着。新对话 `Nsfw.reset()`。

### 10.2 取景：源 APK 怎么做的（不要再缩小去塞全身）

源侧没有「fit full body」API。相机来自 `PostureCameraConfig` /
`web/assets/data/posture_camera.json`：

| | base zoom | ASMR zoom | scale | offsetY |
|---|---|---|---|---|
| sitting | **1.93** | **3.5** | 1.0 | +288.46 |
| standing | **1.45** | **2.5** | 1.488 | −346.15 |

ASMR 的 3.5 / 2.5 **就是包内原值**（约 1.8× 底栏），不是我们额外放大的。
`asmr.cameraPanY` ~3200 不能当本套 `worldH=1720/(zoom/1.93)` 的正交中心
（会把窗口架到骨架上头的空区），所以仍用朝脸的 pan 重映射；**zoom 本身按表**。

点击热区是 `BB_head / breast / weast / arm / body`——上半身，没有脚。
源取景保证这些部位在画面里，站姿脚被裁是表内构图，不是漏做。

曾加过的 `_fitFullBody`（按 setup 盒缩小到头脚都进画面）**已撤回**：人变小，
而且改写了 Y，塔奥家门前坐姿离开 `sofa_root` 像坐在空气上。

坐姿适配中景：场景 JSON **不**随坐/站换一份背景；同一套 skel 里有 `chara_root`
和 `sofa_root`。源符号 `chara_root_offset.dart` /
`_currentSofaRootCompensationOffset`。现：坐姿且存在 `sofa_root` 时，角色用
**世界坐标**（`offsetY + chara_root + Δsofa`），不再把 Y 经相机窗口重映射；
视差挪沙发时人跟着坐垫走。站姿仍走原来的 k 映射 + 视线对齐（0.68 / ASMR 0.50）。

黑边钳制（`_coverFor` / `_applyCamera`）不动。

### 10.3 回归

```
node scripts/nsfw_intent_regression.js
node scripts/motion_regression.js      # 坐姿锁沙发 + 变体 URL 与服装无关 + 300 组钳制
node scripts/boot_smoke.js
```
