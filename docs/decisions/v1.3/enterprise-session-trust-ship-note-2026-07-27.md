# Ship note: Enterprise A+B (session trust + global enterprise auto-approve)

| Field | Value |
|-------|--------|
| Date | 2026-07-27 |
| Plan | `enterprise-session-trust-godmode-plan-2026-07-27.md` |
| Commits | `df5a6c3` plan · `5c3f21b` impl · follow-up UI nits |

## What shipped

### A — 本线程企业信任
- L2 勾选（**MinimalConfirm** + **ConfirmElevated**）→ 仅当前 tool family（netsec 或 shell）
- Idle **30m** + hard **8h** from last **interactive** grant（auto-skip 不刷 idle）
- SafetyStrip chip：**企业信任中 · 撤销**
- WS：`enterprise.session_trust.status` / `.revoke`

### B — 全局企业自动批准
- `security.auto_approve_enterprise_tools`（默认 false）
- Settings 短语「我了解风险」+ 文案矩阵（与 God-mode / 自动批准危险区分）
- Pack 禁止键；boot WARNING

### Gate (G1–G5)
- Scope 先硬拒 → 再 B/A skip
- `mustInteract = (!skip || force) && !hostComputerTrustSkip && !enterpriseSkip`
- God-mode / auto_approve_dangerous **alone** 仍 force shell/netsec

## Tests
- `companion/tests/enterprise-session-trust.test.ts` — 14 pass
- companion + extension `tsc --noEmit` clean

## How to use (pentest)
1. enterprise + netsec 模块 + allowlist + 本线程任务授权  
2. 第一次扫描：红条勾选「本线程内自动批准同类（netsec）」→ 允许  
3. 同线程范围内后续扫描：自动批准（见日志 `security.enterprise_auto_approved`）  
4. 或：设置 → **全局自动批准企业高危工具**（全进程，仍受范围）  
5. 撤销：SafetyStrip「撤销」或重启 Companion  

## Known nits (non-blocking)
- Full T1–T20 server integration suite not fully automated (unit core covered)
- Fingerprint mismatch deactivates but does not hard-revoke grant record
- execute path still has inline scope duplicate of helpers (defense in depth)
