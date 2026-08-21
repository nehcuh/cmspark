# Adversary review (cross-surface) — web act-loop diagnosis

**Reviewer**: independent ADVERSARY / cross-surface skeptic (did **not** write the diagnosis)  
**Subject**: `docs/audit/reviews/web-act-loop-diagnosis-20260821.md`  
**Date**: 2026-08-21  
**Blast**: T2 direction-lock (L1 browser Surface). No implementation in this document.  
**Evidence**: `[inspected]` source + catalog + sibling reviews; no a7ubt9 replay this lane.

Attack charter: similar act-loop holes **outside** browser click; whether “download has the contract, click doesn’t” is the right generalization; W2 vs CU observe→act unification; Trust (text-click ≠ evaluate-without-L2); missed `fill_form` / `hover` / `drag` / `press_key` / `analyze_image`.

Ranking this lane is allowed to accept/reject: **W1+W3 first, W2 second, not host_computer-as-web-default.**

---

## Capability declaration (checked against diagnosis)

```text
Surface:      L1 browser CDP (click/type/read); host_computer remains L2 last resort
L2-classes:   none new; evaluate / osascript_eval / shell_exec already L2
Compose:      none
Autonomy:     single
Trust:        monotonic — better locators MUST NOT skip L2 evaluate/osascript;
              click stays L1 (not promoted into L2_GATE_TOOLS)
Channel:      community
```

Axes fit. This is a **Surface L1 primitive gap**, not a new runtime, not Pack chrome, not CU-as-default. Diagnosis correctly refuses default-on `host_computer` for web.

---

## Verdict in one paragraph

The diagnosis’s ranking is right: **W1 + W3 first, W2 second, do not make `host_computer` the web path.** RC1 (CSS-only locators) and RC4 (last-resort is prose; auto-approve makes osascript a free CDP clone) are the real a7ubt9 engine. RC7’s exemplar is too narrow. The bigger pattern is **not** “download has ELEMENT_*, click doesn’t” — it is **locator tools have no shared resolver, and several of them lie `success:true`**, while `classifyError` marks bare `"not found"` recoverable with **no next action**, and the existing per-tool cap (`MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3`) **resets on tool hop** so the storm is click → evaluate → osascript → `shell_exec`. Copying download’s contract onto `click`/`type`/`get_element_info` only will leave `hover` / `fill_form` / `type`’s click-to-focus as silent no-ops. W3 must **not** be a second per-tool-name cap (that already exists and did not stop 81 osascript). W2 is the L1 source of truth, not gold-plating, but **unifying** it with the CU 12b playbook would be the wrong Surface. Text-click is L1 iff it reuses the bounded finder IIFE; routing `text` through the `evaluate` tool is a Trust fail.

**VERDICT: APPROVE_WITH_NITS** on the recommended ranking. Nits below are direction constraints for implementers, not a reject of W1+W3-first.

---

## 1. Findings

### BLOCKER

None on the ranking itself.

I tried to turn (a) “W1 as written is only three tools”, (b) “W3 duplicates the existing 3-fail cap”, (c) “W2 should be wave-1 because icon buttons”, (d) “evaluate-as-click is the intended L2 path” into blockers. (a) and (b) are **nits that change W1/W3 shape**, not the ranking. (c) fails: the finder already reads `aria-label`/`title`/`value`. (d) fails: `evaluate` is L2 (`l2-admission.ts:50`); with `security.auto_approve_dangerous` it is the **escape hatch**, not the design.

---

### NIT-1 — RC7 exemplar is too small; the module boundary is “every CSS locator”, not “click vs download”

**Evidence** `[inspected]`

Catalog CSS-required (or CSS-only) tools in `companion/src/bridge/tool-definitions-catalog.json`:

