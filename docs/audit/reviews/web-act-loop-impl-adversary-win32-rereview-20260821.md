# Adversary **re-review** (win32 / cross-OS) — WAVE-1 fold only

**Reviewer**: independent ADVERSARY. Did **not** implement the fold.  
**Parent REJECT**: [`web-act-loop-impl-adversary-win32-20260821.md`](./web-act-loop-impl-adversary-win32-20260821.md)  
**Scope**: the four claimed folds (W-TEST, W-GATE, W-L12, W-SCROLL). Not a re-litigation of Ctrl VK / press_key / catalog bits (those already PASSed).  
**Date**: 2026-08-21  
**SoT**: [`docs/superpowers/specs/2026-08-21-web-act-loop-design.md`](../../superpowers/specs/2026-08-21-web-act-loop-design.md) §5.1 §5.4 §5.5 DoD 8, 9, 19

Evidence: `[executed]` commands below; `[inspected]` the functions named in the fold. Implementer claims were **not** trusted.

---

## Machine (must pass first)

Companion `[executed]` cwd `companion`:

```text
./node_modules/.bin/tsc -p tsconfig.test.json    # exit 0
node --test .test-dist/tests/web-act-loop-wave1.test.js
# ℹ tests 6  pass 6  fail 0
```

Note: implementer claimed **15/15** on that file. The file contains **6** tests. 15/15 was the earlier `tsx` run of `wave1` **+** `dom-script-budget`. Compile-green + 6/6 is what matters. Count claim was sloppy, not a product miss.

Chrome-extension `[executed]` cwd `chrome-extension`:

```text
./node_modules/.bin/tsc -p tsconfig.test.json    # exit 0
node --test .test-dist/tests/locator-classify.test.js .test-dist/tests/type-fallback.test.js
# ℹ tests 17  pass 17  fail 0
```

Matches the claimed 17/17.

`npx tsc` from repo root still resolves a dummy “not the tsc you are looking for” binary — use `./node_modules/.bin/tsc` inside each package. Not a WAVE-1 defect.

---

## Verdict in one paragraph

All three **merge-blockers** from the REJECT are folded in code, not in a comment: companion wave-1 tests compile under `tsconfig.test.json`; `failInteractive` is a 5-line delegate onto `classifyInteractiveFailure` which is URL-first for `WRONG_ORIGIN` and treats `"Debugger is not attached"` as `CDP_ATTACH_FAILED` even when the caller passed `ELEMENT_NOT_FOUND`; linux has its own Rule 12 + refuse-12b, and darwin/win32 12b now says NEVER for browser-DOM; exhausted scroll no longer offers `host_computer` as the next move. Residual nits (Rule 9 still describes CU on every platform including linux; `keysFromLegacyModifierMask` still untested; `"No tab with given id"` still locator-shaped; source locks are file greps not `platform:` instantiations) do **not** restore the previous lie paths.

**This is not a rubber-stamp of the first-round product.** It is acceptance that the REJECT’s MUST-FIX 1–3 landed and execute.

---

## Fold 1 — W-TEST (P0 compile)

**Claim**: no `import.meta`; `process.cwd()` for `adapter.ts`; `fields.items` optional.

`[inspected]` `companion/tests/web-act-loop-wave1.test.ts`:

- Line 12 gone; `join(process.cwd(), "src/llm/adapter.ts")` at `:80`.
- `fields.items as { required?: string[] } | undefined` at `:25-26`.
- No `import.meta` in the file.

`[executed]` `tsc -p tsconfig.test.json` **exit 0** (this was exit 2 on TS1343+TS18048). Tests run from the compiled `.test-dist` tree.

Nit: `process.cwd()` is correct for `npm --prefix companion test` and for the command I ran. It is wrong if someone launches `node --test companion/.test-dist/...` from the **repo root**. Other companion tests use `__dirname`. Not a merge block — the repo runner cwd is `companion`.

**Fold 1: PASS.**

---

## Fold 2 — W-GATE (`classifyInteractiveFailure`)

