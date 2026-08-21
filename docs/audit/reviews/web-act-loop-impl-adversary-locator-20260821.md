# Adversary review — web act-loop WAVE-1 IMPLEMENTATION (W1 locator)

**Date**: 2026-08-21  
**Role**: Independent ADVERSARY. Did **not** write this implementation. Attack the code against the locked SoT, not vibes.  
**SoT**: [`docs/superpowers/specs/2026-08-21-web-act-loop-design.md`](../../superpowers/specs/2026-08-21-web-act-loop-design.md) §4, §9, DoD 1–12 + 17  
**Prior design lane**: [`web-act-loop-design-adversary-locator-20260821.md`](./web-act-loop-design-adversary-locator-20260821.md) (REJECT → Combination C / one finder / SYNTAX_ERR-only / type focus carve-out / fill_form item schema / Trust freeze)  
**Question**: did the implementer ship locked W1 locator behavior, or invert it?

```text
Surface:      L1 CDP
L2-classes:   none new; evaluate / osascript_eval / shell_exec / host_computer still L2
Compose:      none
Autonomy:     single
Trust:        resolveLocator extension-only IIFE; click must NOT enter L2_GATE_TOOLS
Channel:      community
```

Evidence tags: `[executed]` session machine (chrome-extension `npm test` 789 pass; companion `web-act-loop-wave1` + `dom-script-budget` pass). `[inspected]` source + tests. `[assumed]` Chrome `querySelector` `i` flag (SoT already falsified a7ubt9 as Element not found, not invalid).

---

## Outcome

Locked W1 locator behavior is **present and not inverted**. The ten attack holes that rejected the design (and would reject a fail-open / liar-success / second-matcher / L2-click impl) are closed in production code.

This is **not** a rubber stamp. Residuals remain (download error-string prefix, text-without-coords double click, test helper that does not mirror `formHits`, `architecture.md:310` shorthand). None of those invert a locked W1 contract.

| Gate | Result |
|------|--------|
| MACHINE | PASS `[executed]` — 789 extension tests; companion wave1 catalog/zod/L2/classifyError |
| TRUST (ADR-020) | PASS `[inspected]` — `resolveLocator` is `BrowserBridge` + `safeEvaluate` IIFE; `click` / `fill_form` absent from `L2_GATE_TOOLS` |
| LOCKED W1 | PASS — Combination C, one finder, AMBIGUOUS fail-closed, type focus path, catalog item schema |
| NITS | docs/copy + test-helper drift + download envelope (see Residual) |

---

## Trajectory

Working tree is **not** a locator-only slice. Uncommitted noise includes MeetingPanel / local-stt, `mcp/transport.ts`, `memory/session.md` rewrite, package-gate scripts. Locator-relevant files are a coherent W1 extract:

| Path | Role |
|------|------|
| `chrome-extension/src/background/locator-classify.ts` | **new** — trim / Combination C / attach URL class / `CODE:` envelope / SYNTAX_ERR regex |
| `chrome-extension/src/background/find-element-by-text.ts` | parameterized `hitAttr` + form-prefer |
| `chrome-extension/src/background/type-fallback.ts` | **new** — INPUT/TEXTAREA `el.value`; contenteditable must not |
| `chrome-extension/src/background/browser-bridge.ts` | `resolveLocator` + click/type/fill_form/hover/get_element_info/select_option/drag_and_drop consumers |
| `chrome-extension/src/background/browser-download-handler.ts` | **calls** `resolveLocator` with `DOWNLOAD_HIT_ATTR` |
| `companion/src/bridge/tool-definitions-catalog.json` | `text` on consumers; fill_form **item** `required: [value]` |
| `companion/src/bridge/tool-schemas.ts` | click refine text\|selector; type omits locator; fill_form field refine |
| `companion/src/tool/l2-admission.ts` | unchanged — click still not L2 |
| tests | `locator-classify.test.ts`, `type-fallback.test.ts`, `find-element-by-text.test.ts`, `web-act-loop-wave1.test.ts` |

No locator logic leaked into companion as a second IIFE. No `click` added to `L2_GATE_TOOLS`. No drive-by that reopens Combination C.

---

## Component layers

