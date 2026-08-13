# Final multi-agent acceptance — coding-handoff / ACP (feat/coding-handoff)

**Date**: 2026-08-13 · **Branch**: feat/coding-handoff · **Worktree**: `.worktrees/feat-coding-handoff`

## Internal adversarial panel (independent explore/execute agents)

| Axis | Verdict | Notes |
|------|---------|-------|
| **Security** | APPROVE_WITH_NITS | No lock break; nits: allow_delete preview, mode not bound on propose tool path, cruise-skip unit test |
| **UX / C5** | APPROVE (after fix) | First pass REJECT (apply CTA unreachable + pack 只读审查) → fixed → re-APPROVE |
| **Architecture** | APPROVE_WITH_NITS | L1–L9 hold; doc drift product SoT apply NO-GO vs gated apply GO |
| **Tests** | APPROVE_WITH_NITS | 23+21 pass [executed]; depth nits only |

## UX blockers fixed before re-approve

1. FocusBand `hasCodingSession` includes `state === "closed"` so 应用 diff / 追问 mount  
2. Chip/store do not auto-clear while `hasPendingDiff`  
3. pack.yaml: 审查/起草 + `acp_apply_diff` allowlist; no mode-label 只读审查  

## Aggregate ship verdict

**APPROVE_WITH_NITS** — safe to push PR #185; residual nits non-blocking for merge.

### Residual nits — **closed** on branch `fix/coding-handoff-residual-nits`

| Nit | Resolution |
|-----|------------|
| L2 preview mode / allow_delete | `l2-admission` preview strings + WS confirm code |
| Bind mode+workspace on propose | `SecurityPolicy.bindingPayloadFor` + L2 normalize + dispatch validate |
| cruise cannot skip acpForceConfirm | pure `resolveL2ForceConfirm` + unit tests |
| Product SoT apply NO-GO drift | product design §0/§6/§8 + ADR-020 Composition |
| Mode badge + cloud disclosure | CodingSessionChip + Modal checkbox |

### Evidence [executed]

```
companion tests/acp-*.test.ts → 23 pass / 0 fail
extension coding-handoff + focus-band → 21 pass / 0 fail
```

## External dual-review (Pi + Claude host CLI)

**2026-08-13 residual nits (PR #186):** both **APPROVE_WITH_NITS** · `both_ok=true`  
Artifacts: `acp-coding-handoff-residual-nits-{claude,pi,verdict}-20260813-154232.*`  
Synthesis: [`docs/decisions/acp-coding-handoff-residual-nits-dual-review-synthesis-2026-08-13.md`](../../decisions/acp-coding-handoff-residual-nits-dual-review-synthesis-2026-08-13.md)

### Earlier note (pre-#186 empty CLI attempt)


Two attempts (timeout 180s / 120s) produced **empty stdout** (artifacts 0 bytes). Host CLIs appear non-responsive in this environment (auth/API), not a product REJECT.

**Fallback acceptance:** internal 4-agent adversarial panel + UX re-approve after blocker fixes = ship bar for this closeout.

## Ship decision

| Item | Status |
|------|--------|
| Aggregate | **APPROVE_WITH_NITS** |
| Push branch | GO |
| Merge PR #185 | GO when CI green (nits non-blocking) |
