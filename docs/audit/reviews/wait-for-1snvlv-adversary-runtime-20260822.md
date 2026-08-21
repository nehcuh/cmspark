# Independent adversary (Runtime / Correctness) — wait_for tabId-only default

**Lane**: Runtime / Correctness (did not implement; did not rubber-stamp)  
**Date**: 2026-08-22  
**Worktree**: `/tmp/cmspark-wait-for` branch `fix/wait-for-default` (index vs `origin/main` `bebb8c4`)  
**Diff**: `docs/audit/reviews/wait-for-1snvlv-diff-20260822.patch`  
**Blast**: T2 L1. No new L2. `wait_for` / `create_tab` load-wait.

```text
Surface:      L1 (wait_for default network_idle; create_tab waits for load)
L2-classes:   none
Compose:      none
Autonomy:     single
Trust:        no new confirm dialect; classifyError recoverability only
Channel:      community
```

---

## MACHINE `[executed]`

| Suite | Result |
|-------|--------|
| `chrome-extension` `tsc --noEmit` | **0** |
| `chrome-extension` `wait-for-mode.test.ts` | **5/5** |
| `companion` `tsc -p tsconfig.test.json` | **0** |
| companion targeted (`wait-for-params`, `tool-schemas`, `bridge`, `security-thread`, `web-act-loop-wave1`) | **128/128** |
| dual-write matrix + zod strip + WS timeout + simulated refine (node, compiled artifacts) | **ran** (see Q1–Q7) |

Commands (cwd as named):

```bash
cd chrome-extension && ./node_modules/.bin/tsc --noEmit \
  && ./node_modules/.bin/tsc -p tsconfig.test.json \
  && node --test .test-dist/tests/wait-for-mode.test.js
# 5 pass

cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json \
  && node --test .test-dist/tests/wait-for-params.test.js \
    .test-dist/tests/tool-schemas.test.js \
    .test-dist/tests/bridge.test.js \
    .test-dist/tests/security-thread.test.js \
    .test-dist/tests/web-act-loop-wave1.test.js
# 128 pass
```

Full companion `npm test` not re-run (targeted set is the claimed 128).

---

## Scores

| Axis | Score | Note |
|------|-------|------|
| **Outcome** | 1snvlv ⚠️ **fixed** on the actual trace; hung/slow load **not** honest end-to-end | tabId-only no longer throws; create_tab waits. WS 15s undercuts extension caps. |
| **Trajectory** | Matches claim for GLM `{tabId}` after empty `create_tab` | New failure mode: `create_tab` WS timeout with **no tab id** → retry opens extra tabs. |
| **Component** | Dual-write **agrees** on 1snvlv shape | Weak component is `TOOL_EXECUTION_TIMEOUT_MS` vs `waitForTabLoad` / settle, not the resolver. |

---

## Attack Q1 — Dual-write: does tabId-only take `network_idle` in BOTH inject and resolver?

**Verdict: YES on the 1snvlv shape. One rare drift (whitespace selector vs old extension).**

Companion `normalizeWaitForParams` (`companion/src/tool/wait-for-params.ts:10-18`): if tool is `wait_for`, selector trims empty, and `network_idle` is not already boolean → inject `network_idle: true`.

Extension `resolveWaitForMode` (`chrome-extension/src/background/wait-for-mode.ts:26-43`): non-empty trimmed selector wins; `network_idle === false` without selector → `invalid`; else `network_idle` with `timeout`/`settle_ms`.

Adapter applies inject **after** zod (`companion/src/llm/adapter.ts:1155-1156`).

`[executed]` matrix (zod → normalize → resolver):

