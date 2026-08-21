# Adversary rereview — TAB_ATTACH_FROZEN (create_tab pin-thaw fold)

**Date**: 2026-08-21  
**Role**: Independent ADVERSARY. Did **not** write the fold. Did **not** edit product code.  
**Prior**: [`site-op-memory-adversary-attach-20260821.md`](./site-op-memory-adversary-attach-20260821.md) **REJECT** — `create_tab` success thawed `pinned_tabs[0]`.  
**SoT**: [`docs/superpowers/specs/2026-08-21-site-op-memory.md`](../../superpowers/specs/2026-08-21-site-op-memory.md) (updated this fold)  
**This round’s reject rule**: if `create_tab` still thaws the pin → **REJECT**. Else APPROVE or APPROVE_WITH_NITS.

```text
Surface:      L1 CDP peek-refuse
L2-classes:   none new
Compose:      none
Autonomy:     single
Trust:        in-process Map
Channel:      community
```

Evidence: `[executed]` `cd companion && node --import tsx --test tests/site-op-memory.test.ts` → **8/8 pass**. `[inspected]` adapter thaw `if`, sole production `thawTabIfPresent` call site, spec line 22, tests 71–102. `[assumed]` none for the pin hole (it is a static `if`).

---

## Outcome

The REJECT hole is **closed**. Adapter thaws **only** `navigate` / `set_tab_url`. `create_tab` is not in that `if`. Pin inject for `create_tab` still happens (`TAB_LEASE_TOOLS` excludes it) but **does not call thaw**, so a successful `create_tab` leaves `1492094151` frozen. Spec now says `list_tabs`/`create_tab` do not thaw.

This is **not** a clean APPROVE. The file header still tells a future reader to thaw on `list_tabs`. There is still **no adapter test** that would fail if `create_tab` were added back to the `if`. Those are nits under this round’s rule, not a re-open of the pin hole.

| Gate | Result |
|------|--------|
| MACHINE | PASS `[executed]` — 8/8 `site-op-memory.test.ts` |
| create_tab thaws pin? | **NO** `[inspected]` — `if (toolName === "navigate" \|\| toolName === "set_tab_url")` only |
| WRONG_ORIGIN freeze | PASS `[executed]` — new test `press_key` on tab 9 |
| Prior REJECT item 1 | PASS — thaw input tabId of navigate/set_tab_url only |
| Residual comments / adapter lock tests | NITS |

---

## Pin-thaw (the only REJECT trigger this round)

Production call sites of `thawTabIfPresent` `[inspected]`:

| File | Role |
|------|------|
| `companion/src/tool/site-op-memory.ts:180` | definition — `frozenTabs.delete` |
| `companion/src/llm/adapter.ts:1331` | **only** runtime caller |
| `companion/tests/site-op-memory.test.ts:49` | unit thaw |

```1328:1332:companion/src/llm/adapter.ts
            // Only navigate/set_tab_url on THIS tabId may thaw. create_tab must
            // not thaw pinned_tabs[0] (qg44es: freeze 4151 then create_tab re-opens CDP).
            if (toolName === "navigate" || toolName === "set_tab_url") {
              thawTabIfPresent(threadId, typeof resolvedTabId === "number" ? resolvedTabId : undefined)
            }
```

`create_tab` is **not** in the condition. Grep for `toolName === "create_tab"` in `adapter.ts`: **zero** matches.

Pin inject is unchanged (`adapter.ts:1159-1160`: non–`TAB_LEASE_TOOLS` including `create_tab` still get `pinned_tabs[0]` into `execParams.tabId`). That extra `tabId` is ignored by `chrome.tabs.create`. It no longer reaches `thawTabIfPresent`. qg44es recovery `create_tab` after freeze **cannot** unfreeze `1492094151`.

Spec lock-step `[inspected]`:

```22:22:docs/superpowers/specs/2026-08-21-site-op-memory.md
| `(thread, tabId)` attach | **1** 次 `CDP_ATTACH_FAILED`/`WRONG_ORIGIN` | `TAB_ATTACH_FROZEN`；**仅**该 tab 的 `navigate`/`set_tab_url` 成功解冻。`list_tabs`/`create_tab` **不解冻**（create_tab 会注入 pinned 旧 tabId） |
```

JSDoc on `thawTabIfPresent` matches (`site-op-memory.ts:179`).

---

## Prior required list — scored

| Required (REJECT r1) | Status |
|----------------------|--------|
| 1. Do not thaw pin on `create_tab` | **DONE** `[inspected]` |
| `WRONG_ORIGIN` freeze of `press_key` same tabId | **DONE** `[executed]` tests 71–83 |
| `list_tabs` success does not thaw | **Partial** — peek still allows `list_tabs`; no adapter test that success skips thaw |
| `create_tab` + `pinned_tabs=[frozenId]` still bans type/press_key | **Missing** — no adapter/integration test; source `if` is the only lock |
| `navigate` success thaws; failure does not | **Missing** — still only direct `thawTabIfPresent("t2", 4151)` |
| frozen tab allows `screenshot` / `navigate` | **Missing** |
| Rewrite `list_tabs / navigate success may thaw` comment | **Partial** — JSDoc fixed; **file header line 11 still says “until list_tabs/navigate”** |

Under this round’s rule, missing adapter tests are nits, not REJECT.

---

## Other folds (not attach-hole, not inverted)

- Locator newline/`#` strip (`sanitizeLocatorFragment`) + test: prompt-injection nit, not thaw.
- `originForSiteOp` prefers `tabUrl` over `params.url` + test: locator-ban key, freeze is still `tabId`. Does not reopen attach.

---

## Nits (do not re-open REJECT)

1. **Stale header** `site-op-memory.ts:10-11`: “until list_tabs/navigate”. A comment-matching “fix” would put `list_tabs` back in the thaw `if` and restore a dead-debugger hop. JSDoc and spec are correct; the header is the landmine from r1.
2. **No source-lock test** on `adapter.ts` thaw `if` (cheap: assert the file does not contain `create_tab` next to `thawTabIfPresent`). Today’s tree would still green if the `if` grew `create_tab` again.
3. `TAB_ATTACH_FROZEN` envelope still untested (`suggested_action: list_tabs` is now spec-correct; still no `host_computer` assertion).
4. `scroll` / untyped `get_page_text` throw remain residual from r1 (not this fold).

---

## Verdict rationale

create_tab does **not** thaw `pinned_tabs[0]`. The qg44es pin hole is gone. Remaining gaps are comment drift and missing adapter lock tests — not a second pin thaw.

VERDICT: APPROVE_WITH_NITS