| Tool | Locator params | Required | Runtime |
|------|----------------|----------|---------|
| `click` / `dblclick` | `selector` | yes | `browser-bridge.ts:777-811` — bare `Element not found for selector:` |
| `get_element_info` | `selector` | yes | `:771` throw `Element not found:` |
| `type` | `selector` optional | no | `:813-836` — **always `success:true`** |
| `fill_form` | `fields[].selector` | yes per field | `:839-868` — click then insertText; **always `success:true`** |
| `hover` | `selector` | yes | `:1153-1166` — **always `success:true`** even if scripting fallback returns `false` |
| `drag_and_drop` | `from_selector`, `to_selector` | yes | `:1186-1201` — `getElementCenter` throw, no ELEMENT_* |
| `select_option` | `selector` | yes | `:1168-1183` — `'Select not found'` |
| `wait_for` | `selector` optional | selector **or** network_idle | `:1206-1242` — 15s poll then `Timeout waiting for selector` |
| `upload_file` | `selector` | yes | `:1288-1307` |
| `analyze_image` | `selector` | yes at runtime (`:438-439`) | `"Element not found: " + selector` inside CDP (`:459`) |
| `get_page_html` | `selector` optional | no | scope only |
| `browser_download` | `selector` **or** `text` | one of | `ELEMENT_NOT_FOUND` / `ELEMENT_AMBIGUOUS` + `user_hint_zh` + `suggested_action` |

Finder comment already says “future click({text})” (`find-element-by-text.ts:1-3`) and is wired **only** to download (`browser-download-handler.ts:11,140-186`). Plan D10 leftover is real.

Diagnosis W1 names `click`/`type`/`get_element_info` only. That is the **incident histogram** (3 clicks), not the **primitive set**.

**Inference**

“Download has the contract, click doesn’t” is a good **story**. The engineering generalization is: **one `resolveLocator({selector?, text?, exact?})` + one fail-closed ELEMENT_* envelope**, used by every tool that today calls `document.querySelector` / `getElementCenter`. Wave-1 does **not** have to add a `text` param to `analyze_image` / `upload_file` / `wait_for`. Wave-1 **does** have to stop **liar success** on `hover` / `type` / `fill_form` and stop bare-string miss on `click`/`dblclick`/`get_element_info`/`drag_and_drop`/`select_option`. Otherwise the next 知乎/X thread is `fill_form` + `hover` submenu, same storm, “we already shipped click({text})”.

**Ask**: extract the module now (same PR as W1). Wire **error contract** to all locator tools. Ship **`text` param** first on `click`/`dblclick`/`hover`/`type`/`get_element_info` (hover is how X/知乎 overflow menus appear). `fill_form` fields should accept `text` **or** `selector` in the same wave if cheap; if not, they must still surface click-failure instead of `success:true`.

---

### NIT-2 — Missed bigger pattern: liar `success:true` is worse than click’s bare error

**Evidence** `[inspected]` `browser-bridge.ts`

```1153:1166:chrome-extension/src/background/browser-bridge.ts
  private async hover(...) {
    try { /* getElementCenter + mouseMoved */ }
    catch {
      if (params.selector) {
        await this.scriptingExecute(tabId, `...querySelector...return true}return false})()`)
        // return value ignored
      }
    }
    return { success: true }
  }
```

`typeText` (`:813-836`): if `selector` is set it `await this.click(...)` and **does not inspect** the click `ToolResult`. CDP `Input.insertText` catch → `el.value = …` on `INPUT`/`TEXTAREA` only; return value ignored; **always `success:true`**. Diagnosis RC6 is real and **secondary**; the silent success is primary — the model never enters the recoverable cap.

`fillForm` (`:843-868`): `await this.click({ tabId, selector: field.selector })` then keys + `insertText`; **always `success:true`**. Draft.js/知乎: click misses, form still “succeeds”, agent publishes empty.

Contrast `scroll` (`:1105-1115`): `success:true` **with** `moved=false` and “Do NOT claim the page scrolled”. That honesty exists; click-family never copied it. Diagnosis RC7 table mentions scroll honesty vs click; it **misses** that hover/type/fill are **dishonest successes**, which never increment `recoverableFailureCounts`.

