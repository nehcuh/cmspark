# WP5 I3 迭代评审 — 编排器接入与防信任放大

> **评审对象**：WP5 迭代 I3（WI-3.1~3.5，ec63fa1 之后 9 commits：6368e26/61bb0d6/996c2df/6468a13/ed1c28b/f237b63/662931d/f29cf74/7bc6bd6）
> **评审时间**：2026-07-20T22:41+0800（时间锚点）；亲跑验证 2026-07-20T22:42-23:20+0800
> **评审依据**：plan I3 节（plan:451-468 出口标准与 WI 定义）、I2 终审遗留登记五项、开发者自报（tsc exit 0、门禁 614/614）
> **评审纪律**：禁止改业务代码；所有结论亲跑或读码验证，证据落 文件:行号

**裁决：APPROVED WITH FOLLOW-UPS**

I3 核心目标——实验层接入编排器 + 防信任放大（G2 包线代码化 / G3 confidence 结构性缺省 / G4 reL2 门永不自动注入 + 坍缩抑制）——全部闭环且经亲跑与读码双重验证；出口标准 1/2/3/5 全满足，标准 4（开关+许可证门+文案）为**显式声明的部分完成**（文案层交付，功能开关留账），中间形态经 grep 实证为 fail-closed（实验层生产侧结构性不可达）。I2 终审五项遗留登记全部清零且三项亲验。发现 1 条 MED（golden 门禁延迟臂环境敏感，本轮亲跑实测假阳性）与 1 条 NIT（plan I3 标题 ✅ 与标准 4 ⚠ 的视觉不一致），均不阻塞 I3 收口，连同留账四项一并给出处置建议。

---

## 1. 亲跑验证记录

时间锚点：`2026-07-20T22:41:28+0800`（`date` 实取）。node=kimi-desktop runtime v24.15.0；tsc 走 `node node_modules/typescript/bin/tsc`。

| # | 验证项 | 方式 | 结果 |
|---|---|---|---|
| 1 | 类型检查 | `tsc --noEmit` + `tsc -p tsconfig.test.json` | 双 exit 0 ✅ |
| 2 | 门禁套件（computer+apps 口径） | `node --test computer-*.test.js apps-*.test.js` | **614/614 全绿**，与自报 557→614（+57）精确吻合 ✅ |
| 3 | 门禁全量套件 | `node --test` 全量（除 settings-web） | 1636 tests / 44 fail / 1 skipped——失败逐条对账全为既有 Windows 环境基线组（acquireLock/releaseLock/setupGracefulShutdown/message-router/chatCreate/server/vault/config 类，symlink EPERM / Unix socket / 时序 flaky），处 41-52 基线带内，**零 computer/apps 失败** ✅ |
| 4 | golden 门禁 hybrid 臂 | `node scripts/verify-tinyclick-golden.js --variant hybrid`（真模型） | total=19 pass=15 fail=1 report=3——唯一 fail 为 f-icon-en **延迟超限**（totalMs=1732.2 > 673.6×1.5=1010.4）；距离判定全部达标；zh 15/15 拒绝 100% ⚠ 见 F-1 |
| 5 | golden 门禁 int8 臂 | 同上 `--variant int8` | total=19 pass=15 fail=2 report=2——两个 fail 均为 frozen-HIT 例**延迟超限**（f-ok-en 2391.3>1711.9、f-icon-en 2387.8>1712.4）；距离全部达标；zh 拒绝 100% ⚠ 见 F-1 |
| 6 | worker 基准（环境归因） | `node scripts/verify-tinyclick-worker.js` | token 7/7 通过；稳态 e2e **1716-1748ms**——同机同代码较当日 20:58 复跑（689-704ms）漂移 ~2.5×，证实机器当前热饱和/负载态，golden 延迟 fail 为环境假阳性 ✅（归因成立） |
| 7 | verify-ort-sea.js（662931d 修复实效） | 实机重跑 + 前后 `%TEMP%\verify-ort-sea-*` 计数 | 全门通过 exit=0（staged 白名单+预算、SEA 加载、dummy [1,2,3]→[2,3,4] PASS）；临时目录 **0→0 零泄漏** ✅ |
| 8 | 实验层生产侧可达性 | grep `tinyclickLocator\|new TinyClickLocator\|tinyclick:` 全 `companion/src` | 仅 executor.ts 三处（dep 声明 :171、链透传 :760、刷新链显式 null :971）——**无任何生产代码构造/传入真实 locator**，层结构性不可达 ✅ fail-closed 实证 |