| Shape | Zod | Inject | New extension | Old extension (`if (selector)` / `if (network_idle)`) | Agree? |
|-------|-----|--------|---------------|------------------------------------------------------|--------|
| `{tabId}` 1snvlv | ok | `network_idle:true` | `network_idle` 15s+2s | `network_idle` | **yes** |
| `{tabId, timeout:5000}` | ok | inject true, keep timeout | `network_idle` **5000**+2s | `network_idle` (**30s hardcode**, ignores timeout) | path yes; cap **no** on old ext |
| `{tabId, selector:" textarea", network_idle:true, state:hidden}` | ok | unchanged | selector `textarea`, hidden | selector | **yes** |
| `{tabId, network_idle:true, settle_ms:3000}` | ok | unchanged | network_idle settle 3000 | network_idle | **yes** |
| `{tabId, network_idle:false}` | ok | **not** overwritten | `invalid` coded | **throw** same string | path yes (error) |
| `{tabId, selector:"#app", network_idle:false}` | ok | unchanged | selector wins | selector | **yes** |
| `{tabId, selector:"  "}` | ok (min 1) | trim empty → inject true | **network_idle** | **selector** `"  "` | **DRIFT** |
| `{tabId, selector:""}` | **FAIL** min(1) | never reached | (raw) would default idle | — | zod vs resolver diverge |
| `{tabId, timeout:0}` | **FAIL** positive | never reached | (raw) fallback 15s | — | zod vs resolver diverge |

1snvlv `{tabId: 1492094196}`: companion injects true so an **unreloaded unpacked extension** takes the old `if (params.network_idle)` branch; new extension defaults even without inject. Dual-write is the compatibility story and it holds for that call.

Whitespace-only selector is the only zod-accepted shape where new-companion + old-extension disagree (selector poll of `"  "` vs idle). Not 1snvlv.

---

## Attack Q2 — timeout-only: load-wait cap, or still 30s / ignore timeout?

**Verdict: extension `wait_for` uses `timeout` as `waitForTabLoad` cap. End-to-end the cap is still 15s WS. `create_tab` still hardcodes 30s.**

`[inspected]` `resolveWaitForMode` → `timeoutMs: positiveMs(params.timeout, 15000)` (`wait-for-mode.ts:41`).  
`[inspected]` `waitFor` → `await this.waitForTabLoad(tabId, mode.timeoutMs)` (`browser-bridge.ts:1548`).  
`[executed]` `{tabId, timeout:5000}` → `timeoutMs: 5000`. `{tabId, timeout:20000}` → `timeoutMs: 20000`.

Then:

1. **Settle is extra, not inside the cap.** After load, `await settle(mode.settleMs)` default 2000 (`browser-bridge.ts:1548-1549`). `timeout: 5000` is **7s** wall if load uses the full cap.
2. **`waitForTabLoad` default remains 30s** (`browser-bridge.ts:517`, `timeoutMs = 30000`). `create_tab` / `navigate` call `waitForTabLoad(tab.id)` with **no** timeout (`browser-bridge.ts:486`, `508`).
3. **Companion WS ignores `timeout`.** `[executed]` `TOOL_EXECUTION_TIMEOUT_MS = 15000`; `resolveToolDispatchTimeoutMs("wait_for", { timeout: 20000 }) === 15000`; same for `create_tab` / `navigate` (`companion/src/ws/tool-forward.ts:20-31`). Catalog says timeout default 15000; schema is `z.number().positive()` with **no max**. A model-requested 20s load wait is a lie: companion resolves `{ success: false, error: "Tool execution timeout (15000ms): wait_for" }` at 15s; extension may still be inside `waitForTabLoad` / settle; late `tool.result` hits `handleToolResult` with no pending (`tool-forward.ts:123-124`) and is dropped.

So: timeout-only is **not** hardcoded 30s on the new `wait_for` path. It is also **not** a real end-to-end cap. The honest cap is 15s WS.

---

## Attack Q3 — `create_tab` wait: leak, double-resolve, tab closed, hung page, `wait_for_load: false`

**Verdict: `done` flag stops double-resolve / listener leak. `wait_for_load: false` is dead on the LLM path. Hung page: 15s WS timeout, no tab id.**

