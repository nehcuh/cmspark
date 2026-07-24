# 坐标化 Computer-Use WP4 UI 面 — 评审结论

> **日期**: 2026-07-20（时间锚点 02:05 +0800 起）· **评审方**: Reviewer（只读 + 写本文档，未改任何业务代码）
> **范围**: `61cf841..HEAD` 共 7 commit（WI-1 `59bf1cf` / WI-2 `42ab032`+`e0294c7` / WI-3 `9b0ae83` / WI-4 `fe7e6d8` / WI-5 `39598d5` / WI-6 `b31fdb7`），工作区干净
> **对照基准**: plan「WP4 实施详案」（WI-1..6 + 协议增改清单 + 组件设计要点）与对抗裁决 `coordinate-computer-use-wp4-plan-adversary.md`（P1–P6 强制/建议修订）
> **方法**: 逐 commit 复读 diff + 关键文件实读 + 门禁亲跑（非转述开发者自报）

## 裁决: `APPROVED WITH FOLLOW-UPS`

P1–P6 全部对抗修订均为**真修复且带非空虚测试**；七项评审重点全部闭环；两侧 tsc 干净、门禁 448/448 + 7/7 + 172/172 亲跑吻合。三条 NIT 级观察不阻塞；真机手动验收两项沿用 §G.5 惯例留 follow-up。WP4 UI 面可入库。

---

## 1. 评审重点逐项结论

### ① P1 修复正确性（full_preview 绕过截断）✅

- **独立字段方案落实**：`SecurityConfirmationDetails.fullPreview`（security-confirmation.ts:81-90，注释记录了「独立字段 vs 豁免提限」二选一的理由——修复面刻意收窄，其余工具 1200 截断行为完全不变）；序列化条件下发（:202-212，仅非空 string）；闸门仅 computer 类设置 `...(hostComputerGated && computerPreview ? { fullPreview: computerPreview } : {})`（server.ts:746-750）。
- **code_preview 截断语义不变**：`codePreview()` 与 `CODE_PREVIEW_LIMIT=1200` 未触碰；P1 测试对照断言 `code_preview.length === 1202`（1200 前缀 + `\n…`）。
- **性质测试真实非空虚**（security-confirmation-origin.test.ts:253-285）：前提断言 `full.length > 1200`（防空洞）；同文双通路对照；语料尾部（2000 个「汉」）在 full_preview 可见、在 code_preview 不可见——恰好演示并关闭了「恶意 LLM 把危险动作排在长清单尾部绕过人审」的洞。
- **体积/内存面无新增**：full_preview 体积受 builder 既有上限封顶（30 动作 + 单任务 2000 字符语料帽）；preview_image 服务端 ≤200KB too_large 兜底 + 扩展 `previewImageSafe` ≤300KB 双保险（computer-utils.ts:28-30）；step 事件图经 `capTimeline` 30 步 / 4MB 双上限（:36-50）。

### ② L2 截图 helper（l2-preview-image.ts）✅

