# Ryza Chat — 离线同人陪伴 App

一个**自己写的、纯前端、不联网官方服务的同人 AI 聊天 App**。整套代码从零编写，
素材来自本地已有的资源文件。目标是：打开就能聊，LLM 与 TTS 接口由玩家自己在设置里填；
玩法与演出**按源项目的模块划分和原始数据重新实现**（没有 Dart 源码可抄）。

状态（2026-09-03）：**点击交互精修完成**——热区改为 BB_* 多边形∩可见轮廓
（点空白不再触发），退出点击态按末帧位移放大淡出并与肢体层/注视恢复重叠
（不再两段弹），连续点击交叉衔接；RPG 层已按源数据补全——游戏状态（体力苹果 /
经验等级 / 金币 / 双背包 / 相遇名单 / 记忆）、8 段主线任务（终点「造船出海」
解锁世界地图）、对话驱动的 `<state>` 数值增减、每日登录、体力耗尽与睡觉恢复，
全部本地实现；官方付费墙不做，改为设置里的**作弊模式**一键解除全部限制。
桌面壳是 **Electron 无边框窗口**（可置顶、无标题栏/边框），安装包与 APK
统一重出 **1.2.2**（`output/desktop/RyzaChat-Setup-1.2.2.exe`、
`output/android/RyzaChat-1.2.2.apk`）。
立绘动作与音景维持 2026-09-01 的修复结论（见 `docs/AUDIT.md` §3.7）。

本目录已 `git init`，作为防错改快照。`config/providers.json` **不要提交**（含 API Key）；模板是 `config/providers.example.json`。

下一轮接手：把 `docs/HANDOFF.md` 整份粘贴给下一个 Agent。

---

## 1. 技术选型与总体结构

```
projects/ryza-ai-revive/
├── web/                    # 应用本体（纯静态，无构建步骤）
│   ├── index.html
│   ├── css/app.css
│   ├── js/                 # 见 §2 逐文件说明
│   ├── vendor/spine-webgl.js  # Spine 4.2 官方运行时
│   └── assets/             # 素材（约 572 MB，与源 APK 一比一）
├── desktop/                # Electron 桌面壳（无边框窗 + 本地 HTTP + /_proxy）
├── android/                # WebView 薄壳（AssetServer 起 127.0.0.1:8765，含 /_proxy）
├── scripts/
│   ├── serve.py            # 静态站 + LLM/TTS CORS 代理（日常开发用）
│   ├── build_indexes.py    # 素材 → web/assets/_index/*.json
│   ├── motion_regression.js    # 立绘动作离线回归（node）
│   ├── game_logic_regression.js# 游戏系统离线回归（node，桩 DOM）
│   ├── boot_smoke.js       # App.init 全接线冒烟（真实 index.html 的 id 集）
│   ├── build_desktop.ps1   # Electron → NSIS 安装包
│   ├── build_apk.ps1       # aapt2/javac/d8/zipalign/apksigner 直打 APK（无 Gradle）
│   └── setup_android_tools.ps1 # 便携 JDK17 + Android SDK 装到 D:\agent\tools
├── config/providers.json   # 开发水合用（gitignore）；模板 providers.example.json
├── data/                   # 源包抽取产物（libapp_strings_*.txt）
└── docs/                   # 本文件、HANDOFF.md、AUDIT.md、reference/
```

**为什么是网页内核**：同一套 HTML/JS 跑在浏览器、桌面壳、Android WebView 里。

**运行方式**（Spine 与 fetch 不允许 `file://`；跨域 LLM 必须走代理）：

```bash
cd projects/ryza-ai-revive
python scripts/serve.py
# 打开 http://127.0.0.1:8765/
```

不要用 `python -m http.server`：没有 `/_proxy`，浏览器打官方兼容接口会 CORS 失败。