### Listener / double-resolve `[inspected]`

`waitForTabLoad` (`browser-bridge.ts:517-550`): `done` + `finish()` removes `onUpdated` then `resolve()`. Poll `check`, listener, and `setTimeout(finish, maxWait)` all go through `finish`. Second call no-ops. Old leak (poll `resolve()` without `removeListener`) is gone.

Residual: `setTimeout(finish, maxWait)` is **never cleared**. After early complete, a no-op timer still fires at cap. Not a Chrome listener leak. First `check` is delayed 300ms, so already-complete tabs wait ≥300ms.

### Tab closed `[inspected]`

`chrome.tabs.get` throw → `finish()` **success**. Then:

- `create_tab`: `chrome.tabs.get(tab.id)` after wait **throws** (`browser-bridge.ts:487-488`) → `executeInner` catch (`166-170`) → `{ success: false, error: "No tab with given id …" }` (attach helper rewrites, `199`). Recoverable via existing `"no tab with given id"`.
- `wait_for` network_idle: wait resolves, **then still settle 2s**, then `{ success: true, mode: "network_idle" }` even if the tab is gone. Silent success. Nit.

### Hung page / 30s stall `[executed]+[inspected]`

`create_tab` extension cap = 30s. Companion dispatch = 15s. Act loop sees timeout at 15s, not a 30s stall, and **not** `{id,url,title}`.

`create_tab` params have **no `tabId`**, so `coerceTabId` is undefined and TabQueue is bypassed (`tab-queue.ts:7-8`, `browser-bridge.ts:79-88`). The new tab is not serialized against a follow-up `wait_for` **inside the extension**. The adapter still `await`s tools sequentially, so same-round wait is not the issue. Next-round retry is.

`waitForTabLoad` **always `resolve()`s**, never rejects, never `{ success: false }`. Hung load looks like success to the extension; companion has usually already timed out.

### `wait_for_load: false` `[executed]` — **not honored on companion path**

DoD / claim: wait unless `wait_for_load === false`.

```text
parseToolArgs("create_tab", { url: "https://zhuanlan.zhihu.com/write", wait_for_load: false })
→ { url: "https://zhuanlan.zhihu.com/write" }   // only key: url
parseToolArgs("navigate", { tabId: 1, url: "https://example.com", wait_for_load: false })
→ { tabId, url }   // wait_for_load stripped
```

`create_tab` zod (`tool-schemas.ts:334-338`) has `url` / `active` / `index` only — default strip. Catalog `create_tab` has no `wait_for_load`. LLM cannot skip the wait. Direct `BrowserBridge.createTab` still honors the flag. Navigate already had the same dead hatch; this patch copies it.

For 1snvlv that is *fine* (we want the wait). The documented escape hatch is fiction on the act loop.

### Orphan tab on WS timeout `[inspected]` — **new vs navigate**

`create_tab` only returns `{id,url,title}` after wait (`browser-bridge.ts:485-488`). If companion times out first, the error string is `Tool execution timeout (15000ms): create_tab` — **no id**. `tabUrlCache` updates only on `result.success` (`tool-forward.ts:277+`). GLM retries `create_tab` (recoverable `"timeout"`, `security.ts:951`) → extra tabs. Navigate timeout still has `params.tabId`. This is the new tool's unique hole.

---

## Attack Q4 — `network_idle:false` without selector: coded vs throw; recoverable?

**Verdict: new extension returns coded error (no throw). Adapter `classifyError` marks recoverable. Old extension throw of the same string is also recoverable now.**

`[inspected]` `waitFor` (`browser-bridge.ts:1522-1526`):

```ts
if (mode.kind === "invalid") {
  return codedToolError("WAIT_CONDITION_REQUIRED", mode.error, {
    suggested_action: "wait_for_network_idle",
  })
}
```

