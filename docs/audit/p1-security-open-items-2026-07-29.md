# P1 安全残余盘点（相对 2026-07-28 诊断）

> **日期**: 2026-07-29（**2026-07-30 复核**：P1-1 代码在 PR #85，尚未合 `main`）  
> **基线 HEAD**: 本文件随 `fix/diagnosis-P1-2` rebase onto main（含 #85/#89/#90）
> **来源**: [diagnosis-fanout-2026-07-28.md](diagnosis-fanout-2026-07-28.md) § Prioritized Action Plan **P1**  
> **本体**: [ADR-020](../adr/020-capability-model-three-axes.md) Trust 横切 + Surface 单调  
> **证据级别**: `[inspected]` 源码路径；**未**做端到端攻击复现

---

## 摘要

| ID | 标题 | 状态 | 严重度（诊断） | 轴 |
|----|------|------|----------------|-----|
| **P1-1** | god-mode / 危险 flag companion step-up | **FIXED** | High | Trust × Surface |
| **P1-2** | MCP（及部分 L2）确认统一 `originWs` | **FIXED** | Medium | Trust · multi-peer |
| **P1-3** | evaluate 批准后代码完整性（勿再改写） | **FIXED** (2026-07-30, Option A) | Medium | Trust · L1 完整性 |
| **P1-4** | shell_exec 策略收紧（`shell:true` + 前缀） | **FIXED（P1a）** | Medium | Surface L2 · enterprise |

P1-1 / P1-2 / P1-3 / **P1-4 P1a** 均 **FIXED**。P1b shell argv 为残余。

---

## P1-1 · God-mode / 危险 flag 无 companion step-up

### 诊断主张

已鉴权 `config.set` 可用布尔武装 `security.allow_all_schemes` / `auto_approve_dangerous`（及后续 enterprise 同类开关）；UI 短语多为剧场。

### 当前代码

| 层 | 行为 | 锚点 |
|----|------|------|
| **Companion 接受布尔** | 扁平字段直接写入 `security.*`，**无** phrase / re-auth / step-up | `companion/src/message-router.ts` ~191–213 |
| **UI 短语（仅 Settings）** | 开 god-mode 需输入固定 phrase；关无需 phrase | `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` ~148–194、~503+ |
| **Enterprise Plan B** | 另有 phrase 门（UI） | 同文件 Plan B 区块；companion 仍接受 `auto_approve_enterprise_tools` 布尔 |
| **执行侧** | god-mode / auto_approve 可跳过大量 L2；**CU 任务级**等路径刻意不跳过 | `companion/src/server.ts` `skipConfirmation` / forceConfirm 簇（~995–1050、~1873 等） |

### 结论

**FIXED**（P1-1 Design A，2026-07-29）。`config.set` 对 `allow_all_schemes` / `auto_approve_dangerous` / `auto_approve_enterprise_tools` 的 **false→true** 要求 top-level `confirmation_phrase` 匹配 `SECURITY_ARM_CONFIRM_PHRASE`（`我了解风险`，`companion/src/security-arm.ts`）。缺失/错误 → 整条 `config.set` 拒绝 + `security.arm_rejected`；正确 → 持久化 + `security.flag_armed`（`ws_phrase_confirmed`）。消武与已武装 resend（Settings 全量 Save）无需 phrase。Settings UI 武装路径经 background 透传 phrase（非剧场）。`config.json` 带外编辑仍为 ADR-010 路径。CU 任务 L2 / shell·netsec forceConfirm 未改。

### 测试建议

- 集成：鉴权后 `config.set({ allow_all_schemes: true })` **无** phrase → 拒绝或保持 false。  
- UI 路径：phrase 正确 → 成功并有 audit。  
- 负例：phrase 错误 → 不持久化。  
- 覆盖：`companion/tests/message-router-config-security.test.ts`（P1-1 矩阵）。

---

## P1-2 · MCP confirm 统一 `originWs`

### 诊断主张

L2/MCP 确认常不绑 `originWs`，多 peer 下其他 loopback WS 可响应确认。

### 当前代码

| 路径 | `originWs` | 锚点 |
|------|------------|------|
| host_computer / Win nonce L2 | **有**（条件绑） | `server.ts` ~1427–1433 |
| host 写路径 / biometric 等 | **有** | ~1999–2009、~5196–5204 |
| tray 部分 | privileged / 旁路 origin 有文档 | ~1469、`swift-tray-bridge` 注释 |
| **MCP tool confirm** | **有** `{ originWs: ws }` | `server.ts` `executeMcpTool` request 第三参 |
| **MCP meta confirm** | **有** `{ originWs: ws }` | `server.ts` `executeMcpMetaTool` request 第三参 |
| **navigate URL L2** | **有** `{ originWs: ws }` | `server.ts` URL gate ~navigate request |
| **通用 L2 门（evaluate 等）** | 仅 nonce / host_computer 时绑 | ~1433（**未**在本批改写） |

`SecurityConfirmationManager` 支持 origin 绑定与拒绝错 peer：`security-confirmation.ts` ~388–411、~510–533。

