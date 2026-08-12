# Multi-adversarial synthesis — thread-graph Obsidian v1.1

| Field | Value |
|-------|--------|
| Batch | `thread-graph-obsidian-v11-20260812` |
| Date | 2026-08-12 |
| Blast tier | **T2** Surface L0 UI polish (no L2/Compose/Trust lift) |
| Scope | `chrome-extension/src/thread-graph/*`, `tests/tag-colors.test.ts`, design §6 |
| Out of scope | `companion/.../host-integrity.ts` (unrelated dirty tree) |

## Capability (ADR-020)

```
Surface:      L0
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        no elevation
Channel:      n/a
```

## Machine

| Check | Result |
|-------|--------|
| `chrome-extension` npm test | **628 pass** (incl. `tag-colors`, `force-layout`, `thread-graph-bg`) `[executed]` |

## Adversary lanes (independent explore agents)

| Lane | Round 1 | Round 2 (after fix) |
|------|---------|---------------------|
| Product/UX | APPROVE_WITH_NITS | — |
| Correctness | **REJECT** | **APPROVE_WITH_NITS** |
| Security/Trust | APPROVE_WITH_NITS | — |
| Spec/DoD | APPROVE_WITH_NITS | — |

### Round-1 Correctness REJECT (blockers) → fixed

| # | Issue | Fix |
|---|--------|-----|
| C1 | focus click rebuilt `nodesInput` arrays → full reseed/jump | `layoutSignature` (ids+deg+edges); same sig keeps x/y/pin |
| C2 | fitView only if energy &lt; 0.06 | also fit when sim ticks exhaust (320) |
| C3 | pointerleave cleared drag without unpin/capture hygiene | leave only clears hover; capture + endDrag on up/cancel |
| C4 | hit pad world-fixed → unclickable when zoomed out | screen-constant `HIT_PAD / scale` |
| C5 | pin cleared on pointerup (§3.4 sticky pin) | sticky pin only after real drag (`moved`); click does not freeze |

Additional: panel `localStorage` only on toolbar toggle; node click transient open; draw rAF no longer remounts on focus (`isolatedIdsRef`).

## Residual nits (non-blocking · file for follow-up)

| Source | Nit |
|--------|-----|
| UX | No on-canvas mini color legend when panel closed |
| UX | Empty state lacks in-graph「提取要点」CTA |
| UX | Toolbar wrap can overlap float panel (`top: 64` fixed) |
| UX | Canvas a11y (role/img, keyboard node nav) |
| Spec | §3.1 left rail stale vs §6 floating (doc debt) |
| Security | `prepareThreadGraphSnapshot` should runtime-slim unknown keys (defense in depth) |
| Correctness | No `ThreadGraphApp` canvas integration tests; resize no re-fit |

## Synthesis VERDICT

**ADVERSARY_SYNTHESIS: APPROVE_WITH_NITS**

- All four lanes ≥ APPROVE_WITH_NITS after Correctness re-review  
- No remaining correctness **blocker** for T2 polish ship  
- Nits tracked; not merge-blockers under blast T2  

## Next gate

→ `scripts/dual-external-review.sh` Claude + Pi with this synthesis + scoped diff  
→ MERGE only if both external VERDICT ∈ {APPROVE, APPROVE_WITH_NITS}
