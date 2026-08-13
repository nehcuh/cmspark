# Dual review: 编程接力 / ACP coding-agent handoff product design

## Nature

**Design / product dual-review** (not a code implementation batch).  
There is **no production ACP Client code** yet. Review the **design synthesis** for product soundness, ADR-020 fit, trust gates, staging, and conflict with existing Outbound MCP / Apps / multi-agent.

## Primary document under review (MUST read fully)

`docs/decisions/acp-coding-handoff-product-design-2026-08-13.md`

## Grounding docs / code (use Read/Grep tools — do not rubber-stamp)

| Path | Why |
|------|-----|
| `docs/adr/020-capability-model-three-axes.md` | Composition vs Surface vs Autonomy; ban 中层 Agent |
| `docs/adr/022-outbound-mcp-server.md` | **Reverse** direction (coding agent → CMspark browser); dual-channel risk |
| `docs/host-and-apps.md` | host_app / host_cli / Apps track — not coding TUI driver |
| `docs/multi-agent-user-guide.md` | spawn_worker ≠ foreign coding agent |
| `docs/mcp.md` (Outbound section) | Existing coding-agent product interface |
| `companion/builtin-skills/dynamic-workflow.md` | Existing “Prompt Chain for Claude Code” — thin slice overlap |
| `companion/src/apps/cli-q5.ts` + `companion/src/tool/l2-admission.ts` | Taint / L2 patterns to mirror for handback |
| `companion/src/mcp/manager.ts` | Config/process lifecycle pattern |
| `docs/audit/reviews/_templates/dual-review-capability-checklist.md` | Mandatory checklist |

## Capability declaration (from design §3)

```text
Surface:      L0/L1 for evidence capture; coding writes not CMspark Surface narrative
L2-classes:   (none default Phase A/B); future apply would be L2-class side effects
Compose:      pack + optional acp client + task-package export (Composition)
Autonomy:     single-thread handoff; NOT spawn_worker / Board coding fleet
Trust:        HITL session start; never auto_approve skip; untrusted handback + taint
Channel:      community review/export; write gated or external
```

## Design claims to stress-test

1. **Hero JTBD only**: browser-truth → local code action (staging/SSO bug, PR page review, AppSec finding). Kill cold-start IDE replacement.
2. **Phasing**: Phase A thin “编程任务包” (no ACP) → Phase B read-only ACP if demand → propose-diff → apply last/NO-GO v1.
3. **Naming**: 编程接力 / 派给终端助手; no 中层 Agent / ACP tab / second runtime.
4. **Trust**: no auto-spawn; no shell-in-agent v1; Outbound×ACP loop guards; Q5-style taint on handback.
5. **UX**: Hybrid offer + always manual confirm; no new bottom tab; diffs open externally.
6. **Architecture**: `companion/src/acp/`; tools propose/collect/cancel not free-fire run; default `acp.enabled=false`.

## Review questions (answer explicitly)

### Product / JTBD
- Is the Hero use case real and unique to CMspark, or demo-ware?
- Is Phase A sufficient value, or is it under-scoped / over-scoped?
- Does dual narrative (Outbound vs 编程接力) stay clear, or will users/docs collapse them?

### ADR-020 / architecture
- Is Composition placement correct, or does ACP actually create a third runtime / Autonomy pollution?
- Conflict with `dynamic-workflow` Prompt Chain — merge or dual-track?
- Missing MUST for a future ADR?

### Trust / security
- Are v1 gates (RO + propose only; no auto-spawn; loop locks) adequate?
- Residual write risk if external agent self-writes while UI says “只读”?
- Disclosure (page text → cloud coding model) parity with ADR-022 L3+?

### Ship decision
- Recommend: **APPROVE** design as SoT for Phase A · **APPROVE_WITH_NITS** · or **REJECT** (must rework before any impl)?
- If REJECT: list **blocking** issues that must change in the decision doc.
- If nits: only non-blocking improvements for Phase A / ADR later.

## Out of scope
- Implementing ACP protocol code
- Reviewing unrelated uncommitted tree noise (focus on the design doc + grounding)
- Expanding to full multi-agent coding fleet

## Output format

1. **Summary** (5–10 lines)
2. **Blocking issues** (if any) — section refs into the design doc
3. **Nits** (non-blocking) — prioritized
4. **Capability checklist** pass/fail notes
5. **Ship recommendation** for Phase A vs Phase B
6. Final line exactly one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