桌面开发：`cd desktop && npm install && npx electron .`
安装包：`powershell -File scripts/build_desktop.ps1` → `output/desktop/RyzaChat-Setup-<ver>.exe`
安卓：`powershell -File scripts/setup_android_tools.ps1`（一次性）后
`powershell -File scripts/build_apk.ps1` → `output/android/RyzaChat-<ver>.apk`

---

## 2. 代码路径逐项说明

### 游戏系统（本轮新增，源证据见 AUDIT §6）

#### `web/js/game.js` — GameState（源 `features/talk/models/game_states.dart`）

localStorage 键 `ryza.game.v1`。字段与 delta 键名**照抄 AOT 快照里挖出的线上名**：
`stamina` / `exp_total` / `money` / `inventory` / `ryza_inventory` / `quest` /
`memory` / `met_charas` / `met_pairs`；事件名 `stamina_delta`、`money_delta`、
`inventory_added/removed`、`ryza_inventory_added/removed`、`need_quest_gen` 等。

- `Game.applyDelta(obj, origin)` — 唯一写入口（reducer）。全部钳位：
  stamina∈[0,max]、money±2000、exp±500、条目 id 白名单化、数量 1–99。
- 体力：`staminaMaxForExpTotal`（源同名符号）→ `max = 50 + 10×Lv`；苹果条
  `apples()` 5 格（`stamina_apple_filled/empty.svg`，源 `StaminaAppleRow`）。
- 每轮对话消耗 `turnCost(mode, style)`：文字 1，语音 +1，物語/没入 2，ASMR 3。
  归零 → `faint()` → 对话页弹「気絶」overlay；睡觉恢复：家（`stage_01_001_04`）
  夜→朝切换、或 overlay 的「回家睡觉」按钮（源文案「安全な場所で寝ると回復するよ」）。
- 背包四档 `talk.inventory.bag.small/normal/large/huge`（源文案名）= 6/12/24/40 格，
  扩容花金币（官方内购的本地替代）。
- **作弊模式** `Config app.cheat`：体力无限、不掉晕、领取自由、背包不挡——
  官方「无限体力/无限任务」付费权益的本地开关，不花钱。
- `Game.promptBlock()` — 把状态写成日文段落，供系统提示词注入。
- `Game.on(cb)` 事件订阅（App 刷新 HUD）；`snapshot()/restoreSnapshot()` 进存档槽。

#### `web/js/quests.js` — 任务引擎（源 `quest_sheet.dart` / `quest_clear_detector.dart` / `mission`）

状态存在 `Game.s.quest` + `Game.s.flags.quest_log`。

- **主线 8 段**（重建依据：序章文案「一緒にお店を始めたり / 冒険したり / 調合して /
  まずは船を手に入れて / 船で自由に旅へ出よう」+ 埋点符号 `quest8_goal/quest8_earned`）：
  1 会話 → 2 探索（地图移动）→ 3 採集 → 4 調合 → 5 戦闘 → 6 店経営 → 7 造船材料×4 → 8 出航。
  第 8 段完成 → `Game.s.sailed = true` → 世界地图 area_02–05 解锁（`world.js` 的
  `World.locked()`，未解锁区域钉子挂 `lock.svg`）。
- **行动结算全离线可玩**：`Quests.doAction(type)` 用本地表（区域采集表、
  配方表、战斗概率=等级+道具、店铺卖价、船部件 4 件、出航 200G），
  没 API Key 也能推进任务链。
- **LLM 通道**：回复尾部的 `<state>{...,"quest":{step_add/complete}}` 走
  `onQuestDelta`；talk/explore 类任务由 App 事件推进（`progressEvent`），
  同轮已有 LLM quest 数据时不双计。
- **8 段之后 =「无限任务生成」**（源 `need_quest_gen` + 付费文案）：`Quests.generate()`
  让 LLM 出 JSON，失败回退本地池。
