# Dual rereview (Claude lane) — web act-loop DIRECTION fold

**Date**: 2026-08-21
**Reviewer**: independent rereviewer (Claude). Did not write the diagnosis, the fold, or any adversary lane.
**Subject**: `web-act-loop-direction-20260821.md` (the fold). Pre-fold diagnosis + three adversaries read in order.
**Evidence tags**: `[inspected]` source read; `[executed]` thread JSON / counts re-run this review.

```text
Surface:      L1 browser CDP (locator + error contract); host_computer stays L2 last resort
L2-classes:   none new (evaluate / osascript_eval / shell_exec already L2)
Compose:      none
Autonomy:     single
Trust:        monotonic — text locators must NOT skip L2 evaluate/osascript; click stays L1
Channel:      community
```

## Method

Read fold → diagnosis → 3 adversaries → ADR-020 checklist. Spot-checked every load-bearing live-code citation and re-executed the thread counts rather than trusting the adversaries' `[executed]` tags.

## Live-code spot checks (all confirm the fold) `[inspected]`

| Fold claim | Verified |
|---|---|
| Catalog `click` requires `selector`, no `text` | `tool-definitions-catalog.json:191-209` — `required: [tabId, selector]` ✓ |
| click error is a bare string; attach failure relabeled | `browser-bridge.ts:797-808` — catch swallows `err`, falls to `querySelector` false → `Element not found for selector:` ✓ |
| `type` liar success | `browser-bridge.ts:818` awaits `this.click(...)` and **discards the result**; `:836` unconditional `success:true`; fallback `el.value` INPUT/TEXTAREA only (`:833`) ✓ |
| `fill_form` liar success | `browser-bridge.ts:845` click result discarded; `:867` unconditional `success:true` ✓ |
| `hover` liar success | `browser-bridge.ts:1161-1162` scripting fallback return **not even captured**; `:1165` unconditional `success:true` ✓ |
| `element not found` / `not found` / `cannot access` / `chrome-extension://` recoverable | `security.ts:957-968` ✓ |
| Finder exists, fail-closed, download-wired only | `find-element-by-text.ts` — "future click({text})" header, `JSON.stringify` needle (`:33`), `classifyTextMatchCount` fail-closed (`:93-97`), `data-cmspark-dl-hit` (`:13,84-86`); only consumer is `browser-download-handler.ts` (`browser-bridge.ts:19` is a re-export, not a wiring) ✓ |
| Existing cap keys per tool name and resets on success/tool hop | `adapter.ts:152, 1359-1374` — `recoverableFailureCounts` keyed by `toolName` ✓ |

## Thread re-execution `[executed]`

| Metric | Fold/adversary claim | My count |
|---|---|---|
| Histogram | 81 osascript / 54 shell / 26 evaluate / 3 click / 1 host_computer | **exact match** |
| osascript failures | "0 `success:false` on those 81" | **1 of 81** — `"Tab matching URL not found in Chrome"` at 02:54:55Z, recovered on the next call |
| click / get_element_info | 3/3 and 4/4 failed | ✓ exact |
| evaluate success-with-null | 11 × `{success:true, result:null}` | **20 of 26** — pattern is *stronger* than claimed |
| host_computer | 1, user-ordered, failed | ✓ |

The off-by-one does not change the falsification: 80/81 osascript successes means `MAX_SAME_TOOL_RECOVERABLE_FAILURES=3` could never fire (and success deletes the counter anyway). The 81-call histogram **is** a working-path loop. Fold's W3′ motivation stands.

## Task's reject conditions — both clear

