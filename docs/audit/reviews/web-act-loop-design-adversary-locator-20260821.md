# Adversary review — web act-loop DESIGN §4 W1 (locator SoT)

**Date**: 2026-08-21  
**Role**: Independent ADVERSARY. Did **not** write the spec. Attack the design, not vibes.  
**Subject**: [`docs/superpowers/specs/2026-08-21-web-act-loop-design.md`](../../superpowers/specs/2026-08-21-web-act-loop-design.md) §4 W1  
**Parent lock**: [`web-act-loop-direction-20260821.md`](./web-act-loop-direction-20260821.md)  
**Question**: accept this spec as wave-1 **implementable SoT** for locators?  
**Evidence**: `[inspected]` source + spec; `[assumed]` Chrome CSS4 `i` in live `querySelector` (not re-executed in a page this review; already falsified in the browser-lane adversary)

```text
Surface:      L1 browser CDP (click/type/hover/get_element_info/fill_form/…)
L2-classes:   none new; evaluate / osascript_eval stay L2
Compose:      none
Autonomy:     single
Trust:        click-by-text ≠ evaluate 工具; click 不进 L2_GATE_TOOLS
Channel:      community
```

Axes fit on paper. The live risk is Trust monotonicity (text path becoming evaluate-without-L2) and fail-closed (spec itself writes a fallback that auto-acts).

---

## VERDICT: REJECT

§4 is the right *problem* (catalog CSS-only, finder wired only to `browser_download`, liar-success on `type`/`hover`/`fill_form`). It is **not** an implementable locator SoT.

Faithful implementation of §4 **as written** would ship three wrong locks and leave four contracts for the implementer to invent:

| Spec lock | Why it is not SoT |
|-----------|-------------------|
| §4.2 「先 selector，失败再 text」 | **Fail-open.** Contradicts §4.3 fail-closed and download’s exclusive text path. |
| §4.1 `browser_download` **继续**用现有 finder | **Fork.** Contradicts the direction lock “one `resolveLocator`”. Attribute rename does not stop matching-rule drift. |
| §4.5 + DoD #3 「`i` flag → `INVALID_SELECTOR`」 | **False CSS model.** Encodes a non-bug as a unit test the implementer must make green. |
| fill_form / type / drag_and_drop / hit consumption | **Unspecified.** A coder must invent field schema, focus-type carve-out, from/to text names, and whether `[data-cmspark-hit="1"]` is a durable selector. |

A DRAFT-FOR-ADVERSARY may leave §12 as questions. A SoT may not. Questions 1 / 5 / 6 **are** W1. They are unanswered, and two of the answered locks are wrong.

Do not start coding §4 until the MUST-LOCK list at the bottom is folded into the spec.

---

## Attack 1 — required fields (`[tabId, selector]` → `[tabId]` + runtime `LOCATOR_REQUIRED`)

**Partially specified. Not implementable without inventing schema.** `[inspected]`

### What is true today

| Tool | catalog `required` | runtime if locator missing |
|------|-------------------|----------------------------|
| `click` / `dblclick` / `hover` / `get_element_info` / `select_option` | includes `selector` | `getElementCenter` throws `SELECTOR_REQUIRED` (`browser-bridge.ts:1396-1397`); click catch: `Click failed and no selector provided` (`:806-807`) |
| `type` | `[tabId, value]` — selector **optional**, description 「不填则输入到当前焦点元素」 (`tool-definitions-catalog.json:239-261`) | skips click; `Input.insertText` on focused element (`:817-820`) |
| `fill_form` | tool `[tabId, fields]`; **each field** `[selector, value]` (`:267-305`) | click result discarded; always `success:true` (`:843-867`) |
| `drag_and_drop` | `[tabId, from_selector, to_selector]` | two `getElementCenter` calls (`:1186-1189`) |
| `browser_download` | `[tabId]` + description selector and/or text; companion zod `.refine` (`tool-schemas.ts:79-104`); handler `SELECTOR_OR_TEXT_REQUIRED` (`browser-download-handler.ts:103-112`) | already the pattern §4.2 wants to copy |

`click` / `type` / `fill_form` are **not** in `TOOL_ARG_SCHEMAS` — they hit `GENERIC_FALLBACK` (`tool-schemas.ts:367-368`). Download is the only locator tool with companion-side one-of.

### Spec holes

