我在做一个同人向的离线 AI 聊天 App（原创同人项目，个人自用，不做任何分发），
技术栈是纯前端 HTML + JavaScript + Spine 4.2 骨骼动画，素材是本地文件，
没有任何官方服务端。代码已经能跑起来，现在需要你继续开发。

【当前状态（2026-09-07）】
NSFW 图集变体（AUDIT §10.1）+ **按源表取景、坐姿锁中景**（§10.2，不要退回去）：
上一轮把角色缩小去「塞全身」是错的——源 APK 用 `posture_camera.json` 的
scale/offset/zoom，点击部位是 BB_head/breast/weast/arm/body（上半身），
本来就不是整脚入画。缩小还会把塔奥家门前的坐姿从沙发上抬走。
现已撤回 `_fitFullBody`；坐姿若场景有 `sofa_root`，世界坐标跟着沙发
（源 `chara_root_offset` / `_currentSofaRootCompensationOffset`），不再经相机重映射 Y。
ASMR zoom **就是源表** sitting 3.5 / standing 2.5（相对底栏 1.93 / 1.45），
没有再额外放大；`asmr.cameraPanY`≈3200 不能当本套正交中心用（会瞄到天上），
仍只做朝脸的 pan 重映射。
源 APK 换装是整包 skel+atlas（`features/skin` / `switchSkin`），没有「同一骨架只换 PNG」。
本轮 NSFW 是图集页变体：`{pageBase}{variant}.png`，不写死服装 id。
脱衣只认回复标签行的 `nsfw:on/off`（和 emotion 同一栏），不是关键词、也不是 tools。
此前（09-06）：姿态/相机/表情补全（AUDIT §9，不要退回去）：默认开局**站姿 `_99`**
（旧存档一次性迁移 `state.postureMigrated`）；姿态 chip 改**动作语义**（站着显示
「坐下」）；`midgroundPostures` 不再当皮肤约束（196/200 组场景只列 sitting），
只决定哪里出切换 chip；黑边与切姿态背景跳位由**板内钳制相机**根除
（`_coverFor` 量最大绘制 quad 世界框 → `_applyCamera` 背景窗口只缩不涨地钳进去，
与玩家选的姿态无关 ⇒ 切坐/站背景一动不动；横屏黑边是同一个洞的另一半，一并没了）；
`_placeCharacter` 按 `k=解出高/表内高` 保住表内取景，并做**视线对齐**修掉站立
「人沉在画面底部」（表里坐 0.70 / 站 0.37，那组相机数据是照更高底板调的）；
换场景「先是放大的坐姿、再换一次才站」两处成因修掉（`postureKey` 自己 gate +
相机按 `_loadedPosture()` 而非请求姿态取参数）；被当 bug 删掉的 **ASMR 表情重掷**
按源包符号 `IntensitySettings.ExpressionRerollMin` 恢复（`weak` 独有口型 010/015 回来）；
`weight` 钉成「不写=1、写 0=作者禁用」；序章屏用回包里的
`onboarding_prologue_bg.png`；模式名补 7 语 i18n（HUD 之前写死 `{chat:'雑談'}`）；
`fadeVolume` 补钳制（rAF 时间戳可早于 `performance.now()` ⇒ `volume=-0.002` 抛
`IndexSizeError` 把淡入淡出打死）。新增第四套回归 `expression_coverage.js`；
`motion_regression.js` 加 50 舞台×3 视口×2 姿态=300 组「相机必须落在绘制框内」断言。
版本单一来源 `config/version.json` + `scripts/stamp_version.js`；打包双闸门
`scripts/privacy_check.py`（暂存前 + 成品，命中私人标识直接中止构建）。exe/APK 重出 **1.2.7**。
此前（09-05）：
模式化 TTS + 气泡自动淡出已完成（AUDIT §8，不要退回去）：每个聊天模式有自己的
TTS 语音指导（api.js MODE_TTS 叠加在 tts.styleHint 基底上；tts.modeHints[mode]
可整段覆盖；openai=风格消息、qwen=仅 instruct 模型加 input.instructions、
flash/vc 不接指令别硬加）；Api.speak 第三参=模式（App.speakThen 显式传）；
MODE_PLAY_FX 播放整形（asmr 0.93×速/0.82×音）由 App.playUrl(url, fx) 应用。
气泡：_bubbleHold/_bubbleKeep/_bubbleReveal 生命周期，读完自动淡出，
背景 alpha .52 半透明；boot_smoke 有 7 条守门断言。整理：占位符检查收口
Api.isPlaceholderModel；App.esc 改为真 HTML 转义（LLM 生成标题进过 innerHTML）；
删 Avatar._aimRest / Onboarding._qs / app.pet / .caret CSS（均零引用）。
exe/APK 重出 1.2.5。此前（09-04）：
布局自适应已完成（AUDIT §7，不要退回去）：#phone 占满视口（黑边根除，Spine
相机自适应任意宽高比）；桌面窗 App._fitUi 给 #phone 设 CSS zoom 等比缩 UI
（仅 Electron，必须用 innerWidth/Height 不能用 clientWidth——会反馈震荡）；
一切 clientX→布局 px 换算经 Avatar._cssZoom 除回（注视/点击/画布 dpr 三处）；
Android manifest 补 windowLayoutInDisplayCutoutMode=shortEdges（否则刘海机黑边）。
TTS：openai 区块补了模型名输入框（手机端「unsupported model tts-model」根因＝
没有该输入框、占位符直接发给端点；providers.json 只在开发水合，打包 404）；
Api.speak 对空/占位符模型抛 NO_MODEL→toast.needModel；端点/密钥两端已分离
（qwenBaseUrl/qwenApiKey vs baseUrl/apiKey，见 §6.9）。exe/APK 重出 1.2.4。
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

