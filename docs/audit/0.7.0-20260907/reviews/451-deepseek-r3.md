Actual model: deepseek-v4-pro (invoked through Claude Code CLI).

# Review — Issue #451 R3 final correction packet

Read-only review of the supplied packet (`451-context-r3.md`). No files outside the packet were read, no commands run; all findings are `[inspected]` static analysis of the shown code. Scope: the four #451 correction areas.

## 1. Untrusted metadata params (`__site_context_tab_id`)

**Closes the hole.** `contextReadParams` (admission.ts:14-20) unconditionally destructures out any model-supplied `__site_context_tab_id` and re-injects it only when the tool is `list_tabs` and a server-owned `internalTabId` (safe, non-negative integer) was passed as the fifth executor argument. `server.ts:461` applies it to every invoke, and `ToolExecuteInvokeOpts.siteContextTabId` (server.ts:406-410) is documented as never read from tool args. The chat adapter's own model-tool path calls `executeTool(tc.id, toolName, execParams, signal)` with no invokeOpts, so a model calling `list_tabs` gets ordinary enumeration with any smuggled field stripped; only `resolveBrowserSiteTarget` (browser-resolver.ts:47) supplies `{ siteContextTabId }` from server code. `contextReadParams` preserves `__thread_id` via spread, which the resolver relies on. Bridge-side validation (browser-bridge.ts:98-100) rejects non-integer/negative ids, and the integration test (outbound-mcp-executor.test.ts:201-212) verifies trusted=7 vs untrusted=undefined. `[inspected]` — correct.

Nit: line 16's `internalTabId! >= 0` — the non-null assertion compiles away and the check is redundant with `Number.isSafeInteger` except for the sign; purely cosmetic.

## 2. Low-entropy URL hash disclosure (plain SHA-256 → HMAC)

**Closes the hole.** Extension side (`browserSiteTarget`, chrome-extension/browser-site-target.ts): per-worker `crypto.subtle.generateKey({name:"HMAC", hash:"SHA-256"}, false, ["sign"])` — non-extractable, never persisted, lazily created, invalidated on worker restart. Companion local helper (`siteTargetFromBrowser`, target.ts:105) uses HMAC-SHA-256 with module-level `randomBytes(32)`. Both HMAC over `url.href` after clearing credentials, so query/fragment still participate (SPA detection preserved — confirmed by the fragment-change test at active-tab-context.test.ts:497-499) but low-entropy query secrets are no longer offline-verifiable by a recipient with no key. `siteTargetFromBridge` (target.ts:130-137) validates the 64-hex key format, re-derives the safe fields, requires `input.url` to equal the redacted origin+pathname (so a bridge response carrying query/fragment is rejected), and **retains the browser-computed key rather than recomputing from the redacted URL** — which would be both wrong (key mismatch) and insecure (back to plain digest). Tests explicitly assert HMAC ≠ plain SHA-256 of the URL including the secret token (extension test:494-495; companion test:524). `[inspected]` — correct, no remaining plain-digest verification path for navigation keys. Knowledge/doc/content digests (service.ts snapshot ids) remain plain SHA-256 as stated, which is fine — they hash HMAC output or knowledge content, not low-entropy secrets.

## 3. Legacy hostname compatibility

**Closes the compatibility gap.** `siteExperienceIdentity` (site-experience-identity.ts:285-297) returns both the v1 id (SHA-256 of www-stripped hostname) and `legacyId` replicating the historical producer key from `url.host` (port preserved, dots→hyphens). `readSiteExperienceEntries` reads both ids, and `matchesSiteExperience` accepts the historical `["site-op-memory"]`-only tag set for legacy reads (`legacyRead=true`) while requiring `"auto"` for v1, rejects wildcard/comma `doc.site`, and compares canonical (www-stripped) hostnames. `getBySite` (skill-engine.ts:1186-1188) is now restricted to `site_knowledge` and routes ownership through `isOwnedSiteExperience`, so wildcard/manual docs can be shown as knowledge but never become automatic write/restore targets. Restore is gated on actually-injected docs via `selectedIds` (adapter.ts:703-707), honoring knowledge budgets. `[inspected]` — correct.