1. **JSON Schema cannot express “text XOR selector”.** `required: [tabId]` + prose in `description` is what download already does. Runtime must still reject. Spec names `LOCATOR_REQUIRED` but does not say **where** (extension canonical vs companion zod vs both). Download does both. Leaving companion unvalidated means empty `click({})` reaches the SW only after the LLM already burned a hop.

2. **Empty / whitespace is not “absent”.** Download trims (`browser-download-handler.ts:37-42`). Spec does not. `selector: " "` is truthy; `querySelector(" ")` is a SyntaxError or miss, then mislabeled. Lock: `typeof === "string" && trim()` else absent.

3. **`type` without locator is a documented feature.** §4.1 lists `type` as a `resolveLocator` consumer. §4.2 says missing both → `LOCATOR_REQUIRED`. Faithful impl **breaks** focus-type after `click({text})` then `type({value})`. JTBD W4 (contenteditable insertText) needs this path. Carve-out: `type` may omit locator iff intending the current focus; if locator present, resolve it. DoD #2 only tests `click`.

4. **fill_form field-level `required: [selector, value]` is untouched.** Tool-level `[tabId]` is the wrong layer. Models will keep sending `selector` per field because the item schema still requires it. Text-on-fill_form never appears. §7 W5 only mentions `click`/`type` descriptions. D1: schema wins.

5. **`drag_and_drop` param names do not exist.** “from/to” is not a schema. Implementer will guess `from_text`/`to_text` vs overloading `text`. Two locators, two independent `ELEMENT_*`. Spec is silent.

6. **New code vs download vocabulary.** Download: `SELECTOR_OR_TEXT_REQUIRED`. W1: `LOCATOR_REQUIRED`. Same user-visible failure, two codes. LLM will treat them as different strategies. Pick one (prefer download’s, already tested).

7. **DoD #10 is click-only.** hover / dblclick / get_element_info / fill_form items / select_option / drag_and_drop can ship with `required` still containing `selector` while `resolveLocator` exists. That is the architecture.md `click("员工管理")` lie all over again (`docs/architecture.md:305,310`).

**Not a confirm explosion.** Changing `required` does not touch `L2_GATE_TOOLS`. See Attack 7.

---

## Attack 2 — fail-closed

**§4.3 table is correct. §4.2 combination rule falsifies it.** `[inspected]`

Download lock A (`classifyTextMatchCount`, `find-element-by-text.ts:93-97`; handler `:154-186`): count ≠ 1 → do not click; return ≤5 matches + `suggested_action`. Spec copies this for the **text-only** table and correctly bans “interactive 优先后仍 ≥2 就点第一个”.

Then §4.2 writes:

> 可同时给：先 selector，失败再 text（一次调用内，不计两次失败）。

That is auto-act on a **different** locator after the named CSS missed. It is the same class as “点第一个”.

### Why this is fail-open

- `click({selector:"#submit", text:"取消"})`: `#submit` exists → clicks Submit, never looks at text. LLM thought it was disambiguating. Tool returns `success:true` on the CSS first-match.
- `click({selector:"button.primary", text:"发布"})`: CSS 0 matches (wrong guess), text uniquely matches a different control → **silent click**. Spec even says not to count it as two failures, so the retry budget does not see the miss.
- `click({selector:"a[href*='blog' i]", text:"Blog"})`: if implementer follows DoD #3, `i` is `INVALID_SELECTOR`. Spec does not say whether INVALID falls through to text. If it does, CSS syntax error becomes a text click. If it does not, good — **unwritten**.
- Attach failure: selector “失败” then text in the **same world** (`Runtime.evaluate` / `scriptingExecute`). Wastes a hop; still not a locator miss. Must **not** fall through on `CDP_ATTACH_FAILED` / `WRONG_ORIGIN`.

Download does the **opposite** `[inspected]`: if `text` is provided, text is exclusive; `ELEMENT_NOT_FOUND` on text **returns**, does not fall through to `selector` (`browser-download-handler.ts:140-194`, `:265-276`).

Direction lock: shared `resolveLocator({selector?, text?, exact?})`. Combination semantics were never folded. Spec invented selector-then-text without an adversary. **Delete it.**

### CSS multiplicity is also fail-open (document or close)

`document.querySelector` returns the first. `click({selector:"button"})` today auto-picks. Spec applies fail-closed only to text count. LLM bypass: use a broad CSS instead of `text:"发布"`. Acceptable **if written** (“CSS is opt-in first-match; text is fail-closed”). Unwritten, implementers will “helpfully” `querySelectorAll` and disagree across tools.

