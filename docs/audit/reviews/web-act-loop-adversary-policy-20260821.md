# Adversary review — web act-loop RC3 / RC4 / W3 (policy / retry-storm)

**Date**: 2026-08-21  
**Role**: Independent adversary (prompt / policy / retry-storm skeptic). Did **not** write the diagnosis.  
**Target**: `docs/audit/reviews/web-act-loop-diagnosis-20260821.md`  
**Question**: accept/reject the claim that retry-storm + last-resort-in-prose is a **first-wave machine gate (W3)**, not prompt-only (W5-only).  
**Trace**: `~/.cmspark-agent/threads/a7ubt9.json` (466 messages, 10 user turns)  
**Blast**: T2 direction-lock. Diagnosis is DIAGNOSIS-only (no impl this batch).

```text
Surface:      L1 browser CDP; host_computer / osascript_eval are L2 last-resort
L2-classes:   evaluate, osascript_eval (already L2; no new class)
Compose:      none
Autonomy:     single
Trust:        monotonic — better locators must NOT skip L2 evaluate/osascript
Channel:      community
```

## VERDICT: APPROVE_WITH_NITS

Accept **W3-not-W5-only** as a first-wave *intent*. Reject **W3 as specified** (hard-block `osascript_eval` on http(s) whenever CDP tools exist) and reject **RC3/RC4 as the cause of the 81× osascript histogram**.

W5-only is correctly insufficient. A machine gate belongs in wave 1. The gate that belongs is **not** the one written in the W3 row.

| Claim | Result |
|-------|--------|
| W5-only (prompt lock-step) will fail again | **Holds** — last-resort is already in Rule 8 + catalog; model still ran 81 osascript |
| 81× osascript is a recoverable-classifier retry storm | **Falsified** — 0 `osascript_eval` `success:false` in a7ubt9; volume is a *working-path* loop |
| Last-resort-in-prose caused the jump to osascript | **Partially falsified** — first switch obeyed last-resort after evaluate-null / click-fail; then it *stayed* because it worked |
| `auto_approve_dangerous` alone made osascript a free CDP clone | **Falsified as mechanism** — evaluate/osascript still `forceConfirm` unless **three-flag cruise**; this user has cruise |
| W3 machine gate in wave 1 (some form) | **Holds** |
| W3 clause “osascript blocked for http(s) DOM when CDP tools exist” | **Must not ship** — would have killed this exact user task and the catalog’s X.com CSP last-resort |

---

## Method

Tried to **falsify** RC3, RC4, and W3 against:

- `companion/src/llm/adapter.ts` — Rules 7–8, 12/12b, `MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3`, `MAX_TOOL_CALL_ROUNDS = 100`
- `companion/src/security.ts` `classifyError` recoverable list (`element not found`, `not found`, `cannot access`, `chrome-extension://`)
- `companion/src/tool/l2-admission.ts` — evaluate + osascript both L2; three-flag cruise
- `~/.cmspark-agent/config.json` `security.*`
- a7ubt9 tool results (histogram vs `success:false` vs `result:null`)
- `chrome-extension/src/background/browser-bridge.ts` click / `ensureAttached` / `safeEvaluate` / `evaluate`

Evidence tags: `[executed]` thread JSON counts; `[inspected]` source; `[assumed]` where not re-run live.

---

## Attack 1 — What actually produced 81× `osascript_eval`?

Diagnosis RC3/RC4 inference: classifier *encourages* another turn; last-resort is prose; auto-approve + recoverable “not found” makes osascript the cheapest retry.

### Falsification `[executed]`

| Fact | Number |
|------|--------|
| Assistant `osascript_eval` calls | **81** (matches diagnosis) |
| `osascript_eval` `success:false` in the thread | **0** |
| Thread-wide `success:false` tool results | **17** (all tools) |
| `click` calls / all failed | 3 / 3 (matches diagnosis) |
| `get_element_info` “Element not found” | 4 (2+2 across a user “继续”) |
| `evaluate` `data.result: null` with `success: true` | **11** |
| `host_computer` | 1, and only after the user ordered it; it failed |

