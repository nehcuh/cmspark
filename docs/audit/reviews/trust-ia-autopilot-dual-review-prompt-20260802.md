# Dual external re-review: Trust IA + Autopilot packaging (design + plan)

**Stage:** Product design SoT + implementation plan — **implementation has NOT started**  
**Date:** 2026-08-02  
**Repo:** `/Users/huchen/Projects/cmspark`  
**Batch id:** `trust-ia-autopilot`

## Required reading (in order)

1. **Design SoT (primary)**  
   `docs/superpowers/specs/2026-08-02-trust-ia-autopilot-design.md`  
   Focus: §0–§2 goals, §4 locks D1–D12 / S1–S5, §5 product shape & matrix, §7 phases, §8 DoD, §10 reject Scheme C.

2. **Implementation plan**  
   `docs/superpowers/plans/2026-08-02-trust-ia-autopilot-impl.md`  
   Focus: P0 Tasks 1–3, P1 Tasks 4–8, file map, R1–R6 gates, no `server.ts` algebra in P0/P1.

3. **Internal adversary synthesis**  
   `docs/audit/reviews/trust-autopilot-ia-adversary-synthesis-20260802.md`

4. **Code spot-check (mandatory — plan vs reality)**  
   - `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` (security section, God-mode, enterprise B, matrix ~400–700)  
   - `companion/src/security-arm.ts` (`SECURITY_ARM_FLAGS`, phrase)  
   - `companion/src/server.ts` — skim forceConfirm / skipConfirmation / enterpriseSkip / allow_all_schemes (confirm plan does not need algebra change for P0/P1)  
   - `companion/src/packs/types.ts` — `FORBIDDEN_PACK_KEYS`  
   - `docs/adr/010-tiered-privilege-godmode.md` · `docs/adr/020-capability-model-three-axes.md` Trust section  
   - `docs/confirm-center-user-guide.md` §5

5. **Optional:** `docs/decisions/v1.3/enterprise-session-trust-godmode-plan-2026-07-27.md` (Plan A/B law)

## Product premise (must not be weakened)

```text
Problem: Too many parallel permission entry points; "God-mode" oversells
  (actually allow_all_schemes = L1 + partial browser L2).
User JTBD: one entry for long-run unattended agent; user accepts consequences.
LOCKED solution shape:
  - REJECT expanding god to skip shell/CU/spawn forceConfirm
  - Rename God UI → 协议解锁
  - Primary JTBD = 运行自主度 (Autopilot tiers) that dual-writes existing bools
  - Hard floors v1: host_computer task L2, spawn_worker, cookies, workspace, pack whitelist
  - Wire keys frozen; Autopilot is Trust packaging (ADR-020), not 4th axis
  - P0 = IA/rename/docs; P1 = arm UI + status chip; P2 session/TTL/spawn budget out of scope
```

## Capability declaration (ADR-020)

```text
Surface:      n/a
L2-classes:   (none new)
Compose:      none
Autonomy:     n/a (spawn still L2)
Trust:        packaging of existing security flags
Channel:      community | enterprise honesty
```

## Your job

Independent **product + security + ADR/compat + settings UX** review of **design + plan** (no implementation diff yet — git may only show docs). Spot-check real code so the plan is implementable and locks match `server.ts` / Settings.

### Must answer

1. Are D1–D12 / S1–S5 **internally consistent** and sufficient for the user premise **without** shipping Scheme C?  
2. Does P0+P1 actually deliver the long-run JTBD, or is P0 alone a false promise? Is the PR split sound?  
3. Is dual-writing existing flags safe vs a new `autopilot` config key? Any skew Ext↔Companion?  
4. Disarm P1-A (clear all three flags) — acceptable UX/power-user risk?  
5. Hard floors: any missing tool family that must stay forceConfirm?  
6. Does plan risk touching `forceConfirm` / god skip shell by accident?  
7. What would make you **REJECT** starting implementation?

### Rejection gates (any fail → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | Design/plan expands `allow_all_schemes` (or Autopilot) to silent-skip shell/CU/spawn forceConfirm in P0/P1 |
| R2 | Plan stores superseding autopilot enum without dual-write bools as SoT |
| R3 | Pack path can arm trust flags |
| R4 | Arm false→true without companion phrase step-up |
| R5 | UI primary path still named God-mode with “full power” copy |
| R6 | Claims CU/spawn unattended in P1 DoD while floors say still confirm (lying matrix) |
| R7 | P0/P1 requires `server.ts` skip algebra change without tests/ADR |
| R8 | Breaks enterprise scope ∩ (allowlist/task-auth) for shell/netsec |

### Non-blocking nits (→ APPROVE_WITH_NITS)

- Copy polish, section order, whether P0 ships placeholder vs empty 运行自主度  
- Whether ADR-020 one-paragraph amend is P0 or P1  
- SafetyStrip vs FocusBand chip placement  
- 旧称 God-mode retention period

### Output format

1. Findings (blocking vs nits) with file:line where code-check fails  
2. Explicit answers to Must answer 1–7  
3. ADR-020 checklist result  
4. Final line exactly one of:

```text
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
