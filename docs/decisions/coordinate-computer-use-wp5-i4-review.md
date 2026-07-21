# WP5 I4 迭代评审 — 实验层用户开启路径

> **评审对象**：WP5 迭代 I4（WI-4.1~4.5，五 commits：`36780fb`/`b087696`/`bc12053`/`2747477`/`946c980`）
> **评审时间**：2026-07-21T08:20+0800（时间锚点）；亲跑验证 2026-07-21T08:14-08:20+0800
> **评审依据**：plan WP5-I4 节（plan:527-615 实施详案 + 出口标准 :570-584 + 对抗修订 P1-P10 :603-615）、`coordinate-computer-use-wp5-i4-implementation-notes.md`、I3 留账四项（i3-review §4）
> **评审纪律**：禁止改业务代码；所有结论亲跑或读码验证，证据落 文件:行号

**裁决：PASS**

I4 交付面——config 五字段 + normalize 防篡改、WS 开关族四路由双层围栏 + 生物识别门、per-task admission 六路 fail-closed 组装、扩展设置页用户面、端到端验收（P7 回归 + 双臂冒烟 + golden 双臂）——全部闭环且经亲跑与读码双重验证；出口标准 6/6 逐条满足，P1-P10 修订逐项落实，I3 留账四项全部清零。设计裁决 1-6 与代码形态逐一吻合；plan 风险节声明的四项诚实边界（owner host 未定禁网兜底 / 冒烟手动臂 / 任务内 admission 不收回 / P10 轮询 DoS 残余）与代码及文档完全一致，无未声明缺口。发现清单 7 条全部为信息级确认（含 1 条既有基线失败对账），无一阻塞。

---

## 1. 亲跑验证记录

时间锚点：`2026-07-21T08:20:16+0800`（`date` 实取）。node=kimi-desktop runtime v24.15.0；tsc 走 `node node_modules/typescript/bin/tsc`；npx 不可用（环境既有）。

| # | 验证项 | 方式 | 结果 |
|---|---|---|---|
| 1 | companion 类型检查 | `tsc --noEmit` + `tsc -p tsconfig.test.json`（重建 .test-dist） | 双 exit 0 ✅ |
| 2 | 门禁套件（computer+apps 口径） | `node --test $(find .test-dist/tests -name 'computer-*.test.js' -o -name 'apps-*.test.js' \| sort)` | **660/660 全绿**（5 suites, 0 fail）——与 `946c980` 自报累计口径 621→660 精确吻合（WI-4.1 +6 在 config.test 不计口径 / WI-4.2 +15 / WI-4.3 +19 / WI-4.4 +4 / WI-4.5 +1）✅ |
| 3 | chrome-extension 类型检查 | `tsc --noEmit` | exit 0 ✅ |
| 4 | chrome-extension 套件 | 重建 .test-dist + `node --test .test-dist/tests/*.test.js` | **196/196 全绿**（0 fail），与自报 176→196（+20）吻合 ✅ |
| 5 | 开启态冒烟 hybrid 臂 | `node scripts/verify-tinyclick-enable-smoke.js --variant hybrid` | 全断言通过（fail-closed 基线 → license_required 四段标记 → 时间戳+12 位哈希+download-host-unset 零网络 → 生物识别门双路 → admission 真会话 → 拒绝臂零注入零预算 → 批准臂 G4+续期各一次、批准后才耗预算、uncrossverified、confidence 缺省）；注入点 vs frozen 锚 **dist=0.0px** ✅ |
| 6 | 开启态冒烟 int8 臂 | 同上 `--variant int8` | 全断言通过；dist=0.0px ✅ |
| 7 | golden 门禁 hybrid 臂 | `node scripts/verify-tinyclick-golden.js --variant hybrid` | **total=19 pass=16 fail=0 report=3**——与 F-1 冻结基线完全一致 ✅ |
| 8 | golden 门禁 int8 臂 | 同上 `--variant int8` | **total=19 pass=17 fail=0 report=2**——与 F-1 冻结基线完全一致 ✅ |
| 9 | config.test 口径外对账 | `node --test .test-dist/tests/config.test.js` | 44 tests / 42 pass / 2 fail（4 个失败条目 = 顶层 `saveConfig vision API key`、`migrateLegacyModelName` 两 describe 及其内 0o600 用例）——**I4 新增 6 条 normalize 测全过**（loud log 实见：coerce/delete/P9 WARNING 全触发）；失败条目均为 0o600 断言（actual 438=0o666 vs expected 384=0o600，Windows chmod 语义），经 `git show 7bc6bd6` 核对同用例 I3 基线已存在（config.test.ts 上次改动为 I1 `2304d18`），**非 I4 引入** ✅（见 F-7） |

