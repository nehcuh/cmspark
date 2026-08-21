# Second-judge rereview — web act-loop WAVE-1 implementation

## Machine gates

Auto-mode permission classifier blocked my re-execution of `node --test` / `npm test` / local `tsc` (known harness behavior). Downgraded to static re-verification:

- All four WAVE-1 test sources read in full — assertions are real, not theater `[inspected]`
- Compiled `.test-dist` artifacts are fresh (15:17–15:18 today) and contain the **post-fold** code ("Debugger is not attached" present in compiled locator-classify.test.js; zero `import.meta` in compiled wave1.test.js) — corroborates the rereview's `tsc exit 0` `[executed]` claim `[inspected]`
- Test counts internally consistent: 13+4=17 extension, 6 wave1 + 9 budget = 15 companion
- Pass/fail counts stand as **adversary-executed claims corroborated by source**, not my execution

## 1. DoD 1–20 in code, not prose

Held. Spot-verified each in source: Combination C (`locator-classify.ts:61-67`), typed 0/1/≥2 before any click (`browser-bridge.ts:371-395`, `:986`), `SELECTOR_OR_TEXT_REQUIRED` on trim-empty (`:345-352`), type focus carve-out (`browser-bridge.ts:998` + zod `tool-schemas.ts:88-94`), SYNTAX_ERR probe not `i`-flag regex (`browser-bridge.ts:404`, `locator-classify.ts:70-72`), URL-first `WRONG_ORIGIN`/`CDP_ATTACH_FAILED` (`locator-classify.ts:85-104`), fail-closed `fillForm` per field with `filled` (`browser-bridge.ts:1053-1059`), peek-≥3/≥24 without increment (`dom-script-budget.ts:144-153`), `stop_or_change_task` hard-coded (`:87-95`), payload-not-brand heuristic (`:15-37`), Ctrl/Meta halves both vk=65 (`cdp-keys.ts:77-97`), 11 codes recoverable (`security.ts:1040-1050`), click ∉ `L2_GATE_TOOLS` (tested, wave1.test.ts:72-77).

Weakest two, both correctly waived as inspection-only: **DoD 16** (evaluate dead-world logic correct at browser-bridge.ts:1613-1642, zero tests — the exact a7ubt9 hole class) and **DoD 11** (fillForm loop fail-closed by inspection, no bridge fixture).

## 2. Trajectory — leftover hops

Clean. Only `host_computer` in extension background is the scroll *prohibition* (browser-bridge.ts:1363). Rule 12/12b/7/8 all carry the NEVER-for-browser-DOM sentences, linux has its own no-CU branch (adapter.ts:449, :457-459), non-darwin Rule 8 states no third JS path (:481). No `suggested_action` anywhere in companion or extension tool results this wave touched names `evaluate`/`host_computer`/`osascript`.

## 3. Component — nits the adversaries waived, re-verified

All confirmed real, none escalate: `selectTextMatchPool` omits formHits (find-element-by-text.ts:128-153); download double-activate on text-without-coords (browser-download-handler.ts:224-232); IIFE default hitAttr is download (:41); pinned-tab origin displacement (adapter.ts:1139-1163 + tabKeyForDomScript); `looksEmpty` treats `{type:"object",value:undefined}` as completion instead of probing (browser-bridge.ts:1600, SoT would probe); Rule 9b/9c still teach CU on linux (adapter.ts:485-486); `keysFromLegacyModifierMask` zero tests; "No tab with given id" still ELEMENT_NOT_FOUND-shaped; WS osascript route bypasses the budget peek.

One finding **better** than the locator adversary reported: the download plain-empty path now emits `SELECTOR_OR_TEXT_REQUIRED:` prefix (browser-download-handler.ts:112) — their nit #3 described the pre-fold state; `CACHE_MISS_NEEDS_ELEMENT` predates this wave (verified via git diff).

## 4. Per-adversary verdicts

| Adversary | Verdict | My ruling |
|---|---|---|
| locator | APPROVE_WITH_NITS | **CONFIRM** — nits real but non-inverting; one already fixed beyond their snapshot |
| budget | APPROVE_WITH_NITS | **CONFIRM** — attack 10 verified in code and correctly sized (volume still caps; no 81-restoration); DoD 16 gap honestly labeled |
| win32 (first pass) | REJECT | **CONFIRM** — compile-red suite meant the locks were fiction; correctly scoped (didn't reject locator/budget work) |
| win32 rereview | APPROVE_WITH_NITS | **CONFIRM** — all four folds verified in source and compiled output; remaining nits verified real |

No over-loose APPROVE found. Trust freeze holds: no new L2 class, click/fill_form/type outside `L2_GATE_TOOLS`, resolveLocator confined to extension IIFE. Carry-forward should-fixes: DoD 16 + adapter peek integration tests, `looksEmpty` spec alignment, Rule 9b/9c linux gating, `budgets.delete` on thread delete.

VERDICT: APPROVE_WITH_NITS