**Claim**: privileged URL always `WRONG_ORIGIN`; `"Debugger is not attached"` is `CDP_ATTACH_FAILED` even with `ELEMENT_NOT_FOUND` fallback; locator miss on https stays `ELEMENT_NOT_FOUND`; `failInteractive` delegates.

`[inspected]` helper:

```85:104:chrome-extension/src/background/locator-classify.ts
export function classifyInteractiveFailure(url, msg, fallbackCode = "CDP_ATTACH_FAILED") {
  if (classifyTabUrl(url) === "privileged") {
    return { error_code: "WRONG_ORIGIN", suggested_action: "list_tabs" }
  }
  if (isInvalidSelectorMessage(msg)) { ... INVALID_SELECTOR ... }
  if (isAttachFailureMessage(msg)) {
    return { error_code: "CDP_ATTACH_FAILED", suggested_action: "list_tabs" }
  }
  // ELEMENT_NOT_FOUND / TYPE_UNSUPPORTED_EDITOR → refine_text_or_selector
  // else list_tabs
}
```

`isAttachFailureMessage` (`:79-83`) matches `/debugger|not attached|attach failed|cannot access|script injection|inspected target|target closed|chrome-extension:\/\/|chrome:\/\/|edge:\/\/|devtools:\/\//i`.

`"Debugger is not attached"` hits both `debugger` and `not attached`. That was the named lie path.

`[inspected]` `failInteractive` (`browser-bridge.ts:324-331`) **no longer has an attachish regex**. It always:

```
const url = await this.getTabUrl(tabId)
const c = classifyInteractiveFailure(url, msg, fallbackCode)
return codedToolError(c.error_code, msg, { suggested_action: c.suggested_action, tab_url })
```

`[executed]` new tests in `locator-classify.test.ts`:

| Case | Result |
|------|--------|
| https + `"Debugger is not attached"` + fallback `ELEMENT_NOT_FOUND` | `CDP_ATTACH_FAILED`, `list_tabs`, no `evaluate`/`host_computer` in action |
| `chrome-extension://…` + `"Element not found: #x"` + fallback `ELEMENT_NOT_FOUND` | `WRONG_ORIGIN` (URL wins) |
| https + `"Element not found: #missing"` + fallback `ELEMENT_NOT_FOUND` | `ELEMENT_NOT_FOUND` |

DoD 8/9/19 on the **named** paths now have a machine lock. Spec §5.1 “禁止 error 子串” is honored for **WRONG_ORIGIN vs CDP_ATTACH_FAILED** (privileged URL is first, before any message). Substring remains only as attach-vs-locator, which is the split MUST-FIX 2 allowed if `"Debugger is not attached"` stopped lying.

Remaining (nits, not resurrected blockers):

- `"No tab with given id"` (`ensureAttached` `:198`) still does **not** match `isAttachFailureMessage`. With fallback `ELEMENT_NOT_FOUND` it stays a locator miss. Parent review marked this optional.
- `/debugger/` is broad. A page exception whose text contains “debugger” and is routed through `failInteractive` would be typed attach. evaluate thrown errors go `EVAL_THROWN` before this helper — low risk.
- Tests exercise the **pure** helper, not a fake `chrome.tabs.get`. Acceptable: `failInteractive` no longer contains classification logic.

**Fold 2: PASS.**

---

## Fold 3 — W-L12 (linux Rule 12 + 12b)

`[inspected]` `adapter.ts:426-465`. Ternary is now `win32` / `darwin` / **else (linux and anything not those two)**.

- **linux Rule 12** `:449`: `host_computer is NOT available on this platform (Linux). NEVER propose it — not for native UI and NEVER for browser-DOM. … If CDP_ATTACH_FAILED, list_tabs or stop; there is no third JS injection path.` Spec §5.4 “文案不得暗示有 CU” — this branch does not.
- **darwin/win32 12b** `:462`: `host_computer is LAST RESORT pixel/OCR inject for native apps — NEVER for browser-DOM (use click({text}) / type / get_page_text / evaluate).` Spec W5 “Rule 12/12b” NEVER is present.
- **linux 12b** `:457-459`: `host_computer is not available here. NEVER propose it for browser-DOM or native UI.`

