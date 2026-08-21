# Web act-loop — locked direction after independent adversaries

**Date**: 2026-08-21  
**Input**: `web-act-loop-diagnosis-20260821.md`  
**Adversaries**:
- browser: `web-act-loop-adversary-browser-20260821.md` APPROVE_WITH_NITS
- policy: `web-act-loop-adversary-policy-20260821.md` APPROVE_WITH_NITS (rejected W3-as-specified)
- surface: `web-act-loop-adversary-surface-20260821.md` APPROVE_WITH_NITS

This document is the **fold**. Dual (Claude + Kimi) reviews THIS, not the pre-fold diagnosis alone.

## What survived

1. **L1 locator honesty is still a hole** (catalog `selector`-only vs architecture `click("员工管理")` vs finder only on `browser_download` / D10 leftover). Wave-1 **W1** stays: `text|selector` on click/dblclick/hover/type/get_element_info, **fail-closed** `ELEMENT_AMBIGUOUS`, copy download’s `suggested_action`. Extract **one `resolveLocator`**, do not leave fill_form/hover as the next 知乎 thread.
2. **Do not default `host_computer` for web** (Trust: L2 pixels). User ask in a7ubt9 was rational given CDP lies; the fix is honest CDP + last-resort gate, not CU-as-browser.
3. **W2 snapshot is SoT, wave-2.** Snapshot needs the same attach that already failed in a7ubt9; prompt-only observe→act without a snapshot tool repeats D1 (schema wins).
4. **W5-only is rejected.** Last-resort is already in Rule 8.

## What was falsified (must not ship)

| Claim in diagnosis | Falsifier |
|--------------------|-----------|
| 81× osascript = recoverable retry storm (RC3) | **0 `success:false` on those 81.** Working-path loop (Draft.js inject/poll). `MAX_SAME_TOOL_RECOVERABLE_FAILURES=3` never sees success. |
| W3 = block osascript on http(s) when CDP tools exist | Would have **killed the only working 知乎 write**. Catalog already documents X.com CSP → osascript last-resort. |
| `click({text})` would have saved a7ubt9 | Zhihu `textarea.Input` was a real node; click **relabeled attach failure** as locator miss. Finder uses the same world. Draft.js still needs W4. |
| Flip `chrome-extension://` to `non_recoverable` | Same attach string on **https** Zhihu tab; would `chat.error` a live editor. Need typed `WRONG_ORIGIN` + `list_tabs`, still recoverable. |
| `auto_approve_dangerous` alone skips evaluate/osascript L2 | Still `forceConfirm` unless **three-flag cruise**. This user had cruise. |

## Wave-1 direction (lock this or REJECT)

**W1 — Locator module + error contract** (capability + honesty)
- Shared `resolveLocator({selector?, text?, exact?})` used by click / dblclick / hover / type / get_element_info (fill_form fields too if cheap).
- Fail-closed multi-match (download lock A). Unique `data-cmspark-hit` prefix **not** `data-cmspark-dl-hit`.
- Structured `{error_code, suggested_action, matches?}`. Never bare `Element not found`.
- `type`/`hover`/`fill_form` must **not** `success:true` when focus/locator failed (liar success).

**W3′ — Act-loop machine gates** (not scheme ban)
- Typed CDP attach/`chrome-extension://` → `WRONG_ORIGIN` / `CDP_ATTACH_FAILED` + `suggested_action: list_tabs`. Do not relabel as locator miss.
- `evaluate` `result:null` must not look like success-with-empty (honesty; today it drives Rule 8 last-resort).
- Cap **identical successful DOM-script loops** (osascript/evaluate fingerprint of same expression/tab), not only recoverable failures.
- Osascript on http(s) remains allowed as **attach-gated last-resort** after typed CDP failure — budgeted, not banned.
- Do not raise `MAX_SAME_TOOL_RECOVERABLE_FAILURES` as the “fix”; it already resets on tool hop.

**W4** with W1 for contenteditable (insertText path already primary; fallback `el.value` is the bug).

**W2** wave-2: interactive snapshot + uid.

**W5** lock-step catalog + Rule 7/8 with W1/W3′ — never instead.

## Trust

- click-by-text is L1 iff it reuses `buildFindByTextExpression` + `JSON.stringify` (no free `evaluate` tool).
- Do not add click to `L2_GATE_TOOLS`.
- Osascript/evaluate stay L2.