- 完成演出：`quest_clear` SE + 彩纸 + `PRAISES`（源文案）+ 奖励 exp/G + 记忆行。
- `Welcome`（欢迎任务五格）也住这里（源 `welcome_mission`，素材 `assets/welcome_mission/`）。

#### `web/js/daily.js` — 每日登录（源 `daily_login_screen.dart`）

localStorage `ryza.daily.v1`。`dailyLogin.weekday.*` 周一～周日七格日历条、
连续计数（断一天归零）、第 5 天里程碑（源文案「5日連続ログインで報酬獲得」）、
奖励全走 `Game`（体力/G/道具/exp/宝箱）。作弊模式下七格随便点。

#### `web/js/api.js` — LLM/TTS 传输 + RPG 注入 + 语言矩阵

- `buildSystemPrompt(mode, style, rpgContext, outLang)` — 人格提示词保持原版日文，
  只追加「## 出力言語（厳守）」段：回复语言 = `Langs.llm()`（auto=界面语言）。
  实测（token-plan qwen 通道）：中文指令下 `[emotion|attitude]` 标签保留、正文中文。
- `parseTaggedReply` 剥掉 `<state>` 块（含忘写闭合标签的宽容解析），
  返回 `{emotion, attitude, text, state}`；显示与朗读永远不含机器块。
- **TTS 双提供商**（`tts.provider`）：
  - `openai`：chat/completions + `audio.voice`（MiMo 克隆路径，实测 200 返回 RIFF wav）；
  - `qwen`：百炼 DashScope `POST /api/v1/services/aigc/multimodal-generation/generation`
    （`qwen3-tts-flash` / `-instruct-flash` / `-vc-2026-01-22`），`language_type`
    取自朗读语言；响应 `output.audio.url` 经 `GET /_proxy` 拉回转 blob
    （口型 analyser 需要同源）。**需要普通百炼 sk- key**——Token Plan 个人版 key 在
    dashscope 返回 401（且其条款禁止 API 调用），token-plan maas 主机不挂 TTS 模型（404）。
  - `Api.qwenCloneVoice()`：声音复刻——把 `assets/voice/ryza_wav/` 原声转 base64 data URI
    发 `voice-enrollment`（接口接受 data URI，无需公网托管），返回 voice_id 自动填入设置。
- `Api.translate(text, toLang)`：朗读语言 ≠ 回复语言时的翻译通道（同一 LLM，低温、
  只输出译文；失败原样返回）。显示文字不受影响。

### 语言矩阵（四槽独立，`Langs` 助手在 i18n.js）

| 槽 | 键 | 含义 |
|---|---|---|
| 界面 | `app.lang` | UI 文案（7 语） |
| 自带语音 | `voice.lang` | tap_voice/alarm/prologue 目录语言（auto=界面） |
| 回复 | `llm.lang` | 莱莎文字输出语言（auto=界面） |
| 朗读 | `tts.lang` | 语音合成语言（auto=回复）；与回复不同时先走 `Api.translate` |

**内容本地化（游戏数据层）**：i18n.js 的 `CONTENT` 表——物品/任务链/行动台词/怪物/
船部件/每日奖励/教程句，ja=源包原文，zh/en=重建译文。**人名地名硬规则：只用源包
验证过的官方译名**（2026-09 从 libapp.so UTF-16 串扫描挖出：萊莎/卡爾/塔奧/米奧/
莫里茨/安佩爾/莉拉/羅密/賽莉/丹尼斯/科洛蒂婭/菲德麗卡/薩維里奧/迪安/多爾特/安娜/
沃爾卡/古老；库肯岛周边地区/克莱莉亚地区/王都周边地区/萊莎家/塔奧家門前；
EN: Ryza/Karl/Tao/Mio/Moritz/Empel/Lila/Klaudia/…；官方繁中教程句「點一下，和萊莎
聊天」「點一下叫醒萊莎」「這裡是萊莎的夢中世界」等）。**未在包内验证过的一律保留
日文原名，禁止自行发明**（尼梅德地方、冥界奥利姆这类编造已撤销；Agate/Lumber/Fressa
等未验证英文名保持日文）。出口：`World.npcName/placeLabel`、
`Quests.titleOf/descOf/goalOf`、`I18n.tc/tf`。

