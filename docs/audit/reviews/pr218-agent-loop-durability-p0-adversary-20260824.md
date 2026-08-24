# PR #218 independent adversary — agent-loop durability P0

**Date**: 2026-08-24  
**PR**: https://github.com/nehcuh/cmspark/pull/218  
**HEAD**: 917f975  
**Base**: origin/main (261b7e4)  
**Blast**: T2 (loop/transcript; not L2 confirm bind)

## Capability declaration (ADR-020)

```text
Surface:      L0
L2-classes:   (none)
Compose:      none
Autonomy:     single
Trust:        none   ← challenged: heal-on-select mutates tape
Channel:      community
```

## Machine

```
cd companion && npx tsc -p tsconfig.test.json
node --test context-budget / tool-batch-heal / anthropic / m10 / adapter / files
EXIT: 0   136 pass
CI: build pass, smoke macos/ubuntu/windows pass
```

## Independent lanes (isolated subagents)

| Lane | VERDICT |
|------|---------|
| Abort/heal | REJECT |
| Compaction/Anthropic | REJECT |
| Snapshot/security | REJECT |

## Converged BLOCKs (must fix before merge)

### B1 — `persistHealedToolRows` always appends; chatCreate heals AFTER the new user row
`companion/src/llm/adapter.ts` writes the user message first, then heals. Heal `addMessage`s at EOF. Pairing only walks contiguous `role=tool` after the unpaired assistant → heal rows land after the new user, rebuild **strips** the round, leftover can be healed again.

### B2 — `thread.select` heals while `run_status=llm`
`companion/src/message-router.ts:1722` heals unconditionally. Concurrent select during an in-flight tool batch writes INTERRUPTED onto live ids. Real success can append later; rebuild takes the first id → model retries already-executed tools. GET mutates history.

### B3 — shrink-only mid_loop drops the sticky omit notice
`context-budget.ts` always splices omit notices out; reinserts only if `dropped > 0`. Pin + shrink with `dropped===0` still sets `compacted` and adapter replaces `messages` → next request loses `[context_omitted]`.

## MAJOR (file, not merge-blocking if B1–B3 fixed)

- Late persist after regenerate (`assistantStillOnDisk`) untested
- Stale `thread.messages` + `run_status: llm` can re-set busy after `chat.done`
- Summoner omit of `run_status` untested
- `persistHealedToolRows` itself untested (tests hit the unused helper)

## NIT

- Comment says summoner/tray omit; code only omits summoner
- Lazy `require("./adapter")` cycle
- S51 still uses fake `user("continue")`

## Trajectory

Diff matches claimed P0 slice. Tests were rewritten to the new abort spec but **do not** cover heal-after-user, in-flight select, or omit retain after shrink-only compact.

VERDICT: REJECT
