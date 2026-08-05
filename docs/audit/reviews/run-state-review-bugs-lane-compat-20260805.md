# COMPAT/PLATFORM Lane Review

**Repo:** `/Users/huchen/Projects/cmspark`  
**Branch / range:** `fix/run-state-review-bugs` uncommitted vs main  
**Diff:** `docs/audit/reviews/run-state-review-bugs-diff-20260805-090257.patch`  
**Lane:** COMPAT / PLATFORM (adversarial)  
**Date:** 2026-08-05  
**Evidence mode:** `[inspected]` patch + live sources (not re-executed in this lane)

## Scope inspected

| Area | Path(s) |
|------|---------|
| Fleet wire + SoT §2.1 | `companion/src/orchestrator/fleet.ts`, `chrome-extension/src/sidepanel/types.ts`, `useWebSocket.ts` |
| RunBusy resolution | `thread-busy.ts` (`resolveOpenIntentsForRun`), `App.tsx`, `ChatView.tsx`, `RunBusyChip.tsx` |
| Security forceConfirm / cruise | `companion/src/server.ts` (~1439–1480) |
| osascript platform gate | `bridge/tool-definitions.ts`, `server.ts` early reject + case body, `security-gates.test.ts` |
| Computer re-L2 / cruise carve-out | `computer/executor.ts`, `session-trust.ts` |
| Tests | `thread-busy.test.ts`, `orchestrator-tab-lease.test.ts`, `security-gates.test.ts`, `computer-executor.test.ts` |

**Themes in diff:**

1. Optional fleet field `open_intents_by_run` + extension RunBusy scoping (no process-wide sticky intents when `runId` known).
2. CRITICAL_API_GATE: waive forceConfirm **only** under three-flag full autonomy cruise (not god-mode alone / domain whitelist / auto_approve_dangerous alone).
3. Computer re-L2: force-interactive tags (`danger_detected` / `experimental_suggestion`) not skipped by cruise.
4. M3' / osascript_eval tests realigned to god-mode-alone forceConfirm + non-darwin early reject.

---

## Status / Recommendation

| Field | Value |
|-------|--------|
| **Status** | **WATCH** |
| **Recommendation** | **APPROVE_WITH_NITS** |

No wire-breaking protocol change, no non-darwin false L2, no platform-only crash path. Residual risk is **version skew** (new extension + old companion under-counts intents) and **intentional product UX shock** for single-flag “unattended” users — both documentable, neither a ship BLOCK for this lane.

**VERDICT: APPROVE_WITH_NITS**

---

## Findings

### C1 — Old companion + new extension: safe wire, intentional under-count of intents when `runId` set
- **Severity:** MEDIUM (version skew only)
- **Status:** WATCH
- **Where:**
  - `useWebSocket.ts` fleet parse: `open_intents_by_run` → `undefined` if absent / non-object / array
  - `resolveOpenIntentsForRun`: `if (!runId) return openIntentCount ?? 0` else `openIntentsByRun?.[runId] ?? 0`
- **Detail:**
  - Old companion emits `fleet.status` **without** `open_intents_by_run`. New extension stores `undefined`.
  - **No crash**, no schema hard-fail: field is optional on the extension type.
  - When active thread has **no** `orchestrator_run_id`: falls back to process-wide `open_intent_count` — behavior matches pre-fix (sticky possible).
  - When active thread **has** `runId`: resolver **does not** fall back to global count → always `0` if map missing. Intent-only RunBusy / composer busy from board intents is **lost** until companion is upgraded.
  - Other run-scoped signals (locks, `llm_active_thread_ids`, holding_tabs, worker busy map) still work from pre-existing fields.
- **Impact:** Temporary **false-negative** intent RunBusy during mixed deploy (new Side Panel, old Companion). Prefer ship extension + companion together; acceptable fail-open for “not sticky busy.”
- **Nit / fix:** Release note: “RunBusy intent chip needs companion that sends `open_intents_by_run`.” Optional: when `runId` set and map `undefined` (not empty object), fall back to global with a one-shot debug log — **not** recommended if SoT prioritizes killing sticky false positives over skew honesty.

### C2 — New companion + old extension: additive-only, sticky bug remains
- **Severity:** — (positive / expected)
- **Status:** CLEAR
- **Where:** `fleet.ts` always includes `open_intents_by_run: Record<string, number>` (often `{}`)
- **Detail:** Extra JSON field is ignored by old clients. Old UI continues using `open_intent_count` only → cross-run sticky intent RunBusy **persists** until extension updates. No deserialize failure, no type clash on wire.
- **Evidence:** `[inspected]` companion required field + extension optional + defensive `Object.fromEntries` filter.

### C3 — Wire sanitization of `open_intents_by_run` is defensive
- **Severity:** — (positive)
- **Status:** CLEAR
- **Where:** `useWebSocket.ts` ~589–598
- **Detail:** Requires plain object (not array); keeps only string keys with **number** values. Malformed companion payloads (strings, nested objects) drop to `undefined` rather than poisoning `deriveRunBusy`. Empty `{}` vs missing: both yield `0` for run-scoped resolution.