验证后工作树零业务改动（仅本评审文档新增；冒烟隔离 DATA_DIR 在 %TEMP%，golden 产出仅 stdout）。盘上 untracked `dist-package-new/` 与 `scripts/spike/s3-golden/i2-worker-benchmark-hybrid-2026-07-20_15-27-48.json` 为前轮遗留非本评审产物，未动。

---

## 2. 评审重点逐项

### 2.1 出口标准逐条核对（plan:570-584）——6/6 满足

**① WI-3.4 原文出口全闭环 + P2 挂钩（plan:465-467/:572）✅**

- 开关状态机测试（无乐观更新、拒绝永久跳过）：扩展 store 四字段只读镜像、reducer 仅响应 `SET_COMPUTER_MODEL_*`（agentStore.tsx:444-457），useWebSocket 三事件映射字段逐个形状校验（useWebSocket.ts:575-614），无本地写路径；拒绝永久跳过 = `model-handlers.ts:288-293` LICENSE_DECLINED 恒返 + `config.ts:101` `modelLicenseDeclined` 字段；computer-model-state.test.ts / model-switch-logic.test.ts 各 8/12 测在套件 196 内全绿（§1 #4）。
- license 门文案双引核对：冒烟断言四段标记（MIT 全文 / Samsung 版权行 / Ethics 引文 / 实测披露「英文短命令」+「13.3%」）双臂实过（§1 #5/#6）；`model-license.ts` 单一真源 + LICENSE_DOOR_TEXT 与 THIRD_PARTY_NOTICES 逐字节一致有既有测试强制（model-license.ts:9-10 注释）。
- 扩展 model 状态折叠测试：computer-model-state.test.ts（状态折叠/广播驱动/无乐观更新）在 196 口径内。
- **P2 挂钩**：`model-state-messages.ts:203-209` layerSemantics 补 per-task 生效语义 + Ctrl+Alt+End/中止任务 estop 引导；`:215-218` switchRunningNote 旁注；扩展镜像逐字一致（model-switch-logic.ts:183-188/195-197），两侧文案断言互锁（companion computer-model-states.test.ts ↔ 扩展 model-switch-logic.test.ts）；运行中旁注判定纯函数（model-switch-logic.ts:305-311）+ 组件接线（SettingsSlideout.tsx 实验区段 runningNote 渲染）。
- 三层依赖提示：masterOffHint 已接线（SettingsSlideout 实验区段传 `state.computerCoordinateEnabled`）；appNotAllowedHint 逻辑+优先级矩阵+测试在案（model-switch-logic.ts:271-278）——全局设置页无单应用上下文故传 null（不判该层，:269 契约注释），见 F-5。

**② O-1 四写入点可达性分析表（plan:573-580，I4 评审逐点重做）✅**

实施笔记 §1 表格与代码逐点复核一致：

| 写入点 | 代码实证 | 复核结论 |
|---|---|---|
| ① server.ts admission 实参 | `server.ts:2005-2015` per-task `resolveTinyClickAdmission({config, holder, deps})`；`:2079` `tinyclickLocator: tinyclickAdmission.locator` 透传；刷新链 `executor.ts:993` `tinyclick: null` 显式不动 | 纯函数六路 fail-closed（见 §2.2）；P7 回归结构锁定（见 §2.3）✅ |
| ② holder 写入 | 写入仅三处：`model-admission.ts:227`（admission 全通过懒建）、`model-handlers.ts:278`（disable dispose 后）、`model-handlers.ts:408`（delete dispose 后）；grep 证据在笔记 §2（本轮复核行号一致） | 并发首建单飞（inFlightBuilds WeakMap，admission :209-215，sessionFactory 仅调一次）；stillEnabled 落地竞态复核 dispose 不写 holder（:217-226）✅ |
| ③ config 五字段 | `config.ts:89-106` 字段定义、`:208-210` 默认形、`:378-417` normalize（非布尔 coerce false / 非 ISO delete / 哈希形状 `/^[0-9a-f]{12}$/` delete / variant 非枚举回退 hybrid，全 loud log）、`:421-424` P9 启动期醒目 WARNING（cache-miss 每进程一次） | 只防形状不撤销合法布尔（裁决 3 语义继承，笔记 §3 文档化）；写入唯一通道 `setComputerModelFields` 白名单四键（config.ts:530，**modelVariant 不在白名单** = 无 WS setter，裁决 4/P3 落实）✅ |
| ④ WS 六路由 | `server.ts:2656-2673` validateWsMessage 四条目（set_enabled 要 enabled:boolean / license_response 要 accepted:boolean / 四者均 source:"settings"）+ `model-handlers.ts:250-260` handler belt 五 type 统一复核（INVALID_SOURCE + 审计）+ `message-router.ts:973-981` 六 case | 双层围栏名实相符（P6）；未知类型默认放行故此六条目真围栏 ✅ |

