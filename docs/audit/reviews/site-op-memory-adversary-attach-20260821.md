# Adversary review — TAB_ATTACH_FROZEN (site op-memory attach lane)

**Date**: 2026-08-21  
**Role**: Independent ADVERSARY. Did **not** write this implementation. Did **not** edit product code.  
**SoT**: [`docs/superpowers/specs/2026-08-21-site-op-memory.md`](../../superpowers/specs/2026-08-21-site-op-memory.md)  
**Trace**: `qg44es` — `type` / `press_key` on tab `1492094151` after `CDP_ATTACH_FAILED` (`chrome-extension://` under 知乎 write)  
**Question**: does one attach fail freeze that tab for all CDP interactive hops, and does thaw only fire when the debugger might actually work again?

```text
Surface:      L1 CDP (peek-refuse in companion before executeTool)
L2-classes:   none new; evaluate still L2; freeze does not add a confirm
Compose:      none
Autonomy:     single
Trust:        in-process Map; no host write
Channel:      community
```

Evidence tags: `[executed]` companion `site-op-memory` + `web-act-loop-wave1` + `security-thread` (46/46) and chrome-extension `locator-classify` (13/13); plus a live import of `site-op-memory.ts` replaying the seven attacks. `[inspected]` adapter thaw, `TAB_LEASE_TOOLS`, `failInteractive`, `ensureAttached`. `[assumed]` qg44es tab was or was not pinned (hole fires only if `pinned_tabs[0]` is the frozen id).

---

## Outcome

The **freeze-on-first-attach** half of the gate is real and would have stopped the qg44es hop (`type` → `click` → `press_key` → `evaluate` on the same `tabId`) without waiting for two locator misses.

The **thaw policy is not load-bearing-tested and is wrong on `create_tab`**. Spec says thaw on `navigate` / `create_tab` / `set_tab_url` **success**. Adapter does call `thawTabIfPresent` only in that `if`. For `create_tab`, `resolvedTabId` is **not** the new tab — `create_tab` is absent from `TAB_LEASE_TOOLS`, so adapter injects `pinned_tabs[0]`. If that pin is the dead 知乎/`chrome-extension://` tab, **one successful `create_tab` unfreezes the debugger-dead tab** and `press_key` / `type` on `1492094151` are legal again.

Module comments still claim thaw on `list_tabs`. Adapter does **not**. Tests never lock the adapter contract. A comment-matching “fix” reopens the storm.

| Gate | Result |
|------|--------|
| MACHINE | PASS `[executed]` — existing tests green; they do **not** cover the load-bearing thaw policy |
| ATTACH FREEZE (1-shot, all interactive) | PASS `[executed]` — `SITE_ATTACH_FAIL_BAN=1`; `WRONG_ORIGIN` and `CDP_ATTACH_FAILED` both freeze |
| THAW POLICY | **FAIL** — `create_tab` thaws pinned frozen `tabId`; no adapter test that `list_tabs` success must not thaw |
| TESTS | **FAIL** — load-bearing gaps (WRONG_ORIGIN freeze, adapter thaw, screenshot/navigate allow, `TAB_ATTACH_FROZEN` envelope) |
| qg44es counterfactual | freeze would stop the hop **until** pinned `create_tab` or a comment-driven `list_tabs` thaw |

---

## Trajectory (qg44es)

WAVE-1 typed `CDP_ATTACH_FAILED` / `WRONG_ORIGIN` from `tabs.get` URL. qg44es still: `click` 9 / `get_element_info` 8 / `press_key` 5 on the same tab after attach already failed. Names reset per `chatCreate`; 「继续」 resets `MAX_SAME_TOOL_RECOVERABLE_FAILURES`.

This wave adds a **tabId freeze** (threshold 1) in a process-lifetime `Map`. Peek is **before** `executeTool`. That is the right layer.

`chrome-extension://` under 知乎 write is `classifyTabUrl` → `privileged` → `WRONG_ORIGIN` (`locator-classify.ts:90-91`). `ATTACH_CODES` includes both codes. The checked-in test only records `CDP_ATTACH_FAILED`. Removing `WRONG_ORIGIN` from the set would still pass CI and miss qg44es.