### C4 — Multi-run board hosts **without** `orchestrator_run_id`
- **Severity:** LOW–MEDIUM
- **Status:** WATCH
- **Where:** `fleet.ts` 112–129; consumers via `resolveOpenIntentsForRun`
- **Detail:**
  - Hosts with board intents contribute to **`open_intent_count` always**.
  - They contribute to **`open_intents_by_run` only if** `orchestrator_run_id` is a non-empty string **and** `n > 0`.
  - Hosts with open/claimed intents but **no** run id are **invisible** to any run-scoped view (`runId` set → map miss → 0).
  - User on a **non-run** thread (`runId` null/undefined): still sees full process-wide count (includes orphan hosts) — same class of sticky as before for that surface.
- **When this matters:** Board-only / pack-applied orchestrator hosts before first `spawn_worker` (spawn stamps parent `orchestrator_run_id` — see `spawn.ts`). Multi-board without multi-agent run remains process-wide when viewing those hosts.
- **Impact:** Correct isolation for true multi-run; residual: board work without a run id never lights run-scoped chips on *other* runs (good) and only lights process-wide when viewer also has no run id.
- **Tests:** Unit covers dual-run with ids (`orchestrator-tab-lease.test.ts`); **no** explicit case for host-with-intents-no-run-id vs viewer-with-run-id.
- **Nit:** Add fleet unit: host no `orchestrator_run_id` + open intents → `open_intent_count` includes them, map has no synthetic key; assert run-scoped resolve from extension helper is 0 for a foreign `runId` and global for `null`.

### C5 — Product: god-mode / auto_approve / domain whitelist alone → more critical confirms (intentional)
- **Severity:** MEDIUM (product UX shock, not security regression)
- **Status:** WATCH (document residual)
- **Where:** `server.ts` forceConfirm algebra:
  - **Before (product 2026-08 waiver):**  
    `forceConfirm = criticalApis.length > 0 && !(browserScriptTool && skipConfirmation) && !userFullAutonomy`  
    → evaluate / osascript critical under god-mode, global auto-approve, or domain skip could waive.
  - **After:**  
    `forceConfirm = criticalApis.length > 0 && !userFullAutonomy`  
    → only three-flag cruise (`auto_approve_dangerous` ∧ `auto_approve_enterprise_tools` ∧ `allow_all_schemes`) waives.
- **Who feels the shock:**
  | User config | Critical `evaluate` / `osascript_eval` (fetch/eval/Worker/…) |
  |-------------|--------------------------------------------------------------|
  | Default | Confirm (unchanged) |
  | Domain whitelist alone | Confirm again (was auto under waiver) |
  | `auto_approve_dangerous` alone | Confirm again |
  | `allow_all_schemes` (god-mode / 协议解锁) alone | Confirm again |
  | All three cruise flags | Still skip L2 + audited `full_autonomy_cruise` |
  | Non-critical dangerous (e.g. innerHTML) under god-mode | Still auto (tests preserved) |
- **Alignment:** Restores M3' / ADR-010 spirit (“domain trust ≠ page-content trust”; god-mode is scheme unlock, not content free-pass). Matches pre-2026-08 design in `docs/security-design-tiered-gates-2026-07-11.md` §6.2 more than the short-lived waiver.
- **Residual UX shock (must document in ship note):**
  1. Operators who armed **only** 协议解锁 / global auto-approve for unattended browser scripts will see **new L2 dialogs** mid-run (fetch/eval/setTimeout-string/Worker/bracket-eval, etc.).
  2. Domain-whitelisted “trusted site” + agent `evaluate` with critical APIs no longer silent — user may think whitelist “broke.”
  3. True unattended path is now **explicit three-flag cruise** (higher arm cost / Trust packaging) — correct product, surprising if undocumented.
  4. Confirm Center load and 45s timeouts rise for single-flag users; denial fails closed (tests flip to `approved: false` → `success: false`).
- **Mitigation for users:** Settings → arm all three autonomy flags for cruise, or keep interactive confirm (safer default).
- **Docs gap:** Diff updates tests/comments in code but **no** user-facing CHANGELOG / Settings copy in this patch. **Nit (product):** one-line release note + optional Settings helper under 协议解锁 / 运行自主度 explaining critical JS still needs confirm unless full cruise.

### C6 — Platform: `osascript_eval` non-darwin early reject still no false L2
- **Severity:** — (positive)
- **Status:** CLEAR
- **Where:**
  - `shouldL2GateOsascript` / `OSASCRIPT_MACOS_ONLY_ERROR` — `tool-definitions.ts`
  - `server.ts` ~1003–1009: reject **before** L2_GATE_TOOLS confirm path
  - Defense-in-depth again in `case "osascript_eval"` (~3768)
  - Tests: god-mode critical osascript branches on `shouldL2GateOsascript`; separate platform test asserts `sawConfirm === false` off-darwin