**③ golden 双臂重跑全绿（plan:581）✅** — §1 #7/#8：hybrid 16P/3R/0F、int8 17P/2R/0F，与 F-1 冻结基线完全一致；准确率臂锚无漂移；延迟臂基线相对 ×2.5 机器无关（I3 F-1 已根治，本轮未复现热饱和假阳性）。

**④ 开启态冒烟（plan:582）✅** — §1 #5/#6 双臂全绿。逐锚核对：reL2 caption 含「实验层建议（TinyClick 本地模型，未校准，可能完全错误）」（verify-tinyclick-enable-smoke.js:314/:325 断言）；拒绝臂降级链无污染（无后续 tinyclick hit，:328-329）+ ELEMENT_NOT_FOUND 诚实降级（:320）+ 零注入（:321）；批准臂 uncrossverified 标记（:356-357）+ **G4 批准后才耗预算**（M1 挂钩：拒绝臂 completedActions=0 vs 批准臂=4 对照，:322/:348）+ G4 门 + A1.3 续期门各一次（:349）+ confidence 缺省（G3，:355）。

**⑤ license 门四段 + 漂移重门（plan:583）✅** — 未接受开启被拒：`model-handlers.ts:294-300` license_required 载荷（LICENSE_DOOR_TEXT + notice）+ **config 零写入**（该分支无任何 setComputerModelFields 调用，冒烟 :177 实证）；接受后双要素记录：`:331-335` 时间戳 + `LICENSE_DOOR_TEXT_HASH`（`model-license.ts:125-128`，sha256 前 12 位版本指纹）；**条款漂移重门**：enable 侧 `modelLicenseAccepted(cfg)` 双要素比对（handlers :294 前置）+ admission 侧 ③ 路同查（model-admission.ts:184）——两处重门，文本漂移后旧接受不默示生效（P1 落实）；拒绝后恒 LICENSE_DECLINED（:288-293）；四段文案双引冒烟实证（§1 #5）。

**⑥ 生物识别门同级（plan:584）✅** — set_enabled(true) 门流次序读码核实（`model-handlers.ts:266-326`）：declined 检查（:288）→ license 双要素（:294）→ 确认通道存在性（:302，缺通道 NO_CONFIRMATION_CHANNEL，P5）→ D2 生物识别门 `requireAppsBiometric` 复用（:307-313，action/reason 明示持久能力授权语义）→ **批准后才写 config**（:321 `setComputerModelFields({modelEnabled:true})`）——批准前全路径零写入，崩溃时序 fail-safe 方向（未持久 = 默认关）。fake 门双路测试在套件（WI-4.2 +15 含门双路）+ 冒烟双路实证（§1 #5）；enabled:false 免费 + dispose + holder=null（:270-284，裁决 4）；license/download/delete 不过门、settings 双层围栏（裁决 1 边界与代码一致）。

### 2.2 admission 纯函数六路 fail-closed（model-admission.ts 全读，229 行）

判定序 ①开关（:182）②declined（:183）③license 双要素（P1 漂移重门 admission 侧比对，:184）④熔断（:203）⑤单飞懒建（:209-215）→ holder 写入点①（:227）——任一拒绝路径 fail-closed（locator=null=层关闭，attempts 记 skipped model-disabled，UIA/OCR/框选链不受影响）。**外来会话防御**：sessionMeta WeakMap（:117-121/:149）配对同实例 tokenizer，非 admission 构建的会话 fail-closed `model-session-foreign`（:189，宁可不开层）。**竞态双保险**：落地×关闭 stillEnabled 新鲜度复核 dispose 不写 holder（:217-226，~1.3GB RSS 泄漏面闭合）；懒建失败 loud log + holder 不写入（:216，下任务重试不卡死）。每任务新建 locator（:190-197）坍缩历史任务级（跨任务零泄漏，I3 语义继承）。ADMISSION_REASON 词表（:60-67）闭合。server.ts 调用点 deps 注入 stillEnabled 重读 config（server.ts:2013）——getConfig 缓存与 setComputerModelFields 写路径同步更新（config.ts setter 直写 cachedConfig），一致性成立。