### 结论

**FIXED**（2026-07-30 P1-2）。MCP tool / MCP meta / navigate URL L2 在存在请求方 `ws` 时绑定 `originWs`；tray 仍走 privileged `respond()`；双 peer 回归：`security-confirmation-origin.test.ts`、`security-gates.test.ts`、`mcp-capability-gate.test.ts`。  
evaluate/shell 条件绑与 god-mode 不在本批范围。

---

## P1-3 · evaluate 批准后仍改写代码

### 诊断主张

用户/L2 批准的 JS 在 extension 侧再经 sanitizer 改写 → 静默破坏完整性，或与 token 绑定码不一致。

### 当前代码

| 步骤 | 行为 | 锚点 |
|------|------|------|
| Companion L2 | 对 `code` 确认；token 绑定 evaluate code | `server.ts` ~1709–1720 `validateToken(..., "evaluate", evalCode)` |
| Extension 执行 | **`sanitizeText(params.code)` 后再执行** | `chrome-extension/src/background/browser-bridge.ts` ~1070–1087 |
| 副作用 | 可能改写用户已批准源；`threats_removed` 进结果 | 同上 ~1095 |

### 结论

**FIXED（Option A，2026-07-30）**。extension `resolveEvaluateExecution` + `browser-bridge.evaluate`：

- `security_token` 非空 → **原样** `safeEvaluate(tabId, String(params.code))`；`detectDangerousApis` 仅 advisory；成功 payload **不**带 `threats_removed`。  
- token 缺失/空串 → `success: false`，**绝不**裸跑。  
- companion token 绑定仍为原始 `code`（`bindingPayloadFor` / `issueTokenFor`）— **未改** companion。  
- `get_page_text` / `PageSanitizer.sanitizeText` 页面路径不变。

锚点：`chrome-extension/src/background/evaluate-code-policy.ts`、`browser-bridge.ts` evaluate；测：`tests/evaluate-code-integrity.test.ts`。

### 测试建议

- 批准含「会被 sanitizer 改写」的代码 → 执行体与确认/token 绑定一致。  
- 未批准路径仍不得裸跑。

---

## P1-4 · shell_exec：`shell: true` + 前缀 allowlist

### 诊断主张

结构上弱于 argv 级 shell 策略；前缀 allowlist 易被 `allowed_prefix; rm -rf` 类拼接绕过（视 shell 解析）。

### 当前代码

| 层 | 行为 | 锚点 |
|----|------|------|
| 执行 | `spawn(command, { shell: true, ... })` | `companion/src/capability/shell.ts` ~86–91 |
| 策略 | `confirm_per_command`（默认）或 `allowlist` 前缀匹配 | ~26–39、`command.startsWith(prefix + " ")` |
| 门禁缓解 | enterprise 模块 + L2 forceConfirm + Plan A/B session trust + single-flight | `server.ts` ~1048+；`enterprise-session-trust.ts`；`orchestrator/single-flight.ts` |
| 审计 | 默认不存完整 command body | shell.ts audit `cmd_len` |

### 结论

**FIXED（P1a，2026-07-30）**。`policy=allowlist` 时在 `commandAllowedByPolicy` **前缀匹配之前**拒绝 shell metachar（`;|&`$()<>` 与换行）；`checkShellScope` 与 `shellExec` 共用该门。`confirm_per_command` 仍允许 metachar（L2 确认路径）。`spawn(..., { shell: true })`、forceConfirm / god-mode 不静默跳过 shell L2 **未改**。  
**残余 P1b**：`shell: false` + argv；brace/glob/`$VAR` 等更细边界（见 dual-review nits）。

---

## 与「已关闭」项对照（避免重复开工）

| 项 | 状态 | 备注 |
|----|------|------|
| tabUrlCache / tab.navigated（旧 P2-1 M1） | **已落地** | `server.ts` tabUrlCache；extension `background/index.ts` M1 推送；集成测 `security-gates.test.ts` |
| `/healthz`（旧 L12） | **已落地** | `server.ts` `handleHealthzRequest` ~105–119 |
| CU session-trust / Stop=abort 等 07-25 High | **FIXED**（见 07-28 复检表） | 不在本 P1 四条内 |

---

## 建议实施顺序

1. **P1-1** god-mode step-up — **FIXED on PR #85**；下一动作 = **合入 main + CI 绿**  
2. **P1-2** originWs 默认绑定 — 局部、可测、MCP+navigate 一并收（**当前下一枪代码**）  
3. **P1-3** evaluate 完整性 — 行为变更需双端协调 + 测  
4. **P1-4** shell 结构收紧 — 设计权衡，enterprise 范围，可 RFC 后做  

权威排期：[optimization-plan-post-adr-020.md](../optimization-plan-post-adr-020.md) §B。

---

*盘点完成 2026-07-29 · 2026-07-30：对齐 PR #85 / Windows P0；合 main 后请把本文件 Status 同步进 main 并刷新 §0 基线 HEAD。*
