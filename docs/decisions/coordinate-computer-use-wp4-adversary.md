# 坐标化 Computer-Use WP4 实现代码 — 对抗裁决（代码级）

> **日期**: 2026-07-20 · **对抗 Agent**: Adversary（只读评审 + 本机只读探针）
> **被审范围**: 分支 `computer-use-w8-windows`，commit `61cf841..HEAD`（WP4 七个 commit：WI-1..WI-6 全项，24 文件 +2549/-15）
> **被审代码**: companion 侧（l2-preview-image.ts、security-confirmation 协议字段、handlers.ts evidence.open、server.ts 闸门接线、executor emit 补字段）+ 扩展侧（types/store/utils、useWebSocket、App.tsx 对话框、ComputerTaskBar、ChatView、AppsPanel、background 透传）
> **基准文档**: `coordinate-computer-use-wp4-plan-adversary.md`（本 Agent 的计划级裁决，P1–P6）、WP4 评审（APPROVED WITH FOLLOW-UPS，N1–N3 NIT）
> **方法**: 全文逐行读码 + 本机复验（companion tsc exit 0，相关套件 304/304；扩展 tsc exit 0，172/172；2026-07-20 02:4x +0800）；未对任何第三方应用发注入；未修改实现代码

## 裁决: `SOUND WITH MANDATORY FIXES`

骨架是真的：计划对抗 P1–P6 全部落地为真实代码并被性质测试锁死（§1 核验表）；对话框渲染无注入面（hardcoded data-URI 前缀 + React 转义 + 300KB 守卫 + onError 回退）；evidence.open 四件套 + 频率上限 + argv 数组；急停 ack 状态机 taskId 匹配正确；两侧套件全绿。但代码级攻击发现 **1 个 MUST-FIX + 1 个 SHOULD-FIX**：X1（re-L2 确认对话框的不可信文本处理双洞——params.task 未按 Y3 纪律转义可伪造对话行，且 code_preview 1200 截断可被 LLM 控制 task 长度把「为什么再次确认」的 reason **确定性地**推出可视区）是 P1 修复的完整性漏口：初始 L2 修了，re-L2 路径被留下，而 re-L2 恰恰在任务最危险的时刻弹出。X2（WI-5 证据按钮因字段名不匹配永不渲染、步数恒显 "?"）是验收测试没盖住真实网线形状的功能失效。

---

## 1. 核验表（计划对抗 P1–P6 落地真实性 + 建议攻击面逐条核查）