## Dual rereview (2026-08-21)

| Judge | File | VERDICT |
|-------|------|---------|
| Claude | `web-act-loop-rereview-claude-20260821.md` | APPROVE_WITH_NITS |
| Kimi | `web-act-loop-kimi-20260821.md` | APPROVE_WITH_NITS |

Both reject-conditions cleared: no http scheme ban; no “click({text}) saved Zhihu” claim.

**Absorbed nits (implementer MUST, not optional):**

1. Success-loop fingerprint includes `shell_exec` whose command contains `osascript` (a7ubt9: 54 shell_exec; bypass of osascript-only budget).
2. Budget bites under **three-flag cruise**; survives user 「继续」 (not per-`chatCreate` reset); keyed `(tool-family, expression-hash, tabId)` so success on another tab does not reset a dead tab.
3. `WRONG_ORIGIN` from `tabs.get(tabId).url` origin, **not** substring `chrome-extension://` on the error string (https Zhihu tab showed the same attach text).
4. Evaluate-null: typed shape distinguishing “no completion value” vs CSP/attach failure (Claude count: **20/26** evaluate `success+null`).
5. Record: osascript `success:false` was **1/81** (tab URL miss, recovered), not 0.

## Dual-review question (answered)

Wave-1 (W1 + W3′ + liar-success), wave-2 W2, not CU-as-web-default: **APPROVE_WITH_NITS** ×2 independent families.

## Cross-platform (added 2026-08-21 — a7ubt9 was macOS-only)

Independent adversaries + Claude/Kimi did **not** exercise Windows. Trace and osascript last-resort are darwin. Lock below so wave-1 does not ship a Mac-only policy.

| Layer | Darwin (a7ubt9) | win32 | linux |
|-------|-----------------|-------|-------|
| W1 locator + ELEMENT_* + liar-success | Extension JS/CDP | **same** (Chromium MV3) | same |
| WRONG_ORIGIN via `tabs.get(tabId).url` | same | **same** | same |
| evaluate-null honesty | same | **same** — and it is the **primary** last-resort (no osascript) | same |
| `osascript_eval` | in catalog; 80/81 success loop | **omitted** (`shouldExposeOsascript` / Rule 8) | omitted |
| Success-loop budget | osascript + evaluate + `shell_exec osascript` | **evaluate** + `shell_exec` (powershell/cscript/chrome) that injects DOM — do not key the cap as `osascript` only | evaluate + shell |
| `press_key` / CU `cmd` | Meta | **Ctrl** (Win key is Meta=8). `fill_form` already dual-sends Meta+A then Ctrl+A (`browser-bridge.ts` CORR-06). `press_key` does **not** remap. | Ctrl |
| `host_computer` as web default | no | **no** (same Trust). Win Rule 12 already says NEVER host_* for browser-DOM. | no |
| CDP attach / `chrome-extension://` | same debugger API | same | same |

**Windows is not easier.** Without osascript, the 知乎-class path after CDP attach failure is: honest `CDP_ATTACH_FAILED` → budgeted **evaluate** (L2) → stop. Today that would be an evaluate-null / attach storm instead of 81 AppleScripts.

**Implementer MUST (platform)**

1. Unit tests for resolveLocator / error_code / liar-success are **platform-free** (no `osascript` in the assertion names as if they were the product).
2. W3′ fingerprint family is `dom_script` = `evaluate` ∪ (darwin `osascript_eval`) ∪ `shell_exec` whose argv looks like DOM inject (`osascript` **or** `osacript` **or** win `powershell`/`cscript` hosting Chrome JS — fail-closed substring on `execute javascript` / `chrome.automation` if we add them). Never `if (darwin) cap else skip`.
3. Catalog/prompt: `press_key` modifiers — tell the model Ctrl on win32/linux, Meta on darwin; do not require the LLM to know bitmask 8 vs 2. Optional small helper later; wave-1 at least prompt + one test that fill_form still dual-sends.
4. Do not add a Windows-only last-resort (UIAutomation-on-Chrome) in wave-1. That would be a new L2 surface.
5. CI: companion locator/error tests in the existing Node suite (already cross-OS). Extension CDP attach typing can be unit-tested with a fake `tabs.get` url; no Windows VM required for wave-1 gates.

Linux follows win32 for this slice (no osascript, CDP+evaluate).