### 2.3 P7 回归测试——executor.ts:993 结构锁定有效

`computer-executor.test.ts` P7 用例（946c980 diff +53 行）：admission 开启态（`tinyclickLocator: tc.locator` 提供）+ X3 刷新形态下，批准后刷新链 `deps.tinyclick` 恒 null——tc 零调用断言 + 日志仅 `computeruse.locate{layer:tinyclick, hit:false, reason:model-disabled, refresh:true}` 跳过形态。executor.ts:990-993 注释自证（「刷新是对已门控决定的新鲜度复核，永不引入实验层新建议」）。**未来重构若把实验层透传进刷新链（未经 G4 人审的建议借道）此测试必红**——锁定语义明确，本轮在 660 口径内实绿（§1 #2）。

### 2.4 P4 dispose 竞态豁免面核查——窄且自洽，不过宽

`tinyclick-runtime.ts:567-580`：disposed 后 registerFault 不计数/不熔断/不广播 + `fault-suppressed` 审计留痕。豁免面三点核查：

1. **置位时机**：`dispose()` 首句同步置位（:280-281），无置位前窗口——豁免区间严格 = dispose 发起后。
2. **豁免对象不可复用**：disposed 实例的故障计数与未来 admission 无关——disable/delete 路径 dispose 后 holder 置 null（handlers :278/:408），竞态路径会话从不入 holder（admission :217-226）；下一任务经单飞懒建**全新实例**（计数器全新）。被豁免的计数永不影响任何后续判定。
3. **遥测诚实**：豁免只抑制计数/熔断/广播，审计 log 仍留痕（fault-suppressed 带 reason+message）——用户关闭/删除模型后不会看到伪造的「熔断」广播，排障证据不丢。

结论：豁免面 = 「死实例的尾随噪声」，语义边界精确，非过宽（M6 冷启动排除语义的正交扩展，笔记 §9-2 偏离登记如实）。

### 2.5 扩展用户面——无乐观更新落实 + family 路由 + 门渲染单一真源

- **无乐观更新**：store 注释明示（agentStore.tsx:64-68）+ reducer 仅广播驱动（:444-457）；非下载中 state 到达清陈旧进度（:445-449）防僵尸百分比；设置页打开拉一次 get_state + 清残留错误/删除待命态（SettingsSlideout 打开 effect）。
- **错误路由**：modelError family → `"computer.model"`（model-handlers.ts:71-74 注释：BIOMETRIC_DENIED 共享 code 不可分，family 是唯一无歧义路由键；旧扩展忽略 family 落 chat 向后兼容）；useWebSocket error case `isComputerModelErrorMessage` **先于** apps 判定（useWebSocket.ts:739-743）。
- **许可证门**：Modal 渲染 license_required 载荷原文（SettingsSlideout 许可证门段 licenseText/notice 直渲），扩展不复制不私编（LICENSE_DOOR_TEXT 单一真源在 companion）；接受/拒绝双钮均发 license_response 并闭门；X/遮罩关闭 = 仅闭门不应答 = 未接受态 fail-closed。
- **两步删除**：modelDeleteArmed 组件内 UI 态（非 store），打开设置页复位。
- **background 透传白名单六 case**（background/index.ts:733-741），注释明载生物识别门与双层围栏归属 companion——扩展不做信任判定，信任边界划清。

### 2.6 PNG 解码器（png-decode.ts 全读，178 行）——安全面全 fail-closed

自研理由在案（:1-21：零新依赖纪律 + 输入形态收敛 = computer-capture.ps1 产出 8-bit 非隔行 ct6/2）。拒绝面逐条核实：签名（:49）、chunk 截断（:65）、首 chunk 非 IHDR（:66）、IHDR 长度（:68）、未知压缩/过滤（:73-74）、缺 IHDR/IEND/IDAT（:86-88）、尺寸上限 8192²（:20-21/:89-91）、16-bit（:92）、Adam7 隔行（:93）、调色板/未知 ct（:95-96）、deflate 损坏（:101-103）、解压长度精确匹配（:106）、未知过滤类型（:146）。不过滤 CRC 的取舍在案（:12-14：可信本地源 + shot.sha256 证据链上游校验）。反过滤 0-4 边处理正确；allocUnsafe 全程覆写无未初始化泄漏。畸形矩阵测试在 660 口径内（WI-4.3 png-decode 5 测）。

