# Adversary review — WAVE-1 W3′ machine gates (success-loop budget + evaluate honesty + classifyError)

**Date**: 2026-08-21
**Role**: Independent adversary (not the implementer). Did **not** rubber-stamp.
**SoT**: `docs/superpowers/specs/2026-08-21-web-act-loop-design.md` §5.2 §5.3 §7 §9 DoD 13–16, 20
**Trace / trajectory**: `a7ubt9` (81 unique-hash `osascript_eval` successes; max identical-hash repeat 2; evaluate `{result:null, success:true}` as hop fuel)
**Evidence**: `[executed]` companion targeted tests 50/50; `[inspected]` sources below; `[assumed]` Chrome CDP wire shapes not re-driven live.

```text
Surface:      L1 CDP; evaluate / osascript_eval / shell_exec still L2
L2-classes:   none added
Compose:      none
Autonomy:     single
Trust:        cap is companion-side hard-refuse of success path; click not L2
Channel:      community
```

---

## Outcome

WAVE-1 **does** implement the two counters that would have stopped a7ubt9, peeks **before** `executeTool`, stores state in a **module `Map` keyed by `threadId`** (not a `chatCreate` local), refuses with `suggested_action: stop_or_change_task`, and lands all 11 SoT codes as underscore substrings in `classifyError`. Identical-hash cap fires on the **4th** call (DoD 13), not the 3rd. Volume fires on the **25th** unique success (DoD 14).

It does **not** machine-verify DoD 16 (evaluate dead-world vs `empty_completion` has **zero** chrome-extension tests). Shell/osascript origin attribution is contaminated by adapter `pinned_tabs[0]` injection, so “shell 无 url → `origin:unknown`” is not always true.

None of the nits restore the 81-success storm or re-label attach failure as `empty_completion` on the inspected paths. Not a REJECT.

---

## Trajectory (a7ubt9 counterfactual)

| a7ubt9 fact | WAVE-1 gate | Counterfactual |
|-------------|-------------|----------------|
| 81 **successful** `osascript_eval`, unique hashes, max repeat 2 | Volume B: 24 successes / origin then hard-refuse | Stops at call 25 (`DOM_SCRIPT_VOLUME_CAPPED`). Loop A never fires (repeat < 3). `[inspected]` §5.3 + `peekDomScriptCap` |
| `evaluate` `success:true` + `result:null` taught the hop to osascript | §5.2 probe `1+1===2`; non-true → `EVAL_DEAD_WORLD`; attach throw → `failInteractive` | Dead world is no longer empty-success **if** CDP returns undefined / throws. Genuine JS `null` is still a completion (SoT known residual). `[inspected]` `browser-bridge.ts` evaluate |
| `classifyError` default `non_recoverable` → `chat.error` | 11 underscore codes in recoverable list | Cap / dead-world / not-found feed the LLM instead of killing the turn. `[executed]` wave1 + security-thread tests |
| `MAX_SAME_TOOL_RECOVERABLE_FAILURES` | still **3** (`adapter.ts:160`) | After cap, 3 recoverable false then stop. Not raised. |

Cruise / 「继续」 (`skipUserMessage`, same `threadId`, new `chatCreate` stack frame): success counters live in `budgets` module Map → still count. Failure counters (`recoverableFailureCounts` at `adapter.ts:842`) **are** chatCreate-local and reset — that is the old guard, not the W3′ success gate.

---

## Component

### 1. `companion/src/tool/dom-script-budget.ts` — counters + heuristic

Module state:

```108:121:companion/src/tool/dom-script-budget.ts
const budgets = new Map<string, DomScriptBudgetState>()
// ...
function stateFor(threadId: string): DomScriptBudgetState {
  let s = budgets.get(threadId)
  if (!s) {
    s = { keys: {}, origins: {} }
    budgets.set(threadId, s)
  }
  return s
}
```

Peek is `>= MAX` **without** increment; record happens only after a real success. That is refuse-the-4th / refuse-the-25th:

```127:153:companion/src/tool/dom-script-budget.ts
/**
 * Record a completed success. The success itself is never refused here —
 * DoD 13/14: after 3 / 24 successes, the *next* call is peek-capped.
 */
export function recordDomScriptSuccess(...)
export function peekDomScriptCap(...): DomScriptCap {
  if ((s.keys[key] || 0) >= DOM_SCRIPT_LOOP_MAX) { // 3
    return { capped: true, error_code: "DOM_SCRIPT_LOOP_CAPPED" }
  }
  if ((s.origins[origin || "origin:unknown"] || 0) >= DOM_SCRIPT_VOLUME_MAX) { // 24
    return { capped: true, error_code: "DOM_SCRIPT_VOLUME_CAPPED" }
  }
  return { capped: false }
}
```

`cappedDomScriptResult` (`:87–95`) hard-codes `suggested_action: "stop_or_change_task"`. JSON cannot contain `host_computer` / `evaluate` as a next hop.

Family heuristic (`INJECT_PAYLOAD` + `LAUNCH_ALLOW`, `:15–37`): payload tokens, not interpreter brand. `Start-Process chrome` / `Get-Process chrome` / `tasklist` miss unless an inject token is also present. `document.querySelector`, `execute javascript`, `osascript`, `Runtime.evaluate` (lowercased) hit.

`[executed]` `tests/dom-script-budget.test.ts`: 3 records → 4th peek `LOOP_CAPPED`; 24 unique → 25th `VOLUME_CAPPED`; Start-Process not inject; `origin:unknown` when meta has no url.

**Nits (this file)**

- `family` is implicit (this Map only stores `dom_script`). Fine.
- Volume counts **successes**, not unique hashes. Matches §5.3 B “24 次成功”; DoD 14 fixture (24 unique) still holds.
- No `thread.delete` eviction (`resetDomScriptBudgetsForTests` is test-only). Leak is two small Records per thread; IDs are not recycled. Nit.
- File-backed `cscript inject.js` with no payload string is **not** family — SoT known residual; test explicitly asserts false.

### 2. `companion/src/llm/adapter.ts` — peek **before** execute; Rule 7/8/12

```1153:1166:companion/src/llm/adapter.ts
if (isDomScriptTool(toolName, execParams)) {
  const meta = resolveDomScriptBudgetMeta(
    toolName,
    execParams,
    typeof resolvedTabId === "number" ? getCachedTabUrl(resolvedTabId) : undefined,
  )
  const cap = peekDomScriptCap(threadId, meta.key, meta.origin)
  if (cap.capped) {
    toolResult = cappedDomScriptResult(cap.error_code)
  } else {
    toolResult = await executeTool(tc.id, toolName, execParams, signal)
    if (toolResult.success) {
      recordDomScriptSuccess(threadId, meta.key, meta.origin)
    }
  }
}
```

- Peek is on the success path **before** `executeTool` (no L2 confirm spam, no CDP). Hard refuse.
- Record only if `toolResult.success` — `EVAL_DEAD_WORLD` / attach fail do not burn the success budget.
- Tool loop is sequential `for (const tc of …)` (`:1051`) — no parallel peek/record race.
- `MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3` (`:160`) unchanged. `recoverableFailureCounts` is chatCreate-local (`:842`) — **not** the success budget.
- Rule 7 (`:471`): `CDP_ATTACH_FAILED` → `list_tabs` / user focus; **do NOT retry via evaluate or host_computer**.
- Rule 8 (`:472–476`): darwin last-resort osascript counted in budget; win32/linux **no third JS path**, host_computer not a DOM fallback.
- Rule 12 both platforms (`:438`, `:446`): `NEVER use host_read/host_write/host_computer for browser-DOM`.

`[executed]` wave1 source-lock test matches those NEVER strings.

**Finding — pinned tab displaces spec origin/tab keys (Attack 10)**

`TAB_LEASE_TOOLS` includes `evaluate` but **not** `shell_exec` / `osascript_eval` (`orchestrator/constants.ts:64–85`). Adapter therefore injects `pinned_tabs[0]` into `execParams.tabId` for those tools (`adapter.ts:1132–1148`). Then:

| Spec §5.3 | Implementation |
|-----------|----------------|
| osascript 无 tabId → key A = `(hash, url:…)` | `tabKeyForDomScript` prefers injected `tabId` → `tab:<pin>` (`dom-script-budget.ts:97–101`) |
| shell 无 url/tab → `origin:unknown` fail-closed shared bucket | origin = `getCachedTabUrl(pin)` when a pin exists |