**Inference**

a7ubt9 `click ×3 all failed` is visible because click still returns `success:false`. The 81 osascript / 54 `shell_exec` are what you get when the L1 tools either error without a next action **or succeed without doing the thing**. W1 that only adds `text` to click, without flipping hover/type/fill_form to fail-closed, leaves the cheaper lie in place.

**Ask**: W1 acceptance = (text locator on click) **and** (hover/type/fill_form return `success:false` + ELEMENT_* / `TYPE_TARGET_NOT_EDITABLE` when they did not act). Do not treat scroll’s warning-on-success as a model for click-family; fail closed.

---

### NIT-3 — W3 must not be another per-tool-name cap; the storm is cross-tool hop + success:true bypass

**Evidence** `[inspected]` `companion/src/llm/adapter.ts`

- `MAX_TOOL_CALL_ROUNDS = 100` (`:137`) — spend cap, not a locator policy.
- `MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3` (`:152`, applied `:1358-1374`) — **per `toolName`**, map created per chat invocation (`:834`).
- Success **deletes** that tool’s counter (`:1271-1274`).
- `classifyError` (`security.ts:950-1038`) marks `"element not found"`, `"not found"`, `"cannot access"`, `"chrome-extension://"`, `"timeout"`, `"eperm"`, `"access denied"` all **recoverable** — feed back to the LLM (`adapter.ts:1358`).
- `shell_exec` close path is **`success:true`** on non-zero / timeout / abort so the agent can read stdout (`capability/shell.ts:603-622`). Those 54 calls **never hit** the 3-fail cap.
- `hover`/`type`/`fill_form` same: success → counter reset.

a7ubt9 histogram (diagnosis): `osascript_eval` 81, `shell_exec` 54, `evaluate` 26, `click` 3. That is **compatible** with a working per-tool cap: click dies at 3, agent hops. 81 osascript implies **many user turns or many successes** (AppleScript JS “worked” as a CDP clone under auto-approve).

**Inference**

Diagnosis RC3 (“recoverable without next action = retry storm”) is **directionally true** and **mechanically incomplete**. Click does not wait forever; `waitForSelector` is 3s (`browser-bridge.ts:782-784,1379-1392`), dispatch timeout is 15s (`tool-forward.ts:20`). The loop is 100 rounds. Meeting-STT “infinite wait” is the wrong literal analog (see NIT-6). The missing machine gate is:

1. **Typed error + `suggested_action`** (download / MCP `enhanceMcpError` already do this).
2. **Fingerprint identical locator across tools** (`click`/`get_element_info`/`hover`/`evaluate` with the same selector/text) — N across **names**, not per name.
3. **osascript (and evaluate-as-click) blocked for http(s) page JS when L1 CDP tools exist** — this is the actual 81-call stopper.
4. Do **not** flip `chrome-extension://` to `non_recoverable`. That kills the turn before `list_tabs`. Typed `WRONG_ORIGIN` + `suggested_action: list_tabs`, recoverable **once per tabId**, then stop that tab.

**Ask**: W3 spec = (2)+(3)+typed WRONG_ORIGIN. Explicitly **not** “raise MAX_SAME_TOOL_RECOVERABLE_FAILURES”. Residual: `shell_exec` `osascript -e` bypasses an `osascript_eval` HTTP block (both L2; auto-approve skips both). Do **not** parse shell argv in wave-1. Document as residual under auto-approve; the real cost of god-mode.

---

### NIT-4 — Trust: `click({text})` must stay L1 bounded finder; must not become evaluate-without-L2

**Evidence** `[inspected]`