【2026-09-06 站坐姿 / 背景黑边 / 表情：已实施（AUDIT §9，不要退回去）】
上一轮那份「只调查未实施」的结论有两条是错的，先记下，别照它再改一遍：

* 错①：「坐姿仅在塔奥家门前可选，其余场景由 midgroundPostures 决定」。
  实测包里 200 组场景时间组合，**196 组只列 posture_sitting**（中景沙发是按坐着画的）。
  拿它当皮肤约束 = 全游戏永远穿 `_01`，玩家看到的还是「默认坐着」——
  这就是改完默认值用户仍然说「进游戏还是坐着的」的原因。
  现在：`postureKey()` 默认站姿；`midgroundPostures` **只决定哪里出现切换 chip**
  （`supportsBothPostures()`，全包只有 `stage_01_002_01` 四时段）。
* 错②：「`resolveSkel` 的 standing→`_99` 正确，皮肤没搞反」这句结论**对**，
  但理由要用数据说：两份 gesture 各自的 `projectConfig.postureKey` 就是权威
  （`_01`=座りライザ（普通座り）/posture_sitting，`_99`=ライザ(3の通常)_立ち/posture_standing）。
  真反的是三处：默认值（已改站姿 + `state.postureMigrated` 一次性迁移）、
  chip 标签（状态语义→**动作语义**：站着显示「座る/坐下」）、场景约束（见错①）。

黑边与背景跳位（实测数字，420×860，`stage_01_002_01`）：站姿窗口 −57…2232（高 2289）、
坐姿 359…2079（高 1720），而 `far_bg` 只画了 629…2701（高 2072），`floor` 在 −2701…−1064，
**中间 1693u 是空的**；站姿窗口比整块 `far_bg` 还高 217u ⇒ 光靠平移不可能不黑，
必须缩。横屏是同一个洞的另一半（`worldW = worldH × 宽高比`，一宽就走出美术左右边界）。
修法（`avatar.js` 一处收口，不给单舞台打补丁）：
`_coverFor()` 取**最大**绘制 quad 的世界框（不是并集，并集会把空带算成已覆盖）→
`_applyCamera()` 背景窗口取**场景自身姿态**的表内窗口，只缩不涨地钳进板内
（⇒ 切坐/站背景一动不动、任意视口无黑边）→ `_placeCharacter()` 用
`k = 解出窗口高 / 表内窗口高` 把角色映射进去（她的屏幕大小/位置仍是表里那套）。
站立「人沉在画面底部」：表里坐着的头在窗口 0.70、站着的在 0.37（ASMR 0.49/0.10），
是照更高的一块底板调的 ⇒ **视线对齐**（普通 0.68、ASMR 0.50，偏差 >0.10 才动，
头的局部高度从骨架 setup pose 现算，不按舞台写死）。实测站 268px / 坐 270px 同一视线。

换场景「先是放大的坐姿、再换一次才站」两个成因（都已修，别退回）：
① 姿态复位写在 `loadScene` 回调里，比皮肤解析晚一整个场景 ⇒ `postureKey()` 自己 gate；
② `loadScene` 先 `resize()` 后 `loadSkin()`，中间那一帧用新姿态的相机摆旧皮肤
（坐着的网格被 `_99` 的 `scale 1.488` 放大）⇒ 相机/摆位一律按
**屏幕上实际是哪套皮肤**（`_loadedPosture()` 读 `_loadedSkelId`）取参数。