| Layer | What W1 did | Verdict |
|-------|-------------|---------|
| **Catalog (LLM surface)** | `click`/`type`/`hover`/`get_element_info` expose `text`; `required` is `[tabId]` (+ `value`/`fields` as appropriate). fill_form **item** no longer requires `selector`. | PASS DoD 12 |
| **Companion zod** | click/dblclick/hover/get_element_info/select_option refine one-of; `type` has no locator refine; fill_form field refine `selector \|\| text`. | PASS holes 9–10 |
| **Extension `planLocator`** | trim-empty = absent; non-empty text exclusive; never selector-then-text. | PASS hole 1 / DoD 4 |
| **Extension IIFE** | one `buildFindByTextExpression`; `JSON.stringify` needle; mark+return only; `hitAttr` parameterized. | PASS DoD 5 / §4.1 |
| **`resolveLocator`** | text poll ≤3s; 0/1/≥2 typed; CSS `querySelector` first-match (legacy, locked); SYNTAX_ERR probe; attach → `failInteractive`. | PASS DoD 1, 7, 8, 9 |
| **Consumers** | click/hover/get_element_info/select_option/drag_and_drop require locator; type may omit; fill_form field fail → whole `success:false`. | PASS DoD 3, 10, 11 |
| **Download** | calls `resolveLocator(..., hitAttr=download)`. No second interactive/ownText matcher. | PASS hole 3 / DoD 5 |
| **Trust** | IIFE via `safeEvaluate` (`Runtime.evaluate` / `scriptingExecute`). Not the `evaluate` / `osascript_eval` **tools**. Click not L2. fill_form 0 confirms because it never was L2. | PASS hole 4 / §4.7 |

---

## Attack results (the ten holes)

### 1. Combination C violated (selector-then-text fail-open)? **NO** `[inspected]` `[executed]`

`planLocator` is exclusive text-first:

```61:67:chrome-extension/src/background/locator-classify.ts
export function planLocator(params: { text?: unknown; selector?: unknown }): LocatorPlan {
  const text = presentLocator(params.text)
  if (text) return { kind: "text", text }
  const selector = presentLocator(params.selector)
  if (selector) return { kind: "css", selector }
  return { kind: "none" }
}
```

`presentLocator` trims (`locator-classify.ts:8-12`). Whitespace-only text is absent → CSS if selector exists (`locator-classify.test.ts:67-73`).

`resolveLocator` (`browser-bridge.ts:344-435`) switches on `plan.kind` and **returns**. Text miss / `ELEMENT_AMBIGUOUS` / `INVALID_SELECTOR` / attach failure do **not** fall through to the other locator. CSS `waitForSelector` miss uses `failInteractive(..., "ELEMENT_NOT_FOUND")` (`:432-434`) — still no text retry.

Download passes `{ text, selector, exact }` into the same planner (`browser-download-handler.ts:144-148`) and `if (!loc.ok) return loc.result` (`:149`). Construct 「CSS would click the wrong node, text is unique」 cannot click CSS.

DoD 4 holds.

### 2. liar-success still on type / hover / fill_form? **NO** (empty-catch success is gone) `[inspected]`

§4.4: locator / focus / CDP / fallback false → `success:false` + `error_code`.

| Consumer | Failure envelope |
|----------|------------------|
| `typeText` | locator fail → `loc.result` (`browser-bridge.ts:1007-1008`). Click-to-focus fail → return that result (`:1011-1012`). `insertText` throw → type-fallback; `ok:false` → `TYPE_UNSUPPORTED_EDITOR` or `ELEMENT_NOT_FOUND`; catch → `failInteractive` (`:1019-1037`). **No** empty `catch { return {success:true} }`. |
| `hover` | locator fail → `loc.result` (`:1412-1413`). No coords → `ELEMENT_NOT_FOUND` (`:1417-1420`). CDP throw → JS events only if `found`; else `failInteractive` (`:1424-1434`). `if (found) return success` is a real dispatch, not a swallow. |
| `fill_form` | missing fields/value → `success:false` + `filled` (`:1043-1060`). Field locator fail → `{ success:false, ..., filled }` (`:1062-1065`). Click / clear / type fail same (`:1066-1102`). Whole call `success:true` only after the loop (`:1106`). |
| `get_element_info` / `select_option` / `drag_and_drop` | locator fail returned; evaluate/coords miss coded; catch → `failInteractive`. |

`codedToolError` prefixes `CODE:` (`locator-classify.ts:43-53`; test `:44-53`).

