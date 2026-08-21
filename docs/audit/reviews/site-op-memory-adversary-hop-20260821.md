# Adversary review — site op-memory (qg44es residual after WAVE-1)

**Date**: 2026-08-21  
**Role**: Independent adversary (not the implementer). Did **not** rubber-stamp. Did **not** edit product code.  
**SoT**: `docs/superpowers/specs/2026-08-21-site-op-memory.md`  
**Trace / trajectory**: `qg44es` (`~/.cmspark-agent/threads/qg44es.json`, 378 msgs, 13 user turns of which **8×「继续」**)  
**Evidence**: `[executed]` helper tests 5/5 + `tsc --noEmit` 0 + origin/www/apex/hop probes via `tsx`; `[inspected]` adapter/router/security wiring; `[executed]` qg44es tool pairing.

```text
Surface:      L1 CDP interactive (click/type/press_key/get_element_info/evaluate/…)
L2-classes:   none added
Compose:      none
Autonomy:     single
Trust:        auto site_knowledge write = existing record_experience / createExperienceSkill
Channel:      community
```

---

## Outcome

The module **does** what the SoT asked for the three named holes:

1. Locator ban lives in a **process `Map` keyed by `threadId`**, not in `chatCreate` locals. 「继续」 does **not** reset it. `[inspected]` `[executed]`
2. `(origin, *, locator)` accumulates across tools. `click` fail ×2 on `text:写文章` then `get_element_info` same text → `SITE_OP_BANNED` **without** executing. `[executed]`
3. Peek is **before** `executeTool` (`adapter.ts:1175` then `1178` refuse vs `1189`/`1195` execute). `[inspected]`
4. No locator success-clear exists. Success of a *different* locator does **not** unban the dead one. `[inspected]` `[executed]`
5. `suggested_action` on the ban result is `stop_or_change_task` / `list_tabs`. JSON does **not** name `host_computer`. `[executed]`

It is **not** a full qg44es storm killer. The live hop was **locator shopping** (`写文章` → `textarea.Input` → `请输入标题` → `key:Escape` → `[contenteditable]`), not same-text `click↔get_element_info`. After the first `CDP_ATTACH_FAILED` the tab freeze **would** have stopped the Escape spam — until `create_tab`/`navigate` success **thaws the old pinned tabId**. `originKeyFromUrl` treats `www.zhihu.com` and `zhihu.com` as different keys (`[executed]` peek miss). Helper tests never lock adapter wiring or www/apex.

`MAX_SAME_TOOL_RECOVERABLE_FAILURES=3` is still `chatCreate`-local (`adapter.ts:171` / `:863`). Spec 非目标: 不提高它.

Not a REJECT of the gate. Not a clean APPROVE.

---

## Trajectory (qg44es counterfactual)

Thread facts `[executed]` pairing of 191 tool msgs:

| qg44es fact | This gate | Counterfactual |
|-------------|-----------|----------------|
| User 「继续」 ×8, each a new `chatCreate`, **same** `threadId=qg44es` | `mem` module `Map` (`site-op-memory.ts:80`). `resetSiteOpMemoryForTests` is tests-only. `chatCreate` never clears it. | Bans/freezes survive 继续. Old `recoverableFailureCounts` (`adapter.ts:863`) **still** reset per 继续 — that is the named residual, now **not** the only gate. |
| `click` `text:写文章` ×2, both `ELEMENT_NOT_FOUND`, tab `1492094151`, origin `https://www.zhihu.com` (home then `/creator`) | After 2nd record, 3rd peek `SITE_OP_BANNED`; `*` key also bans `get_element_info` same text | They **never** issued a 3rd `写文章` click or `get_element_info text:写文章`. Gate would have caught the spec's hop; it would **not** have caught the 2nd click (ban is the *next* peek). |
| Hop after 写文章: `evaluate` (ok) / `get_page_html` / `navigate` / then **`type css:textarea.Input`** | `type` locator `css:textarea.Input` ≠ `text:写文章` → **not** `SITE_OP_BANNED`. `evaluate` locator `none` → **not** banned by locator. | Same-locator hop test is green and **orthogonal** to the live hop. |
| `type` `CDP_ATTACH_FAILED` 12:53:59 tab 4151 | `frozenTabs.add(4151)` on 1st attach (`:142-145`). Peek of **all** `CDP_INTERACTIVE` on that tab → `TAB_ATTACH_FROZEN` | Stops later `type` / `get_element_info` ×3 / `press_key Escape` ×3 / `click 本地图片上传` **on 4151**, until thaw. |
| `press_key Escape` `CDP_ATTACH_FAILED` ×5 across 继续 (4151 then 4161) | Freeze after 1st attach on **that tabId**; locator `key:Escape` bans 3rd same-key on **same origin** | 13:04:08 and 13:04:40 on 4151 → frozen. 4161 is a new tab: first Escape still runs; 2nd (13:14:33) frozen. **Across 继续: yes.** |
| `create_tab` success 13:04:47 (new editor tab 4161) | `adapter.ts:1328-1330` thaws `resolvedTabId` = **pinned old tab**, not `result.data.id` | **Re-opens 4151.** qg44es then `click .public-DraftEditor-content` on 4151 at 13:11. This is the largest remaining hole that the spec's "create_tab 成功则解冻" + pinned-tab injection actually implements. |
| `evaluate` **14 successes** on 4151 *after* the 12:53:59 attach fail | `evaluate` is in `CDP_INTERACTIVE` (`:30`). Freeze would refuse them. | Spec-correct, slightly aggressive: evaluate *was* the working probe. `osascript_eval` is **not** in the set → WAVE-1 volume cap still owns that family. |
| WAVE-1 codes present: `ELEMENT_NOT_FOUND`, `CDP_ATTACH_FAILED`, `DOM_SCRIPT_VOLUME_CAPPED` | `failCode` from `data.error_code` or `CODE:` prefix (`adapter.ts:1339-1342`). Attach codes freeze; others increment locator. Volume-capped osascript is not CDP-interactive → not recorded here. | Fail-code extraction works for WAVE-1 shaped results. Pre-WAVE untyped `"Element not found for selector: …"` records as `UNKNOWN` but **still counts**. |
| `MAX_SAME_TOOL_RECOVERABLE_FAILURES` | Unchanged, per-`chatCreate` | After peek-ban, 3 recoverable `SITE_OP_BANNED` in one turn still `chat.error` stop. Next 继续: 3 more peek-refuses then stop. No 9-click storm. |