### 2.7 P1-P10 对抗修订落实抽查表

| # | 修订 | 落实证据 | 状态 |
|---|---|---|---|
| P1 | license 接受绑定文本版本 + 漂移重门 | config.ts:96/402-409（字段+形状 delete）；model-license.ts:125-128（HASH）；handlers :294（enable 侧比对）+ admission :184（admission 侧比对）；冒烟 :186 断言 12 位哈希 | ✅ |
| P2 | layerSemantics per-task + estop 引导 + 运行中旁注 | model-state-messages.ts:203-218；扩展镜像 model-switch-logic.ts:183-197；组件接线 SettingsSlideout runningNote；双侧断言互锁 | ✅ |
| P3 | 变体切换 = 手改 config + 重启（无 WS setter） | setComputerModelFields 白名单四键不含 modelVariant（config.ts:530-541）；download 按当前配置变体（handlers :370-371/:392）；变体缺失诚实文案（model-variant-missing 词表） | ✅ |
| P4 | dispose 竞态豁免 | tinyclick-runtime.ts:567-580（§2.4 核查通过）；偏离登记如实（笔记 §9-2） | ✅ |
| P5 | requestConfirmation 注入 + 缺通道 NO_CONFIRMATION_CHANNEL | message-router.ts:980 注入；handlers :302-306 缺通道返错 | ✅ |
| P6 | handler belt 五 type 复核 + 四负测试 | handlers :250-260；belt 四负测试在 WI-4.2 +15 内 | ✅ |
| P7 | 刷新链恒 null 回归 | computer-executor.test.ts P7 用例；executor.ts:993 实见 `tinyclick: null`（§2.3） | ✅ |
| P8 | holder 无第二写入方 grep 证据在案化 | 笔记 §2（行号本轮复核一致：admission :227 / handlers :278/:408；server.ts 只读传递 :2007-2009） | ✅ |
| P9 | 启动期醒目 loud log | config.ts:421-424（cache-miss 每进程一次不刷屏；config.test 实测触发，§1 #9） | ✅ |
| P10 | 轮询 DoS 残余声明 | 笔记 §5（损害有界 = 磁盘预算 2048MB 封顶 + .invalid 零网络 fail-fast；高度可见 = 审计 + 广播）；代码形态一致（handlers :340-356/:372-374 单飞幂等 + :384-391 禁网兜底） | ✅ |

### 2.8 设计裁决 1-6 与风险边界一致性

裁决 1（生物识别门同级/license·download·delete 不过门）、裁决 2（许可证状态机/拒绝永久跳过无 UI 复位）、裁决 3（手改 config = owner opt-in 文档化，笔记 §3「门防 LLM 驱动/脚本化 WS 客户端；本机文件系统写权限在 ADR-010 信任边界内」消解双标叙事）、裁决 4（变体不热切换/disable·delete dispose 免费）、裁决 5（.invalid 占位 + 未配镜像 = DOWNLOAD_HOST_UNSET 零网络 fail-fast，冒烟 :187-188 零进度广播实证）、裁决 6（进度 UI 简化 = 状态行 + 百分比文本）——六项全部与代码形态吻合。风险节四项声明（任务内 admission 不收回 / P10 残余 / owner host 未定 / 空命令 admission 前置不立案）与笔记 §5/§6/§8 及代码一致，无未声明缺口；manual-nonce 真实强度一句话在案（笔记 §4：防 LLM 工具循环、不防有 shell 能力同级脚本——D2 门族固有非 I4 新引入）。

---

## 3. 发现清单