`codedToolError` (`locator-classify.ts:43-53`) → `{ success: false, error: "WAIT_CONDITION_REQUIRED: selector or network_idle is required", data: { error_code, suggested_action } }`. Does **not** throw. `executeInner` catch is not involved.

Adapter on `!toolResult.success` calls `classifyError(toolResult.error)` (`adapter.ts:1373`). `[executed]`:

| Error | `classifyError` |
|-------|-----------------|
| `selector or network_idle is required` | **recoverable** |
| `WAIT_CONDITION_REQUIRED: selector or network_idle is required` | **recoverable** |

Needles: `"wait_condition_required"`, `"selector or network_idle"`, `"network_idle is required"` (`security.ts:1041-1043`). Tests: `security-thread.test.ts` 1snvlv case; `web-act-loop-wave1.test.ts` coded line.

Selector **timeout** still **throws** (`browser-bridge.ts:1545`) → catch wraps `{ success: false, error: "Timeout waiting for …" }` → recoverable via `"timeout"`. Inconsistent shape (throw vs coded) but both recoverable.

`network_idle:false` is not the 1snvlv call. Leftover after the default is the only remaining invalid shape. GLM can retry with `network_idle:true` / omit the flag. `MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3` (`adapter.ts:161`) still stops a ⚠️-less loop.

Validation failures (`tryParseToolArgs` not ok) **do not** go through `classifyError` (`adapter.ts:1107-1132`): they `continue` as tool results. Empty `selector:""` is a schema error, not chat.error.

---

## Attack Q5 — Can default `wait_for` stall the act loop (15s+2s / GLM retry storms)?

**Verdict: 1snvlv error-storm is gone. Default idle can still burn ~15s WS; create_tab+wait_for double-wait is ~2s extra after load, not 17s. Hung create_tab can storm new tabs.**

Happy 1snvlv after this patch `[inspected]`:

1. `create_tab(zhihu/write)` waits until `status==="complete"` (typically ≪15s) → real url/title.
2. Rule 6 still tells the model to `wait_for({tabId})` (`adapter.ts:477`).
3. Page already complete → first poll at 300ms → settle 2000ms → success. **~2.3s**, under WS.

Not a 15+2 stall on that trajectory.

Storm / stall cases that remain:

| Case | Wall | What the model sees |
|------|------|---------------------|
| Default idle while tab still loading | load min(15s ext, 15s WS) + 2s settle | If load+settle > 15s: WS **timeout** at 15s (recoverable). Extension may still settle; late success dropped. Retry `wait_for` up to 3× → **~45s**. |
| Default idle, already complete | ~2.3s | success |
| `create_tab` hung / complete >15s | 15s WS | timeout **without tab id**; retry `create_tab` → **orphan tabs** |
| Selector timeout | 15s poll | throw, recoverable |
| `network_idle:false` leftover | milliseconds | coded recoverable |

`"network_idle"` is still **tab `status==="complete"` + settle**, not CDP Network idle. Pre-existing misnomer. Dead duplicate return after idle success was removed (good).

Rule 6 + create_tab-now-waits = **double wait**. Cost is settle, not another 15s, if create_tab actually got `complete`. Catalog `create_tab` description does not say it waits (`tool-definitions-catalog.json:17-18`).

`classifyError("timeout")` is a broad needle. WS timeout is recoverable, which is why hung `create_tab` retries instead of ⚠️ — better than 1snvlv, worse than returning the id.

---

## Attack Q6 — `JSON.stringify` `querySelector` still correct? WAVE-1 `resolveLocator` hole?

**Verdict: stringify is still correct (it *is* `selectorJsLiteral`). CSS-only is a pre-existing hole, not a regression.**

`waitFor` selector path (`browser-bridge.ts:1536-1537`):

```ts
expression: `!!document.querySelector(${JSON.stringify(mode.selector)})`
```