### 渲染与交互

#### `web/js/avatar.js` — Spine 渲染（本轮未动，结论维持 AUDIT §3）

路径：`ManagedWebGLRenderingContext` + 自建 `Matrix4` MVP + `PolygonBatcher` +
`SkeletonRenderer`。单画布 `#scene-canvas`，点击层 `#avatar-hit`。
坐/站随场景 `midgroundPostures`；`fixedBasePoseMode`；注视/张力/指尖/口型/
Occupancy/rim 全部见 AUDIT §3.7；**点击热区（BB 多边形∩轮廓）与退出平滑
（位移缩放淡出 + 重叠还原 + 连点交叉）见 AUDIT §3.9**。
**不要退回旧坑**（HANDOFF 的坑清单）。

#### `web/js/app.js` — 主控制器（只编排，不存状态）

- `init()`：Game→Daily→Quests 顺序装载，`Game.on` 订阅刷 HUD。
- `say()`：体力门槛（不足弹 overlay）→ `Api.chat`（带 `_rpgContext()`：
  Game+人物+Quests 三块，ASMR/テキスト不注入）→ `applyDelta` → 扣体力 →
  任务进度 → 气泡/朗读。失败出「重试」条（源 reconnect 语义的本地化）。
- `gotoStage()`：换景 + `meetCharas`（met_charas/met_pairs 记录 + 记忆行）+
  explore 任务进度。
- `_showPeople()`：源 `area_bottom_sheet.dart` —— 按当前地图层级列在场 NPC
  （头像/名字/注记/位置；没见过的名字带「？」）。
- 顶栏两行：`#topbar`（菜单/地点/时段/语音/设置）+ `#subbar`（模式/坐站 +
  苹果条/金币/等级）；HUD 三枚 chip 点开 `#sheet-status`（冒险状态面板）。
- 视图规则：`#view-talk` 透明叠在立绘上，其余视图自带暗底（源各 screen 独立页）。
- toast 在顶部（源 `top_toast.dart`）；标题页 `body.boot` 隐藏全部 chrome，
  但 Electron 的窗口控制钮 `#winctl` 保留。
- 存档槽 3 格：settings + history + memory + **game + daily** + alarms。
- 设置页：文本速度用源图标（`text_speed_1x/15x/2x/3x.svg`）分段钮；
  「游戏性」区 = 作弊开关 + 全恢复 + 解锁世界（仅作弊时显示）；
  「抹除全部本地数据」= 源 `local_save_data_eraser`（`Config.eraseAll()`）。

#### `web/js/world.js` — 世界地图

`world_hierarchy.json`（5 区域/38 场景块/120 舞台）+ `npc_placement.json`
（34 NPC：bases + move(area/field/stage) + companions，按 `resolveOrder`、按天哈希）。
`World.locked(areaId)`：未出航时 area_02–05 上锁；`npcsInArea/npcName` 供人物面板。

#### `web/js/audio.js` / `alarm.js` / `fx.js` / `shell.js`

- 音景路由不变（标题 opening BGM / 对话 ambient / 地图 world BGM；对话页无 BGM 是源设计）。
- `VoiceBank`（闹钟/反应语音目录）从 alarm.js 挪进 audio.js——语音目录属于声音路由模块。
- `fx.js`：按 `assets/animations/*.json` 的 fr/op 画布播（无 Lottie 运行时）。
- `shell.js`：只在 Electron 里出现（`window.ryzaShell`）——📌置顶/最小化/关闭。

#### `web/js/i18n.js`

