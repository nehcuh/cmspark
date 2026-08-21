# Adversary review — web act-loop W3′ numbers + origin typing

**Date**: 2026-08-21  
**Role**: Independent adversary (budget / origin-typing skeptic). Did **not** write the spec, the diagnosis, or the direction fold.  
**Target**: `docs/superpowers/specs/2026-08-21-web-act-loop-design.md` §5 (W3′)  
**Question**: is W3′ **as specified** shippable, or only the intent?  
**Trace**: `~/.cmspark-agent/threads/a7ubt9.json` (466 messages)  
**Prior lane**: `web-act-loop-adversary-policy-20260821.md` (rejected old W3 scheme-ban; demanded evidence-gated last-resort + success-loop budget under cruise). This lane attacks the **numbers and types** that replaced that ban.

```text
Surface:      L1 browser CDP; evaluate / osascript_eval / shell_exec stay L2
L2-classes:   none new
Compose:      none
Autonomy:     single
Trust:        monotonic — budget is not an L2 skip; last-resort stays L2
Channel:      community
```

## VERDICT: REJECT

Keep W3′ **intent** (typed origin/attach, evaluate honesty, success-loop machine gate, no http osascript ban, do not raise `MAX_SAME_TOOL_RECOVERABLE_FAILURES=3`). **Reject W3′ as specified.** The constants and types would not have stopped a7ubt9, would mislabel the evaluate-null that caused the hop, and would false-positive / false-negative on origin and shell in ways the spec itself listed and then under-specified.

| Claim in spec §5 | Result |
|------------------|--------|
| `DOM_SCRIPT_SUCCESS_LOOP_MAX = 8` on `(family, exprHash, tabId)` stops the 81× success loop | **Falsified** — 81 osascript calls, **78 unique** `redacted:hash` values, max repeat **2**. Cap never fires. |
| Thread-level (not per-`chatCreate`) is the right durability | **Holds** — and is not enough without a **family/tab ceiling** + persistence |
| evaluate `empty_completion` vs thrown is enough honesty | **Falsified** — `document.title` and `1 + 1` returned `{success:true, result:null}`. That is not “no completion value”. |
| `WRONG_ORIGIN` on `chrome-extension:` / `chrome:` / `edge:` / `devtools:` | **Partial** — right for a7ubt9’s PDF viewer; **under-kills `file:` PDF** and plugin documents whose `tabs.get` url is still `file:`/`https:` |
| shell heuristic fail-closed | **Over-counts** `powershell`+`chrome` (`Start-Process chrome`); **under-counts** `cscript`/`pwsh`/file-backed osascript |
| Three-flag cruise still counts | **Holds as a sentence**; **fails as a gate** because unique hashes under cruise still run to 81 |

Do not implement §5.3–5.4 until the MUST FIX list lands in the spec. W1 / liar-success / no-http-ban are out of this lane and are not rejected here.

---

## Method

Tried to **falsify** spec §5 against:

- `companion/src/llm/adapter.ts` — `MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3` (`:152`), `recoverableFailureCounts` **local to `chatCreate`** (`:834`, success `delete` `:1271-1274`, cap `:1358-1374`)
- `companion/src/security.ts` `classifyError` — substring list + **default `non_recoverable`** (`:918-1046`)
- `chrome-extension/src/background/browser-bridge.ts` — `ensureAttached` (`:153-188`), `safeEvaluate` (`:675-701`), `evaluate` always `success:true` (`:1245-1282`), `click` catch relabel (`:797-808`), `pressKey` bare attach (`:1138-1150`)
- `companion/src/tool/l2-admission.ts` — `isFullAutonomyCruise` three-flag (`:94-105`); evaluate/osascript/shell L2 (`:49-55`, `:845-872`)
- a7ubt9 tool rows: osascript **81**, evaluate **26**, shell **54**; redaction hashes as the same 12-hex fingerprint the spec would hash

