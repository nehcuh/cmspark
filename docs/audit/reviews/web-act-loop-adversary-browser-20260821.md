# Adversary review — web act-loop diagnosis (browser-tools skeptic)

**Date**: 2026-08-21  
**Role**: independent ADVERSARY. Did not write the diagnosis. Goal is to falsify ranked RCs and the W1+W3-first lock, not to ship code.  
**Strawman**: [web-act-loop-diagnosis-20260821.md](./web-act-loop-diagnosis-20260821.md)  
**Trace**: `~/.cmspark-agent/threads/a7ubt9.json` (inspected, not re-diagnosed)  
**Evidence tags**: `[inspected]` read source + thread; `[assumed]` Chrome CSS4 `i` support (not executed in a live page this review)

```text
Surface:      L1 browser CDP (click/type/read); host_computer stays L2 last resort
L2-classes:   none new; evaluate/osascript already L2
Compose:      none
Autonomy:     single
Trust:        monotonic — text locators must NOT skip L2 evaluate/osascript; click stays L1
Channel:      community
```

Axes fit: Surface L1 only. No new runtime, no Pack-first issue, no new confirm dialect. Trust monotonicity is the live risk on W1 (text click must not become a stealth `evaluate`) and on W3 (must not *raise* L2 osascript into a free CDP clone, nor *ban* the only working DOM path).

---

## Verdict in one paragraph

The diagnosis’s **product leftovers are real** (catalog CSS-only vs `architecture.md` `click("员工管理")`; D10 finder not wired to `click`; download already has `ELEMENT_*` + zh hint; prompt last-resort is prose). The **causal story for a7ubt9 is not**. CSS-only is not why 3/3 `click` calls failed. `click({text})` would not have published the 知乎 draft. Snapshot is not required in wave 1. Fail-closed must stay. **W1 + W3-first is still the right sequence** if W3 is “typed errors + stop *success* storms + WRONG_ORIGIN”, **not** “ban `osascript_eval` on http(s) because CDP tools exist in the catalog.”

---

## Attack 1 — Is CSS-only really the top root cause, or is it model / prompt / anti-bot?

**Falsified as a7ubt9’s proximate cause. Not falsified as a product hole.**

### What the thread actually did `[inspected]`

| # | Call | Tab | Result |
|---|------|-----|--------|
| click 1 | `a[href*="blog" i]` | 1492093885 `yongzx.github.io` (not X) | `Element not found for selector: …` |
| click 2 | `textarea.Input` | 1492094083 知乎 write | `Element not found for selector: …` |
| click 3 | `.WriteIndexLayout textarea` | same | `Element not found for selector: …` |

Histogram in the diagnosis is consistent with the file: `osascript_eval` 81, `shell_exec` 54, `evaluate` 26, `click` **3 (all failed)**. User pain is the 知乎 compose storm, not the homepage nav miss.

### Click 1 — CSS4 `i` flag claim is wrong `[inspected]` + `[assumed]`

Diagnosis: “`querySelector` does not support the CSS4 `i` flag in this path.”

- Error string is `Element not found for selector: a[href*="blog" i]`, which is the `scriptingExecute` **false** path in `browser-bridge.ts` ~801–804, **not** a thrown invalid-selector / `Script injection failed`. `[inspected]`
- Immediately after, `get_page_html` on the **same tab** (`source: "runtime"`) contains `<a href="/blog/">Blog</a>`. `a[href*="blog"]` **without** `i` would match that href. `[inspected]`
- Chrome has supported `[attr=value i]` in `document.querySelector` since 49. This path *is* `document.querySelector` (waitForSelector / getElementCenter / click fallback), not a private CSS engine. `[assumed]`

So click 1 is **not** explained by “CSS-only + i-flag.” Remaining hypotheses: parallel-tool race, stale debugger context (`ensureAttached` returns early if `attachedTabs.has(tabId)` ~154), or querySelector running against a different document than the later HTML snapshot. That is RC5-adjacent (wrong/stale document), not “the model cannot invent CSS.”

Also a misread: this was **not** an “X blog link.” The open tweet was `x.com/MaxForAI/status/…`. `get_page_text` on X **succeeded**. The failed click was Yong Zheng-Xin’s **static** GitHub Pages nav. Recovered in the next turn via `get_page_html` + `navigate("https://yongzx.github.io/blog/")`. Click 1 was cheap.

### Click 2–3 — the selector was *right* `[inspected]`

~10s after click 2 failed, `osascript_eval` on `zhuanlan.zhihu.com/write`:

```text
querySelector('textarea.Input') → FOCUSED:Input i7cW1UcwT6ThdhTakqFm
```

Same selector, different bind (AppleScript **URL fragment** vs CDP **tabId**). Diagnosis line “Zhihu `textarea.Input` / Draft.js selectors miss” is **false**. CSS was sufficient. The L1 click/evaluate/`get_element_info` path could not see a node AppleScript could see.

Same tab, `press_key` ~16s later:

```text
Debugger attach failed for tab 1492094083:
Cannot access a chrome-extension:// URL of different extension
```

`click` **swallows** attach failure and relabels it `Element not found for selector` (~798–804). That trains the model to invent more CSS. RC5 is masked as RC1.

`evaluate` on 4083 returned `{success:true, data:{result:null}}` (including a top-level `return` snippet that is a SyntaxError — model/prompt, not anti-bot). `get_element_info` uses the same `safeEvaluate` + `querySelector` (~753–771). Four not-founds on guessed *and then proven* selectors are the same attach/world hole.

### Anti-bot? `[inspected]`

No captcha, no Cloudflare interstitial, no 知乎 challenge in the tool results. AppleScript JS ran. `get_page_html` dumped the write page. This is **debugger/world targeting**, not “Chrome is uncontrollable” *or* “知乎 blocks automation.” Do not lock an anti-bot narrative.

### Model / prompt? Partially `[inspected]`

- Catalog **requires** `selector` (`tool-definitions-catalog.json` ~191–208). Inventing Playwright-style CSS is what the schema asks for.
- Prompt (`adapter.ts` ~454–467) never says “click by visible text” or “snapshot before click.” Rule 8 says prefer `get_page_text` / `evaluate`; on 知乎 evaluate returned null so the model *correctly* went last-resort osascript.
- Prompt did **not** cause click 2: the model had a verified selector and still lost.

**Re-rank for this thread (proximate):** RC5 (attach/`chrome-extension://` mislabeled as not-found) ≈ RC4 (last-resort is prose; osascript becomes the loop) > RC3 (see attack extras — the 81 calls are mostly *successes*) > RC1 (real schema hole, not this trace’s failure mode) > RC6/RC2.

**Keep RC1 as highest *product* leftover** (D10, architecture lie, every future `click("员工管理")`). Do not tell the implementer “text locators would have saved a7ubt9.”

---

## Attack 2 — Would `click({text})` have saved a7ubt9 (X blog link, Zhihu Draft.js)?

**No.**

### X tweet `[inspected]`

Never clicked. `get_page_text` on the tweet worked. W1 is irrelevant to the open-tweet step.

### Yong “Blog” nav — maybe, not the user goal

Visible text is `Blog` / `BLOG`. Finder (`find-element-by-text.ts` ~9, 56–60) is **case-sensitive substring**. `click({text:"blog"})` (the casing they put in CSS) would **not** match `Blog`. `click({text:"Blog"})` would, *if* the same document the later HTML dump saw is the one the finder evaluates.

The finder is the same `Runtime.evaluate` / `scriptingExecute` pair `browser_download` already uses (`browser-download-handler.ts` ~141–151). If click 1 failed because the **document** was wrong, W1 fails too. If it failed only because of the `i` selector, W1 helps. Unproven either way; **recovered without W1**.

### 知乎 Draft.js — W1 does not type, and would miss the node `[inspected]`

W1 reuses the finder. Finder comments: “future `click({text})`” (`find-element-by-text.ts:1-3`). It does **not** pierce iframes (`browser-bridge` has no `allFrames`) and does **not** use a different attach than click.

On 知乎:

1. Proven `textarea.Input` was invisible to click/evaluate/`get_element_info`.
2. Therefore `click({text:"请输入标题（最多 100 个字）"})` in the same world is `ELEMENT_NOT_FOUND`, not a save.
3. Body is Draft.js `contenteditable`. W1 is a locator. Typing is RC6 / W4 (`typeText` `el.value` only on `INPUT`/`TEXTAREA`, ~822–833). `click({text})` + current `type` still would not insert into Draft.js.
4. Publish CTA: page text has 发布 / 发布设置 / 发布到专栏 / 将发布到…. Fail-closed `text:"发布"` → `ELEMENT_AMBIGUOUS` (download contract). Auto-pick would be the wrong-click the download D-lock exists to prevent.

**D10 leftover is still worth shipping** (independent `click({text})` “can reuse the same finder” — plan line 129). It would not have closed this thread.

---

## Attack 3 — Is snapshot (W2) required in wave 1?

