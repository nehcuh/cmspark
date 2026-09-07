# Actual model: deepseek-v4-pro

- **N1 — Identity: `endpoint()` external_id is `values.join("@")`** (`part2 checker.ts`, endpoint fn ≈ line 69). IDs containing `@` can collide (`"A@B"+"C"` ≡ `"A"+"B@C"`), so a `sameEndpoint` comparison against a locked contract mapping could match the wrong pair. Requires crafted IDs plus an operator mapping; low severity, but the join delimiter is an unstated identity assumption.
- **N2 — Relation clock uses capture time, not endpoint semantics** (`part2 checker.ts`, relation loop ≈ line 104). Non-runtime relations use `observation.observed_at` with the mutable window (24 h default), so a 25-hour-old capture of an immutable linkage (`tests_commit`, `release_artifact` over commit IDs) goes stale. Fail-safe direction (`ready: false`), but inconsistent with the endpoints' `immutable` clock.
- **N3 — Coverage: `applyPilotCoverage` stamps `complete_for_scope` without asserting iframe absence** (`part4 pilot-contract.ts` ≈ lines 90–104). Collection members inside untraversed iframes would sit silently inside declared coverage. Mitigated by the renderer disclaimer ("静态范围来自试点声明，不代表自动遍历") and the static-declaration adapter, but the provenance assertion list (pagination/virtualization/frame/truncated) conspicuously omits `iframe_coverage`.
- **N4 — Replay cache has no eviction or TTL** (`part1 draft-repository.ts`, mutate ≈ line 177). Matches the "no eviction" claim, and the 4 MB `scopeBytes` cap makes overflow fail closed, but a scope flooded with unique `request_id`s eventually locks out all future mutations (`EVIDENCE_CAPACITY`). Worth an operational note or future replay TTL.
- **N5 — Renderer leaves `:` and `/` unescaped** (`part2 render.ts`, escape ≈ line 155). Bare URLs can autolink/unfurl in rich Markdown viewers. Not a rendering-instruction risk (`[]()!<>` are all escaped; test confirms no `<img`/`![...]`/`<script>`), but wrapping URLs in backticks would close it. The `json` field is intentionally raw data.
- **N6 — Locked pilot rotation** (`part1 draft-repository.ts`, create ≈ line 185). After first create, an updated `pilot-contract.json` is permanently ignored for that scope (lock immutability, tested intentionally). Operational consequence: contract rotation requires a new scope or server-side file surgery. Documented behavior, but worth stating in ops docs.

## Verdict

**APPROVE_WITH_NITS** — 0 BLOCK, 1 MAJOR (time-zone parsing boundary, fixable pre-merge or accepted with rationale), 6 NITs.

The packet is coherent end-to-end: schemas are strict and bounded, the repository is idempotent/replay-safe/race-safe within the documented single-process boundary, the checker is aggressively fail-closed across all five challenge axes (identity, time, coverage, namespace, replay), the renderer is inert, and every false-ready claim I tested in the header survives static challenge. The 20-test count claim checks out against visible registrations; tsc/build results and the grok-4.6/deepseek-v4-pro foundation acceptance are outside this packet and honestly scoped as such by the header.

```json
{
  "deepseek-v4-pro": {
    "inputTokens": 33472,
    "outputTokens": 65580,
    "cacheReadInputTokens": 114560,
    "cacheCreationInputTokens": 0,
    "webSearchRequests": 0,
    "costUSD": 1.8641400000000004,
    "contextWindow": 200000,
    "maxOutputTokens": 32000
  }
}
```