- **调用点在廉价前门之后**：亲验 server.ts 顺序——`assertCoordinateAllowed`（:550）→ `COMPUTER_TASK_BUSY`（:558）→ rate-limit（:566）→ 纯文本预览（:571）→ helper（:584-611，win32-only + exe-only + try/catch 降级，:579-583 护栏注释明文「后续重构不得挪前」）。
- **杀-等-删（P5）结构性成立**：pipeline 的 finally 只在全部 ps1 await 结算后运行；`runPs` 基于 `execFileAsync`（powershell.ts:101-116），其 promise 在子进程 **exit 时**才结算（超时先 kill 后等 exit）——故 finally 执行时被杀的 capture/OCR ps1 已不可能再写盘。两个 P5 测试均为真对抗形状：OCR 挂起→超时先降级、**断言删除未发生**→OCR 结算后删除（computer-l2-preview-image.test.ts:293-324）；capture 自身超时→迟写盘帧仍被删除（:326-354）。
- **caption 三段式 + P3 清洗**：`buildL2PreviewCaption` 逐字为对抗裁决定案文案（l2-preview-image.ts:70-76），应用名过 `sanitizeComputerCaption`；清洗函数（preview.ts:59-65）覆盖 `\p{Zl}\p{Zp}`（U+2028/2029）+ `\p{Cc}` → 空格、`\p{Cf}`（零宽/bidi/FEFF）→ 删除——比裁决要求更宽（连 bidi 覆盖攻击面也关了）。「U+2028 载荷不产生第二行」性质测试在（computer-preview.test.ts P3 property）。
- **预览不进 LLM 上下文的不变量被测试锁死**：computer-executor.test.ts 的 P2 测试断言 `runComputerTask` 返回值 JSON 不含 `previewImage`/`preview_image` 字段名，而同一 step 事件确实携带预览图（`BASE64_JPEG_PAYLOAD`）——图只走事件通路到面板，工具结果洁净。其余外露面（确认 details）只去 originWs 本地面板（对抗 §4 已核无 IM/远程转发面，本轮未变）。

### ③ evidence.open（handlers.ts）✅

- **四件套逐项在码**：严格字符集 `^[a-zA-Z0-9_-]+$`（在任何 fs 触碰之前拒绝——测试:290）→ `path.join(evidenceBaseDir(), taskId)`（字符集保证不可逃逸）→ `assertNotReparsePath` 基目录与任务目录双查（缺失路径 catch 放行、junction 在 Node 的 `isSymbolicLink()` 覆盖内，evidence.ts:106-119）→ 存在性 → 打开。
- **独立 argv 无拼接**：`spawn("explorer.exe", [dir], { detached: true, stdio: "ignore" })`，无 shell 模板，error 事件吞掉防未捕获异常。
- **P6 频率上限**：`EvidenceOpenRateLimiter` 滑动窗口 5 次/分/面板（handlers.ts:33-52），每连接 panelId（server.ts:3018 `randomUUID()` → message-router 透传），无 panelId 退化进程级单桶；测试覆盖第 6 次拒绝 + openDir 停在前 5 次、独立桶、滑窗恢复（apps-coordinate.test.ts:344-395）。

### ④ 急停按钮与热键等效 ✅

- **调用路径**：ComputerTaskBar `sendAbort` → `chrome.runtime.sendMessage({type:"computer.task.abort"})` → background 透传（WI-1 新增）→ server `handleComputerTaskAbort`（WP3 F1 已审）→ executor abortCheck "panel" 分支——与热键**同汇一点**，等效性由协议保证，UI 无第二套停止逻辑。
- **按钮态与状态机一致**：仅 `!finished && !abortAcked` 时渲染；ack 需 `matched>0` 且 taskId 匹配（或 `"*"`）才置位（agentStore COMPUTER_TASK_ABORT_ACK，`matched<=0` 不置位）；3s 无 ack 黄条提示热键兜底；P4 懒创建（resyncing）状态下按钮**同样可用**——迟连面板的第三通道不缺席（computer-utils.ts:106-117 + 测试:142-171 四例）。
- **本地 UI 态随 taskId 切换重置**（ComputerTaskBar.tsx:121-127），急停已发态不渗入下一任务。

### ⑤ uiaCapable 徽标 ✅

- 三态正确（`uiaCapableBadge`，computer-utils.ts:178-203）：true→「UIA」蓝 / false→「OCR」灰 / undefined→「未探测」点灰；**每个 title 都带「能力提示，非安全背书」**；手设（有值无 uiaProbedAt）追加「人工设定」。测试矩阵 + 手设覆盖 4 例（apps-panel-logic.test.ts:160-190）。
- **坐标开关非乐观更新**：`handleToggleCoordinate` 只发消息，显示完全由 apps.list 状态的 `entry.coordinateAllowed` 驱动（等 apps.updated 广播）；开启由 companion 生物识别门承担（亲验 apps/handlers.ts:436-455 gate 调用 + :426-433 COORDINATE_STRUCTURAL_DENY），关闭免费 fail-closed；全局态只读行（disabled checkbox + hint），WP4 不做面板内全局切换——与计划一致。

