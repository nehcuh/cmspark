# Actual model: deepseek-v4-pro

# Independent M1 closure review — #456 context projection lane

## M1 — CLEARED (unreachable via actual producer/lookup chain)

M1's condition was: raw unparsed grant fields reach `firstGrant.context_origins.includes(...)` as a string, turning `Array.includes` into `String.includes` substring matching. Traced against the real producer/lookup, that condition is false at three independent layers:

**1. Producer validates.** `issueOutboundGrant` (outbound-grants.ts) runs `parseContextPermission({ allow_context_export, context_origins, context_knowledge_ids })` before composing the record. The zod schema is `z.array(origin).max(64)` — a string `"https://portal.test"` as `context_origins` **throws** at `.array()` parse and never persists. `origin`'s transform additionally rejects non-exact origins (`username/password/search/hash/pathname !== "/"`) and normalizes (lowercase, default-port strip) via `url.origin`; the duplicate check catches post-normalization dupes. Persisted records therefore contain only normalized exact-origin arrays.

**2. Load re-validates with deny-fallback.** `loadFile()` maps **every** record through `normalizeGrant`, which spreads `contextPermissionFromRecord(raw)` — a full `parseContextPermission` re-parse whose catch returns `{ allow_context_export: false, context_origins: [], context_knowledge_ids: [] }`. A hypothetically tampered on-disk record with `context_origins: "https://portal.test"` (string) fails zod → falls back to `[]` → every origin gate is false → SCOPE_DENIED. Same for `allow_context_export: "false"` (the related minor): `z.boolean()` throws on the string at creation, and the load fallback coerces to `false`, and `requireContextGrant` demands strict `=== true`. Deny-biased on both paths; cleared.

**3. The actual GrantLookup is `lookupContextGrant`, and it re-applies the same parse.** Production wiring (companion-http.ts:50–78): `new ContextSessionRegistry(lookupContextGrant)`; and companion-http.ts:675–748: the `site_context` branch invokes `projectOutboundContext(..., { lookupGrant: lookupContextGrant, ... })` and separately `requireLiveGrant(lookupContextGrant, ...)`. `lookupContextGrant` returns `{ ...contextPermissionFromRecord(record) }` — so every read the projection performs (`firstGrant`, `current`, session scope/resolve) yields zod-normalized arrays. `firstGrant.context_origins.includes(target.origin)` is therefore `Array.prototype.includes` with exact membership: `["https://portal.test"].includes("https://portal.test.attacker.net")` is `false`. There is no reachable path where `.includes` receives a string receiver. The M1 example being false is irrelevant; the type question itself is closed by the producer + load + lookup chain.

## Remaining NITs (none blocking)

- **N1 (retain, cosmetic):** companion-http.ts:480–513 confirms the handler classifies by `instanceof ContextSessionUnavailable → session_invalid: true`, so no mis-classification occurs. A distinct message string is still worth it for error-tab readability only.
- **N2 (cleared):** production `resolveBrowserSiteTarget` enforces `tabId`; the projection's before/after snapshot gate plus resolver check covers it. Optional redundant assert only.
- **N3 (cleared):** origins and per-doc IDs are explicit independent export permissions by design; confirm-outcome `"n/a"` audit is fine.
- **N4 (accepted architecture):** bridge owns the HMAC key; server-side `TARGET_CHANGED` is the snapshot compare it can do. Same trust model as target production. Not a lane defect.
- **N5 (retain):** version hash excludes `source.id`; doc id is compared separately at the final filter, so no concrete failure — fragile-by-construction only.
- **N6 (out of lane):** session capacity/capture reviewed under core/HTTP; no unlimited-retention claim in this lane.
- **N7 (cleared):** `applyTabNavigated` writes shared browser-metadata tab cache, not Chat-scoped memory.

## Verdict

**Projection lane: APPROVED — M1 cleared, no BLOCK, no MAJOR.** The exact-origin guarantee holds end-to-end: create-normalize → load-revalidate-with-deny-fallback → lookup-reparse → exact `===`/Array.includes gates, with the HTTP wiring using `lookupContextGrant` at every projection read. Retained items are NITs only (N1 cosmetic, N5 future-proofing).

```json
{
  "deepseek-v4-pro": {
    "inputTokens": 16285,
    "outputTokens": 7051,
    "cacheReadInputTokens": 0,
    "cacheCreationInputTokens": 0,
    "webSearchRequests": 0,
    "costUSD": 0.2577,
    "contextWindow": 200000,
    "maxOutputTokens": 32000
  }
}
```
