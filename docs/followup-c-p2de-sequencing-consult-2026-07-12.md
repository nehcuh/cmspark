# follow-up C — P2-D vs P2-E 排序咨询

> 致 kimi：这是一个**排序决策**咨询（非实现设计）。P2-C (PR #47) 已合，按此前商定的 Phase 2 序列下一项是 P2-D。但我在 grounding 时发现 P2-D 的 "layer:mcp" 前提**不成立**，故就"先 D 还是先 E"请你裁决。

## 1. P2-D 原始范围

> "godmode_bypassed layer:'mcp' audit broadcast to extension UI in real-time (merges with follow-up B)"

## 2. grounding 发现："layer:mcp" 是个 non-event

MCP 能力门（Phase 1 PR #44）按设计是 **god-mode-invariant** 的：

- `forceMcpConfirm` = `mcpCaps.some(c => CRITICAL_MCP_CAPABILITIES.has(c))`，**不读** `allow_all_schemes` / `auto_approve_dangerous`。
- 关键 MCP 能力（exec/file-write/db-mutate/network-egress）**无论 god-mode 与否都强制确认** —— god-mode 只 bypass UI prompt，不 bypass capability boundary（镜像 §6.1.5 IMAGE_FETCH_GATE / §6.2 CRITICAL_API_GATE）。
- 非关键、已 trusted 的 MCP 调用靠 **trust_level**（非 god-mode）跳过确认。

[inspected] 因此**不存在**"god-mode bypass 了一个 MCP 确认"的场景 —— 没有 `layer:"mcp"` bypass 可广播。server.ts:1140 `executeMcpTool` 全程不引用 `allow_all_schemes`/`auto_approve_dangerous`。

## 3. P2-D 的真实剩余范围（= follow-up B 原始项）

把 companion 侧的 god-mode-bypass 取证事件**实时推到扩展 UI**。当前这些事件**只落 forensic 日志**，扩展 UI 零感知：

| 事件 | 位置 | 触发 |
|---|---|---|
| `security.godmode_bypassed` | server.ts:466 | **L1 scheme bypass**：god-mode 下 navigate/create_tab/set_tab_url 到非 http(s) scheme |
| `security.auto_approved` (reason:"god_mode") | server.ts:390 | **L2 evaluate bypass**：god-mode 下 evaluate/osascript_eval 且无 critical API |

[inspected] 扩展侧 `securityAuditLog`（`agentStore`）**完全本地构建** —— 仅来自确认决策（App.tsx:171）+ UI godmode 武装/解除（SettingsSlideout:115/137）。**没有任何 companion→扩展的审计推送通道**。

**价值**：用户武装了 god-mode 后，确认会消失，但运行时**没有任何实时 UI 信号**告诉 ta"刚刚发生了一次 bypass"。forensic 日志是事后取证，不是 situational awareness。

**kimi 此前裁决**：「可后置，法证日志已覆盖」。

**工作量**：跨层（companion 新 WS 消息类型 + 扩展 consumer + UI toast/audit-entry）。中等。

## 4. P2-E：Phase 1 NITs（companion-only，小）

`classifyMcpCall` 的 arg-scan 有三处可收紧的真实缺口：

1. **非 http(s) scheme**：`MCP_ARG_EXTERNAL_URL` 只匹配 `https?://`（security.ts:361）。`ftp://`/`ws://`/`wss://` 的 egress 不触发 network-egress。
2. **裸 host（无 scheme）**：`"target": "evil.attacker.com:443/exfil"` 这类无 `http://` 前缀的 egress 目标不触发。
3. **>4000 字符 arg 尾截断**：`args.slice(0, 4000)`（security.ts:374）在正则扫描**之前**截断 —— URL/shell 标记若落在 4000 字符之后则逃逸扫描。

**价值**：直接收紧我**刚建的** MCP 能力门所依赖的 arg-scan。低风险、companion-only、可立即收口。

**工作量**：小。

## 5. 我的 push-back（META 2.4，一次）

**P2-E 是更高价值/工时比的下一步**：

- companion-only，无跨层协调；
- 关闭 arg-scan 真实缺口 —— 这些缺口**当下**就削弱 Phase 1 能力门；
- 小、低风险、可立即闭环。

而 P2-D 的 "layer:mcp" 是 non-event；其真实剩余（scheme/L2 bypass 广播）是跨层、更大，且 kimi 已裁"可后置"。

**建议**：先做 P2-E（NITs），再回头评估 P2-D 的真实剩余范围是否值得现在做（还是继续推迟）。

## 6. 请 kimi 裁决

- **(A)** 先 P2-E（NITs，companion-only），P2-D 推迟 —— 我的建议
- **(B)** 先 P2-D（scheme/L2 bypass 实时广播），P2-E 随后 —— 原序列
- **(C)** 其他（例如 P2-D 重新定义为"通用 god-mode bypass 实时广播"并先做）

请裁决。无论选哪个，我都会先出实现 RFC 给你过设计再动手。
