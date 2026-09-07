I'll read only `451-context-r3.md` and produce an independent correction review from that file alone.The packet is longer than the first read; I’ll continue from the cutoff.Independent read-only review of the #451 R3 correction packet only. Claims below are `[inspected]` from that file. Production wiring not shown in a snippet is `[assumed]`. Tests were not executed.

## Scope

T2 Chat metadata/knowledge projection. No new public tool. Ordinary `list_tabs` still enumerates via `chrome.tabs.query({})`; the reserved path is a narrower context-only shape. Upcoming evidence/Pack/MCP work is out of scope.

## Server option admission

`contextReadParams` always drops `__site_context_tab_id` from tool JSON, then reattaches it only for `list_tabs` when the server fifth argument is a safe integer `>= 0`.

`createToolExecutor` applies that preamble before outbound stripping, tabId normalization, and ADR-015 gates. Model `executeTool` in the adapter is four arguments; it cannot set `invokeOpts.siteContextTabId`.

Covered by `context metadata parameters are reserved to server invocation options`: JSON `999` is stripped; `{ siteContextTabId: 7 }` wins.

The extension still keys off the param inside `executeInner`, which is correct if companion is the only caller. Negative ids fail closed (`-1` → `success: false`). Ordinary `listTabs()` is unchanged, as declared.

## Successful-tool retargeting

Retarget is `contextTabId = resolvedTabId` only when `toolResult.success`, the tool is CDP-interactive or thaw, and `resolvedTabId` is a number. That assignment sits after the post-persist abort throw, so an aborted success does not move the conversation target.

The real Chat loop covers the contract:

- Failed `get_page_text` on 999 keeps site A (`requests[2]`).
- Successful `navigate` to B retargets (`requests[3]` has B, not A).
- `run_progress_propose` does not move the target (no tab id).

`create_tab` is excluded from thaw by existing comments; implicit `pinned_tabs[0]` fill can retarget only if that tool actually succeeded on that id. Live URL still comes from `resolveSiteTarget`, not model `params.url`.

## Unavailable-target isolation

Once a concrete tab is selected, `hostnameHint` is suppressed (`contextTabId === undefined ? hostname : undefined`). Failed resolve therefore yields `target_status: "unavailable"`, empty site-op prompt, and no all-origin memory.

`knowledgeView` throws `SITE_TARGET_UNAVAILABLE` unless status is `browser`.

`requests[4]` (tab URL cleared, `site-b.md` removed) contains neither A/B knowledge nor `SECRET_LOCATOR_451`, while manual C and the security footer remain.

Machine restore runs only inside `if (contextTarget)`, from `readSiteExperienceEntries` filtered to actually selected docs. Wildcard/comma sites cannot become owned auto-write targets. `getBySite` is `site_knowledge` only.

## Keyed URL fingerprints

Extension: per-worker non-extractable HMAC-SHA-256 over `url.href` after dropping user/password, with query/fragment retained; `safeUrl` is `origin + pathname` only. Restart drops the module key.

Companion helper is also HMAC with `randomBytes(32)`, not SHA-256. `siteTargetFromBridge` accepts a 64-hex key, structurally checks redacted fields via `siteTargetFromBrowser`, then **keeps the browser key** so it is never recomputed from a redacted URL.

Tests: secrets do not appear in JSON; HMAC ≠ plain SHA-256; fragment/query change the key; path-only URL does not; observation time is out of `siteTargetKey`; `chrome://`, `file:`, `javascript:` never become targets. Snapshot/knowledge digests stay SHA-256.

## Old-client compatibility

Documented and tested with distinct thread ids (`123` vs `undefined`):

| Client | First round | After first successful page tool | Target gone |
|---|---|---|---|
| Modern tab id | Browser target + runtime bans | Origin restore (incl. persisted B) | No hint revival |
| Legacy hostname only | Knowledge from hint, **no** machine restore | Same as modern (`contextTabId` assigned from successful tool) | Same isolation |

v1 identity is hostname SHA-256; `legacyId` remains a read-through key; `"auto"` is required for v1, not for historical legacy reads. Exact-origin bans are not restored from hostname-only hints (scheme/port unknown). Existing in-process bans stay in memory; projection filters them.

Router cache cannot keep old **site** knowledge: `cachedMatchedIds` is filtered with `isSkillDoc`, and `site_knowledge` is not a skill doc.

## Concrete regressions

None found in this packet against the stated #451 corrections. Acknowledged non-goals remain: ordinary `list_tabs` still returns raw tab URLs; page-body secrets are not claimed removed; 1.5s resolve budget fail-closes with no stale-target cache.

Residual notes, not blocking: admission test loop variable is named `trusted` though it is `siteContextTabId`; `formatSiteOpMemoryPrompt` still fail-opens to all origins when `hostname` is omitted, but the new Chat path does not call it that way; Chat loop mocks `resolveSiteTarget`/`executeTool`, so admission and HMAC are proven in sibling tests, not in one e2e path.

---

VERDICT: APPROVE