- `click` is **not** in `L2_GATE_TOOLS` (`l2-admission.ts:49-67`). `evaluate` and `osascript_eval` are.
- Current click **already** runs a bounded `Runtime.evaluate` IIFE via `getElementCenter` (`browser-bridge.ts:1395-1413`) — L1 CDP, model does not supply JS.
- Download text path: `JSON.stringify` needle into `buildFindByTextExpression` (`find-element-by-text.ts:32-34`), `classifyTextMatchCount` fail-closed at `count !== 1` (`:93-97`, handler `:154-186`). Ambiguous → `suggested_action: disambiguate_selector_or_exact_text`, **no auto-pick**.
- Side-effect attribute `data-cmspark-dl-hit` (`find-element-by-text.ts:13,84-86`) is download-namespaced. Reusing it for general click races a concurrent `browser_download`.
- Prompt rule 8 already **prefers evaluate** over osascript for reading (`adapter.ts:463-467`). Models already treat evaluate as click. Auto-approve makes that L2-free in practice (diagnosis RC4) — **do not encode that as the W1 path**.
- Navigate/create_tab/set_tab_url still own the URL gate. Click-as-link-navigation is a **pre-existing** L1 side effect (CSS click already follows `<a>`). Text click must not add a new skip; it also must not be “fixed” by stuffing click into L2.

**Inference**

Attack 4 (“is evaluate-as-click the intended path?”): **No.** Intended path is L1 locator. Evaluate-as-click is what you get when L1 cannot locate and L2 is auto-approved. W1 success criterion: a 知乎/X click works **without** `evaluate`/`osascript_eval`. If implementation injects `params.text` into `evaluate({code})` or `osascript_eval`, that is a Trust regression — REJECT at PR review even if the ranking here is APPROVE_WITH_NITS.

Fail-closed `ELEMENT_AMBIGUOUS` is non-negotiable (download D lock, diagnosis attack 6). Substring `exact=false` on a timeline of “赞” / “回答” will otherwise click the wrong row.

**Ask**:

- Reuse finder IIFE in the **extension** click path (coords or a **new** `data-cmspark-hit` attr, not `dl-hit`).
- `text` is a string needle only; keep `JSON.stringify`.
- Do not add `click` to `L2_GATE_TOOLS`.
- Do not skip domain confirm on `navigate` (unchanged).
- Catalog + architecture.md:305 `click("员工管理")` must match schema in the same PR (diagnosis W5 lock-step; D1: schema wins).

---

### NIT-5 — Do not unify W2 with host_computer 12b; W2 waits as L1 SoT, not as CU-for-web

**Evidence** `[inspected]`

- 12b (`adapter.ts:447-451`): observe→act→observe for **coordinate CU**, last-resort pixel/OCR, aggregate injective steps, never claim 已完成 unless verified.
- Web prompt (`:454-467`): “You control a real Chrome browser” + `list_tabs` + `get_page_text`. **No** snapshot-before-click. Diagnosis RC2 is correct.
- `host_computer` catalog (`tool-definitions-catalog.json:1322-1353`): whitelist app + **always** task L2 (god-mode does **not** skip) + OCR `target` + pixel `x,y` + budget 15/30 + `InjectionRateLimiter` (`computer/rate-limit.ts:13-14`, 30/60s). That is a different Trust class.
- CU already has NL `target` (OCR). Web L1 has **no** uid list. Playwright / chrome-devtools MCP snapshot→uid→click is the structural analog, **not** `host_computer describe`.
- Finder `ownText` includes aria-label (`find-element-by-text.ts:52-54`) — icon buttons with names work without snapshot. Shadow DOM / unnamed icons / virtualized cells do not.

**Inference**

Should W2 wait because CU already has observe→act? **Wait, but not because of CU.** Wait because W1+W3 absorb an **existing** finder + stop the hop; snapshot is a **new** primitive (token size, shadow DOM, iframe). Unifying playbooks in the **prompt** (paste 12b onto web) without a snapshot tool is diagnosis W5 without schema — D1, will fail again. Unifying playbooks in the **runtime** (web default = `host_computer` on the Chrome window) is L2 pixels on a Surface that already has CDP — **reject**, same as diagnosis last paragraph.