Evidence: `[executed]` thread JSON; `[inspected]` source; `[assumed]` Chrome PDF `file:` tab.url (not in this trace — this trace’s PDF was `chrome-extension://`).

---

## Attack 1 — `DOM_SCRIPT_SUCCESS_LOOP_MAX = 8` is the wrong shape, so 8 is both too high and too low

Spec §5.3: do **not** raise the existing fail cap; add a **success** counter keyed `(dom_script, sha256[:12](normalized expr), tabId)`; threshold **8**; same key then `DOM_SCRIPT_LOOP_CAPPED`.

### The existing cap still cannot see this storm `[inspected]`

Unchanged and correctly diagnosed:

- Map is **per `toolName`**, created **inside** `chatCreate` (`adapter.ts:834`).
- `success:true` **deletes** the counter (`:1271-1274`).
- `MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3` (`:152`) only counts `success:false`.
- a7ubt9 osascript `success:false` is **1/81** (tab URL miss). The fail cap cannot fire.

§5.3 is right to refuse “just raise 3”. The replacement keying is still a **per-identical-expression** cap. That is not the 81-call machine.

### Unique-hash cardinality `[executed]`

Thread redaction already stores `expression: "<redacted:hash=xxxxxxxxxxxx,len=N>"` — 12 hex, same width as spec `sha256[:12]`.

| Tool | Calls | Unique hashes | Max repeats of one hash |
|------|-------|---------------|-------------------------|
| `osascript_eval` | **81** | **78** | **2** (`03ef9ee848d8`, `c4fc7659d8ca`, `67cc2d005387`) |
| `evaluate` | **26** | **26** | 1 |

`MAX=8` on identical expr **never trips** on this trace. Volume is Draft.js incremental **new** scripts (probe → `focus()` → `execCommand('insertText')` with a new payload → `formatBlock` experiment → toolbar `.click()` → poll), not 81 copies of one expression.

Policy adversary already said the 81 were a **working-path** loop. Spec §5.3 answered with an **identical-hash** budget. Those are different gates. The identical-hash gate is the one that would have been a comment on a7ubt9.

### 8 is unmotivated, and the sign of the error depends on the missing axis

There is **no** derivation of 8 vs 3 vs 12. Existing fail cap is 3. `MAX_TOOL_CALL_ROUNDS` is 100. User turns in a7ubt9 were 10. 8 sits in the middle of nowhere.

