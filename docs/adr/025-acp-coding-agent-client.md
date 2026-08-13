# ADR-025: ACP Coding Agent Client（编程接力 · Composition）

**日期**: 2026-08-13 | **状态**: Accepted（Phase A 交付 + Phase B 默认关；写盘/shell 仍 NO-GO）  
**相关**: [ADR-020](020-capability-model-three-axes.md) · [ADR-022](022-outbound-mcp-server.md) · [产品设计](../decisions/acp-coding-handoff-product-design-2026-08-13.md) · [双审](../decisions/acp-coding-handoff-dual-review-synthesis-2026-08-13.md)

---

## 决策

### 1. 一句话

> CMspark Companion 作为 **ACP / 本机编程 Agent 的 Client（Composition）**：先交付 **任务包导出（Phase A）**；可选 **只读审查会话（Phase B，`acp.enabled` 默认 false）**。  
> **不是** Side Panel IDE，**不是**第三 runtime，**不是** Outbound MCP 的反写。

### 2. 能力坐标

```text
Surface:      L0/L1 采证；写码不在 CMspark Surface 叙事内
L2-classes:   (none default); session start 走 L2 Confirm
Compose:      coding_handoff pack + acp client + task package export
Autonomy:     single-thread handoff; workers HARD_DENY acp_*
Trust:        HITL start; originWs; untrusted handback + Q5-like taint; never auto_approve skip
Channel:      community Phase A/B readonly; apply/shell NO-GO v1
```

### 3. 锁定

| ID | 锁 |
|----|-----|
| **L1** | Phase A（复制任务包）可 default 可用；无 spawn |
| **L2** | Phase B `config.acp.enabled` 默认 **false** |
| **L3** | 仅 `review_readonly` 产品默认；`allow_exec` 永不 true |
| **L4** | `acp_propose_session` / `acp_start_session` 强制 L2；`autoConfirmEligible` 不适用静默 |
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
- tools: `acp_list_agents` · `acp_propose_session` · `acp_start_session` · `acp_collect_result` · `acp_cancel_session` · `acp_get_status`  
- Extension: `coding-handoff/*` · `CodingTaskPackageModal` · meta slash  
- Pack: `coding-handoff`  

### 6. 后续

Phase C propose-diff / Phase D apply 须 **单独 dual-review** 后升本 ADR 修订。