UI 7 语（zh / zh-tw / ja / en / hi / id / pt-br）。本轮新增系统的全部文案键
（任务卡、每日登录、状态面板、作弊、体力耗尽、背包扩容、重试条…）zh/ja/en 全量，
zh-tw 覆盖关键页，hi/id/pt-br 继承 en。角色台词仍是日文。

### 壳

#### `desktop/`（Electron）

`main.js`：`frame:false` 无边框窗（420×860，Win11 自动圆角），
置顶开关 `setAlwaysOnTop('screen-saver')`，单实例锁，顶栏可拖窗
（`-webkit-app-region`），外链走系统浏览器。内置 `127.0.0.1` 静态服务 +
`POST /_proxy`（与 serve.py 同契约）。`preload.js` 暴露 `window.ryzaShell`。
`RYZA_SHOT=路径 npx electron .` 9 秒后自截图退出（开发自检）。
打包：electron-builder NSIS —— 正常「添加或删除程序」安装/卸载，
存档在 `%AppData%\RyzaChat`，卸载默认保留（要清就在应用内抹除或删目录）。
`web/` 以 extraResources 随包；**providers.json 不在包内**（默认端点也已中立化）。

#### `android/`

`MainActivity`（纯 `android.app.Activity`，无 androidx）+ `AssetServer`
（assets 静态服务 + **`/_proxy` 转发**——之前缺它手机端 LLM 必挂；
`config/*` 直接 404，不打包密钥）。Gradle 工程保留给 Android Studio 用户；
命令行出包走 `scripts/build_apk.ps1`（aapt2→javac→d8→zipalign→apksigner，
自签 keystore 落在 `android/keystore/`，已 gitignore）。

---

## 3. 源项目功能对照（验收用这一节）

模块名来自 `docs/dart_source_tree.txt`。没有 Dart 源码，行为以第 7 节的**原始数据**为准。

**不要做**（官方服务端/商业能力，本地替代已注明）：登录/Firebase、订阅付费墙、
代币/回合票、皮肤内购、远程资源门、公告服、强制更新、分析/崩溃上报、
官方 marionette/yorisoi websocket（LLM 走玩家自填接口）。
**体力与每日登录不再是「不做」**——用户拍板保留玩法约束，付费部分换成作弊模式。

| 源模块 | 玩家侧应该有的 | 现在（2026-09-02） |
|---|---|---|
| `title` | 标题画面再进游戏 | `overlay-title`；标题页隐藏全部 chrome |
| `onboarding` | 问卷、序章语音、教程对话 | 有；教程对白用源包挖回的原文（体力/背包/金币/任务提示） |
| `talk` | 五种模式、气泡、日志、重置 | 有；模式=底栏 sheet；失败出重试条 |
| **GameState** | `exp_total/stamina/money/inventory/ryza_inventory/met_charas/met_pairs/memory` | **已实现**（game.js，键名同源） |
| **体力苹果** | `StaminaAppleRow`、耗尽气絶、睡觉恢复 | **已实现**（HUD 苹果条 + faint overlay + 睡觉） |
| **任务/委托** | 任务卡（goal/cost/概要）、完成演出、动态生成 | **已实现**（quests.js：主线 8 段 + 无限支线） |
| **出航解锁世界** | 船/世界地图推进（`entry_map_move`） | **已实现**（quest8 → sailed → area 门） |
| **每日登录** | 7 日日历、连续 5 日奖励 | **已实现**（daily.js + 抽屉红点） |
| **背包** | `inventory_sheet`、you/ryza 两包、四档容量 | **已实现**（双 tab + 金币扩容） |
| **NPC** | 地图在场、`met_charas` 进状态、`area_bottom_sheet` | **已实现**（人物面板 + 提示词注入 + 状态页名单） |
| 付费墙/代币/订阅 | — | 不做；**作弊模式**替代（设置→游戏性） |
| `spine_avatar` | 情绪/表情/眨眼/分部位点击/注视/物理/站坐/ASMR/视差/rim | 已接（AUDIT §3；点击热区与退出平滑精修见 §3.9） |
| `audio` | 标题 opening BGM；对话 ambient；地图 world BGM；SE；tap_voice | `audio.js`（不变，对话无 BGM 是源设计） |
| `alarm` | 列表+编辑、贪睡、响铃全屏、env 口型 | 有；仅前台 |
| `chara` + `save_slot` | 角色卡、存档槽 | 设定表单 + 3 槽（含游戏态） |
| `skin` | 5 预览、2 可穿、veil | 有；3 套无骨骼只有预览图，作弊也穿不了（数据缺失） |
| `i18n` | UI 多语言 | 7 语（新系统全量 zh/ja/en） |
| 包装 | 可安装的桌面/安卓 | **exe 安装包已产出**；APK 构建脚本就绪（见 §5） |