---

## Attack results

### 1. Does 「继续」 still reset this memory? (must NOT)

**No.** `[inspected]` `[executed]`

- State: `const mem = new Map<string, ThreadMem>()` at `companion/src/tool/site-op-memory.ts:80`.
- `chatCreate` (`adapter.ts:341`) does not call `resetSiteOpMemoryForTests` (grep: tests-only).
- Router passes the **same** `rest.thread_id` on every `chat.create` (`message-router.ts:437-455`). qg44es user turns are 13 messages in one thread file, not 13 threads.
- Prompt is rebuilt each `chatCreate` (`formatSiteOpMemoryPrompt(threadId, hostname)` at `adapter.ts:505`) so 继续 **sees** existing bans, and peek still hard-refuses even if the prompt filter drops them.

Nit: the test named `"same locator fails twice then peek SITE_OP_BANNED; survives as if 继续"` (`tests/site-op-memory.test.ts:19`) never constructs two `chatCreate` frames. It is a same-Map peek. Theater vs WAVE-1 budget, which at least grepped module-Map vs chatCreate-local. Source lock (`adapter.ts` does not `mem.clear`) is the real proof.

### 2. Does click fail ×2 then get_element_info same text get SITE_OP_BANNED?

**Yes.** `[executed]` helper test `:33-36` and probe:

```
click text:写文章 ×2 → peek get_element_info text:写文章 = SITE_OP_BANNED
```

`recordSiteOpFailure` increments both `origin|tool|locator` and `origin|*|locator` (`:147-158`). Peek checks both (`:113-122`).

qg44es did **not** exercise this hop on `写文章`. After the two clicks they hopped to **other** locators. Cross-tool same-locator is implemented; it is not the storm that happened.

### 3. Is peek BEFORE execute (hard refuse success path)?

**Yes.** `[inspected]`

```1173:1178:companion/src/llm/adapter.ts
          const tabUrl =
            typeof resolvedTabId === "number" ? getCachedTabUrl(resolvedTabId) : undefined
          const siteBan = peekSiteOpBan(threadId, toolName, execParams, tabUrl)
          let toolResult: { success: boolean; data?: any; error?: string }
          if (siteBan.banned) {
            toolResult = bannedSiteOpResult(siteBan)
```

`executeTool` is only in the `else if` / `else` (`:1189`, `:1195`). Banned path never talks to the extension. `recordSiteOpFailure` skips `SITE_OP_BANNED` / `TAB_ATTACH_FROZEN` (`:1344-1346`) so peek-refuse does not inflate the counter.

No adapter unit test asserts call order. WAVE-1 `dom-script-budget` had the same shape; wiring is visible, not locked.

### 4. Does success of a *different* locator reset the banned one? (must not)

**No reset API for locators.** `[inspected]` `[executed]`

- `thawTabIfPresent` only `frozenTabs.delete` (`:168-171`).
- Success path (`adapter.ts:1324-1330`) deletes `recoverableFailureCounts` (old gate) and maybe thaws a **tab**. It does not touch `s.locators`.
- Probe: after `写文章` banned, `click text:发布` is allowed and `写文章` stays banned.