The 81 osascript calls are **successful actuator steps** (DOM probe, `focus()`, `execCommand('insertText')`, toolbar `.click()`, progress polls), not a recoverable-error retry storm.

First osascript (02:53:45Z) returned live DOM:

```json
{"success":true,"data":{"result":"{\"count\":1,\"items\":[\"0:DIV:notranslate public-DraftEditor-content:660x26:ph=\"],\"bodyLen\":393}"}}
```

The model’s own reasoning at that switch `[executed]`: evaluate returned `{result:null}` → click could not find `textarea.Input` that osascript had just seen → “click/type 工具在此页面不可用…改用 osascript”. That is **last-resort used as designed**, then committed as the only working JS path.

### Why the existing loop guard did not stop 81

`[inspected]` `adapter.ts:151-152, 1271-1374`:

- `MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3` counts **`success:false` of the same tool name** inside **one** `chatCreate`.
- **Success deletes the counter** (`recoverableFailureCounts.delete(toolName)`).
- New user message → new `chatCreate` → counters reset (10 user turns in a7ubt9).
- `evaluate` `{success:true, result:null}` is **not a failure**. It resets nothing because it never incremented — and it does not stop the loop.

So RC3’s “classifier encourages another turn” is true of the 17 real failures, and **false of the 81**. A classifier that had marked those osascript successes as non_recoverable would have been a bug.

### Alternative causes (ranked, this trace)

1. **Working-path lock-in** — osascript was the only JS injection that returned DOM. Volume is Draft.js/React incremental edits + polls, not retries of an error.
2. **`evaluate` success+null footgun** — `browser-bridge.ts:682` already comments “agent mislabels as CSP”. Statement-shaped `code` (no completion value) and/or CDP returning `undefined` is reported as `{success:true, result:null}`. Model treated that as “CSP blocked evaluate”, which *justifies* Rule 8 last-resort. `[inspected]` + `[executed]`
3. **CDP attach false-positive** on the Zhihu **https** tab: `press_key` → `Debugger attach failed for tab 1492094083: Cannot access a chrome-extension:// URL of different extension` while `list_tabs` shows `https://zhuanlan.zhihu.com/p/…/edit`. Click had already returned bare `Element not found` for selectors osascript could see. `[executed]`
4. **Three-flag cruise** made each successful osascript free (no L2 dialog). Necessary for *silent* 81, not sufficient to *choose* osascript.
5. Recoverable “element not found” / last-resort prose — **not the 81 driver**. They describe the *tiny* click / `get_element_info` prefix.

**RC3 as a pattern for CSS-only tools** still stands (bare string, no `error_code` / `suggested_action`). **RC3 as the explanation of 81× osascript does not.**

---

## Attack 2 — RC4 last-resort-in-prose and auto_approve

### Last-resort is prose — true, and already duplicated `[inspected]`

- Rule 8 darwin: `osascript_eval is a LAST-RESORT macOS-only tool … Prefer get_page_text / evaluate first.` (`adapter.ts:464-467`)
- Catalog: `(macOS ONLY …) Only use as LAST RESORT when both get_page_text and evaluate fail on restricted pages (e.g. X.com CSP).` (`tool-definitions-catalog.json` ~1023-1024)
- Rule 12b: `host_computer is LAST RESORT pixel/OCR inject.` Prefer CDP for web.

There is **no machine budget, no “CDP-failed” predicate, no per-turn cap** on osascript. That part of RC4 is true.

The leap “therefore the model ignored the prompt” is **false on this trace**. Timeline `[executed]`:

1. `get_page_text` / `get_page_html` / `evaluate` (many; several `result:null`)
2. `get_element_info` ×4 (user: stop)
3. `click` ×2 on Zhihu (`textarea.Input`, `.WriteIndexLayout textarea`) — both `Element not found`
4. **then** osascript, with the model citing Rule 8
5. `host_computer` only after the user said so (and Chrome was not initially in the app whitelist)

Prompt-only W5 cannot stop **successful** last-resort once the model believes CDP is dead. Schema/prompt lock-step would still allow 81 if each call is a new expression that returns `success:true`.

### Auto-approve mechanism is wrong in RC4 `[inspected]` + `[executed]`

