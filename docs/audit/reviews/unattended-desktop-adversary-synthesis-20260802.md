# Adversary Synthesis — 无人值守 / 桌面值守（含 host_computer zero initial L2）

**Date**: 2026-08-02  
**User locks**: 无人值守硬需求 · 武装后 CU 零 initial L2 (B) · 会话(进程)作用域 · 仅 coordinateAllowed App · 不扩 allow_all_schemes  
**Agents**: Product/UX · Security · Compat/ADR · Impl architect  

---

## 1. Scoreboard

| Agent | Verdict | Core stance |
|-------|---------|-------------|
| Product | **GO_WITH_CHANGES** | 第 5 档「无人值守」+ 会话 grant；矩阵诚实；急停≠解除 |
| Security | **REJECT_PRODUCT_GOAL** | 武装→零 initial L2 违反 Trust 单调；建议只硬化 G1 |
| Compat | **APPROVE path** | 禁止 God bool；ADR-017/020 先改；session-trust 类 grant |
| Impl | **YES for dual-review** | M0–M3；`unattended-grant` + `hostComputerTrustSkip \|= unattended` |

## 2. Conflict resolution (product owner locks win + max floors)

| Conflict | Resolution for SoT |
|----------|-------------------|
| Security REJECT vs User B | **Product goal stands** (用户已确认硬需求). Ship only with **C1–C14 floors** below; residual OCR risk documented as accepted residual. |
| G1 corpus vs free WeChat type | **open_within_app** corpus policy for unattended only (ADR must name blast radius). G1 closed corpus **unchanged** for non-unattended. |
| God bool vs CU | **Never** `allow_all_schemes` alone → CU skip (Scheme C reject). |
| Process vs thread | **Process-memory arm** (Companion 进程)；execute-time still prefer `thread:` for audit; no disk persist. |
| Autopilot D4 | **Amend**: exception only named unattended grant for **initial** L2. |

## 3. Mandatory compensating floors (from Security, non-optional)

| ID | Floor |
|----|--------|
| C1 | Phrase + dual checkbox + consequence matrix before arm |
| C2 | Session/process memory only; restart clears; **no config persist** v1 |
| C3 | Every task re-check `coordinateAllowed` + structural exclude |
| C4 | PROMPT_ALWAYS tags immutable (danger / experimental / foreground_yielded) |
| C5 | Hard-deny payment/credential paths unchanged |
| C6 | Budget + actions caps mandatory (default ≤30 task; consider lower process hourly cap) |
| C7 | Estop preflight never weakened |
| C8 | Pack cannot arm (`FORBIDDEN_PACK_KEYS` + refuse) |
| C9 | Audit reason `unattended_session_grant` ≠ `god_mode` |
| C10 | Visible chrome `值守中 · 桌面` + one-click disarm |
| C11 | Estop ≠ disarm (toast honesty) |
| C12 | modelEnabled / experimental still block silent initial when applicable |
| C13 | Wall-clock hard TTL (default **8h**) + optional idle (product: **no 30m idle clear** of unattended, or JTBD dies) |
| C14 | Spawn / ask_user / board / MCP critical / host_cli still force L2 |

## 4. Wire shape (consensus of Compat + Impl)

```text
security.unattended.arm { confirmation_phrase }
security.unattended.disarm {}
security.unattended.status → { armed, armed_at, expires_at }

hostComputerTrustSkip = g1InitialSkipEligible(...) || unattendedInitialSkipEligible(...)
// unattended path: armed && coordinateAllowed && caps && !PROMPT_ALWAYS context for initial only
```

Dual-write cruise bools on arm for packaging (网页+企业); **bools alone never skip CU**.

## 5. Workflow (user-mandated)

```text
M0 ADR+SoT → Pi+Claude dual-review
M1 companion grant → Pi review
M2 extension UX → Pi review
M3 integration + docs → Pi+Claude dual-review → merge
```

## 6. Artifacts

- Design SoT: `docs/superpowers/specs/2026-08-02-unattended-desktop-design.md`
- Impl plan: `docs/superpowers/plans/2026-08-02-unattended-desktop-impl.md`
- Dual prompt: `docs/audit/reviews/unattended-desktop-dual-review-prompt-20260802.md`