Residual (not liar-success of a **failed** locator): `Input.insertText` that does not throw is treated as success even if no field is focused (allowed focus path, DoD 3). contenteditable fallback returns `{ok:true}` after a no-op `InputEvent` if `execCommand('insertText')` is false (`type-fallback.ts:32-39`) — §6 names that event as the allowed fallback; DoD 17 is `el.value=`, not DOM-content proof.

### 3. download still has a second matcher? **NO** `[inspected]`

Production handler comment is accurate:

```140:149:chrome-extension/src/background/browser-download-handler.ts
    // Combination C via shared resolveLocator (download hitAttr). No second matcher.
    let clickSelector = selector
    let textCoords: { x: number; y: number } | null = null
    if (text || selector) {
      const loc = await bridge.resolveLocator(
        tabId,
        { text, selector, exact },
        { requireLocator: true, hitAttr: DOWNLOAD_HIT_ATTR },
      )
      if (!loc.ok) return loc.result
```

No second `interactiveSel` / `ownText` / `classifyTextMatchCount` copy in the handler. Finder IIFE is one module; only `hitAttr` differs (`find-element-by-text.ts:27-28, 38-42`; `resolveLocator` defaults `CLICK_HIT_ATTR` at `browser-bridge.ts:353`).

What remains is **hit consumption**, which §4.6 allows:

- `[data-cmspark-dl-hit="1"]` `.click()` (`browser-download-handler.ts:219-228`)
- CSS path may call `bridge.click({ selector: clickSelector })` (`:231-242`) — CSS first-match, not a second text matcher

**Nit (behavior, not inverted C):** if text unique-matches **without** coords, the handler both `scriptingExecute`s the dl-hit click (`:224-228`) **and** leaves `clickSelector = loc.selector` (`:155-156`) so `bridge.click` fires again (`:231-232`). Double-activate. Coords path sets `clickSelector = undefined` (`:151-153`) and is clean. Tests stub `resolveLocator` with a miniature count decoder (`browser-download-handler.test.ts:18-72`) — test double, not a production fork.

**Nit (envelope):** empty locator still short-circuits **before** `resolveLocator` with `error` prefixed `ELEMENT_NOT_FOUND:` while `data.error_code` is `SELECTOR_OR_TEXT_REQUIRED` (`:107-116`). §9 wants `error` to start with `CODE:`. Click/type/fill_form go through `codedToolError` and are clean. Download empty is the leftover.

### 4. click entered `L2_GATE_TOOLS`? **NO** `[inspected]` `[executed]`

```49:67:companion/src/tool/l2-admission.ts
export const L2_GATE_TOOLS: readonly string[] = [
  "evaluate",
  "osascript_eval",
  "host_read",
  "host_write",
  "shell_exec",
  ...
]
```

`click` / `fill_form` / `type` / `hover` are absent. Wave1 test asserts it (`companion/tests/web-act-loop-wave1.test.ts:71-76`). fill_form 「拆确认」 is still the only legal answer: it never went through the `evaluate` tool.

`resolveLocator` lives on `BrowserBridge` (`browser-bridge.ts:344`). Transport is `safeEvaluate` → `Runtime.evaluate` then `scriptingExecute` (`:847-873`). §4.1 ban on the **evaluate / osascript_eval tools** holds. IIFE itself does not `.click()`, does not write `innerHTML`, does not eval user JS (`find-element-by-text.ts:47-104`). Needle is `JSON.stringify` (`:43`).

### 5. fill_form uniquely matching label instead of input? **NO** (when both match) `[inspected]`

Locked recipe: keep a/button/label in the interactive pool; **if any form control hit, prefer form**.

```31:32:chrome-extension/src/background/find-element-by-text.ts
export const INTERACTIVE_SEL =
  'a,button,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="option"],[role="checkbox"],input,textarea,select,[contenteditable="true"],[contenteditable=""],[role="textbox"],[onclick],label,summary'
```

IIFE then:

```86:88:chrome-extension/src/background/find-element-by-text.ts
  const formSel='input,textarea,select,[contenteditable="true"],[contenteditable=""],[role="textbox"]';
  const formHits=pool.filter(el=>{ try{ return el.matches(formSel); }catch(e){ return false; } });
  if(formHits.length>0) pool=formHits;
```

`<label>邮箱</label>` + `<input placeholder="邮箱">` → both interactive → `formHits = [input]` → unique input. Isolated `<label>` with no matching control still unique-matches the label (click may focus if `for=` / wrapping). Spec parenthetical is 「优先 form」, not 「never match label」.