Pass.

### 5. originKeyFromUrl vs hostname www vs apex mismatch → false miss?

**Yes, confirmed peek miss.** `[executed]`

`originForSiteOp` (`site-op-memory.ts:60-63`) uses **only** `params.url` or `tabUrl` → `originKeyFromUrl` (`dom-script-budget.ts:64-74`) = `protocol//host`. Chat `hostname` is **not** a peek fallback.

| input | key |
|-------|-----|
| `https://www.zhihu.com/write` | `https://www.zhihu.com` |
| `https://zhihu.com/write` | `https://zhihu.com` |
| `https://zhuanlan.zhihu.com/write` | `https://zhuanlan.zhihu.com` |
| `zhuanlan.zhihu.com/write` (osascript-style, no scheme) | `origin:unknown` |
| `undefined` (cold `getCachedTabUrl`) | `origin:unknown` |

Probe after 2 fails on www: peek on apex = **not banned**; peek on zhuanlan = **not banned**; peek with `tabUrl=undefined` = **not banned**.

Prompt filter (`:210-217`) is a different function: strip `www.`, then `origin.includes(hostHint)`. That **over**-matches (`notzhihu.com` shows up under hostname `zhihu.com`) and **under**-matches cache misses: bans recorded as `origin:unknown` are **dropped** when `hostname=zhihu.com` (prompt `""`), while `hostname=undefined` lists them.

qg44es: the two `写文章` clicks were both `www.zhihu.com` (cache would be warm after `create_tab`/`list_tabs` — `tool-forward.ts:240-241`, `:277-284`). Then they **intentionally** changed origin to `zhuanlan.zhihu.com` (spec: 换 origin 是新键). So Attack 5 is a **real general hole**, not the qg44es smoking gun. Still untested.

`createExperienceSkill` site field is the exact host (`www.zhihu.com` / `zhuanlan.zhihu.com`). `matchSite` is exact unless the pattern is `*.suffix` (`site-matcher.ts:27-43`). Auto-load on the other label will miss. Trust class is still `record_experience`; the write is just a weaker cousin of the machine Map.

### 6. Adapter not wired / only helper tests green?

**Wired. Tests do not prove it.** `[inspected]` `[executed]`

| call site | wired? |
|-----------|--------|
| `peekSiteOpBan` before `executeTool` | `adapter.ts:1175-1178` |
| `recordSiteOpFailure` on fail | `adapter.ts:1348` |
| `formatSiteOpMemoryPrompt` in `systemPrompt` | `adapter.ts:505`, `:526-529` |
| `hostname` into `chatCreate` | `message-router.ts:455` (chat), `:887` (upload), `:1181` (regenerate) |
| `classifyError` recoverable | `security.ts:1051-1052` `site_op_banned` / `tab_attach_frozen` (lowercased includes) |
| `createExperienceSkill` on `justBanned` | `adapter.ts:1352-1367` — same helper as `record_experience` (`companion-dispatch.ts:1022`) |

`tests/site-op-memory.test.ts` 5/5 never imports `adapter.ts`. `tests/web-act-loop-wave1.test.ts` classifyError list still omits the two new codes; `security-thread.test.ts:466-467` covers them.

Side effect, in scope: `buildSystemPrompt` previously got `hostname=undefined` from `chatCreate` (`adapter.ts` diff). Site knowledge via `getBySite` in the system prompt was dead on the chat path; it is now alive. Dedup via `injectedNames` (`skill-engine.ts:643-651`). Not a new L2.

### 7. Ban `suggested_action` hop to `host_computer` or `evaluate`?

**No hop in the ban payload.** `[executed]`

```173:197:companion/src/tool/site-op-memory.ts
  if (ban.error_code === "TAB_ATTACH_FROZEN") {
    ...
        suggested_action: "list_tabs",
    ...
        suggested_action: "stop_or_change_task",
```

Test `:65-69` `doesNotMatch(/host_computer/)`. Freeze error string says `do not hop click/type/evaluate`.

Residuals the **payload does not stop**:

- `host_computer` is **not** in `CDP_INTERACTIVE` (`:20-34`). Peek returns `{banned:false}`. Rule 12 prompt still the only DOM-vs-CU lock.
- Locator-banned `click text:写文章` still allows `evaluate` (`locator=none`) and `type css:textarea.Input` on a tab that is **not** frozen.
- WAVE-1 `ELEMENT_NOT_FOUND` still ships `suggested_action: refine_text_or_selector` (qg44es 写文章 result). That is what **feeds** locator shopping until this gate's 3rd same-locator peek, or until attach freeze.

---

## Component

### `companion/src/tool/site-op-memory.ts`