`selectorJsLiteral` (`selector-js-literal.ts:12-13`) **is** `JSON.stringify`. WAVE-1 `waitForSelector` / `getElementCenter` / `resolveLocator` syntax probe use the helper; `wait_for` inlined the same function. `[executed]` identity holds. Quotes / U+2028 in selectors stay in-string. No breakout.

Holes vs WAVE-1 (all **pre-existing**, patch did not add `text`):

1. **CSS only.** `click`/`type` get `planLocator` text-exclusive (`locator-classify.ts:61-67`, `browser-bridge.ts:337+`). `wait_for` cannot `wait_for({tabId, text:"发布"})`. Catalog still says CSS. Rule 6 says `{tabId, selector}`. GLM that clicked by text cannot wait by text.
2. **Exists ≠ visible.** `!!querySelector` does not check `display`/`visibility`/`rect`. `state:"hidden"` means **absent from DOM**, not CSS-hidden.
3. **No `INVALID_SELECTOR` probe.** `resolveLocator` syntax-probes and returns coded `INVALID_SELECTOR`. `wait_for` swallows evaluate errors (`browser-bridge.ts:1542`) until the 15s throw `Timeout waiting for selector`. Bad CSS costs a full timeout.
4. **No `waitForSelector` fallback to `scriptingExecute`.** The geom helper does CDP then scripting (`1744-1754`). `wait_for` is CDP-only in the poll loop.

Not a 1snvlv regression. Named residual if WAVE-1 parity is in scope later.

---

## Attack Q7 — Tests that fail if someone adds zod refine requiring selector|network_idle?

**Verdict: two tests die immediately. The rest of the suite would stay green. Guard is real but thin.**

`[executed]` simulated:

```ts
z.object({ tabId, selector optional, network_idle optional, timeout optional, ... })
  .refine(d => Boolean(d.selector) || d.network_idle === true)
```

| Args | Result |
|------|--------|
| `{tabId: 1492094196}` | **FAIL** `selector or network_idle is required` |
| `{tabId, timeout:5000}` | **FAIL** (timeout does not satisfy refine) |
| `{tabId, selector:"#app"}` | PASS |
| `{tabId, network_idle:true}` | PASS |
| `{tabId, network_idle:false}` | FAIL |

Tests that **would fail**:

1. `companion/tests/tool-schemas.test.ts` — `wait_for tabId-only (thread 1snvlv) parses — do not require selector/network_idle`
2. `companion/tests/tool-schemas.test.ts` — `wait_for accepts selector or network_idle or timeout` (the `timeout: 5000` assertion)

Tests that **would still pass** (do not go through that refine):

- `wait-for-params.test.ts` (calls `normalizeWaitForParams` directly)
- `wait-for-mode.test.ts` (extension resolver)
- `bridge.test.ts` catalog `required` array (JSON catalog, not zod)
- `security-thread` / wave1 `classifyError` tests

If refine landed, runtime would **not** resurrect 1snvlv ⚠️: `tryParseToolArgs` failure is a tool_result `continue`, not `classifyError` → `chat.error`. GLM would see a zod message and could add `network_idle:true`. Still a footgun (wasted turn; timeout-only becomes invalid). The tabId-only parse test is the actual tripwire. Comment on schema (`tool-schemas.ts:143-144`) matches.

No test asserts `waitFor` **passes** `mode.timeoutMs` into `waitForTabLoad` (resolver unit only). No test for `waitForTabLoad` `done` / listener. No test that `parseToolArgs("create_tab", {wait_for_load:false})` keeps the flag (it does not).

---

## DoD (external observables)