W2 is not gold-plating. It is the L1 SoT for “observe before act”. Rank it **second**, not “later if we feel like it”, and **do not** implement it as CU.

**Ask**: wave-2 `snapshot_page` returns interactive role/name/uid (cap size). `click({uid})` / `click({text})` share the same fail-closed resolver. Prompt observe→act **lock-steps** with that tool, never with 12b copy-paste. Optional: `get_page_text` is not an observe step for controls (RC2 remains until W2).

---

### NIT-6 — Sibling surfaces: MCP/STT/CU already have “typed failure + next action”; ACP/shell are different holes

Cross-surface check (diagnosis attack 5). All `[inspected]`.

| Surface | Timeout vs infinite | Typed error + next action | Recoverable-without-hint? | Same hole as click? |
|---------|---------------------|---------------------------|---------------------------|---------------------|
| **browser_download** | waiter + busy flag | `ELEMENT_*` + `user_hint_zh` + `suggested_action` | No (contract exists) | **The template to copy** |
| **MCP filesystem** | MCP timeout wrapped | `enhanceMcpError` (`mcp/dispatch.ts:405-478`): retry once / mkdir / list parent / ask allow-dir. Access denied → L2 allow-dir expand **then one retry** (`:271-289,306-389`) | `"access denied"` still in `classifyError` recoverable (`security.ts:1035`) if user **declines** — residual identical retry | **Ahead of click.** Pattern to copy: wrap + one structured retry, not silent recover. |
| **Meeting STT (this week)** | Was infinite wait on missing `voice.stt.end` ACK; patched wall timeout + 20s failsafe + typed `infer_timeout` (`docs/audit/reviews/meeting-mcp-packaged-hang-adversary-mcp-20260821.md`) | Typed codes (`infer_timeout` / `empty_result`) + copy “shorten and retry” | Partial timeouts are **soft**; streak then hard stop | **Analog at policy layer only.** Click **tool** is already 3s+15s bounded. Click **loop** sprays because errors are recoverable prose. Do not “add a wait timeout to click”; add **typed next action** like STT added codes instead of hanging. |
| **host_computer** | Task budget + 60s injection rate limit (`computer/rate-limit.ts`) | Catalog: “typed error … do NOT retry in a loop” (`tool-definitions-catalog.json:1323`) + 12b observe | `"outside client rect"` / `out_of_bounds` recoverable (`security.ts:987-988`) **on purpose** (re-locate) | Observe discipline exists; **do not import as web default**. Recoverable near-miss is OK when the tool returns coords; click returns no match list. |
| **shell_exec** | Wall `timeoutMs` clamped; kill tree (`capability/shell.ts:488-548`) | `timed_out` / `aborted` / `exit_code` on **`success:true`** (`:603-622`) | Never classified as tool failure → **no 3-cap** | **Sibling storm**, not locator. a7ubt9 54 calls are this bypass. W3 HTTP-osascript block does not stop `shell_exec osascript`. Residual, not wave-1 scope. |
| **ACP** | `session_timeout_ms` default 15 min then SIGTERM/KILL (`acp/manager.ts:650-704`); jsonrpc request 60s (`jsonrpc-stdio.ts:86-99`) | Progress “timeout — stopping…”; no ELEMENT_* | Different agent; companion does not locator-retry ACP | **Not the same hole.** Long-running CLI bound by session timer. Do not drag ACP into W1. |
| **press_key** | `ensureAttached` retries **10×500ms** if URL is `chrome-extension://` / `chrome://` / blank (`browser-bridge.ts:160-168`) then throws `Cannot access a chrome-extension://…` | Bare string; recoverable via `"cannot access"` and `"chrome-extension://"` (`security.ts:964,968`) | Yes — diagnosis RC5. Histogram press_key ×4 on extension tab | **Attach/origin**, not locator. W1 `text` does nothing. W3 typed `WRONG_ORIGIN` is the fix. Mini-hang: 5s poll on a tab that will **never** become http(s) (password manager / PDF extension). Cap attach retries when scheme is already `chrome-extension://`. |
| **analyze_image** | 15s dispatch; phase1→L2 image fetch (`image-fetch-admission.ts`) | `"selector is required"` / `"Element not found: "` — no ELEMENT_* | Yes, CSS-only, lower frequency | Same locator hole, **Trust already gated** on fetch. Wave-1.5: share resolver; do not skip image-fetch L2. |
| **wait_for** | Default 15s poll **equals** `TOOL_EXECUTION_TIMEOUT_MS` | `Timeout waiting for selector` → `classifyError` `"timeout"` recoverable | Yes | Can race the WS 15s timeout (two “timeout” meanings). W3 typed `WAIT_TIMEOUT` + `suggested_action: snapshot_or_get_page_text`. |