### ⑥ 扩展侧架构 ✅

- 组件全部纯渲染：ComputerTaskBar 本地态仅展开/计时/放大/降级详情开关；App.tsx 对话框仅加守卫渲染分支；AppsPanel 徽标/开关无本地状态翻转。逻辑全部在 WI-1 纯函数（reducer/capTimeline/previewImageSafe/isValidEvidenceTaskId/uiaCapableBadge）。
- **172 例无新增组件测试属预期非缺口**：扩展测试目录 14 个套件全部为纯逻辑测试（无一 React 组件测试先例），新增逻辑已被 23（computer-task-state）+ 4（apps-panel-logic 追加）例覆盖——与计划「组件保持纯渲染；状态折叠已在 WI-1 覆盖」一致。

### ⑦ 时间线字段透传对齐 ✅

- executor step emit（executor.ts:1099-1116）与证据记录（:1064-1086）、steps 结果（:1087-1098）**三处同源同变量**：`layer`/`confidence` 取自 `hit`（有定位才附）、`durationMs = now() - startedAt`（:589 动作循环内每动作重置——是**动作级**耗时不 是任务级）、`locateAttempts`/`crossverified`/`crossverifyChannel` 直传；`crossverified` 对 scroll/drag 等无锚动作亦有定义（WP2 起初始化为 false）。扩展 `ComputerStepView` 镜像字段完整（types.ts:398-428），StepRow 渲染 layer 徽标/置信度/耗时/坐标/未复核标记/降级详情折叠全部在码。

---

## 2. 发现清单（全 NIT，均不阻塞）

| # | 严重度 | 一句话 |
|---|---|---|
| N1 | NIT | 时间线缩略图「展开即渲染全部行」，未做计划的「进入视口才渲染」惰性——`capTimeline` 30 步/4MB 双上限已兜底，实际体积有界（plan 组件要点 3 的文档级偏差，可 WP7 顺手或文档化）。 |
| N2 | NIT | evidence.open 的失败结果（not_found/rate_limited）扩展侧无 UI 反馈——fire-and-forget，用户点了一个不存在任务的按钮时无感知；result 消息已在网线上，v2 面板内浏览器时顺带展示即可。 |
| N3 | NIT | 时间线「未复核」徽标 title「本步未经像素交叉复核」在 UIA 层语境略窄（歧义降格、live re-probe 等非像素情形也走同一标记）——中性不误导，措辞可泛化为「未经交叉复核」。 |

**P6 设计取舍说明（非发现）**：频率上限在存在性检查**之前**消耗配额（探测不存在的 taskId 也烧频率）——该上限是可用性守卫非安全闸，此顺序反而有反探测收益，方向可接受。

---

## 3. 做对的地方（按对抗纪律逐项）

1. **P1 修复面刻意收窄**：选「独立字段」而非「host_computer 豁免/提限 code_preview」，其余工具的截断行为零变化，旧扩展忽略新字段即回退截断版——向后兼容与最小爆炸半径兼得，且选择在代码注释中留痕（对抗裁决的原话要求）。
2. **P5 从「约定」升级为「结构」**：杀-等-删不是靠开发者记得按顺序调用，而是靠 async fn 的 finally 语义 + execFile 的 exit 结算语义结构性保证，两个测试把「删除绝不在结算前发生」锁成回归门。
3. **P3 清洗比裁决要求更宽**：裁决要求 `\p{Zl}\p{Zp}` + 零宽，实现连 `\p{Cc}` 全控制符与 `\p{Cf}` 全格式符（含 bidi 嵌入/覆盖/隔离）一并处理，且 L2 caption 与 step caption 强制共用同一函数（对抗复核的明确要求）。
4. **P4 的优先级判断正确且在注释中明说**：「急停按钮的存在性优先于事件流整洁性」——懒创建让迟连面板的第三通道不缺席，四例测试覆盖懒创建/paused 懒创建/started 到达转正/完结后来自下一任务的 step。
5. **确认门零改动**：按钮语义、队列、originWs 绑定、45s 超时、nonce 流一概未动；预览渲染失败静默回退纯文本（onError → previewImgFailed），确认门永不被图片阻塞。
6. **事件/证据/结果三处同源**：step 事件的定位可观测字段与证据链、任务结果用同一批变量，不存在「UI 显示一套、证据记一套」的漂移面。

