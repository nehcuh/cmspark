# Dual external re-review: Unattended desktop (design + plan) — M0 gate

**Stage:** Product design SoT + implementation plan — **implementation NOT started**  
**Date:** 2026-08-02  
**Batch id:** `unattended-desktop`  
**Repo:** `/Users/huchen/Projects/cmspark`

## Required reading (order)

1. **Design SoT** — `docs/superpowers/specs/2026-08-02-unattended-desktop-design.md`  
   Focus: U1–U7 locks, §4 floors F1–F15, §5 skip algebra, §8 workflow gates, §9 验收金句, security REJECT honesty.

2. **Impl plan** — `docs/superpowers/plans/2026-08-02-unattended-desktop-impl.md`  
   Focus: M0–M3, predicate, RPC, R1–R7, frozen params.

3. **Adversary synthesis** — `docs/audit/reviews/unattended-desktop-adversary-synthesis-20260802.md`  
   Security REJECT vs product GO resolution.

4. **Parent / conflict surface**  
   - `docs/superpowers/specs/2026-08-02-trust-ia-autopilot-design.md` D4  
   - `docs/adr/017-computer-use.md` Decision 3–4  
   - `docs/adr/020-capability-model-three-axes.md` Axis A rule 2  
   - `companion/src/computer/session-trust.ts` (`g1InitialSkipEligible`, PROMPT_ALWAYS)  
   - `companion/src/server.ts` `hostComputerTrustSkip` / forceConfirm for host_computer  

## Product premise (must not be weakened without REJECT)

```text
Hard product requirement: unattended long-run including WeChat typing.
After arm: ZERO initial L2 for host_computer (Option B).
Scope: Companion process memory only (restart clears).
Apps: coordinateAllowed only, re-checked every task.
MUST NOT implement via expanding allow_all_schemes (Scheme C).
MUST keep PROMPT_ALWAYS mid-task force-interactive.
MUST document accepted residual: OCR-blind payment UI risk.
Security agent rejected the goal; floors F1–F15 are mandatory if shipping.
Workflow: M0 dual → M1 Pi → M2 Pi → M3 dual; no skip.
```

## Capability declaration

```text
Surface: L2 | L2-classes: host_computer | Compose: none | Autonomy: single
Trust: unattended session grant | Channel: community|enterprise
```

## Your job

Independent **product + security + ADR + CU engine** review of **design+plan** (docs only / no impl diff). Spot-check real code so the plan is implementable.

### Must answer

1. Is shipping Option B (zero initial L2 after arm) acceptable **with F1–F15**, or must you REJECT the product goal?  
2. Is `open_within_app` corpus correctly called out as the blast-radius delta vs G1?  
3. Does process-memory arm + 8h TTL match session JTBD without config persist?  
4. Is skip algebra safe (`g1 || unattended`) without letting god/auto_approve alone skip?  
5. Are M0 ADR amendments sufficient before M1 code?  
6. Workflow gates adequate for user mandate (Pi milestones + final dual)?  
7. What would force **REJECT** starting M1?

### Rejection gates (any → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | Plan allows allow_all_schemes / auto_approve alone to skip CU initial L2 |
| R2 | Plan silences PROMPT_ALWAYS under unattended |
| R3 | Pack can arm grant |
| R4 | Grant persists across companion restart in v1 |
| R5 | Non-coordinateAllowed apps eligible |
| R6 | No ADR-017/020/Trust-IA D4 amendment before M1 |
| R7 | Matrix/DoD claims zero risk or omits type-no-preview honesty |
| R8 | Estop / hard-deny payment path weakened |

### Non-blocking nits

- Hourly rate tighten, B′ enterprise type-preview mode, thread-bound vs process arm naming, UI checkbox copy

### Output

1. Findings (blocking vs nits) with file:line when code-backed  
2. Answers 1–7  
3. ADR-020 checklist  
4. Final line exactly one of:

```text
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