**No. Diagnosis is right to defer W2. Do not pull it forward.**

- Playwright/Chrome-DevTools-MCP snapshot→uid needs **the same CDP attach** `press_key` already failed with `chrome-extension://`. Snapshot on 4083 would have been an expensive empty tree or a WRONG_ORIGIN, not a SoT.
- Observe-step gap (RC2) is real vs host_computer 12b (`adapter.ts` ~447–451). Wave-1 observe is: **typed error + match preview** (download already returns `matches` + `suggested_action`), not a new a11y dump.
- Token size / shadow DOM risks in the diagnosis table are enough to keep W2 in wave 2.
- Non-goal “do not vendor chrome-devtools-mcp as the Side Panel loop” stays. Topology is Extension ↔ Companion, not MCP-as-runtime.

W2 becomes interesting **after** attach is honest and W1’s `ELEMENT_AMBIGUOUS` match list is in production. Not before.

---

## Attack 4 — Fail-closed vs auto-pick first match

**Keep fail-closed. Do not auto-pick.**

- Download Q5 / D lock: multi-match → `ELEMENT_AMBIGUOUS` (`classifyTextMatchCount`, `find-element-by-text.ts` ~93–97; handler ~167–185; plan Q5). `[inspected]`
- Architecture example `click("员工管理")` implies a unique control. Chinese writer UIs repeat short labels.
- Auto-pick first `发布` / first `Blog` is a Trust violation (wrong-click is worse than a retry). Click is L1 today; a wrong L1 click still submits, focuses, or navigates.
- W1 **must** copy download: `count` + `matches[0..5]` + `user_hint_zh` + `suggested_action`. That is the observe step wave 1 needs.
- Case-sensitivity: if W1 reuses the finder as-is, catalog must say so (or fold case-insensitive default for `exact=false`). Silent case-sensitive will recreate click 1.

Trust nit (diagnosis attack 7): text click must **not** skip navigate domain confirm; click stays L1; do not route text click through `evaluate` to “make it work” on 知乎. If CDP cannot see the node, fail typed `WRONG_ORIGIN` / `ELEMENT_NOT_FOUND`, do not silently osascript.

---

## Extra attacks (diagnosis list 2, 4, 5)

### W3 osascript-block on http(s) — **direction error as written** `[inspected]`

Diagnosis W3: “osascript **blocked** for http(s) DOM when CDP tools exist.”

On a7ubt9, CDP tools **existed in the catalog** and **did not work**. Osascript was the only DOM write that returned real nodes (`FOCUSED:Input …`, DraftEditor probe). Blocking it would have ended the task, not the storm.

`osascript_eval` is L2 (`l2-admission.ts` ~50–51) and URL-bound, not tabId-bound (`companion-dispatch.ts` comments). That is why it survived `chrome-extension://` on the same numeric tabId.

**Allowed W3:**

- Typed `WRONG_ORIGIN` / `CDP_ATTACH_FAILED` on `chrome-extension://` (already thrown in `ensureAttached` ~167–168) — **do not rewrite to Element not found**.
- Mark `chrome-extension://` **non-retry** in `classifyError` (today it is recoverable ~968).
- Cap **identical successful** osascript/shell loops (see below). Require “CDP attach actually failed” before treating osascript as last resort — machine gate, not catalog membership.

**Not allowed W3:** `if (url.protocol === 'http:') deny osascript`.

iframe / `file:` / extension-page uses in diagnosis attack 2 are secondary. The primary counterexample is **https 知乎 write**.

### Evaluate-as-click was the intended L2 path — and it was tried `[inspected]`

Attack 4 on the diagnosis list. `evaluate` ×26, then osascript as `evaluate` that binds by URL. Do not “fix” L1 by telling the model to `evaluate("el.click()")` as the default web path (Trust: evaluate is L2; click is L1). W1 stays L1 text/selector.

### Recoverable-without-hint is real — but it is **not** why 81 osascript fired `[inspected]`

- `classifyError` treats `"element not found"`, `"not found"`, `"cannot access"`, `"chrome-extension://"` as recoverable (`security.ts` ~949–968). Agreed.
- Click error is a bare string (~804). Download already has `error_code` + `suggested_action`. Agreed RC3 *for click*.
- **Already shipped:** `MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3` (`adapter.ts` ~152, ~1359–1374), per tool **name**, per user turn. `get_element_info` ×4 is parallel-batch overshoot, then the user said stop. Click never reached a 3-fail stop because there were only 3 clicks and the model switched tools.
- Osascript 81 / shell 54 are mostly **`success:true`**. The loop guard **does not count successes**. W3 “max N identical locator fails” does not bite the histogram the diagnosis leads with.