---

## 4. WP4 验收映射核对

| 验收标准（plan §WP4） | 结论 | 说明 |
|---|---|---|
| 扩展 tsc 干净 + 单测过 | ✅ 亲跑 | tsc --noEmit exit 0；node:test 172/172（全新编译后实跑）。 |
| 确认对话框含标注截图 | ✅ 代码级关闭 / 真机项开放 | helper（画点/blackout/raw 清理/超时顺序/降级/三段式）12 例 + 对话框守卫渲染在码；真实 host_computer 任务 L2 弹窗可见十字线截图为**真机手动验收项**（沿用 WP1-3 留痕惯例）。 |
| 急停按钮与热键等效 | ✅ 代码级关闭 / 真机项开放 | 同汇 abortCheck "panel" 分支 + ack 状态机测试在码；「任务中点急停 <500ms 注入停止、finished errorCode=TASK_ABORTED 与 Ctrl+Alt+End 行为一致」为**真机手动验收项**。 |

---

## 5. 本机复跑记录（非转述）

- 时间锚点：`date '+%Y-%m-%dT%H:%M:%S%z'` → **2026-07-20T02:05:40+0800**。
- 范围核对：`git log --oneline 61cf841..HEAD` = 7 commit；`git status --porcelain` 空。
- companion：`node node_modules/typescript/bin/tsc -p tsconfig.test.json` → **exit 0**；门禁套件（computer-\*/apps-\*/integration/computer-\*）→ **tests 448 / pass 448 / fail 0**（420 WP3 基线 + 28 WP4 新增，算术吻合）；`security-confirmation-origin.test.js` → **7/7**。
- chrome-extension：`tsc --noEmit -p tsconfig.json` → **exit 0**；复现 `npm test` 全流程（rm .test-dist → tsc -p tsconfig.test.json → node --test）→ **tests 172 / pass 172 / fail 0**。
- 与开发者自报逐项一致，无出入。

---

## 6. 结论

WP4 的六个工作项按详案落地，P1–P6 全部闭环且测试非空虚，三条 NIT 不影响裁决。**APPROVED WITH FOLLOW-UPS**：

1. **真机手动验收两项**（不阻塞入库，闭合 §WP4 验收）：真实任务 L2 对话框可见十字线标注截图 + 三段式 caption；任务中点急停按钮 <500ms 生效且与热键行为一致（finished errorCode=TASK_ABORTED）。
2. **N1–N3**（可选）：视口惰性渲染、evidence.open 失败反馈、徽标措辞泛化——WP7 红队批次顺手或文档化，无需单独工单。

WP5（模型层）开工无前置阻塞。

---

# 终审（2026-07-20 02:52 +0800）

> 范围：代码级对抗裁决（`coordinate-computer-use-wp4-adversary.md`，SOUND WITH MANDATORY FIXES）后的修复批次 4 commit——`b4a5d03` X1（Y4 并入）、`bce7b56` X2、`d7b319b` Y1/Y2（+Y3 文档化）、`902dd50` 文档入库，工作区干净。以下每条均为逐行复读 diff + 亲跑门禁后的独立确认。