Bare `resolveDomScriptBudgetMeta("shell_exec", { command })` **does** return `origin:unknown` (`[executed]` unit test). The **wired** adapter path often does not.

Blast: volume still caps, but on the **pin origin** (or splits pin origin vs inject target). a7ubt9 osascripts carried URLs, so volume B still keys the page origin. This does not restore 81. It **does** violate the literal fail-closed unknown bucket for pin-ful threads.

No adapter test asserts peek short-circuits `executeTool`. Wiring is `[inspected]` only.

**Residual**: WS `message-router.ts:3350–3389` `osascript_eval` route calls `session.executeTool` and **skips** the budget peek. Not the LLM storm path.

### 3. `chrome-extension/src/background/browser-bridge.ts` — evaluate honesty (§5.2, DoD 16)

```1599:1651:chrome-extension/src/background/browser-bridge.ts
if (result?.exceptionDetails) {
  return codedToolError("EVAL_THROWN", ...)
}
const looksEmpty = type === "undefined" || (value === undefined && type !== "object")
if (!looksEmpty) { return { success: true, data: { result: value, type, ... } } }
// probe 1+1===2 via CDP then scriptingExecute
if (probeOk) { return { success: true, data: { ..., evaluate_kind: "empty_completion" } } }
return codedToolError("EVAL_DEAD_WORLD", "...probe 1+1===2 failed...", { suggested_action: "list_tabs" })
```

Attach: both CDP and scripting throw → `failInteractive` (`:1592–1596`, probe `:1632–1634`) → `classifyAttachFailure(tabs.get url)` (`locator-classify.ts:32–41`) → `CDP_ATTACH_FAILED` / `WRONG_ORIGIN`. **Not** `empty_completion`. Probe `=== true` only; `null` / `undefined` / throw on probe ≠ empty.

SoT algorithm: non-undefined and `type !== "undefined"` → completion (JS `null` included); else probe. Implementation adds `type !== "object"` on the undefined-value arm, so `{type:"object", value: undefined}` (unserializable / missing `returnByValue`) is treated as **completion** and **never probes**. Spec would probe. `[assumed]` CDP shape; not a7ubt9 fuel (that was `null`/undefined without a live `1+1===2`).

**Gap**: no chrome-extension test drives evaluate / probe / attach-fail-not-empty. DoD 16 is inspection-only. That is the same class of hole that shipped `success:true`+null as hop fuel.

### 4. `companion/src/security.ts` `classifyError` — §7 / §9 / DoD 20

```1039:1050:companion/src/security.ts
"selector_or_text_required",
"element_not_found",
"element_ambiguous",
"invalid_selector",
"wrong_origin",
"cdp_attach_failed",
"eval_dead_world",
"eval_thrown",
"dom_script_loop_capped",
"dom_script_volume_capped",
"type_unsupported_editor",
```

`msg = errorMessage.toLowerCase()` (`:919`) so `ELEMENT_NOT_FOUND:` matches `element_not_found`. Legacy spaced `"element not found"` remains. All 11 SoT codes are underscore-friendly.

`[executed]` `web-act-loop-wave1.test.ts` all 11 `CODE:` strings → `recoverable`; `security-thread.test.ts` CDP/volume/dead-world.

---

## Attack checklist