| # | 级别 | 发现 | 证据 | 处置 |
|---|---|---|---|---|
| F-1 | INFO | P4 dispose 竞态豁免面核查通过——窄且自洽：豁免区间严格 = dispose 发起后（首句同步置位 :280-281），豁免对象（死实例）不可复用故计数豁免不影响任何后续 admission，审计 fault-suppressed 留痕 | tinyclick-runtime.ts:567-580；model-handlers.ts:278/:408；model-admission.ts:217-226 | 无需处置（登记核查结论） |
| F-2 | INFO | set_enabled(true) 门流次序核实：declined(:288)→license 双要素(:294)→确认通道(:302)→生物识别门(:307)→批准后写 config(:321)——批准前全路径零写入，崩溃时序 fail-safe | model-handlers.ts:266-326 | 无需处置 |
| F-3 | INFO | get_state 磁盘复验为 stat 级（存在+大小），全量 sha256 复验留 admission（I1 校验即加载）——诚实边界注释在案，与 plan:476 全形一致；probeModelDir absent/error/ready 三分支不伪造就绪 | model-handlers.ts probeModelDir 段及注释 | 无需处置 |
| F-4 | INFO | 冒烟手动臂（真 Windows Hello 弹窗双路 + 真设置页渲染 + 真机关闭开关观察旁注）= 发版前人工 checklist——自动臂 fake 门已覆盖逻辑双路；Hello 实机面属 D2 门族既有验收（apps.set_coordinate_allowed 同门），plan :556 自声明、笔记 §8 末在案 | verify-tinyclick-enable-smoke.js:26-27；implementation-notes §8 | 发版前执行 checklist（计划内项，非缺口） |
| F-5 | INFO | appNotAllowedHint 分支逻辑+优先级矩阵+测试在案，但全局设置页无单应用上下文（组件传 null = 不判该层，model-switch-logic.ts:269 契约注释）——WI-4.4 范围（plan:552-553）仅要求逻辑+设置页渲染，per-app 消费面留待未来有单应用上下文的表面；masterOffHint 已实接线 | model-switch-logic.ts:271-278；SettingsSlideout 实验区段 | 无需处置（功能诚实：未知即不判） |
| F-6 | INFO | 任务内 admission 不收回 = plan 风险节登记的设计取舍（plan:592），I4 评审接受——文案侧已闭环（P2 旁注+estop 引导），立即停止真实通道 = estop 三通道非开关；build×关闭竞态经 stillEnabled 复核闭合 | plan:592；implementation-notes §6；model-admission.ts:217-226 | 无需处置（接受登记） |
| F-7 | INFO | config.test（口径外）44 tests / 2 fail = 0o600 断言组（actual 438 vs expected 384，Windows chmod 语义）——`git show 7bc6bd6` 核对同用例 I3 基线已存在（config.test.ts 上次改动 I1 `2304d18`），**非 I4 引入**；I4 新增 6 条 normalize 测全过（loud log 实见） | §1 #9；7bc6bd6:companion/tests/config.test.ts:203/:282/:374 | 无需处置（既有平台基线；门禁口径 computer+apps 不含 config.test 为既定口径） |

**无 HIGH / MED / LOW 缺陷；无 CHANGES REQUIRED 项；无新增 follow-up。**

---

## 4. 结论

I4 五提交交付了完整的实验层用户开启路径：从 config 持久化（五字段 + normalize 防篡改 + P9 告警）、WS 协议面（四路由双层围栏 + 生物识别门 + license 状态机）、运行时组装（per-task admission 六路 fail-closed + 单飞懒建 + 双竞态保险）、扩展用户面（无乐观更新 + 单一真源文案 + 门渲染载荷原文）到端到端验收（P7 结构锁定回归 + 双臂冒烟 41 项断言 + golden 双臂冻结基线复跑）。出口标准 6/6 逐条满足且全部亲跑复验（§1）；P1-P10 修订逐项落实（§2.7）；设计裁决与风险声明与代码形态零偏差（§2.8）；I3 留账四项全部清零。发现 7 条全为信息级确认。

**裁决：PASS** — WP5-I4 收口成立。实验层自此具备完整的用户可见开启路径，且每一跳（license → 生物识别门 → admission → G4 人审）均 fail-closed；「未校准」叙事从许可证门到证据链（confidence 结构性缺省）全程一致。

---

## 5. 终审（实现对抗 P1-P6 修复批次复验，2026-07-21）

> **终审对象**：实现对抗（`coordinate-computer-use-wp5-i4-adversary.md`，裁决 SOUND WITH MANDATORY FIXES）之后的修复批次三提交——`90214ab`（P1 必修）/ `927ddf2`（P2/P3/P4）/ `99499a0`（P5/P6）
> **终审时间**：2026-07-21T09:01+0800（时间锚点）；亲跑复验 2026-07-21T09:04-09:10+0800
> **对抗发现基线**：P1（LOW-MED 必修，M1 窗口 = owner host 决策落地前——本批**提前收口**）+ P2/P3/P4（LOW，M2 随下一迭代——同批提前）+ P5/P6（NIT，M3——同批提前）