## T1 修复批次逐条确认

| commit | 项 | 结论 | 关键证据（文件:行号） |
|---|---|---|---|
| `b4a5d03` | X1 分支 A（task 伪造行） | ✅ 真修复 | `safeTask = sanitizeComputerCaption(JSON.stringify(params.task ?? ""))`（executor.ts:583）——Y3 转义纪律 + P3 清洗双重；性质测试锁定「唯一真实换行是结构换行」（computer-executor.test.ts:1513-1515：`split("\n").length===2` + 含字面 `\n\n✅` 转义形态 + 不含真实 `\n✅` 断行） |
| `b4a5d03` | X1 分支 B（reason 饥饿） | ✅ 真修复 | reason 前置 `fullText = ${safeReason}\n任务: ${safeTask}`（executor.ts:584）；`fullPreview: fullText` 与 code **同文同变量**（:587-588）；生产接线 `sendConfirmation` 原样透传 details 至 manager.request（server.ts:1090-1099），full_preview 经 WI-2 序列化通道下发。临界验证见 T2 |
| `b4a5d03` | Y4（paused reason 清洗） | ✅ 真修复（并入 X1） | paused 事件改发 `reason: safeReason`（executor.ts:582）；测试以含 U+2028 的 exe 名驱动让位路径，断言 reason 单行、无 U+2028/2029、清洗后仍可读（computer-executor.test.ts:1549-1576） |
| `bce7b56` | X2（证据卡字段名） | ✅ 真修复 | `extractComputerCardData` 纯函数（computer-utils.ts:229-251）：五字段 snake 优先 camel 回退（`task_id/taskId`、`evidence_dir/evidenceDir`、`error_code/errorCode`、`completed/completedActions`、`total/totalActions`），`failed` 双层提取，`canOpenEvidence` 单点守卫；与真实网线形状逐字段对齐（server.ts:2076 失败形 / :2082-2085 成功形——见 T3）；ChatView 三处回退改走纯函数；fixture 测试 4 例（snake 成功/失败/camel 回退/守卫拒绝） |
| `d7b319b` | Y1（schema 封顶） | ✅ 真修复 | `task: z.string().min(1).max(4000)`（tool-schemas.ts:110）、click `target.max(500)`（:119）；测试 4000 过/4001 拒、500 过/501 拒。正常任务零影响评估见 T3 |
| `d7b319b` | Y2（限流桶清扫） | ✅ 真修复 | `tryConsume` 入口全表 `sweep`（handlers.ts:42-44），窗口内无命中的死桶整体删除（:54-61），`bucketCount()` 供测试观测；测试 2 例（死桶清扫/活跃桶不误删）。重连新桶残余为对抗文档已声明接受的边界 |
| `d7b319b` | Y3（explorer 逗号边角） | ✅ 文档化（接受） | defaultOpenDir 注释声明（handlers.ts:88-92）：argv 数组传递无注入面，不引 cmd /c start 更大引号转义面——取舍正确 |
| `902dd50` | 评审+对抗文档入库 | ✅ | 本文件与 `coordinate-computer-use-wp4-adversary.md` 入库 |

## T2 X1 分支 B 专项：「结构性推不出 1200 截断点」核验

**临界构造**：3000 字符 task（>1200 两倍有余）驱动 window-level hard 路径走 re-L2，**端到端过真实 `SecurityConfirmationManager.request` + `codePreview()` 截断**（非 mock）——`code_preview` 以 `\n…` 结尾（截断前提成立）且仍含「检测到高风险内容」，`full_preview` 逐字等于 fullText（computer-executor.test.ts:1520-1547）。

**reason 有界性独立核算**（四个 reL2 调用点逐个看）：
- 预算耗尽（executor.ts:690）/uncross 超限（:779）：纯模板+常量数字，≈50 字符；
- 危险词（:849）：`hits.join(", ")` 的词元全部来自 danger.ts 固定词表（HARD/CAUTION 两表合计 ~25 词），极端全命中 ≈300 字符；
- 前台让位（:1166）：`fgName` = 进程 exe basename，Windows 文件名上限 255，+模板 ≈315 字符。