素材在包里、代码**故意未用或做不到**的：

- `web/assets/animations/`：标题火/语音钮/彩纸用画布按 JSON 帧率播（无 Lottie 运行时）
- `web/assets/spine/objects/`（场景 JSON 未引用，只有图集没有完整 skel）
- `paywall_*.svg`、`subscription.svg`、`tokushoho/tos/privacypolicy.svg`、
  `voicetoken_*.svg`、`logout/link/report*` 等：付费/法务/账号图标，本地版无对应流程

---

## 4. 已跑通的部分

- 标题 → （问卷/序章/教程）→ 对话；立绘全链路（AUDIT §3/§3.7 的 21 条坑不回退）
- 游戏系统全链路：对话/行动 → `<state>`/本地结算 → 体力/经验/金币/背包/任务/记忆 →
  HUD 与面板；主线 8 段通关到出航解锁世界地图（`scripts/game_logic_regression.js` 全程演练）
- 世界钉子图 + NPC 全字段调度 + 人物面板；闹钟响铃/贪睡/env；音景；5 槽换装+veil；
  欢迎任务；存档槽；双背包+扩容；每日登录；作弊模式；数据抹除
- LLM 经 `/_proxy`（serve.py / Electron / AssetServer 三处同契约）；TTS 克隆
- 桌面：无边框 Electron 窗（置顶/最小化/关闭/拖拽）+ NSIS 安装包（612MB，含全部素材）
- 无头测试三件套全绿：`motion_regression.js`（立绘 60s×2 姿态）、
  `game_logic_regression.js`（数值/任务链/每日登录/ reducer 钳位）、
  `boot_smoke.js`（App.init 用真实 index.html 的 id 集跑通）
- 截图走查（外部 puppeteer-core + 本机 Edge，工具在 `D:\agent\temp\ryza-shot`）：
  标题/对话/任务/每日/地图/人物/设置/背包/状态/耗尽/教程/点击反应 12 个状态

---

## 5. 已知问题 / 剩余

1. 闹钟只在应用前台触发（Web 层无系统排程）。
2. 参考音频只接受 wav/mp3；克隆用 `web/assets/voice/ryza_wav/`。
3. 主线 8 段的具体文案是**按源素材文案重建**，不是官方任务表（表在服务器，包里只有键名）。
4. 等级曲线（`1+√(exp/30)`）、体力价目、背包容量档位是本地定的——源值在服务器。
5. APK 需要在装了 JDK+SDK 的机器上跑 `build_apk.ps1`（本机构建进行中/产物见 `output/android/`）。
6. 标题/语音钮/彩纸是画布按 Lottie JSON 帧率播，不是 Lottie 运行时。
7. `spine/objects/` 仍只有图集、没有完整 skel，无法加载。
8. 安装包未做代码签名（SmartScreen 会警告「未知发布者」，自用无碍）。

---

## 6. 素材与脚本