验证后工作树零改动（golden/worker 门禁产出均写时间戳新文件或仅 stdout；基准锚点未动）。

---

## 2. 评审重点逐项

### 2.1 缩编留账评估——I3 条件完成；留账建议独立迭代 WP5-I4

**I3 是否算完成**：出口标准（plan:452）五条逐核——① L2 实装（日志格式不变）✅、② 包线三类拒绝代码化各带测试 ✅、③ experimental→reL2 流通 ✅、⑤ 时间线无未校准数字 ✅，④ 开关+许可证门+文案 **⚠ 部分完成**（收口标记 commit message 如实声明）。文案层交付齐全（`model-state-messages.ts:160-178` MODEL_SWITCH_COPY 六字段：三层依赖提示/默认关闭/许可证门引导/35s 时间线；LICENSE_DOOR_TEXT 双源一致性有测试），功能层四项留账。**判定：核心目标（编排器接入+防信任放大）完成，I3 条件完成可收口**——依据有二：一，缩编非静默，收口标记逐项 ⚠ 声明；二，中间形态 fail-closed（§1 #8 grep 实证：生产侧无 locator 构造点，链恒见 null → `skipped model-disabled`，locate-chain.ts:480-481），用户与 LLM 均无法触达实验层，无未审面暴露。

**tinyclick 显式 null 形态**：executor :760 `tinyclick: deps.tinyclickLocator ?? null`、:971 刷新链 `tinyclick: null`——缺省即 null、刷新恒 null，链对 null 落 skipped 不抛错，**是教科书式 fail-closed**，成立。

**留账四项处置**：WS 开关族（set_enabled/license_response/download/delete）+ config 四字段 normalize + admission 组装 + 扩展 UI 四件 = **同一内聚能力「用户可见开启路径」**——拆开各自无意义（UI 无 WS 是死按钮、WS 无 config 不持久、admission 无前三者不可达），且均属 WP5 既有范围。**建议：立 WP5-I4 短迭代（「实验层用户开关与许可证门」），出口标准直接锚 plan:465-467 既有 WI-3.4 原文；不并入 WP6**——WP6 是云层 L3 主题，并入会稀释其出口标准并进一步拖延实验层用户面门控。详见 §4。

### 2.2 L2 实装正确性——三类拒绝 / 坍缩抑制 / confidence 缺省全闭环

- **包线三类拒绝代码化**（`tinyclick-locator.ts`）：非 ASCII → :116-118（isAscii :84-87）；token >38 → :119-123（**测量口径对齐**：encode 含 [0,...,2] 包装，与 G1 冻结口径一致，:119 注释明示）；帧宽 >1920 → :131-133（解码失败后移，解码异常折叠 error :126-130）。常量锚 envelope §2 冻结值（:36-38），**拒绝不截断**（O-4）——越界即 skipped 返回，无截断路径。直接指称约束按 envelope §2.3 定性为文档级 OOD 排除不代码化（:13-14），与扫描证据一致。
- **坍缩抑制**（:153-167）：同帧 sha + **异命令** + 建议点欧氏 ≤8px → 抑制（`tinyclick-collapse-detected`）；同命令不抑制（用户连点同按钮合法形态，:19-20 注释）；frameSha 缺省不追踪不误伤；历史随 locator 实例消亡（任务级，跨任务零泄漏）。语义与对抗面 4「模型自欺形态呈给人审会放大信任」的意图精确对齐。
- **confidence 结构性缺省**（G3）：hit outcome 类型上无 confidence 字段（:49-57 注释「故意无」）；`types.ts` LocateHit.confidence 改 optional（:253-258 G3 注释，UIA/OCR 照常赋值）；链命中日志仅 `{layer, hit, ms}` 无 confidence 键（locate-chain.ts:459-461）；attempt 四字段格式不变。**全链无数值泄漏**，时间线「未校准」表达成立。
- ModelRuntimeError 三 code 直通 skipped（:140-145），point=null/解码失败/其余异常折叠 `tinyclick-error`（:146-151）诚实失败不编造。

### 2.3 experimental 标记贯穿——编译期强制成立，X1 兼容