最坏情形 ≪ 1200，「reason 永远落在截断预算内」成立；且 reason 经 sanitizeComputerCaption 单行化，无法借多行挤压布局。**分支 B 结构性关闭。**

## T3 X1 分支 A 残余形态与 X2/Y1 附注

**分支 A 残余形态评估**：伪造文本仍以内联转义形态存留于 `任务: "…\n\n✅ 系统提示…"`——可读，但①与任务文本同处一行引号内、带可见 `\n` 转义符，无法冒充对话框结构行或独立系统提示；②对话框首行是 companion 生成的真实 reason（布局上不可推挤）；③与初始 L2 的 Y3 防线同级（JSON.stringify 内联，WP2 起接受的残余形态）。**不另列发现。**

**X2 附注**：server 失败形状（server.ts:2076）不含 completed/total——失败卡步数仍显「?」，但 error_code 正常展示且证据按钮可用（task_id/evidence_dir 均在失败形状内）。此为 WP1 起既有网线形状，非 X2 引入，不列发现。

**Y1 上限对正常任务影响**：task 4000 字符 ≈ 一页长文，远超典型任务描述（数句至数十句）；target 500 字符对 UI 标签量级（典型 <50）极为宽余；type.text 既有 2000 帽不变。正常任务零影响，仅封死「无限长 task 喂饱 full_preview/推挤布局」的对抗面。

## T4 本机复跑记录（终审，非转述）

- 时间锚点：`date '+%Y-%m-%dT%H:%M:%S%z'` → **2026-07-20T02:52:13+0800**。
- 范围核对：`git log --oneline -6` = 4 fix + 1 docs + WI-6 尾；`git status --porcelain` 空（干净）。
- companion：`tsc -p tsconfig.test.json` → **exit 0**；门禁套件 → **tests 453 / pass 453 / fail 0**（448 基线 + 3 X1 + 2 Y2，算术吻合；Y1 的 2 例在 tool-schemas 套件不在门禁 glob）；`security-confirmation-origin + tool-schemas` → **51/51**。
- chrome-extension：`tsc --noEmit` → **exit 0**；全新编译后 `node --test` → **tests 176 / pass 176 / fail 0**（172 基线 + 4 X2 fixture，算术吻合）。
- 与开发者自报（453/453、176/176）逐项一致。

## T5 最终裁决

## 裁决：`APPROVED WITH FOLLOW-UPS`

对抗 MUST（X1 双分支）与 SHOULD（X2/Y1/Y2/Y4）全部真修复且性质测试非空虚（X1-B 端到端过真实截断、X2 真实网线形状 fixture、Y1 边界值 4000/4001、Y2 死桶清扫）；Y3 文档化取舍正确；两侧 tsc 干净、门禁 453/453 + 51/51 + 176/176 亲跑吻合。WP4 代码面全收口。

**Follow-ups（均不阻塞，已显式归口）**：

1. **真机验收两项 → WP7 门禁前闭合**（对抗 §3 重申）：真实任务 L2 弹窗可见十字线标注截图 + 三段式 caption；任务中点急停按钮 <500ms 注入停止、finished errorCode=TASK_ABORTED 与 Ctrl+Alt+End 行为一致。
2. **首轮 N1–N3（NIT，可选）**：时间线视口惰性渲染、evidence.open 失败 UI 反馈、「未复核」徽标措辞泛化——WP7 顺手或文档化。
3. **P6 重连新桶残余**：对抗文档已声明接受的定位（可用性缓解非安全闸），Y2 清扫后内存面无增长，无需进一步动作。

> 本终审段落为追加，首轮评审（§1-§6）原文保留未改。WP5（模型层）开工无前置阻塞。