**Nit:** `selectTextMatchPool` (`find-element-by-text.ts:128-153`) is advertised as mirroring the IIFE and **omits** `formHits`. Tests never exercise form-prefer (`find-element-by-text.test.ts` has no label+input case; `type-fallback.test.ts:39-44` only regex-checks `INTERACTIVE_SEL` contains `input`). IIFE is correct; the pure helper is a lying twin. Regression hazard, not inverted runtime.

`ownText` reads `placeholder` (`find-element-by-text.ts:64`). §4.2.

### 6. contenteditable fallback assigns `el.value`? **NO** `[inspected]` `[executed]`

```23:42:chrome-extension/src/background/type-fallback.ts
    const isField=tag==='INPUT'||tag==='TEXTAREA';
    const ce=el.isContentEditable===true||...
    if(isField){
      ...
      el.value=${valueLit};
      ...
    }
    if(ce){
      el.focus();
      let inserted=false;
      try{ inserted=!!document.execCommand('insertText',false,${valueLit}); }catch(e){}
      if(!inserted){
        el.dispatchEvent(new InputEvent('input',{bubbles:true,data:${valueLit},inputType:'insertText'}));
      }
      return {ok:true,kind:'insertText'};
    }
```

`type-fallback.test.ts:6-14` slices the `if(ce)` branch and asserts `el.value=` is absent. DoD 17 holds. `unsupported` → `TYPE_UNSUPPORTED_EDITOR` (`browser-bridge.ts:1027-1030`).

### 7. AMBIGUOUS still clicks first? **NO** (text path) `[inspected]` `[executed]`

```108:112:chrome-extension/src/background/find-element-by-text.ts
export function classifyTextMatchCount(count: number): "ok" | "ELEMENT_NOT_FOUND" | "ELEMENT_AMBIGUOUS" {
  if (count <= 0) return "ELEMENT_NOT_FOUND"
  if (count === 1) return "ok"
  return "ELEMENT_AMBIGUOUS"
}
```

`resolveLocator` on ≥2 returns `codedToolError("ELEMENT_AMBIGUOUS", ...)` with `matches` ≤5, `user_hint_zh`, `suggested_action: disambiguate_selector_or_exact_text` (`browser-bridge.ts:391-404`) **before** any `applyResolvedClick`. `click()` is `if (!loc.ok) return loc.result` (`:994-996`).

IIFE still **marks** the first 5 hits (`find-element-by-text.ts:100-101`). That is not a click. Residual: an LLM that later CSS-selects `[data-cmspark-hit="1"]` opts into first-match (§4.6: hit attr is not a durable locator).

CSS remains `querySelector` first-match (`waitForSelector` `browser-bridge.ts:1748-1749`; SoT §4.3 legacy lock). Not a text-path invert.

Poll: text waits up to 3s and only `break`s on `count === 1` (`:367-378`). Immediate ≥2 therefore waits the full budget before AMBIGUOUS. Fail-closed, just slow. Nit.

### 8. `INVALID_SELECTOR` regex falsely flags Chrome `i` flag? **NO** `[inspected]` `[executed]`

```69:72:chrome-extension/src/background/locator-classify.ts
/** SYNTAX_ERR-only. Must NOT match Chrome's case-insensitive `i` attribute flag. */
export function isInvalidSelectorMessage(msg: string): boolean {
  return /syntaxerror|is not a valid selector|failed to execute 'queryselector'/i.test(msg)
}
```

The regex is applied to **exception messages**, not to the selector string. `isInvalidSelectorMessage('a[href*="blog" i]') === false` (`locator-classify.test.ts:75-78`). Canonical invalid is in-page:

```413:423:chrome-extension/src/background/browser-bridge.ts
    const syntaxProbe = `(()=>{try{document.querySelector(${selectorJsLiteral(selector)});return{ok:true}}catch(e){return{ok:false,name:e&&e.name,message:String(e&&e.message||e)}}})()`
    ...
      if (pv && pv.ok === false) {
        return {
          ok: false,
          result: codedToolError("INVALID_SELECTOR", pv.message || "invalid selector", {
```

`a[` → `querySelector` SYNTAX_ERR → `INVALID_SELECTOR`. `a[href*="blog" i]` → Chrome accepts `[assumed]` → probe `ok:true` → not invalid (a7ubt9 class = not found). DoD 7.

