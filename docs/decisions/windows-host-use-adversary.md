# Windows Host-Use Plan — Adversary Verdict

> **Branch**: `computer-use-w8-windows` · **Date**: 2026-07-17 (UTC+8)
> **Adversary**: read-only plan agent, evidence-verified against actual code
> **Subject**: `docs/decisions/windows-host-use-plan.md`

## Verdict: `PLAN CORRECT WITH MANDATORY AMENDMENTS`

计划的骨架与代码现实高度吻合：§C 的 server.ts 8 个编辑点全部命中真实位置，security-confirmation.ts 的 nonce 扩展可干净落地，darwin 镜像模式描述准确。2 个 MUST-FIX（originWs 缺失、路径前缀边界）+ 1 个流程级修正（nonce 应挂进既有 L2 对话框而非新增第二 prompt 站点）必须在 dev 前写入计划。

## Findings

| ID | Severity | Claim attacked | Evidence | Required amendment |
|---|---|---|---|---|
| A1 | MUST-FIX | §D.13 "Origin-bound confirmations" | `security-confirmation.ts:101-148`（originWs 只在 options.originWs 设置时生效）；`server.ts:436-451`（现有 L2 调用点从未传 originWs） | nonce 确认请求必须传 `{ originWs: ws }`，否则任何 loopback WS peer 可盲烧 3 次 nonce 尝试造成 DoS |
| A2 | MUST-FIX | "case-insensitive prefix check" 足以防逃逸 | 经典漏洞类：`C:\Users\x\Documents2` 满足裸 `startsWith("C:\Users\x\Documents")` | 检查式必须为 `resolved === root \|\| resolved.startsWith(root.toLowerCase() + path.sep)`，且对 realpath(parent) 结果重复同一检查；加 `Documents2`/`Documents-evil` 拒绝测试 |
| A3 | MUST-FIX | executor 内第二 nonce prompt 是必要且安全的 | `server.ts:399-402`（god-mode/auto-approve 跳过 L2）+ `server.ts:1297-1318`（biometric tier 无条件执行）；`App.tsx:299-377`（扩展已实现单对话框内嵌 nonce） | 常规路径：L2 gate 前探测 Hello availability，不可用时 nonceChallenge 挂进同一个 L2 请求；executor 内独立 nonce prompt 仅保留给 skip-L2 路径（god-mode/auto-approve 下它是唯一用户 gate，⑤确实必要） |
| A4 | NIT | respondFrom 返回 false 的日志语义 | `server.ts:1007-1017`：false 触发 `security.confirmation.origin_mismatch_or_unknown` | nonce_retry/lockout 打独立日志，不得落入 origin_mismatch 语义 |
| A5 | NIT | §B 正则 `[A-Za-z0-9_\-\.\+]+` 过宽 | `darwin/adapter.ts:29-30`（严格 `[a-zA-Z0-9]+`）；base64url 不含 `+` | 收紧正则或注释说明 runtime 规则 3/4 兜底 |
| A6 | NIT | win 的 TargetId 级 vault 复检无法照搬 darwin | `darwin/adapter.ts:111-122`（从 TargetId 重建 bundle id 查 blacklist） | win TargetId 语法已限 3 个 read-allowed 值，复检 vacuous；加注释说明，不复刻字符串重建 |

**已验证为真的关键声明**（无需修改）：server.ts ①②③⑥⑧ 编辑点；`SecurityConfirmationDetails.nonceChallenge` 已存在（`security-confirmation.ts:47`）；`respondFrom`（186-206）插入点干净；扩展端字段名 `nonce_response`（`App.tsx:191`）线缆名对齐；darwin vault→whitelist 顺序（`darwin/index.ts:74-81`）、validateTargetId brand（225-239）、consume re-validation；nonce 生成器 `darwin/index.ts:150-161` 逐行一致；`tests/host-use-linux-nonce.test.ts:10` import 可由 re-export 保住；blacklist 测试镜像（`host-use-blacklist.test.ts:62`）；`win/index.ts` stub、`types.ts:15` 陈旧文案、`types.ts:30` method union、`host-adapter.ts:81-83` 注释、`security-policy.ts:46,80`、`tool-definitions.ts:501,515`、`llm/adapter.ts:200-208` 均属实。

## H1–H5 answers（结论摘要）

- **H1**：不重开 ask-once 漏洞。Round 2 §2.3 禁止的是降级到 ask-once；6 位手输 nonce 是该节采纳的 Linux 替代 tier。Hello 降级由真实硬件状态触发（进程内不可伪造），cancel → denied 无 fallback 语义必须保留。建议（非阻塞）：fallback 时打独立 `security.biometric.downgrade {reason}` 事件。
- **H2**：补上 A2 边界修正后 check-order 枚举成立，无已知具体绕过。8.3 短名方向是误拒（安全方向）；hardlink/symlink 末段安全；残余仅 TOCTOU（W-1 已披露）。
- **H3**：计划触及的 COM 成员集与 OMG 保护集无交集。`GetItemFromID` 返回 MeetingItem 时 `Respond` 存在但脚本从不调用；四字段（SenderName/Subject/ReceivedTime/Body）不受保护。文档级核对，实机确认在 §E.1。
- **H4**：在既有威胁模型内可接受。能读 challenge 的攻击者（已配对但被攻陷的 renderer）本来就能替用户点"允许"，属已接受残余；其它 loopback peer 看不到 challenge，但 A1 不修可盲烧 attempts。需威胁模型明文声明。
- **H5**：⑤ 对 skip-L2 路径是必要的，不构成 gate 削弱（biometric tier 不变量依赖它）；但常规路径应改用单对话框路由（扩展已实现内嵌 nonce UI）——严格更优。

## Final amendment list

1. **(MUST-FIX, A1)** executor 内 nonce 确认请求必须 `securityConfirmations.request(send, details, { originWs: ws })`；保留 "non-origin socket rejected before nonce logic, attempts 不被消耗" 测试。
2. **(MUST-FIX, A2)** allowlist 检查精确式：`resolvedLower === rootLower || resolvedLower.startsWith(rootLower + path.sep)`，对 `path.resolve` 结果与 `fs.realpathSync(parent)` 结果各做一次；加 `Documents2`/`Documents-evil` 逃逸拒绝用例。
3. **(MUST-FIX, A3)** 常规路径在 L2 gate 前探测 Hello availability，不可用时 nonceChallenge 挂入同一 L2 请求（复用扩展内嵌 nonce UI）；executor 内独立 nonce prompt 仅保留给 skip-L2 路径；cancel → denied 无 fallback 不变。
4. **(NIT, A4)** nonce mismatch 的 respondFrom false 打独立 `security.confirmation.nonce_retry` / `security.confirmation.nonce_locked` 日志。
5. **(NIT, A5)** §B 正则收紧至与 runtime 规则一致，或注释说明兜底。
6. **(NIT, A6)** win/adapter.ts 加注释：vault 复检对 win 为防御性 vacuous 检查。
7. **(文档, H1/H4)** §G Risks 增两条：(a) `security.biometric.downgrade {tool_call_id, reason}` 独立审计事件；(b) 威胁模型声明"nonce challenge 机密性与 L2 对话框同级，依赖 paired extension renderer 可信"。

**Unverified (out of budget)**：未实机重测 COM 探针与 OMG 保护成员清单；未通读 `App.tsx:135-199` 全文；未检查 `package.json`/`tsconfig.test.json` 插入点（机械性编辑，风险低）；未读 `linux/index.ts`（计划不涉及其改动）。

裁决：完成 A1–A3 三项强制修订后即可进入 dev；A4–A7 可在 dev 中顺带处理。
