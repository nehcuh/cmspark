# Spec: adapter honors run_progress tri-state (null sticky)

**Date**: 2026-08-31  
**Status**: IMPLEMENTED (Claude/Kimi spec AWN; TDD GREEN)  
**Blast**: T1/T2 — latent contract hole, no production writer of `null`  
**Follow-up to**: Kimi MAJOR #4 (re-review: CONFIRMED latent, downgraded P2)

## Capability

```text
Surface:      L0 RunProgress (existing)
L2-classes:   none
Compose:      none
Autonomy:     n/a
Trust:        ticks still exact item.tool ; overlay still denied
Channel:      community
```

## Contract (already in thread-manager)

`run_progress?: RunProgress | null`

- `undefined` — never set; seed from `handoff.open_todos` eligible
- `null` — explicit clear; sticky; never reseeded
- object — caller-set; kept

TM `get()`/`update()` already honor this (`run-progress.test.ts` sticky-null). Adapter tick does not.

## Bug

`companion/src/llm/adapter.ts` after successful `tool.result`:

```ts
const current = th.run_progress && th.run_progress.items.length > 0
  ? th.run_progress
  : seedRunProgress(th)
const shouldWrite = next !== current || (!th.run_progress && next.items.length > 0)
```

JS: `null` is falsy. `get()` leaves `null` sticky, then adapter reseeds from handoff and writes. `thread.update` WS cannot set `run_progress` (not in allowlist). Only tests currently write `null`. Contract is shipped diseased.

Adjacent: `handleRunProgressToggle` uses `thread.run_progress ?? { items: [] }` — would coerce `null` → empty object on a toggle. UI cannot toggle a cleared list; still honor the contract.

## Design

Extract `nextRunProgressAfterToolSuccess(thread, toolName): RunProgress | undefined` in `run-progress.ts` (undefined = do not write):

1. `run_progress === null` → `undefined` (skip; do **not** seed)
2. else existing object with items → `applyToolResult`; write only if changed
3. else (`undefined` or empty items) → seed then tick; write if `next !== current` **or** (`run_progress === undefined` && seeded items length > 0)

Adapter uses the helper. Toggle: if `=== null`, return thread unchanged (no write).

Naive `!= null` on one clause is **not** enough (`next !== current` still writes after a tick on a seeded copy of null).

## Tests (RED first)

`companion/tests/run-progress.test.ts`:

1. Helper: thread with `run_progress: null` + handoff todos + matching tool → `undefined`
2. Helper: `undefined` + handoff todos with `tool` matching → returns seeded progress with that item `done: true` (or seeded if tool doesn't match but items exist)
3. Helper: existing items, matching tool → ticked object
4. Toggle handler: `run_progress: null` stays `null` after `handleRunProgressToggle`

Replace adapter source-grep "success send" window with a lock that adapter calls `nextRunProgressAfterToolSuccess` (or keep grep for the helper name).

## Non-goals

shell W1e, whisper, UI clear control, WS allowlist for `run_progress`.