Cross-surface (diagnosis attack 5): same pattern is “success but no progress” (osascript `FOCUSED` / shell `COPIED` / host_computer later failed on key whitelist), not only recoverable-without-hint. If W3 only copies download `ELEMENT_*` onto click, the 81-call storm remains.

### Click isolated-world short-circuit `[inspected]` — implementer trap for W1

`scriptingExecute` (~260): if isolated world returns a **usable** `false` (`"result" in r`), it **never** tries MAIN. Finder/click-fallback can report not-found while MAIN/osascript sees the node. If W1 only wraps the existing click fallback, 知乎 stays broken.

`ensureAttached` (~154): once `attachedTabs` has the tabId, URL is not re-checked. Navigation / extension interstitial can desync tabId from http(s) document.

---

## What I accept (do not regress)

| Item | Accept? |
|------|---------|
| Catalog CSS-only vs `architecture.md:305` `click("员工管理")` | Yes — docs lie; schema wins (D1) |
| Finder exists, wired only to `browser_download`; D10 leftover | Yes |
| `type` selector optional but click-to-focus still CSS | Yes |
| Download `ELEMENT_*` + zh hint is the contract to copy | Yes |
| Prompt 12b observe→act for CU vs no web playbook | Yes, as W5 lock-step with schema, never instead |
| Do **not** default `host_computer` for web | Yes (Trust: L2 pixels on Chrome) |
| W4 contenteditable with W1, not instead of W1 | Yes, secondary |
| W5 prompt-only without W1/W3 will fail (D1) | Yes |
| Non-goals: no new runtime, no vendor MCP loop | Yes |
| Fail-closed text click | Yes |
| Click stays L1 | Yes |

---

## Direction lock (corrected)

**Wave 1: W1 + W3\*, then W4, W5 lock-step. W2 later.**

**W1** — `click` / `type` / `get_element_info` accept `text` **or** `selector` (D10); reuse finder; `ELEMENT_NOT_FOUND` / `ELEMENT_AMBIGUOUS` + matches + zh hint. Fail-closed. Case policy explicit. **Do not claim this repairs a7ubt9 知乎.**

**W3\*** — rewrite before implementer starts:

1. Stop rewriting attach failures as `Element not found`.
2. `chrome-extension://` / `CDP_ATTACH_FAILED` → typed, **non-retry** (classifier change).
3. Suggested next: `list_tabs` (show url), do not guess more CSS.
4. Cap *identical successful* last-resort calls (osascript/shell), not only recoverable failures. Existing fail-count=3 is insufficient.
5. **Drop** “osascript blocked for http(s) when CDP tools exist.” Gate last-resort on **attach outcome**, not catalog presence.
6. Optional: osascript still L2; `auto_approve_dangerous` remaining a free CDP clone is RC4 — prompt cannot fix it; a machine “CDP-failed?” bit can.

**W2** — not wave 1.

**W4** — with W1 for Draft.js/知乎/Notion, still useless if attach is lying.

**W5** — web observe→act in the prompt **only** after W1 schema exists.

---

## Nits (non-blocking)

1. Diagnosis “X blog link” → yongzx.github.io `<a href="/blog/">Blog</a>`. Fix the sentence so implementers do not chase x.com locators.
2. `get_page_html({selector:"nav, header"})` returned the **full** document (`length: 6304`). Selector-scope is already dishonest; click honesty should not copy that.
3. Finder `ownText` concatenates `innerText` of descendants (`find-element-by-text.ts` ~47–54); interactive-prefer + leaf filter helps, but `text:"发布"` on 知乎 will still AMBIGUOUS. Document that in the catalog, do not “fix” with auto-pick.
4. `waitForSelector` 3s, timeout not fatal (~1392). Fine. Do not raise it as a 知乎 fix.
5. host_computer in-thread failed because `key` whitelist rejected `cmd+a` / `cmd+v` (assistant then switched to `type` batches). Out of scope for L1 W1; do not silently widen CU to paper over web locators.

---

## Capability / Trust check

- W1 text locator on `click` = still L1. Must not skip domain confirm on subsequent `navigate`. Must not call through `evaluate`/`osascript` inside `click` to “just work.”
- W3 classifier change is companion `security.ts` + error payload; no new L2 class.
- Osascript stays L2, darwin-only, not domain-whitelist (ADR-007 H4 / D11). Do not use W3 to smuggle a new confirm dialect.

---

VERDICT: APPROVE_WITH_NITS