---

## Component

| Path | Role |
|------|------|
| `companion/src/tool/site-op-memory.ts` | `frozenTabs: Set<number>`; peek; record; `thawTabIfPresent` |
| `companion/src/llm/adapter.ts:1328-1329` | thaw **only** on `navigate`/`create_tab`/`set_tab_url` success, using **input** `resolvedTabId` |
| `companion/src/llm/adapter.ts:1153-1178` | pin inject + `peekSiteOpBan` before execute |
| `companion/src/orchestrator/constants.ts:64-85` | `TAB_LEASE_TOOLS` — **no** `create_tab` |
| `chrome-extension/.../locator-classify.ts` | URL-first `WRONG_ORIGIN` vs `CDP_ATTACH_FAILED` |
| `chrome-extension/.../browser-bridge.ts:324-331` | `failInteractive` for type/press_key/click/evaluate |
| `companion/tests/site-op-memory.test.ts` | freeze + direct `thawTabIfPresent`; **not** adapter policy |

---

## Attack results (the seven)

### 1. First `CDP_ATTACH_FAILED` freezes — next click on SAME tabId banned without 2 locator fails? **YES (intended)** `[executed]`

`SITE_ATTACH_FAIL_BAN = 1`. `recordSiteOpFailure` on `ATTACH_CODES` adds `tabId` and returns immediately — **does not** increment locator fails.

```142:146:companion/src/tool/site-op-memory.ts
  if (ATTACH_CODES.has(code) && tabId != null) {
    const was = s.frozenTabs.has(tabId)
    s.frozenTabs.add(tabId)
    return { justBanned: !was, origin, locator: "attach", fails: SITE_ATTACH_FAIL_BAN }
  }
```

Peek checks freeze **before** locator keys:

```108:110:companion/src/tool/site-op-memory.ts
  if (tabId != null && s.frozenTabs.has(tabId)) {
    return { banned: true, error_code: "TAB_ATTACH_FROZEN", locator: "attach" }
  }
```

Live probe on tab `1492094151`: one `type` + `CDP_ATTACH_FAILED` → `click` and `press_key` both `TAB_ATTACH_FROZEN`. Adapter peeks before `executeTool` (`adapter.ts:1175-1178`) so the hop never re-enters CDP. This is the qg44es stop.

`WRONG_ORIGIN` (the chrome-extension URL path) also freezes `[executed]` against the module. **No unit test records `WRONG_ORIGIN`.** Load-bearing gap.

---

### 2. Thaw too eager (`list_tabs` success should NOT thaw — debugger still dead)? **`list_tabs` OK; `create_tab` NOT OK** `[executed]` `[inspected]`

**`list_tabs` does not thaw.** Adapter:

```1328:1330:companion/src/llm/adapter.ts
            if (toolName === "navigate" || toolName === "create_tab" || toolName === "set_tab_url") {
              thawTabIfPresent(threadId, typeof resolvedTabId === "number" ? resolvedTabId : undefined)
            }
```

`list_tabs` is not in that `if`. `isCdpInteractiveTool("list_tabs")` is false; peek never bans it. Debugger still dead; freeze holds. Spec-correct.

**Comments lie.** File header: “until list_tabs/navigate”. `thawTabIfPresent` JSDoc: “list_tabs / navigate success may thaw”. Spec and adapter: navigate / create_tab / set_tab_url only. `bannedSiteOpResult` and the machine prompt tell the model `list_tabs`. Following the prompt does **not** unfreeze (good for the debugger) and is **untested** at the adapter.

**`create_tab` thaws the wrong id — this is the REJECT hole.**

- `create_tab` schema has **no** `tabId` (`tool-schemas.ts:322-326`).
- `create_tab` is **not** in `TAB_LEASE_TOOLS` (`constants.ts:64-85`).
- Adapter pin inject: `if (!multi && !TAB_LEASE_TOOLS.has(toolName)) resolvedTabId = pinned_tabs[0]` (`adapter.ts:1159-1160`).
- On success, `thawTabIfPresent(threadId, pinned_tabs[0])`.
- Extension `createTab` ignores extra `tabId` and returns a **new** `data.id` (`browser-bridge.ts:476-481`). Adapter **never** thaws `result.data.id`.