表情（用户：「之前不小心把 asmr 模式的一个表情当 bug 移除了」）：
被 §3.7 第 10 条「说话不再重摇表情」连带削掉的是**重掷时机**，不是某个 set。
源包 AOT 有 `IntensitySettings.ExpressionRerollMin` / `expressionRerollIntervalMin/Max`
这两个字段名但 JSON 没给值 ⇒ 按「源里有就用源的、没有按常理」：姿势重掷 tick
（5–8s）里没说话时顺带 `_applyFace(false)`。实测（坐姿皮肤 ASMR 300 次重掷）
`weak` 档独有口型 `facial_mouth_010/015` 回来了。
`weight` 语义也钉住了：**不写=1，写 0=作者禁用**（`_99` 的 happy/weak 30 个里 18 个、
tease/weak 24 个里 12 个是显式 0）；整档被禁用时返回 null 退回该档 base，
不许再兜底把禁用的脸放出来。
新增第四套回归 `scripts/expression_coverage.js`：逐条核对引用能否解析、
每个 set 是否可达、哪些 facial clip 没人引用（只剩 `_scrub_01` 变体，源数据就没指）。

【一比一（强制）】
源 APK：`D:\download\ai.gospiral.atelierryza.v1.0.2.apk`（v1.0.2）。
玩家侧**能从 APK 落地的功能必须按源模块 + 原始数据一比一实现**，不要另起一套「能聊就行」的简化玩法。
屏幕/数据流以 `docs/dart_source_tree.txt` 的 features 文件名为准。
行为以 `web/assets/` 里的原始 JSON / 音频目录 / 骨骼 / UI 图为准（已与 APK 3609 个 flutter 资源对过，无缺无多）。
数值曲线类（等级表、价目、任务正文）在官方服务器（/v1/masters），包里只有键名和文案——
本地定值必须列在 AUDIT §6.3，不许当成官方数值传。
没有 Dart 源码可抄。官方登录/订阅/代币购买本身仍不做（见「明确不要做」）。

已核对记录：`docs/AUDIT.md`（2026-08-31 基线；09-01 动作修复 §3.7；09-02 游戏系统 §6；
09-03 点击精修 §3.9；09-04 布局 §7；09-05 模式化 TTS §8；09-06 姿态/相机/表情 §9）。
注意：AUDIT/HANDOFF 是**上一轮当时**的判断，不是事实源。本轮就发现旧文里两条结论是错的
（见下面 §9 那段的「错①/错②」）。冲突时以 `web/assets/` 里的原始 JSON + 真机实测为准。
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
      两个脚本都会：从 config/version.json 盖版本号（stamp_version.js）→ 暂存前跑
      privacy_check.py → 出成品后再跑一遍（APK 按 zip 成员逐个查）。命中即中止构建。
      APK 侧 android:hasFragileUserData=true（API29+ 卸载时问是否保留数据）；
      NSIS 侧 deleteAppDataOnUninstall=false（存档留在 %AppData%，彻底清用设置页）。
      ⚠ android/keystore 必须复用同一把 key，换 key 就不能原地升级。

【测试（改完必须全绿）】
  node scripts/motion_regression.js       # 立绘 60s×2 姿态 + 姿态/相机 300 组钳制断言
  node scripts/game_logic_regression.js   # 数值/任务链 1→8 通关/每日登录/reducer 钳位
  node scripts/boot_smoke.js              # App.init 用真实 index.html id 集全链路
  node scripts/expression_coverage.js     # 表情/动作可达性 + 引用解析全量核对
  node scripts/nsfw_intent_regression.js  # NSFW：标签切图集 + 路径约定
  python scripts/privacy_check.py web     # 打包前隐私自查（构建脚本已自动跑）
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

16. 【布局自适应（AUDIT §7，2026-09-04）不要退回去】
    - `#phone` 占满视口（fixed;inset:0），**别再引入 9:19.5 之类比例列**——黑边就是这么来的。
    - 桌面缩放=`App._fitUi` 设 `#phone` CSS zoom（ryzaShell 门控，手机/浏览器恒 1）；
      比例计算只能用 innerWidth/innerHeight，**用 clientWidth 会反馈震荡**。
    - 任何 `clientX - rect.left`→布局 px 的新代码，一律除以 `Avatar._cssZoom(el)`；
      画布 backing store 的 dpr 乘它。漏一处=点击偏或画面糊。
    - Android 刘海靠 manifest `windowLayoutInDisplayCutoutMode=shortEdges` +
      viewport-fit=cover + env(safe-area) 三件套，缺一有黑边。
    - 手机端 TTS 必须能在设置里填模型名（providers.json 打包不存在）；
      Api.speak 的占位符模型拦截（NO_MODEL）别删。