### Interactive prefer is already fail-closed for count, wrong for forms

`interactiveSel` = `a,button,[role="button"],input[type="submit"|"button"],[onclick],label,summary` (`find-element-by-text.ts:62`). Missing: `input`, `textarea`, `select`, `[contenteditable]`, `[role=textbox]`, `[role=link|menuitem|tab|option|checkbox]`.

- `click({text:"发布"})` on a real `<button>`: OK.
- `fill_form` / `type({text:"邮箱"})`: **label is interactive, text input is not.** Unique match is the `<label>`, not the field. Clicking the label *may* focus the input if `for=` is set; placeholder spans and antd Form.Item will not.
- Spec extracts this IIFE as the **unique** consumer for fill_form fields. Faithful impl uses the download button list for typing. That is not cheap. Direction said “fill_form fields too **if cheap**”. Spec made it mandatory without changing the matcher.

### Text path has no `waitForSelector` 3s

Click waits 3s only when `selector` is truthy (`browser-bridge.ts:782-783`). Text-only SPA “发布” that paints at t=800ms is immediate `ELEMENT_NOT_FOUND`. JTBD W1 is flaky. Download has the same gap; promoting the finder to click makes it product-facing. Lock a poll (same 3s budget) or explicitly accept first-paint-only.

---

## Attack 3 — liar-success

**The diagnosis is real. The spec names the tools and then under-specifies the return shape.** `[inspected]`

Today:

| Tool | Lie |
|------|-----|
| `type` | `await this.click({…})` **discards** result (`:818`); CDP `insertText` catch sets `el.value` and **does not check** the scripting boolean (`:824-835`); always `{success:true}` (`:836`) |
| `fill_form` | click discarded per field (`:845`); no try/catch; always `{success:true}` (`:867`) |
| `hover` | fallback return **not captured** (`:1161-1162`); always `{success:true}` (`:1165`) |

§4.4 + DoD #5/#6 correctly forbid empty-catch success and `type` after failed click. Missing:

1. **fill_form partial fill.** Field 1 insertText succeeds, field 2 `ELEMENT_AMBIGUOUS`. Abort-and-`success:false` leaves a half-filled form (honest). Continue-and-`success:true` with a warning is the **same lie** as today. Spec does not pick. Lock: stop at first locator/focus/CDP failure; `success:false`; `data.filled` = prefix that ran; `error_code` of the failing field. Never `success:true` if any field did not act.

2. **type fallback boolean.** W4 bans `el.value` for non-INPUT/TEXTAREA. If fallback **runs** on INPUT and the IIFE returns `false`, §4.4 requires `success:false`. DoD #5 only covers “click 失败”. Add: insertText throw + fallback false → false.

3. **`select_option` / `drag_and_drop`.** Listed as locator consumers. `select_option` throws `'Select not found'` inside CDP evaluate (`:1176`) — untyped, may surface as attach vs not-found. `drag_and_drop` throws from `getElementCenter` with no `success:false` envelope. If they join `resolveLocator`, they inherit ELEMENT_* or they remain the next liar. Spec is silent.

4. **`get_element_info`.** Throws `Element not found: ${selector}` (`:771`). Read path must not `{success:true, data:null}` — that is the evaluate-null cousin. Out of §4.4’s “点/填” language. Include it.

---

## Attack 4 — `fill_form`

**Mandatory consumer without a form-shaped locator. Confirm question is a red herring.** `[inspected]`

### Confirms will **not** explode if Trust holds

`fill_form` is L1 (`surface-by-tool.ts:28`). Not in `L2_GATE_TOOLS` (`l2-admission.ts:49-67`). One tool call, N in-extension locators, **zero** `SecurityConfirmationManager` dialogs — same as N `querySelector`s today.

§12 question 1 only becomes real if `resolveLocator` is implemented as N `evaluate` **tools** (L2, token, 45s queue) or N companion round-trips. That is Attack 7, not fill_form math.

**Answer the question in the spec:** fill_form stays one L1 call; N locators; 0 new confirms; 0 new dialects.

### What **will** explode / lie

- **Field schema** still requires `selector` (Attack 1.4).
- **interactiveSel** prefers `<label>` over `<input>` (Attack 2).
- **Partial success:true** (Attack 3.1).
- **Hit attribute reuse across fields.** If resolve returns `[data-cmspark-hit="1"]` as a CSS selector, then the loop does resolve-all then act-all, field 2’s IIFE **clears** field 1’s mark (`find-element-by-text.ts:39` analog). Field 1 then clicks the wrong node or nothing and, with today’s code, still `success:true`.