| Use | 8 on identical key | What you actually need |
|-----|--------------------|------------------------|
| 81 unique osascript (this trace) | **too high / inert** (never fires) | **Family+tab (or origin) ceiling** on total `dom_script` successes |
| Same `el.click()` / same `insertText` 8 times | **too high** (8 identical mutations is a lot of damage) | Identical-key cap **3**, matching the fail cap |
| Same evaluate poll of “published?” or page 1..9 of a list | **too low** (spec’s own attack #2) | Read/poll exemption **or** a higher read cap; do not pretend 8 works for both |
| Windows after CDP dead: only evaluate | Identical-key 8 **kills the only fallback** if the model polls; unique-hash 8 **never kills** a unique-expr storm | Same two-axis budget, or Windows is strictly worse |

**MUST FIX:** two counters, both under cruise, both thread-durable:

1. **Identical key** `(family, exprHash, tabId)` success cap **`= 3`** (not 8). Same justification as `MAX_SAME_TOOL_RECOVERABLE_FAILURES`.  
2. **Family ceiling** `(threadId, tabId|origin, family=dom_script)` total successes **`≈ 24`** (clip a7ubt9; allow a real Draft.js multi-step). Reaching it → `DOM_SCRIPT_LOOP_CAPPED` for **any** expr on that tab, `suggested_action: stop_or_change_task`.

Without (2), cruise + unique hashes **reproduces 81**. Without lowering (1) to 3, eight identical “发布” clicks / eight identical `execCommand` are in-policy.

`规范化` is unspecified. If it is identity, `/*1*/` and a new insertText chunk both bypass (1). If it is aggressive minify, distinct scripts collide and trip (1) early. Spec the normalize (whitespace + comment strip **only**; **do not** strip string literals — that would collide every `insertText`).

DoD §10.7 only tests “same hash 8 then 9th capped; other tab ok; shell with osascript counts”. That test **passes on a design that fails a7ubt9**. Add: 9 **distinct** hashes on one tab trip the **family** ceiling; companion restart + 「继续」 still capped; osascript **without tabId** still keyed.

---

## Attack 2 — Thread-level vs `chatCreate`: keep thread, the spec still under-specs the store

**Keep thread-level.** `[inspected]` `recoverableFailureCounts` is a local `Map` inside `chatCreate` (`adapter.ts:834`). a7ubt9 has multiple user 「继续」 (e.g. `02:49:08Z`). A per-invocation cap would reset the way the fail cap already did.

That is necessary and **not sufficient**.

| Hole | Why it ships broken |
|------|---------------------|
| Persistence | `Thread` in `thread-manager.ts` has no counter field. In-memory Map dies on companion restart; 「继续」 after restart is a new `chatCreate` **and** a zeroed budget. Spec says 线程级; does not say JSON sidecar vs RAM. |
| `tabId` churn | Spec: 换 tabId 不受影响. a7ubt9 writer tab was `1492094083` then later ids; `create_tab` returns a new id. Family ceiling keyed only on tabId **resets mid-task**. Prefer `(registrable origin of tabs.get url)` with tabId as a secondary key, reset on **origin change**, not on tab recreate. |
| osascript has **no tabId** | a7ubt9 first 81-path calls are `{url: "zhuanlan.zhihu.com/write", expression}` — no tabId. `key = (family, exprHash, tabId)` with `tabId=undefined` either buckets **all** url-less osascript together or **never** collides. Spec must resolve `url` → tab via cache **before** hashing the key. URL fragment also changed `/write` → `/p/207…/edit` on the same document. |
| No TTL / new-task reset | A week-old thread + same Chrome tab + same `document.title` evaluate is a false cap. Reset family ceiling on **user-visible new task** is out of scope; at least reset on origin change. |
| Workers | `spawn_worker` new `threadId` zeros the budget. Acceptable if Autonomy stays single; say so. |

**MUST FIX:** persist counters on the thread object (same durability as messages). Resolve osascript `url` → tabId/origin. Reset family ceiling on origin change, **not** on `chatCreate` and **not** only on tabId identity.

Do **not** revert to per-`chatCreate`. That is the one number-adjacent choice the spec already got right.

---

## Attack 3 — `empty_completion` vs thrown: two rows, three worlds, a7ubt9 used the missing one

Spec §5.2:

| 情况 | 形状 |
|------|------|
| 语句完成、无返回值 | `success: true`, `evaluate_kind: "empty_completion"`, `result: null` |
| attach/CSP/抛错 | `success: false`, `CDP_ATTACH_FAILED` or `EVAL_THROWN` |

### What evaluate actually did on the Zhihu tab `[executed]`

Assistant at `02:49:59Z` (tab `1492094083`, `https://zhuanlan.zhihu.com/…`):

- `code: "document.title"` → `{"success":true,"data":{"result":null}}` (redact hash `a37bf3152178`, len=14)
- next call `code: "1 + 1"` → same null (hash `72fce59447a0`, len=5)

Reasoning in-thread: 「连 `1+1` 都返回 null」→ CSP → Rule 8 last-resort → first `osascript_eval` at `02:53:45Z` which **returned live DOM**.

`1 + 1` is not a statement with no completion value. If `Runtime.evaluate` ran in the page, the completion is the number `2`. `document.title` is never `undefined` on a real document. **Null here means the JS did not run in that page’s world** (attach to the wrong document, empty isolated world, or `safeEvaluate` fallback returning undefined without throw).

Classifying that as `empty_completion` **reproduces the a7ubt9 footgun**: success-shaped, model reads “evaluate is blocked/CSP”, hops to osascript. Spec §5.2’s whole point was to stop that hop.

### Live code still cannot tell these apart `[inspected]`

`evaluate()` (`browser-bridge.ts:1268-1282`):

- Always `success: true`.
- `result: result.result?.value` → `undefined` becomes JSON `null`.
- `exception` field is **dead**: `safeEvaluate` (`:683-688`) already **throws** on `exceptionDetails`.
- If CDP throws, `safeEvaluate` falls back to `scriptingExecute` (`:691-695`). Scripting that returns a frame with no `result` is treated as failure inside `hasUsableResult` (`:231-237`) and should throw `Script injection failed in both ISOLATED and MAIN worlds` (`:286`). So `1+1` → success+null is **not** that throw path. It is CDP returning a value-less result **without** `exceptionDetails`.

Needed **three** kinds, not two:

| World | `evaluate_kind` / `error_code` | `success` |
|-------|--------------------------------|-----------|
| Statement, CDP `type: "undefined"` **and** the source is statement-shaped (no completion expected) | `empty_completion` | true |
| JS **returned** `null` (`querySelector` miss, `type: "object"`) | `js_null` (or just `result: null` + `type`) | true |
| CDP `type: "undefined"` **but** the source is an **expression** (`1+1`, `document.title`) or attach/scripting is dead | **`EVAL_NO_WORLD`** (or `CDP_ATTACH_FAILED` if `tabs.get` + attach threw) | **false** |
| `exceptionDetails` / thrown | `EVAL_THROWN` | false |
| CSP / both-world injection fail | `EVAL_THROWN` or `SCRIPT_INJECTION_FAILED` — **not** empty_completion | false |

**MUST FIX:** `1 + 1` / `document.title` → **not** `empty_completion`. Do not count `EVAL_NO_WORLD` as a success toward §5.3 (spec currently counts empty_completion as success). Count it as a **typed failure** that **does** latch last-resort (see Attack 6), unlike honest empty_completion which **must not**.

DoD §10.8 (“空完成 success true；抛错 false”) does not mention `1+1` → false. That test would green-light the regression.

---

## Attack 4 — `WRONG_ORIGIN` schemes: a7ubt9 PDF is `chrome-extension:`; `file:` PDF is the miss

### Spec table (click catch only, if `tabs.get` works)

`chrome-extension:` · `chrome:` · `edge:` · `devtools:` → `WRONG_ORIGIN` + `list_tabs`  
`http(s)` + attach/scripting fail → `CDP_ATTACH_FAILED`  
else node missing → `ELEMENT_NOT_FOUND`

**Correct and required:** classify from `chrome.tabs.get(tabId).url`, **never** the substring `chrome-extension://` on the error string. Policy lane already falsified that substring against this https Zhihu tab (`press_key`: `Debugger attach failed … Cannot access a chrome-extension:// URL of different extension` while `list_tabs` showed `https://zhuanlan.zhihu.com/…`). `[executed]` `[inspected]` `ensureAttached:167-168` throws that string whenever **the tab url** is `chrome-extension:`; `pressKey:1142` then surfaces it on **https** if attach itself fails with Chrome’s own message. Origin check on `tabs.get` is the only safe discriminator.

### Would `WRONG_ORIGIN` 误杀 `file:` PDF? **No. It 漏杀.**

Spec §12.4 asked this. Answer with the actual PDF in this trace, then the scheme the spec omitted.

**This trace’s PDF `[executed]`** (tab `1492093878`):

```text
chrome-extension://gfbliohnnapiefjpjlpjnehglfpaknnc/pages/pdf_viewer.html?file=https://www.tomzahavy.com/files/llms-cant-jump.pdf
```

That **is** `chrome-extension:` → `WRONG_ORIGIN`. Right. Agent then used `shell_exec` `curl` + Python (not DOM inject). Heuristic must **not** count that curl (Attack 5).

**`file:` PDF is a different tab url.** Chrome often keeps `file:///…/doc.pdf` (or `https://…/doc.pdf`) as `tabs.get().url` while the pixels are a PDF plugin / built-in viewer. Spec does **not** list `file:`. Then:

- Origin looks “normal” (`file:` is not in the WRONG_ORIGIN column).
- Attach may **succeed** against an empty/plugin document.
- `querySelector` misses → **`ELEMENT_NOT_FOUND`** (row 3). Same honesty bug as RC5, different scheme.
- 5.4 last-resort needs `CDP_ATTACH_FAILED`. Attach succeeded → osascript **blocked**, click **lies** “not found”.

`file:` **HTML** with “allow file URLs” is a legitimate CDP target. Putting `file:` in the WRONG_ORIGIN column **would** 误杀. Do not.

**MUST FIX:** third origin class, not more schemes jammed into WRONG_ORIGIN:

| `tabs.get().url` | code | notes |
|------------------|------|-------|
| `chrome-extension:` `chrome:` `edge:` `devtools:` `chrome-untrusted:` `edge-extension:` `about:` (except maybe `about:blank` during create) `view-source:` | `WRONG_ORIGIN` | keep recoverable + `list_tabs` |
| `file:` / `http(s):` **PDF or plugin** (`Content-Type: application/pdf`, url path `.pdf`, or `navigator.pdfViewerEnabled` document that is not HTML) | `UNSUPPORTED_DOCUMENT` | `suggested_action: download_or_shell_extract` — **not** ELEMENT_NOT_FOUND, **not** WRONG_ORIGIN |
| `file:` HTML | **not** WRONG_ORIGIN | CDP may work |
| `blob:` / `data:` document | `WRONG_ORIGIN` or `UNSUPPORTED_DOCUMENT` | pick one; do not fall through to ELEMENT_NOT_FOUND |
| `http(s)` HTML + attach fail | `CDP_ATTACH_FAILED` | as specified |

`about:blank` during `create_tab` (a7ubt9 returned `url:""`) must **not** burn a WRONG_ORIGIN on a tab that will become https 500ms later. `ensureAttached` already waits 10×500ms (`:160-164`). Cap that wait when the scheme is **already** `chrome-extension:` (surface adversary NIT-6); do not wait 5s on a PDF viewer.

### 5.1 is specified on **click catch** only — that is the wrong consumer

a7ubt9’s attach lie was **`press_key`**, then click’s relabel. `pressKey` (`:1138-1150`) `sendCdp` → `ensureAttached`, no catch, no scheme table. `get_page_text` / `get_element_info` / `type` / `hover` same attach path.

**MUST FIX:** origin typing is a **pre-tool** on every CDP command (or inside `ensureAttached` / `sendCdp`), not a click-only matrix. Otherwise W3′ types the wrong tool and the storm moves one name over — the same hop `MAX_SAME_TOOL_RECOVERABLE_FAILURES` already lost to.

---

## Attack 5 — shell heuristic: `Start-Process chrome` is a real FP; a7ubt9’s 54 are mostly true negatives

Spec §5.3 counts `shell_exec` when argv/command contains:

- `osascript` / `osacript` / `execute javascript` / `chrome.automation`
- win32: `powershell` **and** (`chrome` **or** `javascript`)

Direction fold also named `cscript`. Spec **dropped** it.

### False positives (spec §12.3 — **yes**)

`Start-Process chrome`, `Get-Process chrome`, `Stop-Process -Name chrome`, `Start-Process "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"`, `cd C:\work\javascript && npm test` inside a `powershell -Command …` all match **powershell ∧ chrome|javascript**. Those are **not** DOM inject. Counting them toward a family ceiling (Attack 1) would cap a Windows “open Chrome then evaluate” playbook. Counting them toward an identical-key cap of 8 would cap `Start-Process chrome` after 8 launches.

`chrome.automation` is a Chrome OS accessibility API, not a shell idiom. Dead token.

Darwin `osascript -e 'display notification'` / Finder AppleScript **does** contain `osascript`. Fail-closed 偏计入 is acceptable **if** the family ceiling is origin-scoped to a Chrome tab; it is **not** acceptable if missing tabId buckets all osascript shell into one global key (Attack 2).

### False negatives

| Pattern | Spec | Reality |
|---------|------|---------|
| `cscript` / `wscript` / `mshta` hosting JS into Chrome | omitted (direction had cscript) | Windows DOM-inject bypass |
| `pwsh` vs `powershell` | miss | Win PS7 |
| `osascript /tmp/x.scpt` with JS only **inside the file** | command contains `osascript` → counted (ok) | hash of **command line** not file body; identical-key cap bypassed by rotating temp files |
| `python -c` selenium / `node` puppeteer | miss | out of wave-1 is fine; **say residual** |
| companion wraps `Start-Process chrome` **without** the word `powershell` in `params.command` | miss | depends on `shellExec` launcher |

### a7ubt9 54× `shell_exec` `[executed]`

Sampled: `curl` PDF download, `python3` pypdf probe, `cat > 知乎文章.md` heredoc, `printf … | pbcopy`. **None** of those strings need to match the darwin tokens. Good — a naive “all shell_exec” cap would have killed article writing.

**MUST FIX:** drop `powershell∧chrome`. Require a **DOM-inject** token: `execute javascript` / `osascript` / `osacript` / `chrome.debugger` / `Runtime.evaluate` / AppleScript `tell application "Google Chrome"` / `cscript`+JS. `Start-Process chrome` must **not** count. Put `cscript` back. Hash **resolved** script body when the command is `osascript file.scpt`. DoD: `Start-Process chrome` does **not** increment; `powershell -Command "Start-Process chrome"` does **not**; `osascript -e 'tell application "Google Chrome" to execute … javascript'` does.

---

## Attack 6 — Cruise + §5.4 latch: the budget as written still permits 81

Spec: 三旗巡航下照样计数. `[inspected]` `isFullAutonomyCruise` (`l2-admission.ts:94-105`) is the only skip for evaluate/osascript `forceConfirm`. a7ubt9 had all three flags (policy lane). Counting under cruise is **mandatory**. It does not matter if the counter never fires (Attack 1).

### 5.4 last-resort: `CDP_ATTACH_FAILED` only

「http(s) 不禁。在已返回 `CDP_ATTACH_FAILED` 之后允许；仍走 L2。计入 5.3。」

Timeline `[executed]`:

1. evaluate `document.title` / `1+1` → success+null (`02:49:59Z`) — **not** `CDP_ATTACH_FAILED` under §5.2 as written (`empty_completion`).
2. click `textarea.Input` / `.WriteIndexLayout textarea` → `Element not found` — after §5.1, this is **`ELEMENT_NOT_FOUND`** if attach did not throw into the new matrix, because `tabs.get` is **https** and the click catch today **swallows** attach and runs `querySelector` (`browser-bridge.ts:797-804`). Scripting false → row 3.
3. **first osascript** `02:53:45Z` — **before** `press_key` attach fail. Succeeded. This is the working path.
4. `press_key` later: attach fail with chrome-extension substring on an https tab → would be `CDP_ATTACH_FAILED` **if** 5.1 applied to press_key.

If implementers follow 5.1+5.2+5.4 literally, **the first osascript is illegal**: no `CDP_ATTACH_FAILED` yet, evaluate was “empty_completion”, click was ELEMENT_NOT_FOUND. That is the old W3 scheme-ban **in disguise** for the exact 知乎 write: last-resort locked until a tool that wasn’t typed yet happens to attach-fail.

If they type click’s swallowed attach as `CDP_ATTACH_FAILED`, latch opens and unique-hash osascript runs to 81 under cruise (Attack 1). Two failure modes, both ship-breaking; spec picks neither.

Latch **scope** is also missing: per tab? per thread? forever after one attach fail on **any** tab? A `WRONG_ORIGIN` on the PDF viewer tab must **not** unlock osascript on Zhihu. A stale `CDP_ATTACH_FAILED` must **not** outlive a successful attach on that tab.

**MUST FIX:**

- Latch is **per tabId (after url-resolve) + origin**, not thread-global.
- Unlock osascript on http(s) after **`CDP_ATTACH_FAILED` or `EVAL_NO_WORLD`** on **that** tab — **not** after `empty_completion`, **not** after `WRONG_ORIGIN` on a different tab, **not** after `ELEMENT_NOT_FOUND`.
- Clear latch when `tabs.get` origin is http(s) **and** a later CDP command succeeds.
- Family ceiling still applies under cruise once unlocked. Otherwise 5.4+unique-hash = 81 again.

---

## Attack 7 — `classifyError` default-kill (implementer trap, spec-adjacent)

Spec §9: error strings start with `CODE: …` so `"not found"` stays recoverable; new codes join the list **only when** the model should switch strategy; `DOM_SCRIPT_LOOP_CAPPED` is recoverable but same-key hard-reject.

`classifyError` (`security.ts:918-1046`): substring match, then **`return "non_recoverable"`**. `adapter.ts:1345-1355`: `non_recoverable` → **`chat.error` the whole turn**.

| New code | Matches today’s recoverable list? | Default effect |
|----------|-----------------------------------|----------------|
| `WRONG_ORIGIN` | no (`"chrome-extension://"` is on the **old message**, not the code) | **kills the turn** — the outcome policy lane forbade |
| `CDP_ATTACH_FAILED` | no (`"failed"` is not in the list; `"cannot access"` only if old prose is kept) | kill, unless suffix copies the old string |
| `EVAL_THROWN` | no | kill — model cannot rewrite JS |
| `EVAL_NO_WORLD` (needed, Attack 3) | no | kill |
| `DOM_SCRIPT_LOOP_CAPPED` | no unless added | kill vs spec “recoverable but same key hard-reject” |
| `UNSUPPORTED_DOCUMENT` | `"not found"` only if prose is sloppy | |
| `ELEMENT_NOT_FOUND` | **yes if** prose contains `"not found"` (`ELEMENT_NOT_FOUND`.toLowerCase() is `element_not_found` — **underscore, no space**). The **code token alone does not match**. Spec’s `CODE: …` trick only works if the human suffix still says `not found`. |

**MUST FIX:** name every new code in the recoverable list (or switch classifyError to **exact `error_code`**, which this wave should do anyway — substring `"not found"` is still a landmine). Spec §9’s “仅当” is how `WRONG_ORIGIN` ships as `chat.error`.

`DOM_SCRIPT_LOOP_CAPPED` recoverable + **same-key** hard-reject is coherent. It is **not** coherent if family ceiling is missing: the model changes one comment and continues (Attack 1).

---

## What to keep

- Do **not** ban osascript on http(s). Still true.
- Do **not** raise `MAX_SAME_TOOL_RECOVERABLE_FAILURES`. Still true.
- Do **not** substring-classify `chrome-extension://`. Still true.
- Thread-level durability (not per-`chatCreate`). Still true.
- Count under three-flag cruise. Still true as a requirement; the specified counter does not satisfy it.
- `WRONG_ORIGIN` from `tabs.get` for real extension/PDF-viewer tabs (a7ubt9 `gfbliohnn…`). Keep, extend the consumer set.
- shell in the `dom_script` family (direction nit). Keep the **idea**; replace the heuristic.

---

## MUST FIX before W3′ is implementable

Blocking for §5 as written. Non-blocking for “wave-1 has a machine gate”.

1. **Two-axis budget**, both cruise-live, both thread-persisted: identical-key cap **3**; family+origin ceiling **~24**. 8-on-identical-hash is inert on a7ubt9 (78 unique / max repeat 2) `[executed]`.
2. **Define normalize** (whitespace+comments only). Resolve osascript `url` → tab/origin before keying. Persist on the thread record. Reset family ceiling on **origin change**, not `chatCreate` / not tabId churn.
3. **Third evaluate kind** `EVAL_NO_WORLD` (or equivalent). `1+1` / `document.title` → `success:false`. Honest `empty_completion` stays success and **does not** latch last-resort.
4. **Origin matrix on all CDP tools**, not click catch. Add `UNSUPPORTED_DOCUMENT` for `file:`/`https:` PDF-plugin. Do **not** put `file:` HTML in `WRONG_ORIGIN`.
5. **5.4 latch** per tab+origin after `CDP_ATTACH_FAILED` **or** `EVAL_NO_WORLD`; not after `empty_completion` / other-tab `WRONG_ORIGIN`. Clear on later CDP success.
6. **Shell heuristic**: drop `powershell∧chrome`; restore `cscript`; do not count `Start-Process chrome`. Hash script file body when argv is a path.
7. **Put every new `error_code` in `classifyError` recoverable** (or classify by code). Default `non_recoverable` + `WRONG_ORIGIN` = `chat.error`.

## Nits (non-blocking)

- `chrome.automation` token is dead weight; delete or replace with `tell application "Google Chrome"`.
- `about:blank` wait vs WRONG_ORIGIN: reuse `ensureAttached`’s 10-retry only when url is blank, **not** when scheme is already `chrome-extension:`.
- DoD §10.7–10.8 as written will pass a wrong design; replace with unique-hash family ceiling + `1+1` → not empty_completion + `Start-Process chrome` non-count.
- Windows “8 too early on the only fallback” is real **if and only if** identical-key stays the only cap. Family ceiling + identical 3 is the same on win32/darwin (spec §8: no `if (darwin) cap`).
- `evaluate()` `exception` payload (`browser-bridge.ts:1277-1280`) is dead code today; do not spec around it.

---

## Spec §12 answers (this lane)

| # | Question | Answer |
|---|----------|--------|
| 2 | `MAX=8` 误伤「同一 evaluate 读 9 个列表页」？ | **Yes** if that evaluate is identical. **No** if the model changes the expr (a7ubt9 style) — then 8 **never fires**, which is worse. Split read vs family ceiling; do not pick 8. |
| 3 | `powershell`+`chrome` 误伤 `Start-Process chrome`？ | **Yes.** Drop that conjunction. |
| 4 | `WRONG_ORIGIN` 误杀 `file:` PDF？ | **No — it misses `file:` PDF** (tab url stays `file:`/`https:`). a7ubt9 PDF was `chrome-extension:` and **is** correctly WRONG_ORIGIN. Need `UNSUPPORTED_DOCUMENT`. `file:` HTML must stay allowed. |
| 7 | Windows only-evaluate, 8 过早掐死唯一退路？ | Identical-8: yes for polls, no for unique-expr storms. Family ceiling is the actual Windows gate. 8-only is **both** too early (polls) and too late (unique evaluate storm). |

---

## Bottom line

W3′ **intent** is still the right first-wave machine gate: typed origin/attach, evaluate honesty, success-loop budget that bites under cruise, osascript allowed on http(s) after **real** CDP death. Policy lane was right to kill the scheme ban.

W3′ **as specified** would not have stopped a7ubt9 (`78` unique osascript hashes, cap `8` inert), would still teach the model that `1+1 → null` is an empty success (the hop that unlocked AppleScript), would lock last-resort on a 5.4 predicate that the first working call never satisfied, would relabel `file:` PDF as not-found, would count `Start-Process chrome` as DOM script, and would `chat.error` `WRONG_ORIGIN` unless `classifyError` is patched.

That is not a nit pass. Rewrite §5.2–5.4 + the constant + the DoD, then re-review.

**VERDICT: REJECT**