- **类型强制真编译期**：`ChainLocateResult.experimental?: true`（locate-chain.ts:95，字面量 true 非 boolean——只能标「是」不能标「否」）；locator hit 类型无 confidence（§2.2）——实验层路径取数值置信度**无法通过编译**，非约定级。
- **标记流**：链命中 → experimental:true + crossverified:false + uncrossverified=true（吃 A1.3 子预算，locate-chain.ts:465-475）→ executor :776-779 捕获 → G4 门（:879-922）：十字线预览（凭证区黑化，best-effort 不降门）→ reL2 caption「实验层建议（TinyClick 本地模型，未校准，可能完全错误）」+ 坐标 → 拒绝则补 `experimental-denied-by-user` attempt + 抛 ELEMENT_NOT_FOUND 诚实降级零注入；批准 → `reL2ApprovedMidAction` → X3 新鲜度块走**区域像素复核分支**（:935-950：diffRegion 不重跑链，防提示循环的 rationale 注释在案）→ 不稳定 STALE_SCREENSHOT 拒注。
- **X1 双洞兼容**：reL2 内 reason 过 `sanitizeComputerCaption`（:593，P3 字符类清洗，实验层 caption 插值的 LLM 生成 target 同过此防线——分支 A 不重开）；reason 前置 + fullPreview 独立字段（:596-602）；`autoConfirmEligible:false` 恒（:604）；previewImage 条件展开（:607）既有调用方零影响。
- **刷新链不绕门**：X3 刷新链显式 `tinyclick: null`（:971）——未经人审的新建议无法借刷新通道绕过 G4 门（:968-971 注释自证）。

### 2.4 golden harness——可证伪（本轮实测证伪）；report 语义得当；延迟臂环境敏感（F-1）

- **冻结基线锚定可证伪**：判定纪律 frozen 锚定不自造阈值（golden-eval.ts:8-18 头注）——规则 1 包线外必须 skipped(tinyclick-envelope:*) 漏放即 FAIL（:117-132）；规则 2 frozen HIT 必须 hit 且 dist ≤ frozen.distPx+2px 否则 FAIL（:139-158）；规则 4 totalMs ≤ frozen×1.5 超即 FAIL（:160-167）；汇总 ok=fail===0（:195-204）。**本轮亲跑实测触发 FAIL**（§1 #4/#5）——门禁不是摆设，可证伪性实证成立。
- **3 个 report 态 case 语义**（规则 3，:175-191）：frozen MISS（已知弱点）→ production hit 记 report 附 dist/延迟注（f-ok-en 实测 report dist=809.0px——模型在此类 case 仍输出远偏点，report 如实呈现），error/skipped 视为诚实 MISS 记 pass 不惩罚。语义得当：既不断言已知弱点、又把行为变化摆上台面，非阻塞。
- **脚本执行面**（verify-tinyclick-golden.js）：前置逐个点名（编译产物 :80-87 / 4 onnx :91-97 / 数据 :102-107 / 图像 :111-119）；每 case 新建 locator 规避坍缩串扰（:152-159，注释在案）；exit 0/1/2 三码、无模型诚实退出不伪造通过（:196-201, :25-26）。
- **F-1（MED）**：延迟臂锚定单机冻结值 ×1.5，对机器负载/热态无判别力——同机同代码稳态 e2e 当日内 695ms→1731ms（§1 #6 独立复测实证），致 hybrid 1 例、int8 2 例延迟假阳性 FAIL。**准确率臂不受影响**（两臂 zh 拒绝 100%、距离全达标、token 行为不变）；失败形态为响亮失败非静默通过，方向安全但会阻塞发版门禁或诱发阈值松动。处置建议见 §4。

### 2.5 降级链不动——L0/L1/L3 零回归

- locate-chain diff 严格限域 L2 段与 deps/types 增量：L0 UIA/L1 OCR 段零触碰；L3 cloud stub 原样（locate-chain.ts:485-486 `wp6-not-implemented` 未动）；attempts/log 四字段格式不变。
- 测试 28 绿（+7）：原因矩阵×7、error 折叠、experimental 透传、**日志无 confidence 键回归**、**L0/L1 命中时 L2 零调用**、命令透传（61bb0d6 commit 逐项，门禁 #2 复跑全绿）。
- WP3 X1/X2 修复面无回归：witness 结构未动；全量套件零 computer/apps 失败（§1 #3）。

### 2.6 围栏③——双层成立，诚实边界在案