Residual: probe treats **any** `querySelector` throw as invalid, not `e.name === 'SyntaxError'` / `SYNTAX_ERR` only. In Chromium, `querySelector` throws only that. Spec-tightness nit, not a false `i` flag.

### 9. type without locator still works (focus path)? **YES** `[inspected]` `[executed]`

Catalog `required: ["tabId", "value"]` — no selector (`tool-definitions-catalog.json:285-288`). Description: 「可省略 locator」 (`:261`). Zod `type` has no one-of refine (`tool-schemas.ts:88-94`). Wave1: `tryParseToolArgs("type", { tabId: 1, value: "x" }).ok === true` (`web-act-loop-wave1.test.ts:44`).

Runtime: `resolveLocator(..., { requireLocator: false })` (`browser-bridge.ts:1007`). `plan.kind === "none"` → `{ ok: true }` with no selector/coords (`:354-355`). Skip click (`:1010-1014`). `Input.insertText` on current focus. DoD 3.

If a locator **is** present, Combination C applies (click-then-type).

### 10. catalog still requires selector on click / fill_form items? **NO** `[inspected]` `[executed]`

| Tool | `required` | `text` property |
|------|------------|-----------------|
| `click` | `["tabId"]` (`tool-definitions-catalog.json:220-222`) | yes (`:211-214`); description names text-or-selector + AMBIGUOUS (`:199`) |
| `type` | `["tabId","value"]` (`:285-288`) | yes (`:273-276`) |
| `fill_form` **item** | `["value"]` only (`:327-329`) | yes (`:315-318`) |
| `hover` / `get_element_info` / `select_option` / `dblclick` | `tabId` (+ `value` for select) | yes |

Companion test locks it (`web-act-loop-wave1.test.ts:20-31`). Zod click without either locator is rejected (`:39`); fill_form `{ text, value }` is accepted (`:40-43`).

`architecture.md:305` is now `click({text:"员工管理"})` — W5 lock-step for the named lie. **Nit (docs):** `:310` still writes `click("搜索")` shorthand.

---

## DoD 1–12 + 17 checklist

| # | Lock | Result | Evidence |
|---|------|--------|----------|
| 1 | text 0/1/≥2 → three codes; ambiguous does not click | **PASS** | `classifyTextMatchCount` `find-element-by-text.ts:108-112`; `resolveLocator` `:381-404`; `click` returns `loc.result` before `applyResolvedClick` `:994-996` |
| 2 | both trim-empty → `SELECTOR_OR_TEXT_REQUIRED` | **PASS** (click/type/fill_form/hover) | `plan.kind==="none"` + `requireLocator` `browser-bridge.ts:354-361`; `presentLocator` trims. Download empty: `error_code` correct, **error string prefix `ELEMENT_NOT_FOUND`** (`browser-download-handler.ts:107-116`) — nit, see hole 3 |
| 3 | `type` with no locator can still succeed via focus | **PASS** | `requireLocator: false` `:1007`; catalog/zod hole 9 |
| 4 | selector+text → text exclusive (CSS-wrong / text-unique must not click CSS) | **PASS** | `planLocator` `locator-classify.ts:61-67`; test `:67-73`; download uses same plan |
| 5 | download and click IIFE differ only by `hitAttr` | **PASS** | `buildFindByTextExpression(..., hitAttr)` `find-element-by-text.ts:38-51`; click `CLICK_HIT_ATTR` `browser-bridge.ts:353`; download `DOWNLOAD_HIT_ATTR` `browser-download-handler.ts:147` |
| 6 | click fallback contains `data-cmspark-hit="1"`, not `dl-hit` | **PASS** | text success returns `` `[${hitAttr}="1"]` `` `:408-410` with default click attr; `applyResolvedClick` `querySelector` that selector `:981-982`. Download consumption uses `dl-hit` by design `:221` |
| 7 | `a[` → `INVALID_SELECTOR`; do **not** assert `i` flag invalid | **PASS** | syntaxProbe `:413-423`; regex test `locator-classify.test.ts:75-78` |
| 8 | `https://zhihu.com` + attach fail → `CDP_ATTACH_FAILED` not `ELEMENT_NOT_FOUND` | **PASS** on the `ensureAttached` path | throw `Debugger attach failed...` `browser-bridge.ts:209` matches `failInteractive` attachish `:328-335`; `classifyAttachFailure("https://...")` → `CDP_ATTACH_FAILED` `locator-classify.ts:32-41`; test `:33-37`. Gate still uses error **substring** to decide to classify (spec §5.1 says classify from `tabs.get` URL). Common attach errors match. Residual for exotic messages |
| 9 | `chrome-extension://` URL → `WRONG_ORIGIN` | **PASS** | `classifyTabUrl` privileged `locator-classify.ts:18-24`; test `:39-42`; `ensureAttached` throws `Cannot access a chrome-extension://...` `:189-190` → attachish → URL class |
| 10 | type/hover locator fail → `success:false` | **PASS** | `typeText` `:1007-1008`; `hover` `:1412-1413`; no empty-catch success |
| 11 | fill_form field 2 fail → whole `success:false` | **PASS** `[inspected]` (no jsdom fill_form driver; loop is fail-closed) | `:1062-1102` returns `{ success:false, data:{..., filled} }` without continuing |
| 12 | catalog click/type have `text`; fill_form item does not force selector | **PASS** | catalog + `web-act-loop-wave1.test.ts:20-31` |
| 17 | contenteditable fallback has no `el.value=` | **PASS** | `type-fallback.ts:32-39`; test `:6-14` |