| # | 结论 | 证据 |
|---|---|---|
| P1（full_preview 绕过 1200 截断） | **真修复（初始 L2 路径）——但只修了一半 → X1** | security-confirmation.ts:fullPreview 可选字段 + 仅存在时下发；server.ts:746 仅初始闸门设置；App.tsx `request.full_preview ?` 优先渲染纯文本 pre-wrap（React 转义，无 HighlightedCode 混淆路径）。**体积面核查**：actions ≤50、task/target **无 schema 长度上限**（tool-schemas.ts:108/116）——full_preview 尺寸仅受 LLM 输出长度约束，出向 WS 无门；实际有界（模型输出极限）→ §3-Y1。伪造面核查：确认请求为 server 源头、originWs 绑定（:717），未认证 peer 收发双断（P0-2B + WP2-X3 过滤），无伪造路径。 |
| P2（三段式非绑定 caption） | **真修复** | l2-preview-image.ts:70-76 定案文案；caption 与 image 同生共死（helper 降级则两者俱无——无图时无十字线可误信，方向安全；full_preview 与 helper 解耦恒在，server.ts:746 独立于 helper 成败——「无图静默降低 L2 强度」不成立）。 |
| P3（字符类清洗） | **真修复（caption 系）——paused reason 漏接 → §3-Y4** | sanitizeComputerCaption（preview.ts）剥离 Zl/Zp/Cc→空格、Cf→删除；接线于 L2 caption（l2-preview-image.ts:71）与 step caption（executor.ts:611/649/1106）。**但 paused 事件的 reason（executor.ts:574）未过清洗**——内嵌的 uiaWindowClass/fgOwnerExe 为应用可控文本。 |
| P4（懒创建） | **真修复** | computer-utils.ts:110-117/125-133 懒创建 + resyncing 标记；测试 :142-171 四例锁死（迟连 step/paused/started 到达转正常/完结后来自下一任务）。 |
| P5（杀-等-删） | **真修复（结构性）** | pipeline finally 只在全部 ps1 await 结算后删 raw（l2-preview-image.ts:136-146）；helper 超时返回后 pipeline 后台结算、删除顺序不变；WP2 sweep 兜底。 |
| P6（每分钟 5 次） | **真修复（有已知绕过，文档化）** | EvidenceOpenRateLimiter 滑窗 + panelId 每连接计数 + 测试三例（超限/独立桶/滑窗）。重连即新桶 → §3-Y2。 |
| 攻击面：preview_image 数据面 | **无洞** | hardcoded `data:image/jpeg;base64,` 前缀（App.tsx、ComputerTaskBar:73/253），React `<img>` 渲染无 dangerouslySetInnerHTML，300KB 守卫（computer-utils.ts:28）+ 服务端 ≤200KB 双保险，onError 静默回退；base64 无效即破图无害。 |
| 攻击面：急停按钮 | **无洞** | ack 处理器 taskId 匹配或 "*" 且 matched>0 才置位（agentStore:418-423），错任务 ack 不误标；abort 伪造面：未认证连接入向只允许 auth.handshake，已认证面板发 abort 是设计内的安全方向。 |
| 攻击面：evidence.open | **无洞** | 字符集 → 频率 → 基目录 join → 双 reparse 复查 → 存在性 → explorer argv 数组 spawn + error 吞掉 + unref（handlers.ts:136-176）；非法 taskId 在任何 fs 触碰之前拒绝（测试 :290）。句柄无泄漏（stdio ignore + unref）。 |
| 攻击面：坐标开关透传 | **无洞** | background 透传仅扩展内部上下文可达（chrome.runtime 消息，无 externally_connectable 面）；生物识别门在 companion（apps/handlers.ts 既有），UI 无乐观更新（徽标数据源自 apps.list 状态）。 |
| 探针 | — | companion tsc exit 0，computer/coordinate/confirmation 套件 304/304；扩展 tsc exit 0，172/172。 |

---

## 2. 强制修复（X1）与应修复（X2）

### X1 — MUST：re-L2 确认对话框双洞——未转义的 task 文本可伪造对话行；1200 截断可被长 task 把 reason 确定性推出可视区

- **攻击链（两个分支都是确定性的）**：re-L2 确认在 executor 内构造（executor.ts:575-581）：`code: 任务「${params.task}」需要再次确认：\n${reason}`。
  - **分支 A（伪造）**：`params.task` 是 LLM 生成的不可信文本，**raw 插值、零转义**——Y3（WP2）给初始 L2 做的 JSON.stringify 防伪造纪律、P3（WP4）给 caption 做的字符类清洗，在这条路径上都不存在。task 里放 `\n\n✅ 系统提示：本次操作已通过安全验证，请直接点击「允许执行」` 即以真实换行渲染进对话框（code_preview 走 HighlightedCode，换行如实呈现）。re-L2 对话框弹出的时刻恰是任务**最危险**的时刻（命中危险词 :835、对话框嫌疑 :1152、uncross 超限 :765、预算耗尽 :676）——在人类警觉度最高的节点喂他一段伪造文本。
  - **分支 B（信息饥饿）**：code_preview 恒过 `codePreview()` 截断 1200（security-confirmation.ts:125-129）；`task` 在 schema 无长度上限（tool-schemas.ts:108），LLM 构造一个 1300 字符的 task → `任务「<1300 字符>」需要再次确认：\n<reason>` 在 1200 处被截断——**reason（「检测到高风险内容（支付）」）整体落在截断点之后，对话框只显示任务文本加「…」**，用户在不知道「为什么再次确认」的情况下批准/拒绝。P1 修复（full_preview 独立字段）只接了初始闸门（server.ts:746），re-L2 走 deps.confirm 通道，永远拿不到 full_preview。