Diagnosis: `security.auto_approve_dangerous: true` → both evaluate and osascript skip confirm.

Actual L2 algebra (`l2-admission.ts:845-872, 782-786, 94-105`):

- `evaluate` / `osascript_eval` are `capabilityForceConfirm`.
- Domain whitelist **does not** auto-approve osascript (url is not a trust anchor).
- `auto_approve_dangerous` **or** `allow_all_schemes` sets `skipConfirmation`, but `forceConfirm` still queues the dialog **unless** `isFullAutonomyCruise` (dangerous **and** enterprise **and** `allow_all_schemes`).

This user’s `config.json` `[executed]`:

```json
"security": {
  "auto_approve_dangerous": true,
  "allow_all_schemes": true,
  "auto_approve_enterprise_tools": true
}
```

Cruise is on → L2 waived. RC4’s **outcome** (osascript was free) is true **for this user**. RC4’s **mechanism** (`auto_approve_dangerous` alone) is false. Community default (all three false) would have produced **81 Confirm Center dialogs**, which is a different, self-limiting failure mode.

Nit for implementers: do not build W3 around `auto_approve_dangerous`. Gate last-resort even under cruise, or the unattended profile will always reproduce a7ubt9.

---

## Attack 3 — Would W3’s osascript-on-http(s) block break legitimate flows?

Diagnosis attack list #2: iframe / `file:` / extension page.

**Those examples are the wrong ones.** W3 as written only blocks **http(s) DOM when CDP tools exist**. `file:` and extension pages would still get osascript. Safari is not a current `osascript_eval` target (`tell application "Google Chrome"` in `companion-dispatch.ts:1134-1149`). iframe is not specially helped by AppleScript (top-tab `execute t javascript`).

**The legitimate flow W3 would break is this thread**, and the catalog’s own last-resort sentence.

| Flow | W3 http(s) block | Notes |
|------|------------------|--------|
| a7ubt9 Zhihu writer (`https://zhuanlan.zhihu.com/…/edit`) | **Breaks** | CDP `evaluate` → null; `click`/`press_key` fail; osascript was the only JS that saw the editor. Publishing to 知乎 is the user goal. |
| Catalog “X.com CSP” last-resort | **Breaks** | The tool description *exists so that* http(s) pages can use osascript after evaluate fails. |
| CDP attach false-positive (`chrome-extension://` message on an https tab) | **Breaks** | `press_key` already dead; blocking osascript leaves **no** JS path. |
| `file:` PDF / local HTML | Unblocked | Out of W3 as specified. |
| Other-extension pages (`chrome-extension://gfbliohnn…/pdf_viewer.html`) | Unblocked | CDP cannot attach anyway; osascript matching that URL may or may not help. |
| Safari | N/A | Tool is Chrome-only. |

`[inspected]` `osascript_eval` is already L2, already excluded from domain whitelist, already macOS-only, already last-resort in two prompt surfaces. The missing control is a **budget / evidence gate**, not a scheme ban:

- Require a **typed CDP-failure token** in-session (evaluate exception, attach fail, injection fail) — **not** `{result:null}` success — before the first osascript on http(s).
- Cap osascript **count or identical-expression** per turn (and durable across user “继续”), even under cruise.
- Never treat “CDP tools exist in the catalog” as “CDP tools work on this tab”.

**Do not ship** “osascript blocked for http(s) DOM when CDP tools exist.” That converts last-resort into never-resort on the exact pages the tool was added for.

---

## Attack 4 — Is “element not found” recoverable actually correct?

**Keep recoverable. Do not flip to `non_recoverable`.**

### Why recoverable is still right `[inspected]`

- SPA / late paint: `click` already `waitForSelector` **3s** (`browser-bridge.ts:782-783, 1379-1392`) then still returns not-found. One more LLM retry with a different selector is the intended recovery.
- `get_element_info` does **not** wait; it `querySelector` and throws immediately (`:753-771`). Recoverable here means “try another locator”, not “wait for SPA”.
- Making it `non_recoverable` would `chat.error` the **whole turn** (`adapter.ts:1345-1355`). That is how ENOENT used to kill threads (`security.ts:1003-1005`). Download already chose typed `ELEMENT_NOT_FOUND` **without** killing the turn.