**终审判定：PASS**——六条修复全部真实落实（读码 + 断言面 + 亲跑三重验证），对抗 M1/M2/M3 修正清单全部清零，无新发现阻塞项；门禁 660→668 与自报精确吻合，冒烟/golden 双臂冻结基线复跑一致。

### 5.1 亲跑复验记录

| # | 验证项 | 方式 | 结果 |
|---|---|---|---|
| 1 | companion 类型检查 | `tsc --noEmit` + `tsc -p tsconfig.test.json`（重建 .test-dist） | 双 exit 0 ✅ |
| 2 | 门禁套件（computer+apps 口径） | `node --test computer-*.test.js apps-*.test.js` | **668/668 全绿**（5 suites）——与自报 660→668（P1 +3 / P2 +1 / P3 +2 / P4 +2）精确吻合 ✅ |
| 3 | 冒烟自动臂 hybrid | `verify-tinyclick-enable-smoke.js --variant hybrid` | 全断言通过；dist=0.0px ✅ |
| 4 | 冒烟自动臂 int8 | 同上 `--variant int8` | 全断言通过；dist=0.0px ✅ |
| 5 | golden hybrid 臂（封存） | `verify-tinyclick-golden.js --variant hybrid` | **16P/3R/0F**（F-1 冻结基线一致）✅ |
| 6 | golden int8 臂（封存） | 同上 `--variant int8` | **17P/2R/0F**（一致）✅ |
| 7 | 扩展未动声明 | 三提交 `--stat` 复核 | 仅触 companion 与 scripts，chrome-extension 零改动 ✅（扩展 196/196 无需复跑，对抗轮已独立验证） |

### 5.2 P1-P6 逐条确认

**P1（LOW-MED 必修）download/delete handler 级状态互斥——真实落实 ✅**

- `activeDelete` 进程级标志（activeDownload 对偶）在案：`model-handlers.ts:157`。
- **下载中 delete**：`:444-449` 拒 DOWNLOAD_IN_PROGRESS + 诚实文案「……均未改动」，**拒绝先于 dispose**——会话/文件/配置零触碰（测试断言 `session.disposed===0`、`holder.session` 不动、`delCalls===0`）。
- **delete 中 download**：`:408-413` 拒 DELETE_IN_PROGRESS，fail-fast 于 manifest 读取之前（测试断言零 manifest 读/零 downloadImpl 调用）。
- **第三条触发路径——license_response 自动下载同让路**：`:370-373` `activeDelete` 检查先于 manifest 加载，`note=delete-in-progress` + warn 审计，自动触发不发起（测试断言 `rLic.download==="delete-in-progress"` 且零下载调用）——三向（显式 download / 显式 delete / license 自动下载）互斥完备。
- **delete×delete**：`:451-453` already-running 幂等（与 download 单飞同型；测试断言删除实现只调一次）。
- **错误归一**：delete 整体 try/catch（`:454-484`）——deleteImpl 抛错 → 结构化 DELETE_FAILED（原因如实上达，裸 fs 错误不穿透顶层 catch）+ 失败后广播最新状态（会话已 dispose 属实，UI 如实落位）+ `finally` 清标志（重试语义不受损，测试断言 `r2.ok===true`）。
- **残余如实登记**（INFO，不阻塞）：download 方向存在毫秒级前奏窗口——`activeDownload` 由 `startBackgroundDownload` 首句置位，而 download/license_response 两路径在检查 `activeDelete` 后先 `await manifestLoader()`（本地 manifest 读）再调 `startBackgroundDownload`——窗口内到达的 delete 可先行。反向（delete 中 download）无此窗口（`activeDelete` 在首个 await 前同步置位，`:454`）。窗口 = 本地文件读量级（无网络）、须已配镜像（`.invalid` 禁网面不受及）、损害有界且自揭示（下载器 sha256 复验 + rename 语义不伪造就绪；rm 胜则下载以 fs 错误收尾留痕，下载胜则文件复现可再删）——严格窄于对抗 M1 规格（「delete 查 activeDownload / download 查删除进行中 + 竞态测试」已全规格落实），与 P10 轮询残余同型接受。可选后续：busy 标志前移覆盖 manifest 前奏。
- 竞态测试 ×3 在 668 口径内实绿（handlers 25→28→30）。