- **第一层**：server.ts validateWsMessage 增 `computer.model.reset_circuit_breaker` 条目强制 `source:"settings"`（:2632-2635；未知类型默认放行故此条目是真围栏；validateWsMessage/WsValidationResult 纯导出增量 :2527-2532）。
- **第二层**：model-handlers.ts handler 层 belt 核查（:70-78，INVALID_SOURCE + 审计 warn）——防校验面被绕过/未来直调。
- **语义诚实**：无会话 no-op 不伪造复位不广播（:80-85）；有会话真复位 + 广播 state（:86-90）；get_state 最小形 absent/disabled/ready+faults（:46-54）。**诚实边界注记在案**（:8-11）：source 是声明式非密码学，真防线 = 动作本身无副作用（只复位计数不注入不授权）；围栏防自动化崩溃-复位 DoS 循环（A8）——威胁模型表述准确。
- message-router 两 case 接线（6468a13 diff，进程级 holder 留 WI-3.4 admission 写入——与留账登记一致）。

---

## 3. 发现清单

| # | 级别 | 位置 | 描述 | 处置 |
|---|---|---|---|---|
| F-1 | MED | `tinyclick-golden-eval.ts:160-167`（规则 4） | golden 门禁延迟臂锚定单机冻结值 ×1.5，无机器负载/热态判别力——本轮亲跑实测：同机同代码稳态 e2e 由 695ms 漂至 1731ms（~2.5×），hybrid 1 例 + int8 2 例延迟假阳性 FAIL（距离/准确率臂全绿，worker 基准独立复测归因成立）。失败形态响亮非静默，方向安全，但会阻塞发版门禁或诱发阈值松动 | 跟进：① 最小处置——脚本使用说明补「安静机前提」与假阳性复跑指引（文档级）；② 根治候选——延迟判定改相对本次 run 自测 warmup 基线的比值（机器无关），作 I4/后续迭代评估项，**禁止直接放宽 ×1.5 或删规则**（frozen 锚定纪律） |
| F-2 | NIT | plan:451 I3 标题 ✅ vs 收口标记标准 4 ⚠ | plan 标题行 ✅ 收口视觉断言强于出口标准 4 的 ⚠ 部分完成——commit message 如实但 plan 行本身对后读者有误导面 | 跟进：WP5-I4 立项时在 plan I3 节补一行留账互链（指向 I4），不翻改历史 commit |
| OBS-1 | 观察 | `tinyclick-locator.ts:116-123` | 空命令（""）视为 ASCII 且模板 token 数 ≤38 会进推理——非包线缺口（包线只承诺三类），下游坍缩/reL2 门兜底；如实登记不判缺陷 | 无需处置 |
| OBS-2 | 观察 | golden hybrid f-ok-en report | frozen-MISS 例 production「hit」dist=809.0px——report 语义按设计呈现已知弱点的真实输出，非新问题 | 无需处置（G6 补测 backlog 项覆盖此类） |

无 HIGH 级发现；无未声明偏差；I2 终审五项遗留登记（③ 双层围栏 / ① golden harness / ② ort-sea 清理 / ④⑤⑥ 登记档）全部清零，其中 ③② 经本轮亲验。

---

## 4. 留账处置建议（WP5-I4 立迭代）

**建议立 WP5-I4「实验层用户开关与许可证门」短迭代**，范围 = 留账四项原样（plan:465-467 WI-3.4 既有定义即出口标准）：

1. **WS 开关族**：`computer.model.set_enabled` / `license_response` / `download` / `delete`（model-handlers.ts 扩充 + validateWsMessage 条目 + 路由）；license 接受记录进 config 含时间戳，拒绝永久跳过
2. **config 四字段** normalize 防篡改（ADR-010 惯例：非布尔/非法值 coerce + loud log）
3. **admission 组装**：开关开 + 模型 ready（文件在盘且校验过）+ 无熔断 → 构造 locator 写入 executor/链 + 进程级 holder（model-handlers.ts:29 已留位）
4. **扩展 UI 四件**：background 透传 / store 切片（无乐观更新）/ useWebSocket 映射 / SettingsSlideout 实验功能段（开关默认关 + 状态行消费 MODEL_SWITCH_COPY + 删除按钮 + 许可证门对话框）

