I'll read the issue #451 context file first, then review only the packet code it points to.The context file is longer than the first chunk; I’ll continue from where it left off.# Independent review: issue #451 (Chat shared context / experience lifecycle)

Read-only review of the immutable packet. Scope is this delta only (base `f1aeced9` → W1 + #451). Not #452–#457, not MCP `knowledgeView` grants, not a business-completion claim.

---

## BLOCK

### 1. Mid-loop site-op-memory prompt fail-opens to every origin when the selected tab cannot be resolved

**Trigger:** `contextSelection` is set (all three Chat entry points) and round > 0. Then `resolveSiteTarget` returns `undefined` — tab closed, `chrome://` / non-http, `SITE_TARGET_UNAVAILABLE`, 1500ms budget, abort, or `chrome.tabs.get` failure.

**What happens:** knowledge correctly fail-closes (`hostnameHint` is suppressed whenever `contextTabId` is a number). The execution-experience **prompt** does the opposite.

First compose:

```ts
siteOpPrompt = formatSiteOpMemoryPrompt(threadId, contextTarget?.origin || hostname)
```

Later rounds:

```ts
siteOpPrompt = formatSiteOpMemoryPrompt(threadId, contextTarget?.origin)
```

`formatSiteOpMemoryPrompt` treats a missing hostname as “match all”:

```ts
const matchesTarget = (origin: string): boolean => {
  if (!hostname) return true
  ...
}
```

That filter is applied to runtime bans, restored historical bans, and origin-escalate lines. The model then receives locators / last error codes / origins from **every** site this thread ever touched, wrapped as “Execution experience (data only)”.

This contradicts the packet’s own rule: once a concrete tab was selected, an unavailable target must not revive the old hostname’s material. Knowledge follows that rule; the machine-memory **prompt** revives all hostnames. `peekSiteOpBan` stays origin-keyed, so this is prompt disclosure / instruction contamination, not a runtime ban bypass — still in-scope for this metadata/lifecycle change.

**Evidence:** `companion/src/llm/adapter.ts` (`buildCurrentContext` hostnameHint vs mid-loop `formatSiteOpMemoryPrompt`); `companion/src/tool/site-op-memory.ts` (`matchesTarget`). No test covers unavailable-target + non-empty `restoredLocators` / `locators` on round > 0. `site-context-chat.test.ts` always resolves a target.

---

## MAJOR

### 2. Internal `list_tabs` context param is not reserved; any execute path can `chrome.tabs.get` an arbitrary tab

**Trigger:** `list_tabs` with `__site_context_tab_id` set (model extra args, prompt-injected tool JSON, or any other `executeTool` caller). Adapter only deletes `surface` before forward.

```ts
case "list_tabs":
  if (params.__site_context_tab_id !== undefined) {
    ...
    const tab = await chrome.tabs.get(id)
    const target = await browserSiteTarget(id, tab.url)
    return target ? { success: true, data: { site_target: target } } : ...
  }
  return await this.listTabs()
```

Effects:

- **Hijack:** callers expecting `list_tabs` → `data: Tab[]` get `{ site_target }` instead. `tool-forward` only `refreshTabUrlCache` when `Array.isArray(result.data)`, so this path also skips the normal cache/lease enrichment.
- **Different privilege than `listTabs()`:** `chrome.tabs.get` is a single-id read, not the filtered enumeration. Packet tests even assert `query` must not run. A tab that would not appear in the public list can still yield `origin` / `hostname` / `path` / `navigation_key`.
- WS `context_tab_id` is a client-supplied integer (validated as a safe non-negative int only). Companion then asks the extension to resolve that id. That is the T2 metadata boundary this issue asked to review.

Redaction of userinfo/query/fragment on this path is real (`browser-site-target.ts`, `siteTargetFromBridge`). It does not make the param an authenticated, model-unreachable internal.

**Evidence:** `chrome-extension/src/background/browser-bridge.ts`; `companion/src/llm/adapter.ts` (normalize + `delete surface` only); `companion/src/ws/validate.ts`; `companion/src/site-context/browser-resolver.ts`. Tests cover happy-path redaction, not “model `list_tabs` + extra `__site_context_tab_id`”.

### 3. `contextTabId` follows the model tab id **before** the tool succeeds or is authorized

**Trigger:** any `isCdpInteractiveTool` / `shouldThawAfterSuccess` call with a numeric `resolvedTabId` (including hallucinated / other-window ids). Assignment is next to param normalization, **before** `shouldBlockPageTool`, site-op ban, and `executeTool`.

Next round always does `resolveSiteTarget(contextTabId)` → internal `list_tabs` / `chrome.tabs.get` → `JSON.stringify(request.target)` in the system prompt plus hostname-scoped knowledge.

So a **failed, banned, or propose-blocked** tool still retargets shared context. Name `shouldThawAfterSuccess` is the intended success gate; this update does not wait for success. Combined with finding 2, a non-leased tab id that cannot be read via page tools can still be used as the context target.

**Evidence:** `companion/src/llm/adapter.ts` (assignment immediately after `resolvedTabId`, before `runToolOnce` / `siteBan`). `site-context-chat.test.ts` only follows a successful `navigate`.

---

## NIT

### 4. Production Chat wiring of `cachedMatchedSkillIds: allSkillIds` is untested

Engine treats `cachedMatchedIds` as a **matchSkills substitute**, then unions `getBySite(current hostname)`. Reusing semantic matches is declared. If `allSkillIds` is the full first-round union (active + matched + **initial** `getBySite`) and those ids pass `isSkillDoc`, site-bound skill docs survive navigation.

The only Chat loop test passes `cachedMatchedSkillIds: []` and mocks `resolveSiteTarget`, so it cannot catch router wiring.

**Evidence:** `companion/src/message-router.ts` (all three entry points); `companion/src/skills/skill-engine.ts` `resolveSkillIdsForThread`; `companion/tests/site-context-chat.test.ts`.

### 5. Source-lock marker is now `let contextTabId`

`companion/tests/run-progress.test.ts` slices `basePrompt` until `let contextTabId`. The extra existence assert is good; the marker is still a nearby identifier, not a stable prompt fence.

### 6. `chrome.tabs.get` in the context branch has no local try/catch

Resolver `.catch(() => undefined)` fail-closes Companion. If `BrowserBridge.execute` does not catch, the extension tool path can reject instead of returning `SITE_TARGET_UNAVAILABLE`. Packet does not show an outer execute catch.

### 7. Historical bans render as tool `*`

Restore keys are `locatorMapKey(origin, "*", locator)` (cross-tool, tested). The prompt line is `- * text:save on https://…`. Harmless but easy to misread next to per-tool runtime lines.

---

## What looks sound (not findings)

- Context-only URL redaction: userinfo/query/fragment stripped before any new response field; `navigation_key` is a 64-hex hash; Companion re-validates shape and refuses to trust a raw query URL (`siteTargetFromBridge` reparses `origin+path` only).
- Old extensions that still return `list_tabs` arrays fail closed (`site_target` missing).
- Exact WHATWG origin keys vs hostname knowledge identity matches the declared split; www/apex test inversion is intentional.
- `refreshPersistedSiteOpExperience` replace-semantics, TTL, future/stale/foreign/unknown-schema rejection, and “don’t clear runtime counters” are tested.
- Safety footer / manual knowledge preservation in the synthetic Chat loop is tested.
- `knowledgeView` is unused here; grant/origin checks belong to #456 — not scored.

Tests are real BrowserBridge / SkillEngine / `chatCreate` contracts with mocked LLM/browser, as the packet states. They do not cover the BLOCK trigger or model-controlled `__site_context_tab_id`.

---

VERDICT: REJECT
