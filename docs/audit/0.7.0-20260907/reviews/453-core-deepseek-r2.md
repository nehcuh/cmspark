# Actual model: deepseek-v4-pro — focused R2 delta and complete affected functions

# #453 R2 Focused Review — Verdict

**Scope:** R2 delta over R1: (1) strip persisted `mutation_result` from checked/read/render views; (2) stricter business-timestamp validation (full ISO + tz, token boundaries, no date-prefix); (3) exact empty-marker + same-Observation clock for empty `runtime.assets`; (4) reject `@` in components of derived `system@revision` endpoint; (5) criteria-mapping citations must be single-row with no competing standard/case; (6) test coverage for all of the above.

I read the index plus all three parts end-to-end (both R2 delta hunks and the four full-context functions at the frozen hashes). Correctness and security passes done explicitly below.

## Correctness pass — findings

**BLOCK: none.**

**MAJOR: none.** I checked the specific regression classes the R2 spec calls out:

- *False ready via stripped history:* `checkDraft` clones before destructuring (`structuredClone(draft)` then `{ mutation_result: _historicalReply, ...publicDraft }`), so the caller's `DraftRecord` is not mutated; the scenario test confirms raw `f.draft.mutation_result.ready` stays `true` while `check(...).draft.mutation_result` is `undefined` in both the CheckedDraft and `renderDraft(...).json`. `service.create/update` still return `mutation_result` unchanged. Matches spec.
- *Empty `runtime.assets` clock:* `freshness()`'s `explicitEmpty` branch requires `businessTimestamp(time)`, a clock citation with `exactExcerpt` + token match in the *same* observation as each coverage citation, and skips only the requirement that the timestamp appear inside the empty-marker excerpt itself — the "dynamic time not inside static marker" exemption is correctly scoped. The scenario test mutates the clock to date-only `"2026-09-07"` and gets `runtime.assets:unverified` (via freshness) plus `ready:false` — proves both the regex rejection and that the empty path doesn't fabricate readiness. `coverage()` still enforces `EMPTY_NOT_EXPLICIT` against `empty_marker` (`"No assets"`), independent of the clock logic.
- *Timestamp regex:* anchored, allows `Z`/`±HH:MM` and 1–3 fractional digits; `Date.parse` catches out-of-range months/days. Date-only `"2026-09-07"` is rejected — no date-prefix truncation path survives, since the same `businessTimestamp` guard runs both in `validateCitations` (for the `.source_updated_at` fields themselves) and in `freshness` (for clock consumers).
- *`@` in endpoint components:* only `architecture_target` has `names.length > 1` (all other rules are single-name), so the rejection is exactly scoped to `system@revision`; precedence of the `||`/`&&` chain is correct (`names.length > 1 && names.some(...)` binds before the outer `||`). A blocked endpoint flows to `ENDPOINTS_UNVERIFIED` → relation not supported → gap → not ready. No false-ready window.
- *Criteria mapping single-row rule:* `!citation.excerpt.includes("\n")` plus competing-standard (token=false) and competing-case (token=true) exclusion. The swapped test uses whole-page citations and asserts `unverified`; the supported case cites `"Café 😀 works → CASE-1"`-style single rows and passes. `ids.get(id)!` and `resolve(citation)!` non-null assertions are safe: the block only runs when the field reached `supported`, meaning every citation already resolved in `validateCitations`.
- *Regression on locked mappings:* the new mapping test proves `user_confirmed` provenance is retained and — critically — that a conflicting `artifact.build_id` still flips the relation off `supported` and `ready:false`, so locked mappings cannot mask field conflicts.

## Security pass

No new trust-boundary input. The regex is anchored with no catastrophic-backtracking shape; `Date.parse` on attacker strings is bounded; all new values flow only into escaped render output (`escape()` unchanged). `structuredClone` avoids aliasing caller state. No SQL/shell/path surfaces touched.

## Tests

New/updated tests directly cover: two-platform native-ID merge rejection, complete-draft historical-vs-current readiness, exact empty marker/clock (happy + date-only rejection), swapped whole-page mapping rejection, locked-mapping conflict regression. Per index, fields/core machine 23/23 + build pass — consistent with my reading (e.g., `criteria_mapping` must be `immutable`-clocked, or its single-line member excerpts would fail `freshness`; the green tests confirm this).

## NITs (non-blocking)

1. **field-checker.ts (criteria competing check):** competing criterion text is matched with `token=false` (substring). If one criterion's text is a substring of another ("Login works" vs "Login works on mobile"), the second row is falsely rejected. Conservative direction (false-unverified, never false-ready), but real pilots will hit it. Consider word-boundary matching for standards.
2. **field-checker.ts (`businessTimestamp`):** rejects lowercase `z`, 4+ fractional digits, and bare-hour offsets (`+08`) that ES `Date.parse` accepts. Fine per spec, but the stricter surface is only documented by test, not by the caller-facing contract; worth a one-line note in `DRAFT_SCHEMAS` docs.
3. **checker.ts (`_historicalReply`):** underscore-prefixed omit-variable relies on the TS noUnusedLocals exemption convention; harmless, note if lint rules ever tighten.

## VERDICT

**push-ready.** R2 fixes hold up end-to-end against the specified regression classes; no BLOCK, no MAJOR. Three NITs are conservative-direction or documentation-level only. No enterprise/release approval is implied by this gate.

```json
{
  "deepseek-v4-pro": {
    "inputTokens": 20738,
    "outputTokens": 30015,
    "cacheReadInputTokens": 34560,
    "cacheCreationInputTokens": 0,
    "webSearchRequests": 0,
    "costUSD": 0.871345,
    "contextWindow": 200000,
    "maxOutputTokens": 32000
  }
}
```