**排序理由**：四项为同一能力「用户可见开启路径」的不可拆切片；均为 WP5 既有范围且无外部依赖。**不并入 WP6**（云层 L3 主题相异，并入会稀释 WP6 出口并拖延实验层用户面门控）。**I4 出口标准追加一条**：admission 接线后重跑 `verify-tinyclick-golden.js` 双臂 + 端到端开启态冒烟（证明 fail-closed → 可开启的转换不引入绕过）。F-1 的根治评估可搭 I4 便车，最小处置（文档级安静机前提）建议即做。

---

## 5. 结论

**APPROVED WITH FOLLOW-UPS**——I3 条件完成，可收口：

1. 核心目标全部闭环：包线三类拒绝代码化（G2）、confidence 结构性缺省（G3 编译期强制）、experimental→reL2 门永不自动注入（G4）+ 坍缩抑制，全部读码 + 测试 + 亲跑三重验证；降级链零回归。
2. 出口标准 4 部分完成系**显式声明缩编**且中间形态 fail-closed 实证（生产侧无 locator 构造点），不构成静默缩标；留账四项按 §4 立 WP5-I4。
3. golden harness 补上 I2 顺延项且**可证伪性本轮实测成立**；F-1 延迟臂环境敏感为门禁可靠性跟进项（响亮失败方向安全），不阻塞收口。
4. I2 终审遗留五项全部清零；围栏③ 双层经读码与全量套件验证。

---
*WP5 I3 评审 — ec63fa1 后 9 commits；业务代码零改动；亲跑证据见 §1。*

---

## 6. 终审（修复批次复核）

> **终审对象**：对抗评审 M1-M3 与本评审 F-1/F-2 的修复批次——`f991ed2`（M1 预算记账后移）、`5be7758`（M2 golden 锚定加固）、`9ac1122`（M3 坍缩声明+isAscii 收紧 / F-1 基线相对延迟臂 / F-2 留账互链）
> **终审时间**：2026-07-20T23:40+0800（时间锚点）；复跑验证 2026-07-20T23:40-23:55+0800
> **开发者自报**：tsc exit 0、门禁 621/621、golden 真机双臂全绿（hybrid 16P/3R/0F、int8 17P/2R/0F）

**最终裁决：APPROVED**

### 6.1 修复逐条确认（读码 + 亲跑双重验证）