| # | Claim | Result |
|---|-------|--------|
| 1 | `wait_for({tabId})` does not throw the 1snvlv string; defaults to load+settle | **HOLD** `[executed]` resolver + inject; `[inspected]` `waitFor` idle path |
| 2 | `wait_for({tabId, selector})` still polls selector (selector wins) | **HOLD** `[executed]` + `[inspected]` `1529-1545` |
| 3 | Zod accepts tabId-only | **HOLD** `[executed]` |
| 4 | Missing-arg leftover is recoverable (not chat.error ⚠️) | **HOLD** `[executed]` classifyError + coded return |
| 5 | `create_tab` waits for complete before returning url/title (unless `wait_for_load` false) | **HOLD in extension**; **FAIL on companion path** for the unless-clause (stripped); **FAIL end-to-end** if load >15s WS (timeout, no url/title) |
| 6 | Default wait is bounded (timeout, not infinite) | **HOLD** (bounded twice: 15s WS and 15s/30s ext). Bounds **fight**. |
| 7 | No new L2 / host_computer / confirm dialect | **HOLD** `[inspected]` |

---

## Findings

### Not merge-blocking for 1snvlv (nits with teeth)

**N1 — Companion WS 15s undercuts new waits.** `TOOL_EXECUTION_TIMEOUT_MS` is not raised for `wait_for` / `create_tab`. Default idle is 15s load **+ 2s settle**. `create_tab` extension cap is 30s. `timeout: 20000` is accepted then ignored. Hung `create_tab` returns timeout **without tab id** → recoverable retry → extra tabs. Navigate already lived with 15s vs 30s; this patch **extends that lie to `create_tab`**, which previously returned in milliseconds. 1snvlv zhihu `complete` is usually ≪15s, so the original trace still works.

**N2 — `wait_for_load: false` cannot reach the extension through companion.** Zod strip. Catalog silent. DoD escape hatch is dead. Direct bridge still works.

**N3 — `waitForTabLoad` never fails.** Idle `wait_for` always `{ success: true }` after cap+settle (if WS lets it finish). Closed tab during idle wait is success. Model cannot distinguish "loaded" vs "gave up".

**N4 — Whitespace selector dual-write vs old unpacked extension.** New resolver trims to idle; old `if (selector)` treats `"  "` as selector. Rare.

**N5 — CSS-only `wait_for` vs WAVE-1 text locators.** Pre-existing. `JSON.stringify` is not a regression.

**N6 — Rule 6 still instructs `wait_for` after `create_tab`,** which now already waited. Extra ~2s settle, not a 15s storm, if create_tab got `complete`.

**N7 — Thin tests.** Refine is guarded by two schema tests only. No bridge test that timeout is forwarded; no `waitForTabLoad` unit test; no strip test for `wait_for_load`.

### Residual (pre-existing, in blast radius)

- `"timeout"` classifyError needle is global (any tool).
- `interval` is in wait_for zod, not catalog.
- `getTabId` treats `tabId: 0` as missing (`browser-bridge.ts:313`) — Chrome ids are large.
- Name `network_idle` ≠ network idle.

---

## Trajectory vs thread 1snvlv

Prod:

1. `create_tab(zhihu/write)` → `{id, url:"", title:""}` (no load wait)
2. glm-5.3 `wait_for({tabId})` (24 tokens)
3. Extension throw `selector or network_idle is required` (4ms)
4. `classifyError` → **non_recoverable** → ⚠️
5. User 「继续」; same call; same stop

After patch, same calls:

1. `create_tab` waits (unless WS 15s fires) → url/title populated on typical complete
2. `wait_for({tabId})` inject + resolver → idle ~2.3s if already complete
3. No 1snvlv string
4. Leftover false-without-selector is recoverable
5. 「继续」 is not required for this shape

Diff scope matches claim (13 files, wait_for + create_tab + classifyError + tests). No L2 / host_computer / confirm dialect.

---

## Eval gate card (this lane)

**Blast tier**: T2  
**MACHINE**: PASS (extension 5/5 + tsc 0; companion targeted 128/128 + tsc 0)  
**ADVERSARY (Runtime)**: APPROVE_WITH_NITS  
**MERGE (this lane)**: YES with N1–N3 owned — do not treat `timeout` / `wait_for_load:false` / hung `create_tab` as done.

---

VERDICT: APPROVE_WITH_NITS
