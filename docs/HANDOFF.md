我在做一个同人向的离线 AI 聊天 App（原创同人项目，个人自用，不做任何分发），
技术栈是纯前端 HTML + JavaScript + Spine 4.2 骨骼动画，素材是本地文件，
没有任何官方服务端。代码已经能跑起来，现在需要你继续开发。

【当前状态（2026-09-03）】
AUDIT §5 条 5/6 的两个交互问题已全部修复（机制与回归断言见 AUDIT §3.9，不要退回去）：
点击热区 = BB_* 多边形 ∩ 可见轮廓（miss→null，半径兜底已删；poke(null) 不再兜底
放随机反应；App 只在命中时出波纹/SE/语音）；退出点击态 = 淡出时长按反应 clip
末帧位移放大（源 0.3s 为下限）、肢体层与 _lookMul 在淡出 60% 处重叠还原、
一次性动作期间指针参考冻结（_faceRef）；连续点击 = 首发保留源瞬切（enter 0）、
重叠时 0.15s 交叉淡化。死代码已清（见 AUDIT §6.2 末段），TTS 语言映射收口
Langs.ttsLangType。exe/APK 已统一重出 1.2.3。
RPG 游戏系统已按源包数据补全：GameState（体力苹果/经验等级/金币/双背包/相遇名单/记忆）、
主线 8 段任务（终点造船出海→解锁世界地图 area_02–05）、对话驱动 <state> 数值协议、
每日登录（5 日连续里程碑）、体力耗尽与睡觉恢复、作弊模式（设置→游戏性，一键解除限制）。
语言矩阵四槽独立（界面/自带语音/回复/朗读，朗读≠回复时先翻译再合成）；
TTS 双提供商（MiMo OpenAI 兼容 + Qwen 百炼，含莱莎原声复刻入口）；
物品/任务/人名/地名内容本地化，人名只用源包验证过的官方译名（AUDIT §6.9）。
桌面壳 = Electron 无边框窗（置顶/最小化/关闭/顶栏拖拽），NSIS 安装包；
安卓壳 = 纯 Activity + AssetServer（含 POST+GET /_proxy），scripts/build_apk.ps1 无 Gradle 直出 APK；
Android 键盘不再压扁画面（web/js/kbd.js）。
注视跟随的三处单帧瞬变（阈值硬门/eye-head 增益/followers delay 跳档）已统一收口为
_aimSm 逐骨骼平滑施加（AUDIT §3.8），指针扫掠回归守门。
先读 docs/AUDIT.md §3.9 与 §6（本轮改动），不要重复实现、不要退回去。

【一比一（强制）】
源 APK：`D:\download\ai.gospiral.atelierryza.v1.0.2.apk`（v1.0.2）。
玩家侧**能从 APK 落地的功能必须按源模块 + 原始数据一比一实现**，不要另起一套「能聊就行」的简化玩法。
屏幕/数据流以 `docs/dart_source_tree.txt` 的 features 文件名为准。
行为以 `web/assets/` 里的原始 JSON / 音频目录 / 骨骼 / UI 图为准（已与 APK 3609 个 flutter 资源对过，无缺无多）。
数值曲线类（等级表、价目、任务正文）在官方服务器（/v1/masters），包里只有键名和文案——
本地定值必须列在 AUDIT §6.3，不许当成官方数值传。
没有 Dart 源码可抄。官方登录/订阅/代币购买本身仍不做（见「明确不要做」）。

已核对记录：`docs/AUDIT.md`（2026-08-31 基线；09-01 动作修复 §3.7；09-02 游戏系统 §6）。
音景与源包一致：**对话页没有 BGM**（包里只有 `bgm_opening` / `bgm_world_map` 两首），对话页播地点 ambient；进地图才切 `bgm_world_map`。不要把「地图才出 BGM」当成漏做。腮红 overlay 按 Normal。角色 Physics **每帧只 update 一次**。
`config/providers.json` 含水合用的 API Key，**不要进 git、不要打进任何安装包**；复制 `config/providers.example.json` 再填。
不要把 AUDIT 旧段落里的「NPC 调度错、FX_BY_EMOTION、循环 fade_in、sourceHash 对不上」当成还没修——那些已经改过。先读 AUDIT 全文再动手。