| # | Attack | Result | Evidence |
|---|--------|--------|----------|
| 1 | Identical-hash cap on **3rd** success (wrong) vs refuse **4th** (DoD 13) | **Refuse 4th** | peek `>= 3` after record; test records 3 then peeks. `dom-script-budget.ts:146`, test `:41–53` `[executed]` |
| 2 | 24 unique hashes then 25th `VOLUME_CAPPED` (DoD 14) | **Holds** | test `:55–65` `[executed]` |
| 3 | chatCreate-local Map (WRONG) vs module Map keyed by threadId | **Module Map** | `budgets = new Map` `:108`. `recoverableFailureCounts` at `:842` is the *failure* guard, not this gate. 「继续」 = same `threadId` `[inspected]` |
| 4 | Peek **before** execute (hard refuse success path) | **Holds** | `adapter.ts:1159–1166` `[inspected]`. No integration test. |
| 5 | Cap `suggested_action` must be `stop_or_change_task`, never `host_computer`/`evaluate` | **Holds** | `cappedDomScriptResult` `:87–95`; test `:92–98` `[executed]` |
| 6 | `powershell Start-Process chrome` NOT family; `document.querySelector` / `execute javascript` IS (DoD 15, parameterized win32) | **Holds** (test hole on `execute javascript` string) | heuristic `:15–37`; wave1 `:66–68` `[executed]`. Token `execute javascript` is in `INJECT_PAYLOAD`; **no test string contains it**. |
| 7 | Dead-world vs `empty_completion`: probe `1+1===2`; attach fail not empty | **Holds by inspection** | `browser-bridge.ts:1607–1651` `[inspected]`. **No unit test.** |
| 8 | All 11 codes as underscore-friendly substrings (`element_not_found` not just `"element not found"`) | **Holds** | `security.ts:1040–1050`; wave1 `:47–64` `[executed]` |
| 9 | `MAX_SAME_TOOL_RECOVERABLE_FAILURES` still 3 | **Holds** | `adapter.ts:160` `[inspected]` |
| 10 | shell with no url buckets `origin:unknown` | **Partial** | Helper yes (`:88–89` test). Wired adapter injects pin tabId → cached origin. Spec literal miss. |

---

## DoD checklist (13–16, 20)

| DoD | Status | Notes |
|-----|--------|-------|
| 13 同 hash+tab 成功 3 次后第 **4** 次 `LOOP_CAPPED` | **PASS** | Not the 3rd. |
| 14 同 origin 不同 hash 成功 24 次后 `VOLUME_CAPPED` | **PASS** | 25th peek. Other origins untouched. |
| 15 `Start-Process chrome` 不计入; `querySelector` / `execute javascript` 的 cmd/cscript 计入 | **PASS** (nit: `execute javascript` untested) | OS-agnostic payload heuristic = parameterized win32, no VM. |
| 16 evaluate 死世界探针失败 → 非 `empty_completion` | **PASS `[inspected]` / FAIL as machine-DoD** | Logic present; **zero** chrome-extension tests. Attach fail → `failInteractive`, not empty. |
| 20 新 error_code 均在 `classifyError` recoverable | **PASS** | All 11 underscore forms. |

---

## Nits (should-fix, not reopen-storm)

1. **DoD 16 untested.** Extract probe/empty vs dead-world vs attach into a pure helper (or a BrowserBridge fixture) and assert: probe false → `EVAL_DEAD_WORLD`; both CDP+scripting throw → not `evaluate_kind: empty_completion`.
2. **Adapter integration test**: mock `executeTool`, record 3 evaluate successes, 4th must not call executeTool and must return `DOM_SCRIPT_LOOP_CAPPED`.
3. **Attack 10**: do not feed injected `pinned_tabs[0]` into `tabKeyForDomScript` / origin for `shell_exec`. For `osascript_eval` without caller `tabId`, key A must stay `url:…` per §5.3. Resolve origin from `params.url` first; else `origin:unknown`.
4. DoD 15 fixture: add `execute javascript` (and `Runtime.evaluate`) command strings to `web-act-loop-wave1.test.ts`.
5. `looksEmpty` vs SoT: `{type:"object", value:undefined}` should probe, not succeed. Align with `value !== undefined && type !== "undefined"`.
6. Clear `budgets.delete(threadId)` on hard thread delete (symmetry with session-trust / host approvals).
7. Optional: peek in `executeCompanionTool` so the WS `osascript_eval` route cannot outrun the LLM-loop gate.

---

## What was *not* found

- Off-by-one that caps the 3rd success.
- chatCreate-local success Map.
- Peek-after-execute (would let the 4th/25th succeed).
- `suggested_action` hopping to `host_computer` / `evaluate` on caps.
- `Start-Process chrome` false-positive family membership.
- `ELEMENT_NOT_FOUND` (underscore) missing from `classifyError`.
- Raised same-tool recoverable ceiling.

---

VERDICT: APPROVE_WITH_NITS