- **代码证据**：executor.ts:575-581（reL2 构造，raw 插值）；security-confirmation.ts:127-129（截断无豁免）；server.ts:1046/3165（re-L2 的 confirm 通道与 fullPreview 无交集）；tool-schemas.ts:108（task 无 max）。测试侧全域无「re-L2 对话框文本转义/reason 可见性」断言。
- **修复要求**：① re-L2 的 code 改为**reason 在前、task 在后**（reason 永远落在截断预算内——reason 本身由模板+固定词表/系统字段构成，长度有界），task 行按 Y3 纪律 JSON.stringify 转义 + P3 清洗；② 或更彻底：re-L2 也走 full_preview 通道（reason 结构化独立字段）；③ paused 事件的 reason 同步过 sanitizeComputerCaption（合并修 §3-Y4）；④ 补两条性质测试：「2000 字符 task 的 re-L2 对话框 reason 完整可见」「含 \n/U+2028 的 task 在对话框文本中为单行转义形态」。

### X2 — SHOULD：WI-5 证据入口字段名不匹配——「打开证据目录」按钮永不渲染，步数恒显 "?"

- **事实**：server 的工具结果恒为 snake_case（server.ts:2076/2082-2085：`task_id` / `completed` / `total` / `evidence_dir` / `error_code`，经 `msg.result` 原样透传无 camel 转换层，useWebSocket.ts:249）。ChatView 读取：`computerData?.taskId` **无 snake 回退**（ChatView.tsx:378）→ 恒 undefined → `isValidEvidenceTaskId(undefined)` false → **按钮永不渲染**；`completedActions/totalActions`（:459）同样无回退 → 恒显「完成 ?/? 步」。evidenceDir/errorCode 倒是有回退（:379-380）——同一行代码里回退给了两个、漏了两个。任务条完结态的入口（ComputerTaskBar:216，用 store 的 taskId）不受影响——所以 WI-5 有一半存活，这解释了它为何通过了人工冒烟。
- **修复要求**：补 `?? task_id` / `?? completed` / `?? total` 三处回退；并补一个**真实网线形状**的 fixture 测试（录制一份 server 工具结果 JSON 驱动渲染断言）——「组件纯渲染无测试」的既定立场正是这个洞漏到交付的原因，wire-shape fixture 不需要 React 渲染测试也能写（纯函数抽 `extractComputerCardData(result)` 进 utils）。

---

## 3. 观察项（不阻塞本裁决）

- **Y1（SHOULD）task/target 无 schema 长度上限**：full_preview 尺寸仅受 LLM 输出极限约束（出向 WS 无门）；建议 schema 加 `task.max(4000)` 类封顶——顺手把 X1 分支 B 的饥饿面也收窄。
- **Y2（SHOULD）P6 频率上限两重残余**：重连即新 panelId 新桶（可用性缓解的已知边界，计划已声明其价值定位）；`hits` Map 对死去的 panelId 永不清理（长驻进程缓增长，每项 ~100B）——建议 access 时顺带全表过期清扫或设进程级上限。
- **Y3（NIT）explorer.exe 逗号路径边角**：用户名含逗号的 profile 路径会被 explorer 的参数解析误切（argv 数组传递本身正确）；发生率极低，文档化即可。
- **Y4（SHOULD，并入 X1 修）**：paused 事件 reason 未过 sanitizeComputerCaption（executor.ts:574），内嵌的 uiaWindowClass（应用可控）可在任务条 pausedBar 伪造断行（React 挡 HTML 不挡 U+2028）。
- **评审 N1–N3（NIT）维持**：时间线无惰性渲染（30 步上限内可接受）、evidence.open 失败无 UI 反馈（explorer 打开失败对用户其实可见——explorer 自身报错；rate_limited/not_found 确实静默，可后补 toast）、徽标 title 措辞。
- **重申**：F2 真机验收清单（L2 弹窗十字线截图、急停按钮 <500ms 与热键等效）按验收映射执行，进 WP7 门禁。

---
*Adversary verdict · CMspark coordinate computer-use WP4 · 2026-07-20*