Lock: per field, resolve → act **immediately** (coords from the result, or fallback `[data-cmspark-hit="1"]` in the same turn). Do not return the hit attribute as a durable selector. Do not batch-resolve.

Direction: “fill_form fields too **if cheap**”. Cheap = selector-only fields keep `querySelector`, and liar-success is fixed. Text-on-fields is **not** cheap (matcher list + label/input + partial-fill contract). Spec made it mandatory. Either:

- **W1 fill_form = liar-success + selector path through `resolveLocator` only**, text on fields deferred, **or**
- W1 fill_form text: extend interactive/form pool (`input,textarea,select,[contenteditable],[role=textbox]`) and prefer the control over the label when both match.

---

## Attack 5 — `INVALID_SELECTOR` and the `i` flag

**The typed code is right. The example and DoD #3 are false.** `[inspected]` + `[assumed]`

§4.5: `querySelector` 不支持 `a[href*="blog" i]` → `INVALID_SELECTOR`.

Browser-lane adversary already falsified this as a7ubt9 click 1’s cause:

- Error string is `Element not found for selector: a[href*="blog" i]` from the **scripting false** path (`browser-bridge.ts:801-804`), not a thrown syntax error.
- Same tab later `get_page_html` contains `<a href="/blog/">Blog</a>`. `a[href*="blog"]` without `i` would match.
- Chrome has supported `[attr=value i]` in `document.querySelector` since 49. This path **is** `document.querySelector`.

DoD #3: 「非法 selector `i` flag → `INVALID_SELECTOR`」.

That is a **SoT unit test for a non-bug**. Implementer will make it green by:

- string-matching ` i]` / `\si\s*\]` → misclassify **valid** Chrome selectors, or
- running jsdom/nwsapi which may not match Chrome, then baking that engine’s opinion into production.

Either way the LLM is told “drop `i` or use text” for a selector Chrome would accept. Liar-adjacent.

### What to lock instead

`INVALID_SELECTOR` **iff** `querySelector` throws `DOMException` `SYNTAX_ERR` / CDP `exceptionDetails` that is a syntax error — **before** the 3s `waitForSelector` poll. Hint: “selector is not valid CSS in this document.querySelector; drop unknown pseudo/flags or use `text`”. Do **not** special-case `i`.

DoD #3 becomes: `:::not-a-thing` / `a[` / unclosed quote → `INVALID_SELECTOR` in <<3s, not `ELEMENT_NOT_FOUND`. Optional: `a[href*="blog" i]` in a Chrome-shaped stub is **valid** and proceeds to match/not-found.

`waitForSelector` today swallows errors and retries 200ms (`:1386-1390`). An invalid selector waits ~3s then `getElementCenter` says not found. Typed INVALID is still worth shipping — just not as “the `i` flag”.

---

## Attack 6 — dual finder vs download

**Spec contradicts the direction lock. Attribute rename is necessary but not sufficient.** `[inspected]`

Direction: extract **one** `resolveLocator`; unique `data-cmspark-hit` prefix **not** `data-cmspark-dl-hit`. Surface adversary constraint 1: “Download keeps **calling it**. Click-family starts calling it. **Do not fork a second finder.**”

Spec §4.1: new module *or* extract; click-family is the unique consumer; **`browser_download` 继续用现有 finder**; 禁止复用 `dl-hit`; 本模块标记 `data-cmspark-hit`.

That is two IIFEs. They will drift on: `interactiveSel`, `ownText`, visibility, exact/case, leaf filter, error envelope (`SELECTOR_OR_TEXT_REQUIRED` vs `LOCATOR_REQUIRED`), match preview, `user_hint_zh`.

`find-element-by-text.ts:1-3` already says “future `click({text})`”. Forking now throws away the only tested matcher (`chrome-extension/tests/find-element-by-text.test.ts`).

### Attribute race is narrower than the spec thinks

Same-tab ops serialize on `TabQueue` (`tab-queue.ts:17-38`). `browser_download` holds the queue for the **whole** `executeInner` including `waiter.wait()` (`download-busy-entry.ts:50-57`). Click on the same tab **waits**; it does not interleave IIFEs.