**Inference**

The org already learned this contract **four times** (download ELEMENT_*, MCP `enhanceMcpError`, STT typed codes, CU “don’t retry typed boundary”). Web click is the surface that did not absorb it. That **supports** W1 (copy download) and **rejects** inventing a fifth dialect. Do not add a new confirm family. Do not add a snapshot tool in wave-1 to “be like CU”.

---

### NIT-7 — W3 osascript HTTP block: legitimate leftovers (file:, iframe, extension page)

Diagnosis attack 2. `[inspected]`

- `osascript_eval` is macOS-only, L2, host execution — **does not take domain whitelist** (project A4⑤). Auto-approve is the only skip.
- Equivalent L1 path for **http(s) DOM** is `evaluate` (L2) or click/type (L1). Blocking AppleScript-JS **on http(s) tabs** when CDP attach works is correct.
- Keep osascript for: Mail/Notes/Finder (not DOM), `chrome://` / `chrome-extension://` **Chrome UI** (CDP cannot script other extensions — RC5), maybe `file:` if debugger attach failed.
- **iframe cross-origin**: neither CDP main-frame `querySelector` nor Chrome AppleScript JS on the front tab solves it. Do not sell W3 as iframe support. Out of scope.
- **Debugger already attached** by another tool: click already falls back to `chrome.scripting` (`:798-805`). Osascript is not required for that.

**Ask**: W3 gate = `osascript_eval` whose target is JS in an http(s) tab → hard error `OSASCRIPT_DOM_BLOCKED` + `suggested_action: use_click_or_evaluate`. Do not blanket-ban osascript. Do not mark `file:` the same without a measured attach-fail corpus.

---

### NIT-8 — RC1 is not overstated vs “model too dumb / Zhihu anti-bot”

Diagnosis attack 1. `[inspected]`

- Catalog `click.required = [tabId, selector]` (`tool-definitions-catalog.json:205-208`). The model **cannot** pass `text` even if it wanted to.
- Architecture example `click("员工管理")` (`docs/architecture.md:305`) and `type("#search", name)` + `click("搜索")` (`:310`) document an API that **does not exist**.
- CSS4 `i` flag in `a[href*="blog" i]` is not `querySelector` in this path (`getElementCenter` `:1402`). That is a runtime hole, not a dumb model.
- Finder exists, tests exist (`chrome-extension/tests/find-element-by-text.test.ts`), download uses it, click does not.

Anti-bot may still hide controls; that is **after** locators work. Histogram 3 clicks vs 81 osascript is what you see when the only L1 act primitive is “invent CSS for Draft.js”. RC1 stands.

---

## 2. Attack list (diagnosis §) — answers