Replay: freeze `1492094151` → `thawTabIfPresent(pinned=1492094151)` → `press_key` on that tab is **not** banned. Empty pin → freeze holds.

qg44es recovery: freeze → suggested `list_tabs` (no thaw) → `create_tab` to get a real https write tab. If the dead tab is pinned (thread primary focus — `tab-resolver.ts:118-119`), create_tab **reopens type/press_key on 1492094151**. New tab was never frozen anyway; thawing it is a no-op. Thawing the pin is how the storm comes back.

---

### 3. Thaw too late (user opens new tab — new tabId not frozen — OK; navigate same tabId should thaw)? **Mostly OK; untested** `[executed]` `[inspected]`

New `tabId` is a different Set member. Probe: `tab+1` not banned after freeze of `1492094151`. User/Chrome `tabs.create` without the agent is fine.

`navigate` **is** in `TAB_LEASE_TOOLS` → pin is **not** injected. Schema requires `tabId`. Success thaws **that** `tabId`. Spec-correct **if** the model passes the frozen id.

No adapter test. No test that `navigate` failure does not thaw.

`close_tab` of a frozen id does not delete the freeze. Chrome tab ids are not typically reused in-session (`[assumed]`). Residual.

---

### 4. `WRONG_ORIGIN` freeze then user `navigate`s the same tabId — thawed? **YES at module; adapter would if navigate succeeds** `[executed]` `[inspected]`

`ATTACH_CODES = {CDP_ATTACH_FAILED, WRONG_ORIGIN}`. Probe: `WRONG_ORIGIN` freeze → `thawTabIfPresent(same id)` → type allowed.

Adapter thaws on `navigate` / `set_tab_url` **success** of that `tabId`. Privileged URL → https on the same tab is the intended recovery.

**Not tested.** Classification of chrome-extension URL as `WRONG_ORIGIN` is tested in `locator-classify.test.ts`; **the freeze mapping is not**.

`list_tabs` after `WRONG_ORIGIN` still does not thaw (attack 2). Model can see `chrome-extension://` and still retry the same id → cheap `TAB_ATTACH_FROZEN` (recoverable, `security.ts:1052`). Storm of CDP attach is stopped; storm of peek-refuses across tool names is not a hard stop.

---

### 5. evaluate 36 successes — freeze must NOT trigger on evaluate success; freeze WOULD stop later evaluates if attach failed first. **HOLD** `[executed]` `[inspected]`

`recordSiteOpFailure` runs only on `!toolResult.success` and skips `TAB_ATTACH_FROZEN` / `SITE_OP_BANNED` (`adapter.ts:1324-1347`). Success path never adds `frozenTabs`.

Probe: no failure recorded → `evaluate` and `click` unbanned. After `evaluate` + `CDP_ATTACH_FAILED` → `evaluate` peek-banned (`evaluate` is in `CDP_INTERACTIVE`).

qg44es 36 evaluate **successes** would not freeze. If attach had failed **first**, those evaluates would have been peek-refused. That is the contract.

Residual: `evaluate` `EVAL_DEAD_WORLD` / `EVAL_THROWN` are **not** in `ATTACH_CODES`. Dead world after a live attach does not freeze. Correct for “debugger attached”. `get_page_text` / `get_page_html` **throw** untyped (`executeInner` catch has no `failInteractive`). First-tool `Cannot access a chrome-extension:// URL` has no `error_code` and does not match `^([A-Z]…):` → `UNKNOWN` → locator `none`, **no freeze**. qg44es was type/press_key (`failInteractive` → coded). Residual, not the reported storm.

---

### 6. Screenshot / `list_tabs` / `navigate` still allowed on frozen tab? **YES (and `scroll` too)** `[executed]`

`CDP_INTERACTIVE` is click/dblclick/type/hover/fill_form/get_element_info/select_option/press_key/drag_and_drop/evaluate/wait_for/get_page_html/get_page_text.

Probe on a frozen tab:

| Tool | peek banned? |
|------|----------------|
| `list_tabs` | no |
| `screenshot` | no |
| `navigate` | no |
| `scroll` | no |
| `osascript_eval` | no (spec 非目标) |
| `click` / `type` / `press_key` / `evaluate` / `get_page_text` | yes |

Attack 6 allow-list holds. Existing test only asserts `list_tabs`. Screenshot/navigate allow is load-bearing for “look, then navigate” recovery and is **not** in CI.

`scroll` is a residual CDP path: not frozen, and `browser-bridge` scroll returns **`success: true`** with `mode: "exhausted"` when all CDP/scripting paths fail (`browser-bridge.ts:1353-1364`) — will **never** freeze. Spec named click/type/press_key; still a same-tab attach leak.

---

### 7. Tests cover freeze + thaw? **NO — load-bearing gaps** `[executed]`

What CI has (`site-op-memory.test.ts:40-51`):

- one `CDP_ATTACH_FAILED` → click/evaluate `TAB_ATTACH_FROZEN`
- `list_tabs` peek not banned
- **direct** `thawTabIfPresent(4151)` unbans

What CI does **not** have (each would have caught a hole in this review):

| Missing test | Why load-bearing |
|--------------|------------------|
| `WRONG_ORIGIN` freezes (qg44es chrome-extension URL) | Removing it from `ATTACH_CODES` still greens |
| Adapter: `list_tabs` **success** does not thaw | Comments say it does; a “fix” restores the storm |
| Adapter: `navigate`/`set_tab_url` success thaws **that** `tabId`; failure does not | Spec thaw |
| Adapter: `create_tab` success must **not** thaw `pinned_tabs[0]` / frozen id | Attack 2 hole; replayed live |
| `screenshot` / `navigate` allowed while frozen | Attack 6 |
| `TAB_ATTACH_FROZEN` envelope (`suggested_action`, no `host_computer`) | Only `SITE_OP_BANNED` envelope is tested |
| `press_key` after freeze | qg44es tool; same Set, weaker |

User rule: missing load-bearing test = REJECT.

---

## Residual (not the verdict by themselves)

1. **Comment / prompt / spec split** — header + JSDoc + `suggested_action: list_tabs` + Rule 7 “call list_tabs” vs spec thaw list. Cheap peek-hop continues until per-name recoverable cap.
2. **`get_page_text` untyped throw** — first attach on a privileged tab may not freeze until a `failInteractive` tool runs.
3. **`typeText` scripting fallback** — CDP attach fail + scripting `ok` → `success:true` → no freeze; later `press_key` (CDP-only) freezes and then bans the scripting type path. Inverse of qg44es (both failed).
4. **`scroll` / `browser_download` / `upload_file`** not in `CDP_INTERACTIVE`.
5. Freeze is per-`threadId`. Other threads can still CDP the dead tab.

---

## Required before re-review (do not rubber-stamp a comment-only patch)

1. **Stop thawing the pinned frozen tab on `create_tab`.** Thaw `navigate`/`set_tab_url` **input** `tabId` only; if `create_tab` must thaw anything, it is `toolResult.data.id` (new tab — a no-op) **never** `pinned_tabs[0]`.
2. Tests that fail on today’s tree:
   - `WRONG_ORIGIN` one-shot freeze of `press_key`/`click` on the same `tabId`
   - `list_tabs` success does not call thaw / freeze still holds
   - `create_tab` success with `pinned_tabs=[frozenId]` still peek-bans `type`/`press_key` on `frozenId`
   - `navigate` success of `frozenId` unbans; `navigate` failure does not
   - frozen tab still allows `screenshot` and `navigate`
3. Delete or rewrite the `list_tabs / navigate success may thaw` comment so it cannot be implemented.

---

## Verdict rationale

Freeze-on-first-attach is the right gate for qg44es **and it is implemented**. That is not enough. Thaw is the other half of the contract. `create_tab` + pin inject unfreezes the dead tab — the exact `tabId` the hop was using. Tests do not pin the adapter thaw policy, so the comment that says `list_tabs` thaws is a landmine. Per the attach-lane attack list, missing load-bearing tests are a reject.

VERDICT: REJECT