So `dl-hit` vs `hit` is defense-in-depth against: missing `tabId` (queue bypass), leftover attributes after the tool returns, page `MutationObserver`, and an implementer who unifies the fallback to `querySelector('[data-cmspark-hit]')` without `="1"`.

Download leftover: unique match leaves `data-cmspark-dl-hit="1"` on the node (`find-element-by-text.ts:83-86`). Ambiguous marks 1..5 then **does not click**. Next click-family IIFE must **clear only its own** namespace. Spec does not say “clear own attr only” — a unified `querySelectorAll('[data-cmspark-]')` would clobber download mid-wait **if** someone later releases the queue before fallback (not today).

### Real dual-finder bugs to lock

1. **One module.** `buildFindByTextExpression(text, exact, { hitAttr })` with `hitAttr ∈ {data-cmspark-hit, data-cmspark-dl-hit}`. Download calls it with `dl-hit`. Click-family with `hit`. Matching body is **one** function. `classifyTextMatchCount` stays shared.

2. **Consume coords, not a durable CSS selector.** Download: coords from `matches[0]`, CDP mouse, fallback **only** `querySelector('[data-cmspark-dl-hit="1"]')` (`browser-download-handler.ts:225-262`). W1 must copy: fallback **only** `[data-cmspark-hit="1"]`, never `[data-cmspark-hit]` (first of five). Same turn as the mark.

3. **Do not mark on a read-only `get_element_info` if you can avoid it.** Marking 1..5 nodes is a DOM write. A later click fallback could hit a stale mark if the click IIFE fails before its own clear. Prefer: finder returns `{count, matches, coords}`; setAttribute only when the caller is about to act.

4. **Needle `JSON.stringify` only** — spec has this. Keep it. Tests already (`find-element-by-text.test.ts:16-18`).

5. **Case-sensitive substring `exact=false`.** Spec copies download. Catalog **must** say so. `click({text:"blog"})` does not match `Blog` (a7ubt9 click 1). Silent case-sensitivity recreates CSS-only misses in English UIs.

---

## Attack 7 — Trust: text path as evaluate-without-L2

**Intent is right. Freeze is missing. fill_form “确认拆爆” is the symptom of a Trust miss, not a fill_form property.** `[inspected]`

Direction Trust: click-by-text is L1 **iff** it reuses `buildFindByTextExpression` + `JSON.stringify` (no free `evaluate` tool). Do not add click to `L2_GATE_TOOLS`. Spec §2 repeats this. §4.1 only repeats JSON.stringify.

Today click **already** runs a bounded `Runtime.evaluate` IIFE via `getElementCenter` (`:1395-1413`) and `scriptingExecute` (`:801-802`). That is L1 CDP, model does not supply JS. Download text path is the same transport with a bigger IIFE (`body *` + `setAttribute`). `click` ∉ `L2_GATE_TOOLS`; `evaluate` / `osascript_eval` ∈ it (`l2-admission.ts:49-51`).

### What “not evaluate-without-L2” must mean in SoT (or implementers will cheat)

| Allowed | Forbidden |
|---------|-----------|
| Extension `sendCdp(Runtime.evaluate)` / `scriptingExecute` of the **frozen** finder IIFE | Dispatching the `evaluate` **tool** (L2 token, `code` from model or concatenated from `params.text`) |
| Needle = `JSON.stringify(text)` only; `exact` = boolean literal | Interpolating `params.text` / `params.selector` except via `JSON.stringify` / `selectorJsLiteral` (already `selector-js-literal.ts:12-13`) |
| `setAttribute` of the parameterized hit attr | `innerHTML`, `eval`, `Function`, `el.click()` **inside** the finder (act is a separate step) |
| click stays off `L2_GATE_TOOLS` | Promoting click to L2 “to be safe”, or skipping L2 on evaluate because “we have text click now” |

If resolveLocator is implemented in **companion** as `evaluate({code: buildFind…})`:

- every `click({text})` becomes L2 → confirm storm (this is §12.1), **or**
- under three-flag cruise, it is evaluate-without-looking-like-evaluate — Trust regression the direction called REJECT-at-PR.

Finder IIFE is already a **DOM write** (`setAttribute`) plus a full `body *` scan. That is more power than `querySelector`. It is acceptable **because download already shipped it** and the needle cannot carry JS. Freeze the IIFE capabilities in the spec so W1 cannot grow iframe-walk / `eval(selector)` / user CSS inside the text path.