| # | 修复 | 位置与机制 | 验证 | 结论 |
|---|---|---|---|---|
| M1 | 预算记账移 G4 批准后 | `executor.ts:797` 扣减块加 `!experimentalSuggestion` 守卫；`:927-941` G4 批准后新增实验层专用记账块（uncrossLeft 递减、耗尽则续期 reL2、续期拒 → UNCROSS_DENIED 零注入） | **反向缺口排查**：G4 拒绝分支已 throw → 被拒零消耗 ✓；实验层注入唯一路径必经 G4 → 紧接 M1 记账块（链上 experimental 与 uncrossverified 同生同灭，块必触发）→ **无「批准后未计数」缺口**；批准后 STALE 的消耗与 A1.3「计决策不计注入」语义一致。测试 3 例全核：耗尽快照下被拒仅 G4 一窗（三连弹窗消解）、批准弹窗序 G4 前续期后 + 真注入、续期拒 → UNCROSS_DENIED 零注入 | ✅ |
| M2 | golden 锚按 id 键取 + fail-closed | `tinyclick-golden-eval.ts:214-232` indexFrozenAnchors（id 缺失/重复即 throw）；规则 5 锚缺失 report→**FAIL**（:137-143）；脚本侧锚索引 throw→exit 2 + 每 case 断言 id 在锚（失配 exit 2，`verify-tinyclick-golden.js:148-160`）+ 逐 case 按 id 取锚（:166） | 读码 + 测试 2 例（重排后按 id 取锚正确含旧行为错配反证；id 缺失/重复 throw + 规则 5 改判 FAIL）；门禁双臂亲跑 19 case 全数命中锚（无 exit 2） | ✅ |
| M3-a | 坍缩抑制定位声明 | envelope §2 补记 6：信任过滤器非安全边界（9px 步进/精确重复绕过语义合法、代价仅用户注意力、reL2 人审兜底）——与「包线通过≠命中承诺」同型 | 读档（9ac1122 envelope hunk） | ✅ |
| M3-b | isAscii 收紧 0x20-0x7E | `tinyclick-locator.ts:83-91` 与 `tinyclick-golden-eval.ts:95-99` 双处同规则；C0 控制符/DEL 属未测区域 fail-closed 拒绝（reason 复用 non-ascii） | 测试：locator 5 种控制符（NUL/TAB/LF/ESC/DEL）拒绝且 session 零调用 + 0x20/0x7E 边界放行自证；eval isEnvelopeIn 控制符用例；golden 双臂 en case 零回归（亲跑） | ✅ |
| F-1 | 延迟臂相对基线 ×2.5 | `tinyclick-golden-eval.ts:33-36` GOLDEN_LATENCY_BASELINE_FACTOR=2.5 + opts.baselineMs（:69-75）；规则 4 有基线→baseline×2.5、无基线→frozen×1.5 legacy 回退（:131-137, :190-197）；harness prepare 后 s1 参考命令 fixture.png 实测 3 次取中位（`verify-tinyclick-golden.js:148-165`） | **真回归可捕性（重点）**：单元锁死热机假阳性消解（基线 1730 下 1717.1ms pass——评审假阳性实例复现即消）且**同基线 4326ms（≈2.5×+）仍 fail**（10× 退化类同捕）、安静机边界 1750/1751、factor 覆写、legacy 回退测试保留；亲跑：hybrid 基线 709.8ms→上界 1775ms、f-icon-en 692ms 过；int8 基线 1150.6ms→上界 2877ms。残余（如实登记）：全局均匀减速随基线同漂不可见——由分层门禁覆盖（worker 基准绝对值人审、生产 5s 超时、warmup 日志），非本臂职责 | ✅ 换参照系非放宽 |
| F-2 | 留账互链 | plan:451 I3 标题改「✅ 条件收口」+ 括注（标准 4 部分完成、四项留账 → WP5-I4 待立项、出口锚 :465-467 + i3-review §4、fail-closed 实证注记） | 读档（9ac1122 plan hunk）——✅ 与 ⚠ 视觉不一致消除。附注（OBS）：「出口标准 4/5 部分完成」可读性歧义（「第 4 条/共 5 条」 vs 「第 4、5 两条」），按上下文锚定第 4 条解读成立，后续互链建议书「第 4 条（共 5 条）」 | ✅ |

### 6.2 终审复跑记录

| # | 项 | 结果 |
|---|---|---|
| 1 | `tsc --noEmit` + `tsc -p tsconfig.test.json` | 双 exit 0 ✅ |
| 2 | 门禁套件（computer+apps 口径） | **621/621 全绿**，与自报 614→621（M1 +3 / M2 +2 / 批3 +2）精确吻合 ✅ |
| 3 | golden 门禁 hybrid 臂（真机） | **total=19 pass=16 fail=0 report=3，exit 0**——与自报一致；本次 run 基线 709.8ms（[710,688,725] 中位）→ 上界 1775ms；f-icon-en HIT 3.2px ≤ 5.2px、692ms；zh 15/15 拒绝 100% ✅ |
| 4 | golden 门禁 int8 臂（真机） | **total=19 pass=17 fail=0 report=2，exit 0**——与自报一致；基线 1150.6ms→上界 2877ms；zh 拒绝 100%、距离全达标 ✅ |

### 6.3 裁决理由

1. 对抗 M1-M3 与本评审 F-1/F-2 **五项全部修复属实**：M1 经反向缺口排查无「批准后未计数」路径；M2 锚定两处 fail-open 均改 fail-closed/exit 2；M3 声明与代码收紧双落；F-1 换参照系而非放宽（2.5× 边界单元锁死，真回归仍捕）；F-2 互链消除视觉不一致。
2. 复跑全绿且与自报逐项精确吻合（621 计数、双臂 P/R/F 数字、基线实测值）；机器已回安静态，F-1 热机路径由单元测试 + 上轮实测数据（1732.2 ≤ 1730×2.5）双保险覆盖。
3. 无新偏差声明需求；遗留仅 WP5-I4 立项（plan 已互链）与既有 backlog/观测档（G6 补测、宽高比实测）——均为先前置记项，非 I3 承诺缺口。

**I3 终审通过，条件收口成立；下一动作 = WP5-I4 立项（出口锚 plan:465-467 + 本评审 §4）。**

---
*WP5 I3 终审 — 修复批次 f991ed2/5be7758/9ac1122 复核；业务代码零改动；亲跑证据见 §6.2。*