Source lock `[executed]` (`wave1.test.ts:79-85`) now requires all of: NEVER host_* for browser-DOM, Rule 7 do-not-retry, 12b NEVER-for-DOM snippet, Linux “NOT available”. Still a **file grep**, not `os.platform()` instantiation — deleting one **branch** of a duplicated NEVER could still pass if the other branch keeps the string. Both win32 (`:439`) and darwin (`:448`) still have the NEVER sentence, so a single-branch deletion of NEVER would fail only if **both** were removed. Acceptable as a lock; not as strong as a `platform:` parameterized prompt builder test (parent should-fix 7, still open).

**Fold 3: PASS.**

Nit (not in the four folds, still true): Rule **9b/9c** (`:485-486`) still describe `host_computer` action `describe` / Qwen3-VL click locate on **every** platform, including linux where 12+12b say the tool does not exist. Contradictory prompt. Dispatch already hard-refuses. Do not treat as a restored funnel for **browser-DOM** (Rule 7 still forbids that hop).

---

## Fold 4 — W-SCROLL

`[inspected]` `browser-bridge.ts:1360-1363`. Exhausted scroll warning is now:

```text
Try press_key PageDown. Verify with get_page_text — do not claim scrolled.
Do not use host_computer or evaluate as a scroll fallback for the web page.
```

`rg host_computer` in `browser-bridge.ts` → **only** that prohibition line. The previous `"or host_computer scroll if coordinate mode is on"` is gone.

Naming the tools in a **negation** can still prime a stubborn model. That is weaker than suggesting them. Fold as specified: PASS.

**Fold 4: PASS.**

---

## Outcome / Trajectory / Component (fold delta)

| Previous ID | Sev then | Now |
|-------------|----------|-----|
| W-TEST | P0 block | **closed** `[executed]` tsc 0 |
| W-GATE | P1 | **closed** for the named `"Debugger is not attached"` / URL-first WRONG_ORIGIN paths `[executed]` 17/17 |
| W-L12 | P2 | **closed** `[inspected]` |
| W-SCROLL | P2 | **closed** `[inspected]` |
| W-STALL | nit | unchanged (5s `chrome-extension://` retry) — out of fold |
| W-CODE | nit | unchanged (`KeyENTER`) — out of fold |
| W-MASK | nit | `keysFromLegacyModifierMask` still **zero tests**; catalog test now also `doesNotMatch(/Shift=4/)` on modifiers.description (`wave1.test.ts:31`) — partial |
| W-8TEST | nit | heuristic + `getToolDefinitions("win32")` hides osascript (`wave1.test.ts:68-69`) `[executed]`. Still no runtime Rule 8 ternary test. |

Trajectory of the fold is tight: helper extract, prompt split, one warning string, test compile fix. No new Surface/L2. Click still ∉ `L2_GATE_TOOLS` `[executed]`.

---

## Remaining nits (non-blocking)

1. Rule 9b/9c still teach `host_computer` on linux (`adapter.ts:485-486`).
2. `keysFromLegacyModifierMask(8) → metaKey` untested; `press_key` still spreads DOM booleans onto CDP.
3. `"No tab with given id"` + `ELEMENT_NOT_FOUND` fallback still types as locator miss.
4. Source locks are greps; `process.cwd()` for `adapter.ts` assumes companion cwd.
5. Implementer 15/15 claim was the wrong file set; actual wave1 file is 6/6.

None of these restore evaluate/CU as `CDP_ATTACH_FAILED.suggested_action`, nor the compile-red suite.

---

## Judges

| Gate | Result |
|------|--------|
| MACHINE companion tsc | **PASS** `[executed]` exit 0 |
| MACHINE companion wave1 | **PASS** `[executed]` 6/6 |
| MACHINE extension WAVE-1 | **PASS** `[executed]` 17/17 |
| ADVERSARY fold | four claimed folds verified in source |

VERDICT: APPROVE_WITH_NITS