`get_element_info({text})` as a read tool that mutates the DOM is a Trust smell. Return coords without marking, or clear in `finally`.

Navigate/create_tab URL gate is unchanged. Text click on `<a>` follows the link — **pre-existing** L1 side effect of CSS click. Do not “fix” that by stuffing click into L2. Do not skip domain confirm.

---

## Attack 8 — `data-cmspark-hit` vs `dl-hit`

**Namespace split: keep. Consumption protocol: missing. Unique prefix is not a resolver.** `[inspected]`

Spec: 禁止复用 `data-cmspark-dl-hit`; 本模块标记 `data-cmspark-hit`. Good as far as it goes.

Must also lock:

1. Parameterized attr on the **shared** IIFE (Attack 6.1). Two copies that happen to use different strings will still drift.
2. Clear **own** attr at IIFE start (`querySelectorAll('[data-cmspark-hit]')` / `dl-hit` analog at `find-element-by-text.ts:39`). Never clear the other namespace.
3. Fallback selector **must** include `="1"` (unique-match mark). Ambiguous path marks 1..5 **and does not click** (download `:85-86`). If W1 copies the mark-on-ambiguous behavior, a buggy fallback without `="1"` clicks mark `"1"` of an **ambiguous** set — the exact auto-pick §4.3 forbids.
4. Do not publish `data-cmspark-hit` to the LLM as a selector to retry. Matches preview is `{tag, text, x, y}` like download (`:74-81`). Giving the model `[data-cmspark-hit="1"]` is a stale-handle API.

Automation fingerprint: two attrs instead of one. Download already fingerprints. Accept.

---

## Additional W1 holes (still locator SoT)

- **iframe / shadow / `allFrames`.** Finder does not pierce. Direction already said W1 would not have saved 知乎. Spec should say so, or someone will “fix” Trust by osascript. Non-goal, write it.
- **`wait_for` / `analyze_image`.** Not in the consumer list. Fine if explicit. Otherwise the next thread is `wait_for({text})` invented by the model and rejected by schema.
- **`user_hint_zh`.** §4.3 mentions it for NOT_FOUND only. Download has it for AMBIGUOUS too (`browser-download-handler.ts:179-182`). Copy both; it is the wave-1 observe step (direction: match preview, not snapshot).
- **Recoverable list.** Spec §9 says `error` starts with `CODE:` so existing `"not found"` still matches `classifyError` (`security.ts:957-958`). `LOCATOR_REQUIRED` / `INVALID_SELECTOR` / `ELEMENT_AMBIGUOUS` do **not** contain “not found”. If they are omitted from the recoverable list, the turn dies on a correct fail-closed. Lock: add them as recoverable with `suggested_action` already on the payload — except do not teach the model to retry the **same** locator (that is W3′ 5.3’s job for scripts; for locators, recoverable + matches list is the retry).

---

## MUST-LOCK (fold into §4 before coding)

These are not nits. A SoT that omits them forces the implementer to invent policy.

1. **One finder module.** Shared IIFE + `classifyTextMatchCount`. `hitAttr` parameter: click-family `data-cmspark-hit`, download `data-cmspark-dl-hit`. Download **calls** `resolveLocator`; it does not keep a private copy.

2. **Combination semantics — pick B or C, never spec’s D.**  
   - **B (strict):** both provided → element must match **both** (CSS unique ∩ text unique). 0 → `ELEMENT_NOT_FOUND`; ≥2 → `ELEMENT_AMBIGUOUS`.  
   - **C (download):** if `text` present, text-exclusive; selector used only when text absent. Text miss does **not** fall through to CSS.  
   **Forbidden:** selector-then-text fallback. **Forbidden:** fall through on `INVALID_SELECTOR` / `WRONG_ORIGIN` / `CDP_ATTACH_FAILED`.

3. **`INVALID_SELECTOR` = `querySelector` SYNTAX_ERR only.** Delete DoD #3 `i` flag. Replace with a truly illegal selector. Do not string-match ` i]`.

4. **Required / one-of.** Catalog: `required: [tabId]` (plus `value`/`fields`/`from`/`to` as today). Description: “text 或 selector 至少一个” on **every** consumer, not just click. Trim-empty = absent. Companion zod refine like `browser_download` **or** document that extension `LOCATOR_REQUIRED` is canonical. **Unify the code name with download (`SELECTOR_OR_TEXT_REQUIRED`) or justify the split.**  
   `type`: locator optional (focus path).  
   `fill_form` **items**: `value` required; `selector`/`text` one-of at runtime.  
   `drag_and_drop`: `from_selector`/`from_text`, `to_selector`/`to_text` (names locked here).

