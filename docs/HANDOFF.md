我在做一个同人向的离线 AI 聊天 App（原创同人项目，个人自用，不做任何分发），
技术栈是纯前端 HTML + JavaScript + Spine 4.2 骨骼动画，素材是本地文件，
没有任何官方服务端。代码已经能跑起来，现在需要你继续开发。

【一比一（强制）】
源 APK：`D:\download\ai.gospiral.atelierryza.v1.0.2.apk`（v1.0.2）。
玩家侧**能从 APK 落地的功能必须按源模块 + 原始数据一比一实现**，不要另起一套「能聊就行」的简化玩法。
屏幕/数据流以 `docs/dart_source_tree.txt` 的 features 文件名为准。
行为以 `web/assets/` 里的原始 JSON / 音频目录 / 骨骼 / UI 图为准（已与 APK 3609 个 flutter 资源对过，无缺无多）。
没有 Dart 源码可抄。官方登录/付费/分析等见下面「明确不要做」。

已核对记录：`docs/AUDIT.md`（2026-08-31）。结论：**素材对；主路径已接上。**
音景与源包一致：**对话页没有 BGM**（包里只有 `bgm_opening` / `bgm_world_map` 两首），对话页播地点 ambient；进地图才切 `bgm_world_map`。不要把「地图才出 BGM」当成漏做。腮红 overlay 按 Normal。角色 `Physics.update` **只一次**。
`config/providers.json` 含水合用的 API Key，**不要进 git**；复制 `config/providers.example.json` 再填。
不要把 AUDIT 旧段落里的「NPC 调度错、FX_BY_EMOTION、循环 fade_in」当成还没修——那些已经改过。先读 AUDIT 全文再动手。