18. 【姿态与相机（AUDIT §9，2026-09-06）不要退回去】
    - 皮肤↔姿态的权威是两份 gesture 各自的 `projectConfig.postureKey`
      （`_01`=sitting、`_99`=standing）；**默认站姿**。
    - `midgroundPostures` 只决定「哪里允许切换」（`supportsBothPostures()`），
      **不要**再拿它当皮肤约束——196/200 组场景只列 sitting，那样全游戏永远坐着。
    - 背景窗口必须与玩家选的姿态无关（按 `_primaryPosture()` 解算），否则切坐/站跳位；
      钳制只允许「缩」不允许「涨」，涨了就出黑边。
    - `_placeCharacter`/`_applyCamera` 取相机参数一律用 `_loadedPosture()`
      （屏幕上实际是哪套皮肤）；用 `postureKey()`（请求值）就会在换场景那一帧
      把旧皮肤按新 `scale` 摆出来＝用户报的「放大的坐姿」。
    - 视线对齐只在偏差 >0.10 时生效，别改成无条件强推——那会毁掉 196 个场景的既有构图。
    - `_coverFor` 取**最大** quad 而不是并集（并集把 `floor` 拉进来，假装空带被画了）；
      量时忽略 `slot.color.a`（淡入中途会判空）；`RegionAttachment` 的四角缓存
      首帧前可能是空的，那个「尺寸×骨骼矩阵」的兜底框别删。
    - **不要**再做「非 ASMR 全身拟合」：源机位本来就裁脚、BB_* 热区在躯干。
      把人缩小会让模型显得过小，还会把坐姿从沙发上抬到空气里。
    - 坐姿有 `sofa_root` 时用世界坐标（不要走 `k` 映射）；ASMR zoom 用源表
      3.5/2.5，不要拿 `cameraPanY≈3200` 当正交中心。
    - NSFW 脱衣只认标签行 `nsfw:on/off`（和 emotion 同一栏）。不要再做玩家关键词
      立刻换图，也不要为这一下接 OpenAI tools（自填接口不一定支持，且会多一套协议）。
17. 【模式化 TTS + 气泡生命周期（AUDIT §8，2026-09-05）不要退回去】
    - TTS 语音指导= `ttsStyleFor(mode)` 两层：`tts.styleHint`（基底，用户可改）
      + `MODE_TTS[mode]`（模式层，`tts.modeHints` 可覆盖）。别退回「所有模式
      共用一条 styleHint」——那正是「ASMR 听起来不像 ASMR」的根因。
    - `input.instructions` 只在模型名含 instruct 时加（flash/vc 不接指令）。
      `MODE_PLAY_FX`（App.playUrl(url, fx)）是端点不吃指导时的 ASMR 保底，
      onended 必须复位 playbackRate——否则闹钟/点击语音也跟着变调。
    - 气泡淡出三件套：`_bubbleHold/_bubbleKeep/_bubbleReveal`。说话期间必须
      Keep（playUrl 开播取消、onended 重排 1.6s）；打字完成后无语音路线
      5.2s、有语音路线 12s 兜底。别把 `.fade-out` 的 520ms 与 JS 定时器改掉。
    - `#bubble-wrap` 依旧 `pointer-events:none`（立绘热区靠它透下去）；
      淡出只动 `#bubble` 本体。占位符模型检查走 `Api.isPlaceholderModel()`
      唯一出口；`App.esc` 是真转义（任务标题进过 innerHTML），别退回 String()。

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
  - app.js 已按节分区（utils/boot/chrome/talk/sheets/LLM/bubble/alarms/modal/
    memory/skins/forms/语言矩阵/作弊/存档槽，82 个方法），**唯一还值得动的一刀**
    是把「forms + 语言矩阵 + 作弊 + 存档槽」四段（约 1.1k 行，纯 UI 装配，
    只读 Config/Game）拆成 web/js/settings.js：拆时要一起改 index.html 的
    script 顺序（在 app.js 之前）、boot_smoke 的文件清单，以及
    App.buildSettings/buildCharaForm/_renderSlots 三个入口名。本轮**没拆**，
    因为刚验完「安装包与源码逐文件哈希一致」，不想在打包之后再动结构。

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