改了 `web/assets/` 下的文件后跑：

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
| ✅ 有 | 抽取的字符串（含游戏状态键名）、源码**路径名**清单 |
| ❌ 没有 | 反编译 Dart 源码（AOT 快照不可逆） |
| ❌ 没有 | Java/Kotlin 业务逻辑（dex 是 Flutter/Firebase 样板） |
| ❌ 没有 | 官方任务表/数值表/等级曲线（`/v1/masters` 在服务器） |

不能「对着原来的函数抄」，只能**按原始数据 + 模块划分重新实现**；
数值曲线类只能定「同形制、本地值」，并在 AUDIT 里注明。

### 7.2 原始素材

| 路径 | 内容 |
|---|---|
| `web/assets/spine/crf_chr_002/crf_skn_002_0001_01/` | 坐姿服装：skel / atlas / png / `*_gesture.json` |
| `web/assets/spine/crf_chr_002/crf_skn_002_0001_99/` | 站姿服装，结构同上（`postureKey`: standing） |
| `web/assets/spine/scenes/<舞台>_<时段>/spine/` | 50 套 × 4 时段场景骨骼 |
| `web/assets/spine/scenes/<舞台>_<时段>/<同名>.json` | `constraintOverrides`、`light`、`midgroundPostures` |
| `web/assets/audio/alarm/<语种>/<语气>/<类型>/<时段>/` | 预录语音 + 同名 `.env.json` |
| `web/assets/audio/prologue/jp/` | 9 条开场白原声 |
| `web/assets/audio/tap_voice/` | 点击反应语音 |
| `web/assets/audio/ambient/` `bgm/` `se/` | 地点环境音；BGM 仅两首；SE 三条（quest_clear/skin_change/touch_start） |
| `web/assets/icons/` | 全部 UI 图标（含 `stamina_apple_*`、`hud_coin`、`cauldron`、`shop`、`text_speed_*`） |
| `web/assets/world_map/ui/`、`welcome_mission/`、`images/`、`animations/`、`fonts/` | 地图钉子、欢迎任务图、头像/预览、Lottie JSON、字体 |
| `web/assets/voice/ryza_wav/` | 开场白转出的 24kHz 单声道 wav（TTS 克隆） |

### 7.3 原始配置 JSON（行为的权威来源）

| 路径 | 用途 | 当前读取者 |
|---|---|---|
| `web/assets/spine/crf_chr_002/*/…_gesture.json` | 角色动作表全套 | `avatar.js` |
| `web/assets/world_map/world_hierarchy.json` | 区域/场景块/舞台 | `world.js` |
| `web/assets/world_map/npc_placement.json` | NPC 分布与同行 | `world.js` |
| `web/assets/data/stage_background_map.json` | 舞台→背景套 | `world.js` |
| `web/assets/data/posture_camera.json` | 站/坐镜头与 ASMR | `avatar.js` |

### 7.4 抽取产物（非原始文件，只当目录/文案/键名索引）

| 路径 | 内容 |
|---|---|
| `docs/dart_source_tree.txt` | 479 条源码路径（无代码）——功能清单以模块树为准 |
| `data/libapp_strings_ascii.txt` | **游戏系统键名的出处**（`stamina_delta`、`dailyLogin.*`、`talk.inventory.bag.*`、`quest8_goal`…）AUDIT §6 逐条引用 |
| `data/libapp_strings_ja.txt` | 抽取的日文文案（含序章/教程/体力说明原句） |
| `docs/reference/apk_asset_inventory.txt` | 源包 3609 个文件清单 |
| `docs/reference/strings_ja_ui.txt` | 清洗后的日文文案 |
| `docs/reference/spine_example.html` 等 | Spine 官方示例，渲染路径对照 |

源 App 结构分析（接口、包名）在 `D:\agent\backup\ryza-recon-report.md`，不放在本目录。

### 7.5 生成物

`web/assets/_index/*.json` 由 `scripts/build_indexes.py` 扫描素材生成。改素材就重跑。
