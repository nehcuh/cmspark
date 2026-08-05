# Multi-Adversarial Code Review — main S45 pull (#122–#124 · PATH · upload · 0.4.0)

**Date**: 2026-08-05  
**Range**: `4a2d02f..474df7e` (after `git pull --ff-only origin main`)  
**Base**: `4a2d02f` (docs: Pi final gate after #121)  
**Tip**: `474df7e` (`docs(memory): S44 handoff — file upload busy-stuck…`)  
**Method**: 4 independent adversarial lanes in parallel (Security / Correctness / Architecture / Compat)  
**Orchestrator**: Grok Build · post-ship multi-lane pattern (`memory/project-knowledge.md`)  
**Diff artifact**: [`s45-main-pull-diff-20260805.patch`](s45-main-pull-diff-20260805.patch)  
**Lane reports**:
- [`s45-lane-security-20260805.md`](s45-lane-security-20260805.md)
- [`s45-lane-correctness-20260805.md`](s45-lane-correctness-20260805.md)
- [`s45-lane-architecture-20260805.md`](s45-lane-architecture-20260805.md)
- [`s45-lane-compat-20260805.md`](s45-lane-compat-20260805.md)

**Prior targeted reviews in range** (re-verified, not re-litigated as open when tip still holds):
- run-state-review-bugs multi-lane + dual (Claude+Pi) for #122-class M3' floors / run-scoped RunBusy — **LIVE tip holds** `[inspected]`

---

## Lane verdicts

| Lane | Status | Recommendation |
|------|--------|----------------|
| Security | WATCH | **APPROVE_WITH_NITS** |
| Correctness | WATCH | **REQUEST_CHANGES** |
| Architecture | WATCH | **APPROVE_WITH_NITS** (HIGH residual: stop scope honesty) |
| Compat/Platform | WATCH | **APPROVE_WITH_NITS** |

## Final synthesis

| Field | Value |
|-------|--------|
| **Architectural status** | WATCH |
| **Internal multi-lane** | **REQUEST_CHANGES** |
| **Merge-ready (code already on main)?** | **YES for claimed Trust floors + PATH harden + same-thread upload fix**; **NO for treating S44 upload busy state-machine as complete** under thread switch |
| **Product ship / default-on?** | N/A — floor restore + bugfix, not new autonomy default |
| **Bake-off note** | Pair extension↔companion upgrades for RunBusy fields (`open_intents_by_run`) |

### Deterministic merge gate

- Architect ≠ BLOCK  
- **Correctness HIGH confirmed** (upload_error thread isolation) → multi-lane **REQUEST_CHANGES**  
- Architecture HIGH (scoped display vs process-wide stop) does **not** override Trust pass, but is control-plane honesty debt  
- Security has **no HIGH regression** in range (M3'/cruise re-L2 closed)  
- Compat nits (version skew, cross-version under-count) non-blocking for post-ship

### Evidence levels

- Lanes: primarily `[inspected]` patch + live tip  
- Orchestrator re-check:
  - Correctness F1 `file.upload_error` missing `shouldApplyStreamEvent` — **CONFIRMED** `[inspected]` `useWebSocket.ts:1176-1201`; `ADD_MESSAGE` appends active transcript without thread filter `[inspected]` `agentStore.tsx:317-323`
  - Architecture F1 `fleet.stop_all` without `orchestrator_run_id` while companion supports filter — **CONFIRMED** `[inspected]` `FleetStrip.tsx:99-108`, `FleetWorkerList.tsx:70-78`, `message-router.ts:1809-1820`
  - forceConfirm three-flag only — **CONFIRMED** `[inspected]` `server.ts` comments + algebra
  - `process-path` tests: **9 pass / 1 skip** `[executed]`
  - cruise danger carve-out (`full autonomy cruise does NOT auto-approve computer.danger_detected`) **PASS** `[executed]`
  - pure `thread-busy` node suite: **19 pass** `[executed]` (vitest wrapper reports “no suite” — dual-runner format; node --test is authoritative)
  - `computer-executor` full suite: 91 pass / 12 fail on this Windows host — failures cluster on unrelated CU paths (UNCROSS / platform); **not** used to reject #122 claims
  - `plasmo.config.ts` still `0.3.0` while packages `0.4.0` — **CONFIRMED** `[inspected]`

---

## Scope (production themes in range)

| Theme | Commits / notes |
|-------|-----------------|
| #122 M3' + run-scoped RunBusy | `9e2e594` — forceConfirm only under three-flag; cruise re-L2 carve-out; `open_intents_by_run` |
| #123 PATH / osascript | `673aa2f` — `process-path.ts`; absolute `OSASCRIPT_BIN` |
| #124 active-thread fleet scope | `69f0886` — `buildScopedRunBusyInput` on composer/chip/Fleet UI |
| S44 upload stuck busy | `c6b1e8b` — `file.upload_error` clear; reasoning stream; diagnostics |
| 0.4.0 release | `50f9efb` — Qwen VL worker gate; drop TinyClick/ORT ship requirements |
| Docs/memory | S43 lid-close; S44 handoff; review artifacts for run-state |

---

## P0 — must address (HIGH, multi-lane)

### 1. `file.upload_error` ignores thread gate → transcript pollution + false-ready

- **Status**: **OPEN** `[inspected]`  
- **Lanes**: Correctness F1 (primary); Architecture F2 residual dual-write  
- **Evidence**:
  - `useWebSocket.ts:1176-1201` — always clears global `isProcessing` / streaming / status and `ADD_MESSAGE` into **active** store  
  - Contrast: `chat.done` / `chat.error` / `file.upload_status` use `shouldApplyStreamEvent`  
  - `agentStore.tsx:317-323` — `ADD_MESSAGE` does not filter by `thread_id`  
  - Same class: panel SW-fail callback in `App.tsx` (Correctness F1)  
- **Failure mode**: Upload on A → switch to B → A parse fails → B’s composer unlocks + A’s error bubble lands in B  
- **Fix (minimal)**:
  1. Always `SET_THREAD_BUSY` for `uploadErrTid`  
  2. `if (!shouldApplyStreamEvent(uploadErrTid, activeThreadRef.current)) break` before panel chrome clear + `ADD_MESSAGE`  
  3. Mirror on panel SW-fail path: only mutate global processing/messages when active === `uploadThreadId`

### 2. Scoped fleet **display** vs process-wide **stop** (control-plane incomplete)

- **Status**: **OPEN** `[inspected]` (Autonomy honesty; not Trust floor bypass)  
- **Lanes**: Architecture F1 (primary)  
- **Evidence**:
  - UI list scoped via `buildScopedRunBusyInput` / `resolveFleetScope`  
  - `fleet.stop_all` messages omit `orchestrator_run_id`  
  - Companion already filters when `rest.orchestrator_run_id` set (`message-router.ts:1809-1820`)  
- **Impact**: Multi-run residual scenario — user viewing run A and confirming 「停止全部子任务」kills run B workers  
- **Fix**: Pass `orchestrator_run_id` when `scope.kind === "run"`; fix `scope.none` title/affordance contradiction; parent-without-run keep process-wide only with explicit copy

---

## P1 — should fix soon (MEDIUM, multi-lane)

| ID | Lanes | Summary |
|----|-------|---------|
| C-F2 | Correctness | Unstamped WS `error` (size/validation) clears **active** mapBusy, not upload thread |
| C-F3 | Correctness | `file.uploaded` can false-clear active `isProcessing` after thread switch (thinking, no tokens) |
| S-F5 | Security | Pre-existing: `file-parser.ts` outer `filename` not basenamed → zip-slip-class write under companion UID (WS-auth required); not introduced in range but exercised by S44 path |
| A-F2 | Architecture | Busy dual-write structural (optimistic + llm_active); document event matrix |
| A-F3 | Architecture | Shotgun active-thread projection rebuilt in ~5 UI sites |
| A-F4 | Architecture | Three-flag cruise predicate copy-pasted (server cookie / forceConfirm / executor) |
| A-F7 | Architecture | `architecture.md` still lists TinyClick / over-claims god-mode for CU |
| K-C | Compat | Cross-version RunBusy: new ext + old companion under-counts; old ext + new companion sticky fleet — **pair upgrades** |
| K-V | Compat | `plasmo.config.ts` still **0.3.0** vs package.json **0.4.0** |
| K-M | Compat | MV3 SW `JSON.stringify` full upload payload near 10MB → OOM risk (busy still clears on port error) |

---

## Cross-lane agreed positives

1. **M3' domain ≠ content restored** for critical evaluate/osascript under partial skips (god-mode / domain / auto_approve alone still forceConfirm).  
2. **Cruise re-L2 carve-out** holds for `danger_detected` / experimental under three-flag.  
3. **`process-path` + absolute osascript** correctly fix packaged `PATH=file` → `spawn ENOTDIR`; Windows essentials present; Linux not crashed by macOS constants.  
4. **#124 active-thread RunBusy** wiring is consistent across App / ChatView / chip / FleetStrip / FleetWorkerList / FocusBand for **display** signals.  
5. **0.4.0 packaging** scripts/CI/gates align on Qwen worker + on-demand weights; ORT/TinyClick no longer hard ship requirements.  
6. **Upload diagnostics** log meta only (no base64 bodies).

---

## Recommended fix batch (post-ship fast-follow)

| Priority | Item | Effort |
|----------|------|--------|
| P0 | Gate `file.upload_error` + panel SW-fail with `shouldApplyStreamEvent` / active-thread check | S |
| P0 | Thread `orchestrator_run_id` into `fleet.stop_all` when scope is run | S |
| P1 | Stamp `thread_id` on size/invalid WS errors **or** track in-flight upload tids | S–M |
| P1 | Gate `file.uploaded` `isProcessing` clear with active thread | S |
| P1 | Bump `plasmo.config.ts` to 0.4.0 | XS |
| P1 | `path.basename` outer upload filename in file-parser | S |
| P2 | Extract active-thread projection helper; docs lag TinyClick | S |

---

## One-line summary

**Multi-lane: REQUEST_CHANGES** — Trust floors + PATH + same-thread upload look solid; **must** fix upload_error cross-thread isolation and fleet stop scope honesty before calling S44/S45 busy UX complete.