**P2（LOW）inflateSync maxOutputLength 硬顶前移——真实落实 ✅**

`png-decode.ts:99-106`：`expected = height*(1+stride)` 前移至 inflate 前，`inflateSync(buf, { maxOutputLength: expected })`——炸弹形超限输入解压期即拒（ERR_BUFFER_TOO_LARGE 折叠为「deflate 损坏或输出超限」fail-closed）；欠长形态仍走 `:110` 长度比对，双路径 fail-closed。测试 +1（1MB 炸弹负载拒 + 欠长拒）实绿（png 5→6）。

**P3（LOW）下载进度广播节流——真实落实 ✅**

`model-handlers.ts:226-250`：规则 = 整百分点前进 或 距上次 ≥200ms 才广播（`:248`）；每文件独立记百分点（`lastPctByFile` Map `:232`）；0% 首帧（undefined≠0 必过）与 100% 末帧（百分点必变）必达；时钟经 `deps.now` 注入（`:80`，测试 seam 同 deps 族纪律）。万级 dispatch → 百级。测试 +2（冻结时钟 1000 回调 →101 条单调无重复 + 同 pct 刷屏抑制/时间轴兜底）实绿（handlers 28→30）。

**P4（LOW）admission 防御折叠——真实落实，不掩盖真实 bug ✅**

- 落实面：`model-admission.ts:241-255` `resolveTinyClickAdmissionSafe` 包装器——任何意外抛出 → `{locator:null, model-admission-error}` + loud log（`computer.model.admission.error` 带错误消息）；词表增 `ADMISSION_ERROR`（`:68`）；生产唯一调用点改走包装器（`server.ts:2007-2009`）。
- **掩盖面核查（终审重点）**：① 折叠仅作用于**意外抛出**——六路正常拒绝原因原样透传、正常路径零 error 日志（测试断言逐字验证，admission 13→15）；② loud log 每折叠**恰好一次**带原始错误消息（测试断言 `errLogs.length===1` + 消息匹配）——可观测性成立，非静默吞错；③ 单测仍直测 `resolveTinyClickAdmission` 原始函数（严格性不被包装器稀释），冒烟 harness 亦直调原函数（verify-tinyclick-enable-smoke.js:147）——真实 bug 在测试/冒烟面仍会炸出；④ holder 不写入断言在案（异常折叠不留半态）。
- **残余如实登记**（NIT，不阻塞）：生产接线 `deps.log` 落 `logger.info` 级（server.ts:2012 邻位）——「永不应发生」的防御折叠以 info 级留痕，告警可见性弱于 warn/error；事件名 `computer.model.admission.error` 独立可 grep，接收现状。可选后续：生产 deps.log 对该事件升级 warn。

**P5（NIT）P9 WARNING 过归因修订——真实落实 ✅**

`config.ts:418-425`：改述「实验层处于开启状态（设置页经门开启 或 手改 config.json opt-in 皆可达此态，持久化配置不区分来源）」——不再把开启态单归因于手改；WARNING 醒目性 + ADR-010 语义保留；config.test P9 断言复跑绿（批 3 提交文实证，本终审未复跑该口径外套件——P5 为纯文案，门禁 668 内无涉）。

**P6（NIT）冒烟脚本注释对齐——真实落实 ✅**

`verify-tinyclick-enable-smoke.js:21-22` 头注释改述「打印 + ≤64px 冒烟级 sanity 断言（1920 帧宽 ≈3.3%）——准确率判定归 golden 门禁」，与 `:358` 实有断言一致；脚本本体改动后双臂复跑全绿（§5.1 #3/#4）。

### 5.3 终审结论

对抗轮 M1（必修，窗口 owner host 决策前）/ M2 / M3 全部**提前于本迭代收口**；修复无规格缩水（P1 三向互斥含第三条自动下载路径、竞态测试 ×3 超规格 ×2）；两处残余（download 前奏 TOCTOU 毫秒窗 / P4 生产 log 级别）如实登记为 INFO/NIT，方向均 fail-closed 或仅告警级别，不阻塞。**WP5-I4 终审判定：PASS——迭代收口成立，实验层用户开启路径全链（license 门 → 生物识别门 → config → admission → G4 → 证据链）经评审 + 对抗 + 终审三轮验证闭环。**

文档处置：本评审（含终审段）+ 对抗文档 + plan 出口总账（I4 标题 ✅ + I3 留账指针更新）同批提交。
