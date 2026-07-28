I have all the context needed. Here is my review.

---

# Review: Site-knowledge auto-load via chat hostname

## 1. Verdict: **APPROVE-WITH-AMENDS**

The diagnosis is accurate and the approach is surgically minimal. The companion already has the complete machinery — `resolveKnowledgeIdsForThread` in `skill-engine.ts:432-452` correctly calls `getBySite(hostname)` which delegates to `matchSite()` — but it never receives a hostname from the extension. Three amend items below must be resolved before implementation.

---

## 2. Findings (severity-ranked)

### F1 — **Hostname case normalization is missing** (mandatory)

`matchSite()` in `site-matcher.ts:15-30` does **strict case-sensitive comparison** (`pattern === hostname`, `hostname.endsWith("." + suffix)`). Per RFC 4343, DNS hostnames are case-insensitive. If the extension sends `Github.com` and the knowledge doc declares `site: github.com`, matching silently fails.

The plan lists lowercase normalization as "Optionally." It must be **mandatory** and should happen **companion-side** in `resolveKnowledgeIdsForThread` (defense-in-depth, even if extension filters). Change:

```ts
// companion/src/skills/skill-engine.ts, resolveKnowledgeIdsForThread
const site = hostname ? this.getBySite(hostname.toLowerCase()).map(s => s.name) : []
```

Also normalize `rest.hostname` in `message-router.ts` at extraction points (lines 397, 749) — or normalize at the single call-site in `resolveKnowledgeIdsForThread`. Either is fine; the latter is cleaner (one place).

### F2 — **`getActiveTabContext` uses `lastFocusedWindow` diverging from existing patterns** (should-address)

Every other tab query in `background/index.ts` uses `currentWindow: true` (notebooklm handlers at lines 611, 636). The plan uses `lastFocusedWindow: true`.

- For a background SW, `lastFocusedWindow` is actually **more correct** — the SW has no "current window."
- But the side panel is always opened from the **current window**, so `currentWindow` + `lastFocusedWindow` together would be safest.

**Recommendation:** Use `{ active: true, currentWindow: true }` to match existing patterns in this file, OR document why `lastFocusedWindow` is chosen. Either way, the deviation needs an explicit rationale in the plan.

### F3 — **`chrome://` scheme filtering should be explicit in the helper, not just implied** (nice-to-have)

The plan's filter `!/^https?:\/\//i.test(url)` correctly excludes non-web pages. But the code should also filter `file://`, `data:`, `about:`, and `devtools://` for cleanliness. Adding an explicit allowlist is clearer:

```ts
if (!url || !/^https?:\/\//i.test(url)) return {}
```

This is already in the plan's helper, so this is just confirming it's the right approach.

---

## 3. Answers to Reviewer Questions

### R2: Should we also fall back to first pinned tab hostname if active tab is chrome://?

**No.** If the user is on `chrome://extensions` or `chrome://settings`, auto-injecting site knowledge from a pinned Gmail/Pinterest tab would be wrong. The current behavior (no hostname → no site knowledge injection) is correct for non-web pages.

### R3: Pass only `hostname` or both `hostname` + `url`?

**Pass only `hostname`.** The companion already has the `rest.url → new URL(rest.url).hostname` fallback as backward-compatibility, but the extension can and should parse hostname itself. Sending `url` adds unnecessary data over the wire and introduces a minor privacy surface (full URL with query params could leak into companion memory). The companion's fallback parse from `url` can remain for robustness, but the extension should not send `url` by default.

### R4: Any privacy concern logging hostname in companion logs?

**Low risk, but note-worthy.** The companion sits on `127.0.0.1`, logs are local, and the tab hostname is already in `tabUrlCache` (pushed by `chrome.tabs.onUpdated` at line 858). The plan's approach — hostname is **only for knowledge selection**, not security gates — is correct. Mitigation: the companion should avoid logging the full URL string in debug/trace logs. The extension should NOT send `url` (see R3 answer), which removes query-param leakage.

---

## 4. Implementation: **Proceed after addressing F1 + F2**

F1 (case normalization) is a one-line change in `skill-engine.ts`. F2 (window query parameter) is a one-line change in the plan's helper. Both are trivially fixable. No design-level issue blocks this plan.

The three injection points identified in the plan are correct:
1. `chat.send` handler (background/index.ts ~line 390)
2. `chat.regenerate` handler (background/index.ts ~line 420)
3. QuickAction `chat.create` fallback (background/index.ts ~line 619)

One note: the `chat.regenerate` sent from `ChatView.tsx:122` does NOT pass `skill_ids`. The background handler's existing `chat.regenerate` case also omits `skill_ids` and `hostname`. The plan correctly notes it should be enriched. The companion's `chat.regenerate` handler (line 749) already has the `currentHostname` extraction — just needs the extension to send it.