Locator key prefers `text` over `selector` (`:42-45`) — combination C, correct for click. Applied too broadly: `press_key({text:"写文章", key:"Escape"})` keys as `text:写文章` (`[executed]`). qg44es press_key args were `key` only, so the live Escape hop is `key:Escape`, not folded into the 写文章 ban.

`locator === "none"` is excluded from the `*` hop (`:118`, `:152`) but **not** from the per-tool key. Two `evaluate` / `get_page_text` failures on an origin ban **all** subsequent `evaluate`/`get_page_text` on that origin. Aggressive; qg44es evaluate mostly succeeded.

Prompt `k.split("|")` (`:214`) truncates CSS locators that contain `|` (`css:div|span` → prompt `css:div`). Peek key stays full. Prompt-only.

### `companion/src/llm/adapter.ts` — thaw on the wrong tab

```1328:1330:companion/src/llm/adapter.ts
            if (toolName === "navigate" || toolName === "create_tab" || toolName === "set_tab_url") {
              thawTabIfPresent(threadId, typeof resolvedTabId === "number" ? resolvedTabId : undefined)
            }
```

SoT: `navigate/create_tab/set_tab_url` 成功则解冻. Implementation thaws **`resolvedTabId`**, which for `create_tab` is `pinned_tabs[0]` (the **broken** editor), not `toolResult.data.id` (the new tab). `tool-forward.ts:277-284` correctly caches the **new** id. Adapter thaws the **old** one.

qg44es 13:04:47 `create_tab` after Escape attach-fails → this path re-arms 4151.

`list_tabs` is the freeze `suggested_action` and does **not** thaw (matches SoT). Good. The model that follows the suggestion then `create_tab`s to escape the freeze, which **undoes** it.

### `companion/src/message-router.ts`

Hostname plumbing is complete on the three `chatCreate` sites. Peek does not consume it (Attack 5).

### Tests

`[executed]`

```text
node --import tsx --test tests/site-op-memory.test.ts  → 5/5 pass
./node_modules/.bin/tsc --noEmit                       → 0
```

Missing locks (do not ship as “qg44es closed” until some of these exist):

1. www vs apex / `origin:unknown` peek miss (Attack 5).
2. Adapter source lock: `peekSiteOpBan` appears before `executeTool` in `adapter.ts` (WAVE-1 Rule 12 style).
3. `create_tab` success must **not** thaw a frozen tabId that is not the created tab.
4. Two `chatCreate` frames, same `threadId`, Map still bans (real 继续, not the comment).
5. `press_key` / `type` different locator still allowed after `click`×2 (document as residual, or extend SoT).

---

## Capability (ADR-020)

- Surface L1 only. `click` stays non-L2. `evaluate` / `osascript_eval` / `host_computer` L2-classes unchanged.
- Trust: `createExperienceSkill(..., "site_knowledge", ...)` is the existing `record_experience` writer. No new confirmation class. Auto-write on `justBanned` is fail-closed negative knowledge, same family as WAVE-1 stale marks.

---

## Nits (fold or own)

1. **P0 residual — `create_tab` thaws pinned tab.** Thaw `toolResult.data.id` on create, or only the tab whose URL actually changed. qg44es 13:04:47 / 13:11:13.
2. **Attack 5 — use one origin function.** Either registrable-domain (or strip `www.`) for peek keys, or fall back `hostname` from `chatCreate` when cache is cold. Do not let prompt `includes()` and peek `protocol//host` diverge.
3. Replace the 「继续」 test name with an assertion that `chatCreate` does not import/reset the Map (source lock) or a tiny two-call harness.
4. `locatorKeyForTool`: `press_key` should key `key:`, never leftover `text`.
5. Prompt `split("|")` / `includes(hostHint)` are display bugs, not gates.

---

## Verdict table

| Attack | Result |
|--------|--------|
| 1 继续 resets memory | **PASS** (must NOT) — Map survives; test is theater |
| 2 click×2 → get_element_info same text | **PASS** `SITE_OP_BANNED` |
| 3 peek before execute | **PASS** `[inspected]` adapter; no test lock |
| 4 other-locator success unbans | **PASS** (must not) |
| 5 www vs apex / hostname mismatch | **FAIL** peek miss `[executed]`; not qg44es-causal |
| 6 adapter unwired | **PASS** wired; **FAIL** “tests prove hop” claim |
| 7 suggested_action → host_computer / evaluate | **PASS** payload; evaluate/type still callable on unfrozen tabs with other locators |

qg44es: 继续-reset and same-locator hop are closed. Attach freeze would have cut Escape×N **until create_tab thaw**. Locator-shopping + pinned-tab thaw + www/apex keys remain. That is a nits verdict, not a reject of the Map.

VERDICT: APPROVE_WITH_NITS