【先读这两个文件，它们描述了整个项目】
  projects/ryza-ai-revive/docs/PROJECT.md
     ├─ 第 1-2 节：目录结构、每个 JS 文件的职责与关键函数（含 game/quests/daily）
     ├─ 第 3 节：源项目功能对照表
     ├─ 第 4-6 节：已跑通的部分、剩余问题、素材脚本
     └─ 第 7 节：源包解包产物的完整位置对照表
  projects/ryza-ai-revive/docs/dart_source_tree.txt
     479 条源码路径（只有路径，没有代码）。功能按 features 下的模块名来写，
     屏幕/数据流以这些文件名称为准（talk_screen、world_map_screen、
     alarm_ringing_screen、onboarding_questions_screen 等），不要自己发明另一套玩法。

【关于素材：请直接读原始文件，不要只看文档转述】
PROJECT.md 第 7 节列出了所有解包产物的路径。其中这些是**原始数据**，
是行为的权威依据，请务必打开来看：
  web/assets/spine/crf_chr_002/*/…_gesture.json
      角色动作表。`fixedBasePoseMode`：换情绪不换 A_* 待机。
      一次性动作 ← `fixedGestureBindingsByAttitude`（丢掉 weight==0）；
      脸 ← `intensityProfiles.normal.expressionSets`；
      特效 ← `effectSets` + `fxOnAnimNames` / `fxOffAnimNames`（不要自造情绪→blush 表）；
      mix ← `mixDurationMin/Max` + `mixDurationSaturationRatio`；
      手臂 ← `MotionGroups` + `idleGroupIds.byPosture`；
      注视/指尖 ← `DriverDefs`、`fingerTrack*`、`rigConfig.aimSlots/rollSlots`；
      口型 ← `lipSyncClosure`；点击 ← `hitPartNames` + `TapReactions`。
  web/assets/world_map/world_hierarchy.json   5 区域 / 38 场景块 / 120 舞台
  web/assets/world_map/npc_placement.json     34 位 NPC：bases / move / companions / resolveOrder
  web/assets/data/stage_background_map.json   120 个舞台 → 50 套背景
  web/assets/data/posture_camera.json         sitting 1.93 / standing 1.45 / ASMR 3.5
  web/assets/spine/scenes/<舞台>_<时段>/      场景骨骼 + constraintOverrides/light/midgroundPostures
  web/assets/audio/…                          alarm 1120 条 + env、prologue 9 条、tap_voice、ambient/bgm/se
  web/assets/icons/ + welcome_mission/        UI 图标（stamina_apple_*、hud_coin、cauldron、shop、lock、text_speed_*）
游戏系统的键名证据在：
  data/libapp_strings_ascii.txt   stamina_delta / exp_total / inventory_added / dailyLogin.* /
                                  dynamic_quest_* / quest8_goal / talk.inventory.bag.* / …
  data/libapp_strings_ja.txt      日文原句（体力说明、教程、序章、每日登录）
另有抽取产物（非原始文件，仅供参考）：
  docs/dart_source_tree.txt      源码路径名（功能模块清单）
  docs/reference/apk_asset_inventory.txt   源包内 3609 个文件的清单
  docs/reference/strings_ja_ui.txt         清洗后的日文文案

【重要前提：没有反编译源码】
源包是 Flutter 应用，业务逻辑是二进制里的 Dart AOT 编译快照，不可逆回源码；
8 个 dex 也只是 Flutter/Firebase 样板，没有业务逻辑。
实现方式是：
  1. 用 dart_source_tree 的模块/屏幕/文件名，还原源项目的页面与数据流；
  2. 用上面的原始 JSON / 音频 / 骨骼 / UI 图，填进这些页面；
  3. 文案可对照 data/libapp_strings_ja.txt；键名对照 libapp_strings_ascii.txt。
不要另起一套「能聊就行」的简化玩法。

【运行方式】
  cd projects/ryza-ai-revive
  python scripts/serve.py
  打开 http://127.0.0.1:8765/
必须用 `scripts/serve.py`（静态 + `POST /_proxy` 转发 LLM/TTS）。
桌面开发：cd desktop && npx electron .（首次需 npm install，脚本里有镜像环境变量）
安装包：powershell -File scripts/build_desktop.ps1
APK：  先 scripts/setup_android_tools.ps1（一次性，装 D:\agent\tools\jdk17 + android-sdk），
      再 scripts/build_apk.ps1

【测试（改完必须全绿）】
  node scripts/motion_regression.js       # 立绘 60s×2 姿态
  node scripts/game_logic_regression.js   # 数值/任务链 1→8 通关/每日登录/reducer 钳位
  node scripts/boot_smoke.js              # App.init 用真实 index.html id 集全链路
截图走查（UI 改动必做）：外部工具在 D:\agent\temp\ryza-shot（puppeteer-core + 本机 Edge），
  node shot.js title talk quest daily world people settings inv status faint tap
  出图在 shots/*.png，用 read 工具看图核对。Electron 窗口自检：
  $env:RYZA_SHOT='...png'; npx electron .   （9 秒后截图退出）

【已经跑通的部分】
标题页（隐藏全部 chrome）、onboarding 问卷/序章/教程（教程台词用源包挖回的原文）、
单 WebGL 画布立绘+场景、坐/站随 midgroundPostures、gesture 全套、注视/张力/指尖/口型、
分部位点击（波纹环+反应动作+tap_voice；热区=BB 多边形∩可见轮廓，
退出平滑、连点交叉，AUDIT §3.9）、
世界钉子图 + NPC 全字段调度 + 人物面板（area_bottom_sheet）、出航前 area_02–05 上锁、
游戏系统全链路（见上）、双背包+金币扩容、状态面板、音景、闹钟、5 槽换装+veil、
欢迎任务、存档槽（含游戏态）、LLM 经代理 + providers.json 水合、TTS 克隆、
重试条、数据抹除、7 语 UI、Electron 无边框壳 + NSIS、APK 构建脚本。

【立绘坑（已经踩过，不要退回去）】
1. 两块 WebGL 或给 avatar-canvas 再 getContext，Windows 会闪。点击层是 div。
2. 场景 `anm_fade_in` 必须 loop:false。
3. 图集没有 pma:true。头发阴影 Multiply 第二遍 PMA；腮红/pale/tear 第一遍改 Normal。
   setup 的 cheek_line/nose_hi 每帧摘掉。
4. 换情绪不要 setAnimation(0, 新idle)。一次性在 track 1，empty delay ≤0。
   oneshot_D_* 不要 mute 手臂/躯干/腿。
5. 不要用角色 AABB 当镜头。
6. Occupancy motion_add_F/G/B/E/C 必须 MixBlend.replace；add 只给 effect_wind*。
7. 场景 rim：角色先画到默认 FB，FBO 只加算轮廓。
8. idle 重掷不要重抽仍适用的 MotionGroup；同 AnimName 不要 out→in。
9. 角色 Physics.update 每帧只一次。
10. 音景是源设计：对话页不要 BGM；Sound.unlock 用独立 Audio；循环源记 _loopSrc，
    禁止写 Sound['_ambientSrc']。
11. 动作抽动修复全套见 AUDIT §3.7（_ptrW、张力三带、_lookCyc、closed 深眨、
    hashHex 有符号两半、_effectNames memo、gazeEntries 锁脸 3s、rollFollowSpeed、
    双姿态舞台才出坐/站 chip）。
12. 【2026-09-02 新增，不要退回去】
    - 顶栏是两行定高（#topbar + #subbar），视图 padding-top 用 var(--bars-h)；
      往顶栏加 chip 记得 .hud-chip 是 nowrap+ellipsis，别加会换行的东西。
    - 非对话视图必须保持暗底（.view:not(#view-talk)），别为了透出立绘改透明——字会糊。
    - #bubble-wrap 是 pointer-events:none（立绘热区靠它透下去），别改回 auto。
    - toast 在顶部（--bars-h 之下）；每日登录提示延后 3.2s 错峰。
    - body.boot 隐藏 chrome 时 #winctl 要保留，否则无边框窗在标题页关不掉。
    - 苹果图标（stamina_apple_*）不吃通用 sepia 滤镜（css 有 src*='apple' 豁免）。
    - <state> 块必须在显示/朗读前剥掉（api.parseTaggedReply 里做）；reducer 是唯一写入口。
    - talk 类任务：同轮 LLM 已回 quest 数据时不要再 progressEvent（防双计）。
    - AssetServer / Electron main 的 /_proxy 与 serve.py 是同一契约，改一处三处同步
      （POST=LLM/TTS JSON，GET=Qwen 音频 URL 回拉）。
13. 【注视平滑（AUDIT §3.8）不要退回去】_applyLook 是「目标→_aimSm 逐骨骼
    指数平滑→施加」结构；fingerTrack 阈值走 _ptrRamp 渐入，不是硬门。
    别把 eyeK/headK 或 followers delay 改回单帧切换——那会复活
    「特定角度卡模型/重影」。motion_regression 的指针扫掠断言（_aimSm
    每帧 <12u）就是守这条的，改注视相关代码后必跑。
14. 【点击交互（AUDIT §3.9，2026-09-03）不要退回去】
    - hitPartAt = BB_* 多边形 ∩ `_onCharacter` 可见轮廓，miss→null；
      骨根半径兜底和 `poke(null)→随机反应` 都已删，别加回来。
      App 的波纹/SE/tap_voice 只在命中时触发。
    - 退出淡出 = `_pokeExitMix`（源 0.3s 下限、按末帧位移放大到 ≤0.65s）；
      肢体层与 `_lookMul` 在淡出 60% 处重叠还原（`_pokeUnmuteReady`，
      avatar.js `_loop` 和 motion_regression `stepOnce` 共用这一个出口条件）。
    - 一次性动作期间 `_faceRef` 冻结指针参考；`_lookMul` 回升 τ=0.3s。
    - 连点：首发瞬切（enter=0 是源值），`_trackBusy(6)` 时 0.15s 交叉。
    - 回归里 `_aimSm` 每帧 <25u 的断言只在 poke 退出窗口测；扫掠断言仍是 <12u。
15. 【语言与命名（2026-09-02）】
    - 语言矩阵四槽：app.lang / voice.lang / llm.lang / tts.lang（Langs 助手在 i18n.js）。
      tts.lang ≠ llm.lang 时 Api.translate 先翻译再合成；显示文字永远是 llm.lang。
    - 人格提示词保持原版日文，只加「## 出力言語（厳守）」段。别把 persona 翻成中文。
    - **人名/地名/物品名只用源包验证过的官方译名**（i18n.js CONTENT 表有注释标明来源=
      libapp.so UTF-16 扫描）。没验证过的一律保留日文原名——禁止自行发明翻译
      （已发生过一次：尼梅德地方/冥界奥利姆等编造被撤销）。要加新译名，先回
      D:\agent\temp\apk-l10n\ 的扫描脚本（dump_ordered.py / scan_cjk.py）在包里验证。
    - TTS 双提供商 tts.provider=openai|qwen。Qwen 用百炼 DashScope，**必须是普通
      sk- API key**；Token Plan 个人版 key 在 dashscope 是 401，且条款禁止 API 调用，
      别把它配进 Qwen 槽。Qwen 声音复刻走 voice-enrollment + data URI（本地 wav 直接
      base64，无需公网），voice_id 自动填设置。
    - 【2026-09-03】两端**凭据字段已分离**：qwen 只读 `tts.qwenBaseUrl`/`tts.qwenApiKey`
      （baseUrl 空=回落公共 DashScope），openai 只读 `tts.baseUrl`/`tts.apiKey`；
      音色本来就分离（`qwenVoice` vs `presetVoice`/`reference`）。别把 qwen 路径
      改回读共享字段——那正是「切端点后 401/404」的根源（AUDIT §6.9）。
      参考 wav（assets/voice/ryza_wav/，git 跟踪）三端相对路径解析已核，随包分发。

【三条必须知道的技术约束】
1. Spine 4.2：skeleton.updateWorldTransform(spine.Physics.update) 必须传枚举；
   每帧先 skeleton.update(dt)。场景用 Physics.none。
2. 渲染用官方示例写法（ManagedWebGLRenderingContext + 自建 Matrix4 + PolygonBatcher +
   SkeletonRenderer）。SceneRenderer 的 OrthoCamera 不要用（zoom 语义相反）。
3. TTS 参考音频只接受 wav / mp3，m4a 会报 "Unsupported audio.voice source format"。

【怎么写功能（强制）】
按源项目逻辑写，不要猜。每个功能先读：
  - dart_source_tree 里对应 features/<模块>/ 的文件名
  - PROJECT.md 第 7 节对应的原始数据
  - data/libapp_strings_*.txt 里的键名/文案
然后再改 web/js、web/index.html、web/css。
缺数据的官方接口（mission-board、登录、订阅）用本地 JSON / localStorage 替代，
但玩家看见的流程要跟源模块一致。

【还剩的、能做的】
  - 闹钟后台化（Web 层做不到，可考虑桌面壳加系统级排程）
  - 标题/语音钮按 Lottie JSON 帧率画，不是 Lottie 运行时（源包未带运行时，不引 CDN）
  - spine/objects/ 只有图集没有 skel，加载不了
  - 安装包代码签名（自用可跳过）
  - 用户计划以后把「游戏完整版」下载下来后继续加内容——保持模块边界
    （game/quests/daily 只经 Game.applyDelta 写；UI 只读；见 AUDIT §6.2），
    新数值/曲线类数据一律「形制照抄、本地定值」并登记在 AUDIT §6.3。

【明确不要做】（官方服务端/商业能力）
登录 / Firebase、订阅付费墙、代币与回合票购买、皮肤内购、远程资源下载门、
公告服、强制更新、分析/崩溃上报、官方 marionette/yorisoi websocket
（LLM 继续走玩家自己填的 OpenAI 兼容接口）。
注意：**体力与每日登录已经本地实现**（用户拍板保留约束），
付费解除 = 设置里的作弊模式，别再往「删掉体力系统」方向改。
法律条文页不必复刻官方文本。

【怎么看画面（强制）】
你有多模态，可以直接看图。用上面的截图工作流（temp/ryza-shot），
自己看真实页面：顶栏、任务卡、日历、地图锁、响铃、问卷、换装、标题、点击反应。
不要写 ASCII 密度图，不要用「测 canvas 像素」的脚本代替自己看。

【输出位置】
只改 projects/ryza-ai-revive/ 内的文件（截图工具例外，在 D:\agent\temp\ryza-shot）。
仓库根目录规范见 AGENTS.md 与 structure.md，不要往仓库根目录丢文件。
每完成一个阶段做 git 提交。打包产物只进 output/（已 gitignore）。
任何安装包/仓库内容不得含 config/providers.json、个人端点、测试音频。

两点补充说明：

docs/recon-report.md 已移到 D:\agent\backup\ryza-recon-report.md。那份文档通篇是源 App 的结构分析（接口、包结构、官方特征），留在要交出去的目录里正好是最容易触发审核的东西。没删，你要看随时能看。

另外参照价值的解码产物在 docs/reference/——按项目规范 temp/ 是「可随时清理」的，不该让后续工作依赖它。