【先读这两个文件，它们描述了整个项目】
  projects/ryza-ai-revive/docs/PROJECT.md
    ├─ 第 1-2 节：目录结构、每个 JS 文件的职责与关键函数
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
      口型 ← `lipSyncClosure`。
  web/assets/world_map/world_hierarchy.json
      5 区域 / 38 场景块 / 120 舞台的层级与地名
  web/assets/world_map/npc_placement.json
      34 位 NPC：bases / move / companions / resolveOrder
  web/assets/world_map/ui/*.svg
      地图钉子 / 区域针
  web/assets/data/stage_background_map.json
      120 个舞台 → 50 套背景的映射
  web/assets/data/posture_camera.json
      sitting zoom 1.93 / standing 1.45 / ASMR 3.5。ASMR 特写是表里的，不是比例算错。
      代码里视野高度是 `1720 / (zoom/1.93)`，不要改回用角色 AABB 缩放整屏。
  web/assets/spine/scenes/<舞台>_<时段>/spine/
      200 组场景骨骼（50 套 × mor/aft/eve/ngt 四时段）
  web/assets/spine/scenes/<舞台>_<时段>/<同名>.json
      constraintOverrides（视差 mix 已写）、light.rim*（FBO 轮廓着色器）、midgroundPostures（选坐/站骨骼）
  web/assets/audio/alarm/<语种>/<语气>/<类型>/<时段>/
      1120 条预录语音，旁挂同名 .env.json（口型）
  web/assets/audio/bgm/  ambient/  se/  tap_voice/  prologue/
      BGM 只有两首：`bgm_opening.m4a`（标题，`BackgroundTrackId.bgmOpening`）、
      `bgm_world_map.m4a`（地图，`bgmWorldMap`）。对话页没有第三首 BGM，
      背景是 `ambient/amb_NNN_{day,night}.m4a`（`amb001Day`…）。
      路由见 `docs/AUDIT.md` §3.6。`audio.js` / `onboarding.js` 已接线。
  web/assets/welcome_mission/
      欢迎任务 UI 图
  web/assets/voice/ryza_wav/*.wav
      从开场白原声转出的 24kHz 单声道 wav，TTS 声音克隆用
另有抽取产物（非原始文件，仅供参考）：
  docs/dart_source_tree.txt      源码路径名（功能模块清单）
  data/libapp_strings_ja.txt     1601 条日文 UI 文案原文
  docs/reference/apk_asset_inventory.txt   源包内 3609 个文件的清单
  docs/reference/strings_ja_ui.txt         清洗后的日文文案

【重要前提：没有反编译源码】
源包是 Flutter 应用，业务逻辑是二进制里的 Dart AOT 编译快照，不可逆回源码；
8 个 dex 也只是 Flutter/Firebase 样板，没有业务逻辑。
所以不要试图去找「原来的函数」照着改。实现方式是：
  1. 用 dart_source_tree 的模块/屏幕/文件名，还原源项目的页面与数据流；
  2. 用上面的原始 JSON / 音频 / 骨骼 / UI 图，填进这些页面；
  3. 文案可对照 data/libapp_strings_ja.txt。
不要另起一套「能聊就行」的简化玩法。

【运行方式】
  cd projects/ryza-ai-revive
  python scripts/serve.py
  打开 http://127.0.0.1:8765/

必须用 `scripts/serve.py`（静态 + `POST /_proxy` 转发 LLM/TTS）。
`python -m http.server` 没有代理，浏览器会 CORS 失败。

【已经跑通的部分】
标题页、onboarding 问卷/序章/教程、
单 WebGL 画布立绘+场景（fade 一次、不闪）、坐/站随 `midgroundPostures`、
gesture：待机不跟情绪换、一次性覆盖、effectSets 特效、注视/指尖、手臂组、lipSync、
分部位点击、腮红 overlay 按 Normal（颊线/鼻高光仍摘）、
世界钉子图 + NPC 全字段、音景（标题 opening BGM / 对话 ambient / 地图 world BGM）、闹钟响铃/贪睡/env、
5 槽换装+veil、欢迎任务、存档槽、道具栏、
LLM 经代理 + providers.json 水合、TTS 克隆、
desktop/ 有 pywebview 壳，android/ 有 WebView 薄壳（本机尚未打出 exe/apk）。

【立绘坑（已经踩过，不要退回去）】
1. 两块 WebGL 或给 avatar-canvas 再 getContext，Windows 会闪。点击层是 div。
2. 场景 `anm_fade_in` 必须 loop:false。loop 会每秒从透明重来。
3. 图集没有 pma:true。全局 PMA 会让网格接缝发黑。Multiply 的颊线/鼻高光直通 Alpha 会过曝：idle 摘掉这两槽。ON 腮红走 `038_face_cheek`，**按 Normal 画**（不要 Multiply 第二遍 PMA，腮红会过曝）。头发阴影才 PMA。
4. 换情绪不要 `setAnimation(0, 新idle)`。`fixedBasePoseMode` 下一次性动作在 track 1，empty 的 delay 必须 ≤0（从片段结束淡出）。delay 0.2 会在开拍 0.2 秒把动作掐掉。一次性 `motion_oneshot_D_*` **不要** mute 手臂/躯干/腿。
5. 不要用角色 AABB 当镜头，换装会连带缩放背景。
6. Occupancy 的 `motion_add_F/G/B/E/C` 是完整肢体 pose，track 上必须 `MixBlend.replace`。`MixBlend.add` 只给 `effect_wind*`。用 add 会把手臂叠成立柱。
7. 场景 rim：角色先画到屏幕，FBO 只加算轮廓。不要把角色主画面改成 FBO blit（会变成黑剪影）。
8. idle 重掷不要重抽仍适用的 MotionGroup；同 AnimName 不要 out→in。未标 `poseTypeIds` 的 A_* 不要当所有姿势类型的候选。
9. 角色 `Physics.update` **只一次**。不要再 `Physics.none`，那会丢掉物理、动作抖。肢体换组时不要 `setEmptyAnimation(mix=0)` 再 delay，也不要 `addAnimation` 接到 looping 当前片段后面（永远不会开始）。
10. 音景是源设计，不是漏做：对话页 **不要** 播 BGM；进 `world_map_screen` 才播 `bgm_world_map`。对话页 `setRoute('talk')` 必须播地点 ambient。`Sound.unlock` 用独立 Audio；循环 src 记在 `_loopSrc`，禁止写 `_ambientSrc`（会把解析函数覆盖掉，环境音永久没声）。

【三条必须知道的技术约束】
1. Spine 4.2 的 skeleton.updateWorldTransform() 必须传参，
   传 spine.Physics.update（那是个枚举，不是类）；
   每帧还要先 skeleton.update(dt) 推进 skeleton.time，否则物理约束不动。
   场景用 Physics.none。
2. 渲染用官方示例的写法（ManagedWebGLRenderingContext + 自建 Matrix4 MVP
   + PolygonBatcher + SkeletonRenderer）。SceneRenderer 的 OrthoCamera 不要
   用，它的 zoom 语义是乘不是除。
3. TTS 参考音频只接受 wav / mp3，传 m4a 会报
   "Unsupported audio.voice source format: mp4"。

【怎么写功能（强制）】
按源项目逻辑写，不要猜。每个功能先读：
  - dart_source_tree 里对应 features/<模块>/ 的 screens、widgets、models、data 文件名
  - PROJECT.md 第 7 节对应的原始数据
  - 日文文案里相关句子
然后再改 web/js、web/index.html、web/css。
缺数据的官方接口（mission-board、登录、订阅）用本地 JSON / localStorage 替代，
但玩家看见的流程要跟源模块一致。

【还剩的、能做的】
  - 标题/语音钮是按 Lottie JSON 帧率画的画布，不是 Lottie 运行时（源包未带运行时，CDN 也不引入）
  - `spine/objects/` 仍只有图集、没有完整 skel

【明确不要做】（源项目有、本重建去掉）
登录 / Firebase、订阅付费墙、代币与回合票、体力苹果、皮肤内购、
每日登录领奖、远程资源下载门、公告服、强制更新、分析/崩溃上报、
官方 marionette/yorisoi websocket（LLM 继续走玩家自己填的 OpenAI 兼容接口）。
法律条文页不必复刻官方文本。

【怎么看画面（强制）】
你有多模态，可以直接看图。打开 http://127.0.0.1:8765/ 之后，
自己看真实页面：立绘与场景是否对齐、地图钉子、闹钟响铃、问卷、换装、标题。
不要写 ASCII 密度图，不要用 puppeteer / 无头截图脚本，
不要用「测 canvas 像素」的脚本代替自己看。

【输出位置】
只改 projects/ryza-ai-revive/ 内的文件。仓库根目录规范见 AGENTS.md 与 structure.md，
不要往仓库根目录丢文件。

两点补充说明：

docs/recon-report.md 已移到 D:\agent\backup\ryza-recon-report.md。那份文档通篇是源 App 的结构分析（接口、包结构、官方特征），留在要交出去的目录里正好是最容易触发审核的东西。没删，你要看随时能看。

另外参照价值的解码产物在 docs/reference/——按项目规范 temp/ 是「可随时清理」的，不该让后续工作依赖它。
