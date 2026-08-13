# ADR-025: ACP Coding Agent Client（编程接力 · Composition）

**日期**: 2026-08-13 | **状态**: Accepted（Phase A 交付 + Phase B 默认关；**静默写盘 / free shell** 仍 NO-GO；**gated apply** GO）  
**相关**: [ADR-020](020-capability-model-three-axes.md) · [ADR-022](022-outbound-mcp-server.md) · [产品设计](../decisions/acp-coding-handoff-product-design-2026-08-13.md) · [双审](../decisions/acp-coding-handoff-dual-review-synthesis-2026-08-13.md)

---

## 决策

### 1. 一句话

> CMspark Companion 作为 **ACP / 本机编程 Agent 的 Client（Composition）**：先交付 **任务包导出（Phase A）**；可选 **审查 / 起草会话（Phase B，`acp.enabled` 默认 false）**。  
> **不是** Side Panel IDE，**不是**第三 runtime，**不是** Outbound MCP 的反写。

### 2. 能力坐标

```text
Surface:      L0/L1 采证；写码不在 CMspark Surface 叙事内
L2-classes:   (none default); session start / apply_diff 走 L2 Confirm
Compose:      coding_handoff pack + acp client + task package export
Autonomy:     single-thread handoff; workers HARD_DENY acp_*
Trust:        HITL start+apply; originWs; untrusted handback + Q5-like taint; never auto_approve skip
Channel:      community Phase A default; Phase B opt-in; gated apply GO; free shell NO-GO
```

### 3. 锁定

| ID | 锁 |
|----|-----|
| **L1** | Phase A（复制任务包）可 default 可用；无 spawn |
| **L2** | Phase B `config.acp.enabled` 默认 **false** |
| **L3** | 默认模式 `review_readonly`（任务意图=审查）；`propose_diff` 需显选；`allow_exec` 永不 true |
| **L4** | `acp_propose_session` / `acp_start_session` / `acp_apply_diff` 强制 L2；cruise/god-mode **不可**静默跳过 |
| **L5** | Handback `<<<UNTRUSTED_ACP_HANDBACK>>>` + taint 至下一条用户消息 |
| **L6** | Worker / orchestrator 子线程 **禁止** 全部 `acp_*` |
| **L7** | 与 Outbound：子进程不注入 `CMSPARK_*` outbound tokens；无 `cmspark__acp_*` 导出 |
| **L8** | UI 会话模式 = 审查/起草，**不**声称 OS 沙箱只读 |
| **L9** | 无新 BottomBar Tab；设置「编程助手」+ `/code` |

### 4. 非目标

- 侧栏 multi-file apply / Zed 克隆  
- shell-in-agent / git push 经 ACP  
- 自动 spawn  
- 用 Computer Use 操作 TUI  

### 5. 实现落点

- `companion/src/acp/*`  
- tools: `acp_list_agents` · `acp_propose_session` · `acp_start_session` · `acp_collect_result` · `acp_cancel_session` · `acp_get_status` · `acp_apply_diff`  

- Extension: `coding-handoff/*` · `CodingTaskPackageModal` · meta slash  
- Pack: `coding-handoff`  

### 6. 后续 / 修订（2026-08-13 S72）

已在 `feat/coding-handoff` 落地增量（仍默认 `acp.enabled=false`）：

| 项 | 状态 |
|----|------|
| 路径探测 + adopt 持久化 | ✅ |
| 启动 argv presets（claude -p 等） | ✅ |
| 多轮 follow-up（新 session + 上文） | ✅ |
| Live FocusBand + handback 注入 | ✅ |
| **propose_diff** + **gated apply**（工作区 containment、L2 永不 cruise 跳过） | ✅ |
| 完整 Zed IDE / free shell / 静默写盘 | ❌ 仍 NO-GO |

Apply 路径：`acp.apply_diff` / tool `acp_apply_diff` — 仅应用会话内解析出的 pending_diffs，禁止路径逃逸。