1. **Wave-1 is not the old W3 scheme ban.** Fold W3′: "Osascript on http(s) remains allowed as attach-gated last-resort — budgeted, not banned", plus the falsified-table row that kills the ban (it would have ended the only working 知乎 write; catalog documents X.com CSP last-resort). ✓
2. **W1 is not claimed to have saved Zhihu Draft.js.** Falsified-table row: `click({text})` would *not* have saved a7ubt9 — `textarea.Input` was a real node, click relabeled the attach failure, finder uses the same world, "Draft.js still needs W4". W1 is framed as a product hole (don't leave fill_form/hover as the next 知乎 thread), not an incident rescue. ✓

## Direction assessment

- **W1** — shared `resolveLocator` + fail-closed `ELEMENT_*` + stop liar success on type/hover/fill_form: verified against real code holes; the liar-success fix matters as much as the text param (liar successes never increment the loop counter — `browser-bridge.ts` evidence above). Unique `data-cmspark-hit` prefix (not `dl-hit`) avoids racing a concurrent download. Correct.
- **W3′** — typed `WRONG_ORIGIN`/`CDP_ATTACH_FAILED` + `suggested_action: list_tabs`, evaluate-null honesty, budget on identical successful DOM-script loops, osascript budgeted-not-banned: correctly absorbs all three adversaries' MUST-FIX items *except* the two keying requirements below. The scheme ban was the one genuinely dangerous clause in the diagnosis and it is gone.
- **W2 wave-2** — right: snapshot rides the same CDP attach that failed in a7ubt9; pulling it forward would have shipped an expensive empty tree.
- **NOT host_computer as web default** — right (Trust: L2 pixels on a surface that has CDP; the thread's one CU call also failed).
- **Trust section** — covers the evaluate-without-L2 leak: text click is L1 iff it reuses `buildFindByTextExpression` + `JSON.stringify`, no free `evaluate`, click stays off `L2_GATE_TOOLS`. Verified the finder's injection-safe needle (`find-element-by-text.ts:33`). ✓

ADR-020 checklist: axes fit (Surface L1 + policy machine gates), no new runtime, no new confirm dialect, Trust monotonic, no originWs change, no experimental write-path dependence. All pass.

## Nits (non-blocking, for the implementer brief)

1. **`shell_exec osascript -e` bypass dropped from the fold.** The surface adversary documented it as a required residual (its §4 constraint 8); the fold omits it. Under budget-not-ban it is no longer a *gate bypass*, but the budget as specced fingerprints "osascript/evaluate" only — a model can run the same AppleScript via `shell_exec osascript -e` and evade the fingerprint, which is exactly the tool-hop pattern a7ubt9 showed (54 shell_exec). Cheap fix: include `shell_exec` commands containing `osascript` in the same DOM-script fingerprint namespace, or carry the documented residual forward explicitly.
2. **Budget keying/durability unstated.** Policy adversary MUST-FIX #4/#5: the budget must (a) bite under three-flag cruise (a7ubt9 ran under cruise — a confirm-gate-shaped fix would never fire), (b) survive user "继续" (per-`chatCreate` reset defeats it; a7ubt9 had 10 user turns), (c) not reset on success on another tab. The fold's "fingerprint of same expression/tab" implies per-tab keying but not (a)/(b). The fold is the locked direction — these should be stated so the implementer doesn't inherit only the counter that already failed.
3. **Off-by-one in the falsifier table.** "0 `success:false` on those 81" → actually 1/81 (tab-URL resolution miss, immediately recovered). Conclusion unchanged (80/81 success is stronger evidence); fix the number for the record.
4. **Evaluate-null honesty lacks a typed shape.** "Must not look like success-with-empty" is direction-clear; implementer needs to know it means a typed signal distinguishing "statement had no completion value" from "CSP/attach failure". My count says 20/26 evaluate calls returned null-with-success — this bullet is more load-bearing than any lane reported.
5. Wording only: "finder wired only to browser_download" — `browser-bridge.ts:19` re-exports the builder for callers/tests without consuming it in click; claim effectively holds.

None of these flip the direction. Fold approved: wave-1 = W1 + W3′ + liar-success fix, wave-2 = W2, no CU-as-web-default.

VERDICT: APPROVE_WITH_NITS
