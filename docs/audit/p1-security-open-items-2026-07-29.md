# P1 安全残余盘点（相对 2026-07-28 诊断）

> **日期**: 2026-07-29  
> **基线 HEAD**: 当前 `main`（盘点时含 ADR-020 文档采用 `e669314` 一带）  
> **来源**: [diagnosis-fanout-2026-07-28.md](diagnosis-fanout-2026-07-28.md) § Prioritized Action Plan **P1**  
> **本体**: [ADR-020](../adr/020-capability-model-three-axes.md) Trust 横切 + Surface 单调  
> **证据级别**: `[inspected]` 源码路径；**未**做端到端攻击复现

---

## 摘要

| ID | 标题 | 状态 | 严重度（诊断） | 轴 |
|----|------|------|----------------|-----|
| **P1-1** | god-mode / 危险 flag companion step-up | **OPEN** | High | Trust × Surface |
| **P1-2** | MCP（及部分 L2）确认统一 `originWs` | **OPEN**（部分路径已绑） | Medium | Trust · multi-peer |
| **P1-3** | evaluate 批准后代码完整性（勿再改写） | **OPEN** | Medium | Trust · L1 完整性 |
| **P1-4** | shell_exec 策略收紧（`shell:true` + 前缀） | **OPEN**（有缓解） | Medium | Surface L2 · enterprise |

四条均 **未闭环**。缓解存在（UI 短语、enterprise L2 forceConfirm、shell allowlist 可选），但诊断原意的 companion 硬门 / 绑定一致性 / 批准后不改写 / 结构上弱于完整 shell 策略 **仍成立**。

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

**OPEN**。任意已鉴权 WS peer（不仅是 Settings UI）可 `config.set` 武装全局放宽。  
**目标形态（建议）**：companion 对「布尔 0→1 的危险 flag」要求：

1. 与 UI 相同的 phrase（或一次性 step-up token / 二次确认消息族），或  
2. 拒绝经 `config.set` 武装、仅允许专用 `security.arm_*` 消息 + origin 绑定。  

消武（true→false）可保持宽松。

### 测试建议

- 集成：鉴权后 `config.set({ allow_all_schemes: true })` **无** phrase → 拒绝或保持 false。  
- UI 路径：phrase 正确 → 成功并有 audit。  
- 负例：phrase 错误 → 不持久化。

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
| **MCP tool confirm** | **无** | `server.ts` ~3905–3918 `request(...)` 无第三参 |
| **MCP meta confirm** | **无** | ~4089–4098 |
| **navigate URL L2** | **无** | ~1805–1816 |
| **通用 L2 门（evaluate 等）** | 仅 nonce / host_computer 时绑 | ~1433 |

`SecurityConfirmationManager` 支持 origin 绑定与拒绝错 peer：`security-confirmation.ts` ~388–411、~510–533。

### 结论

**OPEN（部分）**。Computer / 部分 host 已 origin-bound；**MCP 与 navigate URL 确认仍为广播式**。  
**目标形态**：凡 `securityConfirmations.request` 且存在请求方 `ws`，默认 `{ originWs: ws }`；tray 应答走已有 privileged path；补双客户端回归测。

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

**OPEN**。批准语义应对 **用户确认的那份 `code` 字节** 执行；injection 过滤应在 **确认预览之前** 完成，或批准路径跳过改写（仅 advisory 标注）。  
**目标形态（择一）**：

- **A（推荐）**：extension 在 `security_token` 已验证路径上 **原样** `safeEvaluate(tabId, params.code)`；sanitizer 仅用于无 token 的防御或预览。  
- **B**：companion 在确认前 sanitizer 一次，token 绑定 **净化后** 码，extension 禁止二次净化。

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

**OPEN（有缓解）**。产品门（enterprise、L2、模块开关）降低暴露面，但 **执行模型仍是整串 shell**。  
**目标形态（分阶段）**：

1. **P1a**：allowlist 模式禁止 metachar（`;|&`$()` 等）或强制 argv 数组 API。  
2. **P1b**：默认 `shell: false` + `spawn(file, args)`；需要 shell 语法时显式 flag + 更严确认。  
3. 保持：god-mode **不得**静默跳过 shell L2（已有 forceConfirm 语义，回归锁住）。

---

## 与「已关闭」项对照（避免重复开工）

| 项 | 状态 | 备注 |
|----|------|------|
| tabUrlCache / tab.navigated（旧 P2-1 M1） | **已落地** | `server.ts` tabUrlCache；extension `background/index.ts` M1 推送；集成测 `security-gates.test.ts` |
| `/healthz`（旧 L12） | **已落地** | `server.ts` `handleHealthzRequest` ~105–119 |
| CU session-trust / Stop=abort 等 07-25 High | **FIXED**（见 07-28 复检表） | 不在本 P1 四条内 |

---

## 建议实施顺序

1. **P1-1** god-mode step-up — 最高 blast radius，对齐 ADR-020 Trust  
2. **P1-2** originWs 默认绑定 — 局部、可测、MCP+navigate 一并收  
3. **P1-3** evaluate 完整性 — 行为变更需双端协调 + 测  
4. **P1-4** shell 结构收紧 — 设计权衡，enterprise 范围，可 RFC 后做  

权威排期：[optimization-plan-post-adr-020.md](../optimization-plan-post-adr-020.md) §B。

---

*盘点完成 2026-07-29 · 代码变更后请更新本表 Status 列。*