DoD 13–16, 18–20 are W3′/W4/W5 (budget, evaluate honesty, Ctrl VK, classifyError, suggested_action). Not this lane’s reject bar. Spot-check only: all 11 §9 codes are in `classifyError` recoverable (`security.ts:1039-1050`); click is not L2; fill_form Ctrl payloads carry `windowsVirtualKeyCode` (`type-fallback.test.ts:16-29`).

---

## Residual risks (do not invert locked W1)

1. **`architecture.md:310`** still `click("搜索")` after `:305` was fixed to `click({text:"员工管理"})`. W5 copy lock was the named example; the sibling line was missed. Docs nit.

2. **`selectTextMatchPool` omits `formHits`** while the IIFE has it. Unit tests cannot catch a future IIFE regression that unique-matches `<label>` over `<input placeholder>`.

3. **Download empty-locator `error` prefix** is `ELEMENT_NOT_FOUND:` with `error_code: SELECTOR_OR_TEXT_REQUIRED`. §9. classifyError still recoverable either way.

4. **Download text-without-coords double click** (`dl-hit` IIFE + `bridge.click` on the same selector). Coords path is clean.

5. **`failInteractive` attachish regex** is a substring **gate** in front of URL classification (`browser-bridge.ts:328-335`). DoD 8/9 pass for `Debugger attach failed` / `Cannot access chrome-extension://`. A non-matching attach throw on https would still be `ELEMENT_NOT_FOUND` (CSS fallback code). W3′ residue.

6. **contenteditable** `InputEvent` without `execCommand` success does not insert text but returns `ok:true`. Allowed fallback shape; not DOM-verified.

7. **IIFE default `hitAttr` is `DOWNLOAD_HIT_ATTR`** (`find-element-by-text.ts:41`). `resolveLocator` always passes click/download explicitly. Forgetting the arg in a future caller mixes namespaces.

8. **`zod` `.min(1)` does not trim.** `" "` survives companion refine; extension `presentLocator` treats it as absent and fail-closes. Extra hop, not fail-open.

9. **AMBIGUOUS marks hit 1..5** then returns. Durable-locator misuse is an LLM problem §4.6 already forbade.

10. **`drag_and_drop` two text resolves** share `CLICK_HIT_ATTR`; the second IIFE clears the first mark (`find-element-by-text.ts:51`). Practical path uses `coords` from each resolve (`browser-bridge.ts:1488-1494`), so the clear is harmless unless coords are missing.

11. **Working tree mix.** Locator is reviewable; do not ship this tree as “W1-only” without splitting meeting/mcp/session.md.

12. **Known SoT residuals (not this impl’s to close):** `file:`/`https:` PDF plugin may still lie `ELEMENT_NOT_FOUND`; CSS multiplicity is first-match by lock; iframe/shadow out of wave.

---

## Capability (ADR-020)

Axes match the SoT. `resolveLocator` did not become an L2 `evaluate` tool. `click` did not enter `L2_GATE_TOOLS`. fill_form field batches stay 0-confirm because they stay L1 CDP. Trust freeze holds `[inspected]`.

---

VERDICT: APPROVE_WITH_NITS
