# Lane A r2 (Independent Adversary) — post-#219 kimi nits — LLM loop re-verify

**Role**: INDEPENDENT ADVERSARY (Lane A). Did **not** implement. Prior verdict: **REJECT** (`post219-kimi-nits-lane-a-llm-20260825.md`).  
**Date**: 2026-08-25 (r2 incremental)  
**Repo**: `C:\Users\HuChen\Projects\cmspark`  
**Scope**: Re-falsify only the three claimed A-folds after implementer fix. No source/test edits by this lane.  
**Default**: REFUTED until `file:line` + evidence tag.

---

## Capability declaration (unchanged claim)

| Axis | Declared | r2 check |
|------|----------|----------|
| Surface | L0 | `[inspected]` No new L2 in range |
| Autonomy | steer / nextRun | `[inspected]` finally leftover→nextRun |
| Trust | unchanged | `[inspected]` |

---

## Machine tests `[executed]`

CWD `companion/`:

```text
npx tsx --test tests/adapter-steer-overflow.test.ts tests/tool-batch-heal.test.ts tests/run-queues.test.ts
```

| Suite | Pass | Fail |
|-------|------|------|
| `adapter-steer-overflow.test.ts` | **13** | 0 |
| `tool-batch-heal.test.ts` | **12** | 0 (includes new assistantId scope test) |
| `run-queues.test.ts` | **7** | 0 |
| **Total** | **32** | **0** |

No `Connection error.` in this run. Overflow/length cases assert `streamParams.length` ∈ {1,2,3} — mock was consumed.

---

## Claimed A-folds vs live

| ID | Claim | Live | Status |
|----|--------|------|--------|
| A-BLOCK | Patch `OpenAIProvider.prototype.streamChat` (CanonicalStreamEvent), not dummy Completions; 13/13 | `adapter-steer-overflow.test.ts:10-12,114-121`; `createProvider` → `OpenAIProvider` | **FOLDED** |
| A-High leftover | finally: `takeSteer` → `enqueueNextRun`; queue-full WARN only — **no** `dropSteer` | `adapter.ts:1749-1769`; `dropSteer` not imported (`adapter.ts:43`) | **FOLDED** |
| A-High filler | `replaceInterruptedFillerIfPresent(..., assistantId)` scans contiguous tool block only; adapter passes `savedAssistantId` | `tool-batch-heal.ts:217-250`; `adapter.ts:1415-1416`, `1608-1609` | **FOLDED** |

---

## Attack replay

### 1–2 — Mock seam / fake production path

**Prior REJECT**: Completions.prototype patch never hit `OpenAIProvider` (dual class under tsx).

**r2** `[executed]` private probe (not committed):

- `createProvider(...) instanceof OpenAIProvider` → **true**
- Patch `OpenAIProvider.prototype.streamChat` → `providerHit=1`, yields `token`/`done`
- Same process: patch dummy `Completions.create` → `completionsHit=0`
- Dummy Completions path still **misses** production (prior finding stands as historical); **current suite patches the right seam**

Fake-fold attack (“tests pass but adapter uses another class”) → **REFUTED** for openai protocol default. Anthropic path is out of this suite’s mock (tests use default openai config) `[assumed]` acceptable for this WIP scope.

### 3 — Queue-full leftover wipe

**Live** `[inspected]` `adapter.ts:1757-1768`:

```text
takeSteer → enqueueNextRun
on fail: logger.warn(...); // NO dropSteer
```

`dropSteer` appears only in a comment (`adapter.ts:1767`). Import is `enqueueNextRun, takeSteer` only (`adapter.ts:43`).

**Concurrent survival** `[executed]` private probe:

1. Fill `nextRun` to `MAX_NEXT_RUN`
2. `takeSteer` leftovers
3. `enqueueSteer('concurrent-after-take')` (simulates race after take)
4. `enqueueNextRun` fails
5. **Without** `dropSteer`, `takeSteer` returns the concurrent item (`clientMessageId` preserved)

