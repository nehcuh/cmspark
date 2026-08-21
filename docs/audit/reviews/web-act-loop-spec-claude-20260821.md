Independent rereview complete. All four documents read in full; the spec was checked clause-by-clause against each lane's MUST-LOCK list, then the six named holes were attacked directly.

## Fold confirmation — were the REJECT MUST-LOCKs written into the body?

**Yes, all three lanes are folded into the operative sections, not just the §12 record table** `[inspected]`:

| Lane | Body evidence |
|------|--------------|
| locator REJECT (10 MUST-LOCKs) | §4.1 one finder + parameterized `hitAttr` + download must *call* `resolveLocator`; §4.2 combination = **C** with explicit 「禁止 selector 失败再 text」+ no-fall-through on `INVALID_SELECTOR`/`WRONG_ORIGIN`/`CDP_ATTACH_FAILED` + code unified to download's `SELECTOR_OR_TEXT_REQUIRED`; §4.5 SYNTAX_ERR-only + 「禁止把 `i` flag 测成 invalid」; §4.3 CSS first-match written down + text-path 3s poll; §4.4 liar-success envelope incl. `get_element_info`; §4.6 hit consumption same-turn, `="1"` fallback, clear-own-namespace, not-a-durable-locator; §4.7 Trust freeze; §4.2 `interactiveSel` extension to form controls mandated in the same PR |
| budget REJECT (7 MUST-FIXes) | §5.3 two counters (identical **3** + origin volume **24**), thread-persisted, cruise-counted, cross-「继续」， osascript `url`→origin, origin-change reset, tabId-churn no-reset; §5.2 dead-world ≠ empty_completion via `1+1===2` probe + `EVAL_DEAD_WORLD`; §5.3 payload-fingerprint heuristic with explicit non-hit list; §7 all new codes into `classifyError` recoverable; `MAX_SAME_TOOL_RECOVERABLE_FAILURES=3` untouched |
| win32 REJECT (7 MUSTs) | §5.4 matrix: win32/linux = no third JS path, stop on `CDP_ATTACH_FAILED`, 禁止 suggest evaluate/host_computer; §5.1 suggested_action ban (同一 debugger rationale); §5.3 cap ⇒ hard-reject success path + no CU hop; Rule 12/12b NEVER `host_computer` for browser-DOM on three platforms (§5.4); linux CU hard-refuse + 文案不得暗示 CU; §5.5 correct CDP masks documented, catalog de-masked to 人话， fill_form Ctrl half must truly work; §10 DoD parameterized `platform:"win32"` with the Start-Process/cscript fixtures |

§12 is a fold *record* with a re-adversary trigger on 5.3/5.4 changes — correct lock discipline.

## Hole-by-hole attack

1. **selector-then-text — CLOSED.** §4.2 text-exclusive both directions (「只走 text，不 fall through 到 CSS」； trim-empty text = absent → CSS), fall-through banned on the three non-locator failures. DoD #4 constructs exactly the case D would have silently clicked (「CSS 会点错、text 唯一」). No reopen path found — `fill_form` fields inherit the same table via 「按上表解析」.

2. **evaluate-as-attach-retry — CLOSED.** §5.1 bans `suggested_action: evaluate` on `CDP_ATTACH_FAILED` with the correct reason (same debugger); §5.4 win32 row bans it again plus `host_computer`; DoD #19 asserts the absence. Residual path (model calls evaluate anyway on a dead world): `EVAL_DEAD_WORLD` is recoverable → rides the existing 3-strike fail cap; on darwin the legal escape is osascript-under-budget, on win32 it's 停. Coherent.

3. **identical-hash-only cap — CLOSED.** Counter B is the a7ubt9 killer: 24 per `(dom_script, origin)` regardless of hash; DoD #14 tests distinct-hash 24→cap. Origin (not tabId, not path) correctly survives `/write`→`/p/…/edit` and tab churn; resets only on origin change. Whitespace/comment normalize bypass of counter A is bounded by B.

4. **powershell+chrome heuristic — CLOSED.** Replaced by payload tokens (`execute javascript` / `Runtime.evaluate` / `document.querySelector` / `el.click(` / `chrome.debugger` / `--remote-debugging-port` / osascript incl. `tell application "Google Chrome"`); interpreter brand dropped; explicit non-hit list (`Start-Process chrome` / `Get-Process chrome` / `tasklist`); DoD #15 has both fixtures including cscript-carried JS.

5. **type focus carve-out — CLOSED.** §4.2 「允许省略 locator（焦点路径，JTBD 先 click 再 type）。有 locator 则按上表解析」 + DoD #3. Honesty preserved: focus-false → `success:false` per §4.4, so the carve-out can't resurrect liar-success.

6. **classifyError default non_recoverable — CLOSED.** §5.1 states the trap explicitly; §7 mandates 9 codes in the recoverable list; DoD #20 blanket-asserts every new `error_code` is recoverable — this covers `ELEMENT_NOT_FOUND`/`EVAL_THROWN` (new code tokens whose underscore form wouldn't match the legacy `"not found"` substring). Capped codes stay recoverable-but-hard-rejected with `stop_or_change_task`, which is the coherent shape the budget lane demanded.

## Nits (non-blocking)

- **`规范化` undefined** (§5.3). Budget lane asked for whitespace+comment-strip-only. Damage bounded by counter B; still one implementer choice left on the table.
- **shell_exec dom_script hits have no origin.** The tool carries no tabId/url; bucketing for counter B is unspecified. Null-origin shared bucket is the fail-closed default an implementer will reach — say it.
- **`file:` HTML / `blob:` / `data:` attach-fail** falls past all three rows of the §5.1 table → row-3 `ELEMENT_NOT_FOUND` lie, adjacent to the documented PDF residual but not itself documented.
- **§5.5 press_key keeps DOM-key booleans.** Win32 lane's inspection says CDP ignores `ctrlKey`/`metaKey` (only `modifiers` + VK are real). DoD #18 locks fill_form's Ctrl half by outcome, but press_key chords have no equivalent 「真正生效」 proof — extend the same execution-proof standard or send `modifiers`.
- **§7 list vs DoD #20 scope mismatch** (2 codes covered only by the blanket) and **AMBIGUOUS payload lacks `user_hint_zh`/`suggested_action`** (locator MUST-LOCK 9 partial — ≤5 matches made it, the hints didn't).
- **One-of validation side unspecified** (companion zod vs extension canonical; name was unified, locus wasn't).
- Rule 12 string change and linux CU-refuse are W5-mandated but DoD-less — verifiable by review, tests would be cheaper.

All six attacked holes are closed in the body with DoD coverage; what remains is either a documented residual, bounded by the second counter, or a W5 text change — nothing forces the implementer to invent load-bearing policy. Declaration in §2 is well-formed per the checklist; Trust monotonicity holds (finder frozen in-extension IIFE, click off `L2_GATE_TOOLS`, no new confirm dialects).

VERDICT: APPROVE_WITH_NITS
