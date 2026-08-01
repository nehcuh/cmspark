# Triple external re-review: Qwen3-VL experimental layer product design

**Stage:** Design SoT after multi-adversarial revision (§9 locks + §16)  
**Date:** 2026-08-01  
**Repo:** `/Users/huchen/Projects/cmspark`

## Required reading (in order)

1. **Design SoT (primary)**  
   `docs/superpowers/specs/2026-08-01-qwen3-vl-experimental-layer-product-design.md`  
   Focus: §0–§11, **§9 decision locks**, **§16 adversary amendments**.

2. **Internal four-lane synthesis (context, do not rubber-stamp)**  
   `docs/audit/reviews/qwen3-vl-product-design-adversary-synthesis-20260801.md`

3. **User-facing doc (spot-check honesty)**  
   `docs/qwen-vl-experimental-layer.md`

4. **Optional code spot-check** (if tools available):  
   `companion/src/computer/qwen-vl-*.ts`, `qwen-vl-worker.py`, `model-handlers.ts`, `model-license.ts`, Settings experiment UI.

## Capability declaration (must not be weakened)

```text
Surface: L2 experimental locate only
Trust: modelEnabled + license + biometric enable + per-hit re-L2
       god-mode/auto_approve never skip experimental
Channel: community local download + local inference
```

## Your job

Independent **product + security + ops** review of the **design document** (not a full code audit unless you spot-check).

### Must answer

1. Are §9 locks (D1–D11) **internally consistent** and **sufficient**?  
2. Does §16 close the gaps that four-lane adversaries raised, or are residual holes still Blocking?  
3. China download / no-Python journey: is the design honest and shippable as written?  
4. Supply-chain (`trust_remote_code`, budget, notices): acceptable for P0/P1 bar?  
5. What is still **missing** from a complete product design (not implementation)?

### Rejection gates (any fail → REJECT design as merge-ready)

| # | Gate |
|---|------|
| R1 | Spec allows inject without re-L2 / experimental gate |
| R2 | Spec allows enable while `!canEnable` without hard refuse (D1 must be A) |
| R3 | Coordinate protocol still ambiguous (D3 must force pixel-only) |
| R4 | Disk budget story still contradictory (2048MB vs multi-GB) without D8 resolution |
| R5 | License door checklist omits remote-code ACE / data path / real download source |
| R6 | Claims “P0 complete / 可内测” while §16 A1–A8 open |

### Output format (strict)

```markdown
## Summary
## §9 decision locks
## §16 coverage of prior gaps
## User journey / CN network
## Trust / supply-chain
## Residual holes (design-level)
## Blocking
## Nits
## Verdict confidence
(0-100%)

VERDICT: APPROVE | APPROVE_WITH_NITS | APPROVE_WITH_CHANGES | REJECT
```

Write only the review markdown to stdout. Be adversarial; cite § numbers. Tag `[inspected]` when you read files.