### Why recoverable did not cause a click storm on a7ubt9 `[executed]`

- 3 click failures total (1 CSS4 `i` flag on the Google blog, 2 on Zhihu). Model switched after 2 Zhihu misses.
- 4 `get_element_info` misses split **2+2** across user “继续” (`02:50:04` then `02:50:19` / `02:50:48`). Per-invocation cap of 3 **never fired**.
- The 3s wait already happened inside click. LLM-side recoverable is not “the SPA waiter”.

### Misleading error (more important than the classifier bit)

On Zhihu, osascript listed `textarea.Input` / `.public-DraftEditor-content` **and then** click returned `Element not found for selector: textarea.Input`. Same tab id. That is not “SPA not ready”. Click’s fallback (`scriptingExecute` + `querySelector`) returning false is reported as missing element even when the node exists in AppleScript’s world (iframe / isolated-world / attach flake). Download’s `ELEMENT_NOT_FOUND` + `user_hint_zh` + `suggested_action` is the right contract; flipping recoverability is not.

**W3 “max N identical locator fails”** is the useful piece, and it is **not** the existing cap:

| Existing cap | Needed |
|--------------|--------|
| Per **tool name** | Per **(tool, selector, tabId)** |
| Resets on **any** success of that tool (Escape `press_key` on the home tab reset the Zhihu attach-fail counter) | Must not reset across tabs / selectors |
| Per `chatCreate` | Durable across “继续” in the same thread |
| Only `success:false` | Also `{success:true, result:null}` for evaluate, and identical osascript expressions |

Without those, W3’s N-cap is a comment on a constant that already exists and already failed this trace.

---

## Attack 5 — `chrome-extension://`: recoverable or not?

**Do not make the substring `chrome-extension://` `non_recoverable`.** Typed `WRONG_ORIGIN` when `tab.url` *is* that scheme: yes. Classifier-string flip: no.

### Two different events in a7ubt9 `[executed]`

1. **True wrong origin** — PDF viewer `chrome-extension://gfbliohnnapiefjpjlpjnehglfpaknnc/pages/pdf_viewer.html?file=…` (tab 1492093878). `get_page_text` / scripting correctly refused. Recoverable + no `suggested_action: list_tabs` → hammer. Diagnosis RC5 is right **here**.
2. **False-positive attach** — Zhihu https tab 1492094083 (later 1492094087, even home tab 1492094074): `Debugger attach failed for tab …: Cannot access a chrome-extension:// URL of different extension`. `ensureAttached` wraps `chrome.debugger.attach` (`browser-bridge.ts:185-187`). `list_tabs` still shows `https://zhuanlan.zhihu.com/…`. The model noticed the contradiction. Osascript kept working on that tab.

If W3 marks any error containing `chrome-extension://` as non-retry / `non_recoverable`:

- (1) PDF: good (stop hammering).
- (2) Zhihu editor: **kills the turn** while the user still wants to publish, and while osascript is live. That is worse than the storm.

`cannot access` is also recoverable (`security.ts:964`) and would still match the PDF error if only the scheme token is flipped.

**Correct machine shape:**

- If `chrome.tabs.get(tabId).url` starts with `chrome-extension://` (and is not *this* extension): typed `WRONG_ORIGIN`, `suggested_action: list_tabs`, **do not retry CDP on that tabId**. Classifier can be `recoverable` with a **tabId-level** denylist for the rest of the turn (not conversation-killing `non_recoverable`).
- If attach throws that message on an **http(s)** tab: typed `CDP_ATTACH_FAILED`, suggest `list_tabs` / do not retry `press_key`/`click` on that tab — **do not** block osascript, **do not** `chat.error` the thread.

RC5 is real. W3’s “`chrome-extension://` non-retry typed error” is only safe if it is **origin-checked**, not substring-classified.

---

## Attack 6 — Model ignoring prompts?

Not the leading cause. The model:

- Cited Rule 8 before the first osascript `[executed]`
- Avoided `host_computer` until the user asked (Rule 12b + no Chrome app token at first)
- Stopped `get_element_info` when told
- Kept using osascript because **it was succeeding**

