I'll start from the R2 index and then read every numbered part, staying inside that snapshot and not touching anything else.Index lists four parts. Next I’ll read all of them as one continuous R2 packet.# #453 draft core R2 — independent review

Scope: this packet only (parts 1–4). No commands, no other reports. Claims below are **[inspected]**. Machine line (tsc / 23/23 / build 0) is taken as given, not re-executed.

Gate: every MAJOR blocks. Synthetic scenario `ready: true` is not enterprise acceptance.

---

## R2 corrections — status

| Claimed R2 fix | Verdict |
|---|---|
| checked/read/render omit `mutation_result`; only mutation retry returns the historical reply | **Holds.** `checkDraft` strips it; `service.read`/`render` go through `checkDraft`; `create`/`update` return `mutation_result` only. Scenario asserts historical `ready` stays true while the checked view is stale and `draft.mutation_result` is `undefined`. |
| Empty `runtime.assets`: coverage excerpt **equals** `empty_marker`; same complete Observation must independently cite full business time; time need not sit inside the marker | **Holds.** `explicitEmpty` skips “time ∈ this excerpt”; clock still requires `businessTimestamp` + same-`observation_id` token match. Coverage still requires exact `empty_marker`. Regression test flips `ready` on a date prefix. |
| Business times: complete ISO + timezone, whole-token, not date prefixes | **Holds.** Regex + `Date.parse`; `.source_updated_at` and runtime/tests freshness force `token: true` even though the schema marks those scalars `token: false`. `"2026-09-07"` inside `"2026-09-07T05:55:00Z"` fails the token boundary (`T` is a letter). |
| Derived architecture join rejects `@` in components | **Holds in code.** `endpoint()` returns `undefined` when `names.length > 1` and any component contains `@`, so `architecture_target` cannot become `supported` on an ambiguous `id@rev`. No dedicated regression test (NIT). |
| Criteria mapping: single row; only the expected known standard + known case; whole-page A→2 / B→1 cannot prove A→1 / B→2 | **Holds.** No `\n`; competing known standards (`token: false`) and known cases (`token: true`) must not appear in the cited range. Swapped whole-page citations asserted `unverified`. |
| False-ready / empty runtime / historical-ready–current-stale / namespace / human-mapping tests | **Present** in the packet (scenario + field-checker + repository/service). |

---

## False-ready challenges (called, not confirmed)

1. **Historical `mutation_result.ready` as current status**
   Mutation retry still returns the frozen snapshot (including `ready: true` after the clock has moved). That is the specified contract. False-ready would be echoing it on the **checked** draft. Strip + tests close that path. `service.read().ready` after time-travel on a **complete** draft is only covered via `checkDraft`, not `BusinessEvidenceService` — same function, NIT.

2. **Date prefix as runtime/tests clock**
   `Date.parse("2026-09-07")` is finite, but `businessTimestamp` rejects it, and field freshness demotes `runtime.assets` / `runtime.system_id` before `runtime_target` can use the loose relation `token: false` clock. Relation path is not a bypass.

3. **Whole-page co-occurrence for `tests.criteria_mapping`**
   Member `excerptSupportsValue` is skipped in `validateCitations` (JSON is not on the page). Derived check still requires a single-line excerpt that contains this standard + this case and **no other known** standard/case. Swapped pairs fail. Empty `ids` (`!ids.size`) cannot satisfy testing acceptance.

4. **Human `mapping_id` skips relation citations/clock**
   Endpoints + context fields must already be `supported` (so they carry their own freshness/FK checks). Invented mapping → `MAPPING_MISMATCH`. Conflicting `artifact.build_id` → relation not `supported`, `ready: false`.

5. **Runtime exemption**
   Only `change_material.v1` + locked `runtime_not_applicable.allowed` + **all** `runtime.*` `missing` + **absent** `runtime_target`. Partial/bogus runtime (`"N/A"`, no citations) drops exemption and fails ready. Cannot delete a persisted native relation (stated residual).

6. **Null/empty pilot**
   Unbound citations → not `supported`; `PILOT_CONTRACT_MISSING` if `contract` is null. No ready path.

7. **Planted `ready` on stored JSON**
   Public tools cannot write top-level `ready`. Extra schema-1 keys are preserved by design; only `mutation_result` is stripped. Residual/NIT, not a model bypass.

None of these is a remaining core false-ready.

---

## BLOCK

*(none)*

## MAJOR

*(none — gate stays open on this axis)*

## NIT

1. **`PublicDraft` is `Pick<…> & Record<string, unknown>`**, and `checkDraft` only pulls off `mutation_result`. A hand-edited extra `ready` / `gaps` on the stored record would still appear under `view.draft`. Whitelist the public keys.

2. **No test that `@` in `architecture.system_id` or `architecture.revision` demotes `architecture_target`.** The guard is real; a one-liner would lock the R2 join rule.

3. **Relation `runtime_target` timestamp uses `excerptSupportsValue(..., false)`** vs fields’ `true`. Harmless today because unverified/stale clock fields already fail endpoints, but it is a latent inconsistency.

4. **`draftRecord` accepts any `Date.parse`-able `created_at` / `updated_at` / `checked_at` / `mutation_result.checked_at`**, and does not check `mutation_result.ready === (gaps.length === 0)`. Fail-open on file corruption only.

5. **Empty-collection `empty_marker` is an existence check** on a `complete_for_scope` Observation, not a proof the rest of that Observation has no members. Kitchen-sink synthetic pages rely on the owner pointing `collection_scopes` at the real list surface — same family as the stated `static_declaration_v1` residual, not a new ready bypass if the pilot is honest.

6. **Service-level test** asserts `checked_at` changes after +24h, but not `ready` flipping on a complete draft through `BusinessEvidenceService.read` (covered at `checkDraft` instead).

---

## Accepted residuals (not findings)

Relation links use `observed_at` / mutable window except runtime; replay never evicts and counts toward 4 MiB; null pilot locks the scope; no pre-lock backfill; shared `required_fields` should stay empty or every draft of the other kind gets `PILOT_FIELDS_SCHEMA_MISMATCH`; zero standards cannot pass; native relations cannot be deleted; `static_declaration_v1` is owner-declared top-frame completeness (no iframe walk); secrets in paths/bodies are not scrubbed; Markdown is escaped data (`<br>` is renderer-owned after user `<>&` escape).

---

## VERDICT: **APPROVE_WITH_NITS**

R2 false-ready holes that this round claimed to close are closed in the core checker/repository/service/render path. No BLOCK, no MAJOR. Nits are defense-in-depth and test gaps, not merge-blocking ready lies.