Nit: the `legacyId` read-through path (historical file id, no-`auto` tag set) is implemented but not exercised by the shown regression tests — "old client" coverage in site-context-chat.test.ts is the legacy-hint path (initialTab `undefined`), not the legacy-file-id path. Also, for non-default-port origins `legacyId` retains a `:` (e.g. `b-test:8443`), which the comment asserts mirrors the producer but is untested.

## 4. Unavailable-target memory

**Closes the hole.** In `buildCurrentContext` (adapter.ts:679-694): once a concrete `contextTabId` was chosen, `hostnameHint` is forced `undefined`, so an unavailable tab cannot revive knowledge selected for the request's stale hostname; `currentSiteOpPrompt` (adapter.ts:731-733) returns `""` when `contextSelection` is present but no target resolved, so no site-op machine-memory text is injected; `refreshPersistedSiteOpExperience` runs only on a concrete `contextTarget` (adapter.ts:703-709). Retargeting to `resolvedTabId` happens only on `toolResult.success` (adapter.ts:1870-1873), and the abort/on-disk guard at 1841-1868 precedes it. The real chat regression covers all four claimed behaviors: failed `get_page_text(999)` keeps SITE_A (line 432), successful `navigate` flips to SITE_B with persisted ban restored at actual B (lines 420-421, 433), disappeared target projects neither SITE_B, SITE_A, nor the secret locator (lines 435-437), and legacy-hint runs retain knowledge but never machine restoration (`SECRET_LOCATOR_451` absent, line 431). The per-round context rebuild (adapter.ts:1200-1215) and 1.5s bounded resolver with no stale cache (browser-resolver.ts) match the stated dispositions. `[inspected]` — correct.

Minor observation: in `resolveBrowserSiteTarget`, an abort arriving between the entry `signal?.aborted` check and `addEventListener` registration leaves the controller un-aborted; the read then runs to its 1.5s cap. Consequence is negligible (bounded, race still applies, adapter discards on abort), but a post-registration `if (signal?.aborted) controller.abort()` would close it.

## Other checks

- `siteTargetFromBrowser`/`browserSiteTarget` reject non-http(s), strip credentials before any field storage (tests assert no `secret`/`password` in JSON), and `url.origin` excludes credentials.
- `siteTargetKey` includes tab_id/origin/HMAC — path/query/fragment changes churn identity, observation time does not (verified target.test.ts:534-538).
- Bridge context path never enumerates tabs (`tabs.get` only; test makes `query` throw), ordinary `listTabs` uses `query({})` — consistent with the stated T2 posture.
- Existing gates (ADR-015 preamble at server.ts:534-538, site-ban before execution at adapter.ts:1637/1657-1668, outbound provenance at 514-522) remain in place after the preamble as claimed.
- Test machinery: distinct thread ids per iteration (`context-chat-123` / `context-chat-legacy`) as stated; env var restore and dynamic-import caching are test-local concerns only.

## Verdict

All four #451 correction areas — untrusted metadata params, low-entropy URL hash disclosure, legacy hostname compatibility, and unavailable-target memory — are genuinely closed by the shown code, with regression tests covering the real loop for modern and legacy clients. No concrete correctness or security regression found in the correction code. Remaining issues are minor and non-blocking.

**VERDICT: APPROVE_WITH_NITS**

Nits (non-blocking):
1. `admission.ts:16` — redundant `internalTabId!` assertion/duplicate integer check (cosmetic).
2. `browser-resolver.ts` — abort-race window between the entry check and listener registration.
3. Legacy-file-id read-through (`legacyId`, historical `["site-op-memory"]`-only tags) has no regression test; non-default-port `legacyId` containing `:` is unverified against the historical producer's actual sanitization.