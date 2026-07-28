# Fix Plan: Site-knowledge auto-load via chat hostname

**Date:** 2026-07-28  
**Repo:** cmspark  
**Ask:** Dual-review (Claude + Pi). If APPROVE (or APPROVE with minor amends), implement.

## Problem

Site-scoped knowledge (`type: site_knowledge` + `site: example.com` / `*.example.com`) is designed to auto-inject when the user chats while on a matching tab.

Companion already resolves:

```ts
// message-router.ts chat.create / regenerate
const currentHostname = rest.hostname || (rest.url ? new URL(rest.url).hostname : undefined)
skillEngine.resolveKnowledgeIdsForThread(threadId, knowledgeMode, currentHostname)
// auto mode: activeKnowledge ∪ getBySite(hostname)
```

But the extension never sends `hostname` / `url` on chat:

| Layer | Payload today |
|-------|----------------|
| Side Panel `App.tsx` | `{ type: "chat.send", threadId, message, skillIds }` |
| Background `index.ts` | `{ type: "chat.create", thread_id, message, skill_ids }` — **no hostname** |
| Companion | `rest.hostname` always undefined → `getBySite` never matches |

UI Knowledge panel *does* read active-tab hostname for grouping only — that is display-only, not chat inject.

Also: `knowledge/sites/` is empty on this machine; vault notes under `knowledge/global/` are not `site_knowledge`. Auto-load only helps once site docs exist + hostname is passed.

## Proposed fix (minimal)

### 1. Extension: attach active-tab hostname on chat paths

**`chrome-extension/src/background/index.ts` — `chat.send` (and preferably `chat.regenerate`, quickAction `chat.create`):**

Before `wsClient.send`, resolve active tab:

```ts
async function getActiveTabContext(): Promise<{ hostname?: string; url?: string }> {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    const tab = tabs[0]
    const url = tab?.url
    if (!url || !/^https?:\/\//i.test(url)) return {}
    const hostname = new URL(url).hostname
    if (!hostname) return {}
    return { hostname, url }
  } catch {
    return {}
  }
}
```

Send:

```ts
{
  type: "chat.create",
  thread_id: message.threadId,
  message: message.message,
  skill_ids: message.skillIds,
  hostname: ctx.hostname,  // optional
  url: ctx.url,            // optional backup for companion parser
}
```

Same enrichment for `chat.regenerate` and background quickAction `chat.create` fallback.

**Do not** trust arbitrary client hostname for security gates (cookie/trusted_domains). Hostname is **only** for knowledge/skill *selection* (which docs to inject). Cookie tools still use explicit domain params + trusted_domains.

### 2. Companion: accept hostname (already does)

No contract change required if we send `hostname` and/or `url`. Optionally:

- Document fields on `chat.create` / `chat.regenerate` validation as optional strings.
- Normalize: lowercase hostname, strip trailing dots; reject empty / `chrome:` schemes already filtered extension-side.
- Prefer `hostname` over parsing `url` (already the order).

### 3. Tests

- Unit/extension: pure helper tests for `getActiveTabContext` logic if extracted; or background message shape includes hostname when mock tab is http(s).
- Companion existing `getBySite` / `resolveKnowledgeIdsForThread` tests already cover matching; add one integration-style test if cheap: `resolveKnowledgeIdsForThread(..., "github.com")` includes site doc.

### 4. Out of scope (this PR)

- Migrating `createExperienceSkill` from `skills/` to `knowledge/sites/` (works today via type filter).
- Changing vault notes to site_knowledge.
- Auto-scraping site knowledge.

## Risk / security notes

| Risk | Mitigation |
|------|------------|
| Spoofed hostname injects wrong knowledge | Low impact: only expands prompt context from *user's own* knowledge store; not a trust boundary for tools. Still: only extension SW should set it (not free-form LLM). |
| chrome:// / extension pages | Skip non-http(s) → no hostname |
| Private IPs | OK for knowledge matching (user may test internal apps) |
| Prompt size | Site docs only when matched; not all global vault |

## Acceptance

1. Create a `site_knowledge` doc with `site: example.com`.
2. Open https://example.com, send a chat message with knowledge mode **auto**.
3. System prompt / resolved knowledge IDs include that doc.
4. Open a different domain → doc not auto-included (unless manually checked or mode=all).
5. Skills panel still free of vault leakage (prior fix).

## Reviewer questions

1. APPROVE / APPROVE-WITH-AMENDS / REJECT?
2. Should we also fall back to first *pinned* tab hostname if active tab is chrome://?
3. Pass only `hostname` or both `hostname` + `url`?
4. Any privacy concern logging hostname in companion logs?