5. **fill_form.** One L1 call, 0 confirms. Per-field resolve-then-act. First field failure → `success:false` + `data.filled`. Either defer **text** on fields to after interactiveSel includes form controls, or extend the matcher in the **same** PR. Answer §12.1 in the spec body, not as an open question.

6. **Trust freeze.** `resolveLocator` lives in the **extension**. Transport = existing `sendCdp(Runtime.evaluate)` / `scriptingExecute`. Needle `JSON.stringify`. No `evaluate`/`osascript_eval` **tool**. Click stays off `L2_GATE_TOOLS`. IIFE may match + (optional) mark + return `{count,matches,coords}`; it may not click, set `innerHTML`, or eval user JS.

7. **Hit consumption.** Act on `matches[0].{x,y}` the same way download does. Fallback only `[data-cmspark-hit="1"]` in the same turn. Clear own namespace at IIFE start. Never treat the hit attribute as a locator the LLM can store.

8. **CSS first-match.** Write it: CSS `querySelector` remains first-match (legacy); text is fail-closed. Do not silently upgrade CSS to `querySelectorAll` fail-closed in W1 unless DoD covers it.

9. **Liar-success envelope.** `type`/`hover`/`fill_form`/`select_option`/`drag_and_drop`/`get_element_info`: locator/focus/CDP/fallback-false → `success:false` + `error_code`. `error` string `CODE: …`. AMBIGUOUS includes ≤5 matches + `user_hint_zh` + `suggested_action: disambiguate_selector_or_exact_text`.

10. **DoD additions** (replace #3; add):  
    - trim-empty both → `LOCATOR_REQUIRED` / chosen alias.  
    - `type` with neither locator still `success` path (focus) **or** the carved behavior you locked.  
    - fill_form field 2 fail → overall `success:false`.  
    - both selector+text under the chosen B/C rule (include a case that today’s D would have silently clicked).  
    - shared module: download IIFE and click IIFE differ **only** by `hitAttr`; a test that the attribute names are not equal.  
    - fallback expression contains `data-cmspark-hit="1"` and does **not** contain `data-cmspark-dl-hit`.  
    - invalid CSS `a[` → `INVALID_SELECTOR`; `a[href*="blog" i]` is **not** asserted invalid.  
    - `click`/`type` catalog: `text` property exists; `required` does not force `selector`; fill_form **items** do not force `selector`.

---

## Nits (non-blocking once MUST-LOCK lands)

- Case-sensitive `exact=false` must appear in catalog copy (English `blog` vs `Blog`).
- `disabled` / `pointer-events:none` / `aria-hidden` not filtered; pre-existing download behavior.
- `ownText` uses `getAttribute('value')` not live `el.value`.
- `wait_for({text})` / iframe / shadow: explicit non-goals.
- Same-tab click queued behind a 60s download: TabQueue, not a finder bug; mention in TROUBLESHOOTING if W1 makes click-by-text common.
- §7 architecture.md examples must change in the **same** PR as catalog (already W5; restate so it cannot slip).

---

## §12 W1 answers (for the fold)

| # | Question | Answer |
|---|----------|--------|
| 1 | fill_form × resolveLocator 拆爆确认？ | **No**, iff locator stays L1 extension IIFE. Yes if anyone routes through the `evaluate` tool. Lock Trust freeze; then 0 new confirms. |
| 5 | download 与 click 双 finder 漂移？ | **Yes, as specified.** Fork is in §4.1. Parameterize `hitAttr` on one module. |
| 6 | text 路径是否变成未确认的 evaluate？ | **It does** if companion dispatches `evaluate`. **It does not** if it is the frozen download IIFE on the existing CDP/scripting transport. Spec must freeze that, not only say “click ≠ evaluate 工具”. |

2 / 3 / 4 / 7 are W3′ — out of this review’s kill-scope.

---

## ADR-020

Declaration in spec §2 is well-formed. Fail-open selector-then-text is a **Trust** defect (wrong L1 act). Routing text click through `evaluate` is a Trust defect. Forking the finder is a Compose/honesty defect (two sources of ELEMENT_*). No new confirm dialect **unless** fill_form is implemented as N L2 evaluates.

---

VERDICT: REJECT