`Map.delete` inside `takeSteer` (`run-queues.ts:28-31`) only removes the snapshot being converted; a later `enqueueSteer` creates a fresh queue entry. No remaining wipe constructed on the queue-full branch.

**Coverage gap (Nit)**: suite test `leftover steer with full nextRun queue...` asserts empty steer after (leftover drained) but does **not** inject a post-take concurrent steer. Fix is real; automated race pin is missing.

### 4 — Filler wrong-row

**Live** `[inspected]` with `assistantId`:

- `from = asst+1`, `until` advances while `role === "tool"` (`tool-batch-heal.ts:230-236`)
- Find only inside `history.slice(from, until)` (`:238-244`)
- Missing assistant id → `return false` (`:232`)

**Adapter** passes `savedAssistantId` on success and exception paths (`adapter.ts:1415`, `1608`) `[inspected]`.

**Helper test** `[executed]`  
`replaceInterruptedFillerIfPresent: assistantId scopes to that round (does not rewrite an older filler)` — two assistants both with `call_A` INTERRUPTED; replace with `assistantId=a-new` leaves `f-old` INTERRUPTED, updates `f-new` only. **Pass.**

Wrong-row attack against the **claimed** replace fix → **REFUTED**.

**Residual (Nit, not this claim)**: `persistHealedToolRows` skip-if-id-anywhere remains whole-tape (`tool-batch-heal.ts` ~180). That can still skip writing a *new* block filler when an old id exists; scoped replace then falls through to `addMessage` EOF. Different bug class; not a regression of the A-High filler fold.

Omitting `assistantId` still scans full tape (`from=0,until=length`) — legacy helper call without id; production tool path passes id `[inspected]`.

### 5 — leftover drops `clientMessageId`

**Still true** `[inspected]`:

- Leftover join uses `.map(s => s.text)` only (`adapter.ts:1759`)
- `nextRunByThread: string[]` (`run-queues.ts:14,40-47`)

Mid-run steer still echoes first `client_message_id` (`adapter.ts:910-921`) — FOLDED for that path.

Deferred leftover→nextRun **loses** F1 adopt id. Severity: **Nit** (not BLOCK) — text is not silently dropped on normal finish; optimistic bubble adopt may fail on the drained follow-up. Outside the three claimed A-folds’ acceptance bar, but still open product debt.

### 6 — Fake fold (provider instance)

See §1–2. `provider.streamChat` is prototype dispatch on `OpenAIProvider` instances from `createProvider`. Suite patches that prototype before `chatCreate`. **REFUTED.**

---

## Findings (r2)

### Prior BLOCK / High — disposition

| Prior | Disposition |
|-------|-------------|
| BLOCK: Completions mock / 13 fail | **CLOSED** — provider `streamChat` mock; 13/13 pass; probe confirms hit |
| High: queue-full `dropSteer` wipe | **CLOSED** — warn-only; concurrent steer survives in probe |
| High: filler global first-match | **CLOSED** — assistant-scoped contiguous block + helper test |

### Open nits

1. **Leftover→nextRun discards `clientMessageId`** — `adapter.ts:1759` + `run-queues.ts` string queue. F1 adopt incomplete on deferred path.
2. **No suite pin for post-`takeSteer` concurrent survival** on queue-full (private probe only).
3. **`persistHealedToolRows` global id-skip** residual vs multi-assistant same tool id (related to heal, not replace).
4. **Inherent** `takeSteer`-then-side-effect crash window (mid-run persist / finally enqueue) — unchanged; not claimed fixed.

No new BLOCK/High found against the three claimed folds.

---

## Verdict rationale

The three implementer A-folds are present at cited call sites and backed by green `[executed]` suites plus targeted probes. Prior REJECT causes are closed. Remaining issues are nits (cmid on nextRun, test-gap on concurrent race, heal skip residual).

VERDICT: APPROVE_WITH_NITS