DeepSeek-v4-flash (`config.json` `model_name`) will ignore weak prose under tool-choice pressure; that is why W5-only is rejected. It is not why 81 happened. A better prompt that says “max 3 osascript” without a machine counter will lose the same way D1 already recorded: schema wins.

---

## What to keep from the diagnosis

- **W1** (text locator + `ELEMENT_*` like download) is still the highest-leverage L1 fix. Not in scope of this review, not falsified.
- **W5 must lock-step with schema**, never instead of a gate. Agree.
- Bare click / `get_element_info` errors without `error_code` / `suggested_action` are a real contract gap (RC3 **as a locator-tool bug**, not as the 81 cause).
- Do **not** make `host_computer` the default web path (Trust: L2 pixels on the Chrome window). Agree; a7ubt9’s one `host_computer` also failed.
- Existing `MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3` proves the project already believed in a machine loop guard. It is the wrong keying, not the wrong idea.

## MUST FIX before anyone implements W3

Blocking for the W3 row as written. Non-blocking for “wave 1 has a machine gate”.

1. **Drop** “osascript blocked for http(s) DOM when CDP tools exist.” Replace with: evidence-gated last-resort + count/expression cap, live under cruise.
2. **Do not** explain 81× osascript as recoverable-not-found. Instrument: `success:false` vs `success:true` vs `result:null`. Treat evaluate-null as a **first-wave typed honesty bug** (sibling of W3, possibly cheaper).
3. **Do not** flip `chrome-extension://` or `element not found` to `non_recoverable`. Typed errors + per-(tool,selector,tab) cap + tabId denylist.
4. **Do not** attribute L2 skip to `auto_approve_dangerous` alone. Three-flag cruise is the skip. W3 must bite **with cruise on**, or this user env will not change.
5. Key the N-cap so that success on **another tab** does not reset failures on the dead tab, and so that user “继续” does not reset identical locator fails.

## Nits (non-blocking)

- Diagnosis RC4 “click requires selector; architecture shows text” is true and is **W1/W5**, not W3. Do not overload W3 with catalog copy.
- `not found` as a recoverable substring is extremely broad (`security.ts:959`). Tightening it is a separate classifier audit; not required to accept W3-intent.
- Disk redaction of successful osascript (`redacted:true` in thread JSON) is confusing to *later* turns; in-flight LLM rows stay raw (`adapter.ts` SEC-C comment). Secondary amplifier, not the 81 cause.
- `docs/GOAL.md` still says osascript is released only by the global auto-approve switch. Stale vs three-flag cruise. Docs nit.

---

## Answers to the diagnosis attack list (this lane)

| # | Question | Answer |
|---|----------|--------|
| 2 | Would W3 osascript-block on http break a legitimate use? | **Yes — this trace, and X.com CSP as documented.** `file:` / Safari / extension-page examples are not the risk. |
| — | Is “element not found” recoverable correct vs the storm? | **Correct for SPA / other-selector. Not the 81 storm. Do not flip.** Need structured `ELEMENT_*` + identical-locator cap. |
| — | `chrome-extension://` non_recoverable? | **No as a substring.** Yes as typed `WRONG_ORIGIN` when `tab.url` is actually that scheme. Attach false-positive on https must stay a different, non-fatal code. |

---

## Bottom line

Retry-storm **of failed locators** is real, small (17 failures), and already half-gated by a cap that keys the wrong thing. Last-resort-in-prose is real and will not hold a model that has a working L2 clone. **W5-only is correctly rejected.**

The 81× histogram is **not** that retry-storm. It is last-resort **succeeding** under full-autonomy cruise after evaluate lied (`result:null`) and CDP attach lied (`chrome-extension://` on https). A first-wave machine gate is still the right move. The gate is: **typed failures, per-locator/tab caps that survive “继续”, evaluate-null honesty, and an osascript budget that still allows http(s) when CDP is actually dead.**

W3 as a row in the diagnosis table must be rewritten before implementation. W3 as “don’t ship prompt-only” stands.

**VERDICT: APPROVE_WITH_NITS**