- **Detail:** ForceConfirm tightening only affects paths that **enter** L2. Non-darwin never enters → no confirm spam, recoverable typed error. Windows/Linux CI remains stable.
- **Darwin:** god-mode alone + critical expression now **does** request L2 (parity with evaluate) — platform-correct, intentional.

### C7 — Computer re-L2 under full autonomy cruise (platform-neutral CU gate)
- **Severity:** — / LOW product
- **Status:** CLEAR (with intentional confirm increase for danger tags)
- **Where:** `executor.ts` `reL2`: `forceInteractive` checked **before** cruise short-circuit
- **Detail:** Cruise still silences routine re-asks (budget / uncross / dialog) when `!forceInteractive && !reL2ShouldPrompt`. `computer.danger_detected` / `computer.experimental_suggestion` always surface — including under three-flag cruise. New test locks this. CU remains win32/darwin gated at L2 entry; no linux false dialog introduced.

### C8 — Extension/MV3 / protocol versioning
- **Severity:** —
- **Status:** CLEAR
- **Detail:** No new permissions, no CSP/eval changes, no lockfile/native deps. Fleet is existing WS type fan-out. Optional field + client filter is textbook additive evolution. No Windows-specific path or shell change in this diff.

### C9 — Test matrix coverage (compat-relevant)
- **Severity:** LOW
- **Status:** WATCH (coverage nits)
- **Covered:**
  - `resolveOpenIntentsForRun` no-runId vs runId no-fallback
  - Fleet map aggregation by run id
  - God-mode alone / auto_approve alone / domain whitelist + critical → forceConfirm
  - Full cruise evaluate critical → waive + audit reason
  - osascript non-darwin early reject; darwin forceConfirm under god-mode alone
  - Computer cruise does not auto-approve `danger_detected`
- **Missing / soft:**
  - Integration skew: extension unit only; no e2e “companion without field”
  - Host without `orchestrator_run_id` + open intents (C4)
  - osascript under **full cruise** on darwin (parity with evaluate cruise test) — optional

---

## Compatibility matrix (summary)

| Client \ Server | Old companion | New companion |
|-----------------|---------------|---------------|
| **Old extension** | Sticky process-wide intent RunBusy (legacy) | Sticky intent RunBusy; extra map ignored — **CLEAR** |
| **New extension** | No crash; **intent RunBusy under-count when `runId` set** (C1) | Run-scoped intents — **intended fix** |

| Platform | osascript critical under god-mode alone | False L2 off-darwin |
|----------|------------------------------------------|---------------------|
| darwin | L2 forceConfirm (restored) | n/a |
| win32 / linux | Early reject, no L2 | **None** (C6) |

| Security flags | Critical browser script L2 |
|----------------|----------------------------|
| none / whitelist / god alone / auto_approve alone | **Confirm** (restored) |
| three-flag cruise | Skip + `full_autonomy_cruise` audit |

---

## Summary table

| ID | Topic | Severity | Status |
|----|--------|----------|--------|
| C1 | New ext + old companion intent under-count | MEDIUM | WATCH |
| C2 | New companion + old ext additive | — | CLEAR |
| C3 | Wire sanitization | — | CLEAR |
| C4 | Board host without `orchestrator_run_id` | LOW–MED | WATCH |
| C5 | God-mode-alone UX shock (intentional) | MEDIUM product | WATCH |
| C6 | osascript non-darwin no false L2 | — | CLEAR |
| C7 | CU re-L2 force-interactive under cruise | — / LOW | CLEAR |
| C8 | MV3 / deps / Windows shell | — | CLEAR |
| C9 | Test gaps (skew, no-run-id host) | LOW | WATCH |

**Lane status:** **WATCH** (no BLOCK; no CRITICAL platform/wire break)

---

## Solid

1. **Additive fleet field** with optional extension typing + strict wire filter — dual-version safe.
2. **SoT §2.1 resolver** deliberately avoids global fallback when `runId` known — kills sticky false RunBusy (primary bug).
3. **M3' restore** is coherent: single-flag auto-approve ≠ content trust; cruise remains the only critical waive path.
4. **osascript platform gate order** (before L2) preserved — no Windows/Linux confirm false positives.
5. **Tests moved with product** rather than leaving stale “god-mode auto-approves fetch” expectations.

---

## Final recommendation

### **APPROVE_WITH_NITS**

Ship companion and extension in the same release train when possible. Before or with merge, add a short product note that:

1. Critical `evaluate` / `osascript_eval` under **god-mode alone** or **domain whitelist alone** will confirm again (use full autonomy cruise for unattended critical JS).
2. RunBusy intent scoping needs the new companion field; mixed versions may hide intent-only busy until both sides update.

Optional nits (non-blocking): fleet unit for hosts without `orchestrator_run_id`; darwin osascript + three-flag cruise integration parity test.

---

**VERDICT: APPROVE_WITH_NITS**