| # | Attack | Answer |
|---|--------|--------|
| 1 | RC1 overstated vs dumb model / anti-bot? | **No.** Schema forbids text; docs lie; finder unused. |
| 2 | W3 osascript HTTP block break file:/iframe/extension? | Scope to **http(s) DOM JS**. Leave file:/chrome UI. iframe unsolved either way. |
| 3 | W2 wave-1 or gold-plating? | **Neither.** Second wave, L1 SoT. Not CU. Not skippable forever. |
| 4 | Missed evaluate-as-click as intended path? | **No.** That is the auto-approve escape. W1 must make it unnecessary. |
| 5 | ACP / CU / MCP / STT same recoverable-without-hint? | MCP/STT/CU/download **already wrapped**. ACP ≠ locator. **shell_exec success:true** is the sibling storm. |
| 6 | ELEMENT_AMBIGUOUS must not auto-pick | **Affirm.** Download lock. Substring on 赞/回答 will misclick. |
| 7 | Text click must not skip domain confirm; click stays not-L2 | **Affirm.** Bounded finder IIFE; not `evaluate` tool; not `L2_GATE_TOOLS`. |

Additional attack this lane: **RC7 too narrow.** Shared module **now**; liar-success tools in wave-1; W3 = cross-tool fingerprint + osascript HTTP block, not a fourth counter.

---

## 3. Ranking (this lane’s job)

| ID | Diagnosis rec | This lane | Why |
|----|---------------|-----------|-----|
| **W1** | First (with W3) | **Accept first**, with NIT-1/2/4 | Absorb finder + ELEMENT_* **module**; kill liar success; `text` on click/dblclick/hover/type/get_element_info. |
| **W3** | First (with W1) | **Accept first**, with NIT-3/7 | Machine hop-stop + osascript HTTP DOM block + typed WRONG_ORIGIN. Not another per-tool cap. |
| **W2** | Second (L1 SoT) | **Accept second** | Observe primitive. Do **not** unify with 12b / host_computer. Do **not** promote to wave-1. Do **not** drop. |
| **W4** | With W1 for 知乎 | **Accept with W1** | `type` contenteditable + fail if not editable. Required for Draft.js once locators work (RC6). |
| **W5** | Lock-step with schema | **Accept only lock-step** | Catalog/architecture/prompt same PR as W1. Prompt-only is D1. |
| **host_computer as web default** | Explicit non-goal | **Reject** | L2 pixels on Chrome; Trust + CU task L2 + rate limit are the wrong Surface. User-ordered CU in a7ubt9 is last resort, not the product. |

Non-goals (diagnosis) stand: no 中层 Agent, no vendoring chrome-devtools-mcp as the Side Panel loop.

---

## 4. Implementer constraints (non-blocking here; blocking at PR if ignored)

1. **Module**: `resolveLocator` + `classifyTextMatchCount` + ELEMENT_* envelope live in one extension module. Download keeps calling it. Click-family starts calling it. Do not fork a second finder.
2. **Liar success**: `hover` / `type` / `fill_form` must return `success:false` when the element was not acted on. Wave-1 gate.
3. **Trust**: `text` → JSON-stringified needle in the existing IIFE; never the `evaluate` tool; never skip L2 on evaluate/osascript; click stays off `L2_GATE_TOOLS`.
4. **Ambiguous**: fail-closed, return up to 5 match previews (download already does).
5. **Attr**: do not reuse `data-cmspark-dl-hit` for general click.
6. **W3**: identical-locator fingerprint **across** click/get_element_info/hover/evaluate; `OSASCRIPT_DOM_BLOCKED` for http(s); `WRONG_ORIGIN` + `list_tabs` for `chrome-extension://` (still recoverable once). `ensureAttached` should not 10-retry a URL that is already `chrome-extension://`.
7. **W2**: new tool later; prompt observe→act only when the tool exists. No CU playbook paste.
8. **Residual documented**: `shell_exec` as osascript bypass under auto-approve; iframe; unnamed icon without aria (needs W2).

---

## 5. What this lane did not do

- Did not replay `~/.cmspark-agent/threads/a7ubt9.json`. Histogram and user interventions taken from the diagnosis.
- Did not execute tests. `[inspected]` only.
- Did not re-review the meeting hang **diff**; used the same-day adversary notes for the timeout-vs-infinite analog.

---

VERDICT: APPROVE_WITH_NITS
