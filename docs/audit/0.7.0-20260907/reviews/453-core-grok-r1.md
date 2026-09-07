I'll review #453 draft core as specified: index first, then every numbered part, with no other files, commands, or edits.Index lists four sequential parts. Reading them in order next.Part 1 cuts off mid `field-checker.ts`. Continuing with the remaining numbered parts.Part 2 also ends mid-test. Reading parts 3 and 4 to complete the packet.# #453 draft core — independent review

Scope is this packet only. Public executor/Packs are later. Foundation primitives are taken as given. Checker **`ready`** is the bar for false-ready.

## VERDICT: **APPROVE_WITH_NITS**

No BLOCK. Authoritative `CheckedDraft.ready` does not go true on unbound citations, mixed namespaces, clipped tokens, stale clocks, incomplete collection coverage, invented mappings, submitted unverified runtime, capacity gap, missing story text, or non-pass test outcome. Remaining issues are a fail-closed clock/coverage contradiction, a dual-ready DTO footgun, and test/operational nits.

---

## BLOCK

None.

No path in this packet yields `ready: true` while skipping exact excerpt, binding, single `system_key`, environment (including the agnostic/`runtime.`/`target.` exceptions), collection adapter+scope+`user_pilot_declaration`, empty-marker exactness, foreign keys, identity context, derived criteria mapping (original standard text + case id, not a page hash), locked-pilot runtime exemption rules, or `EVIDENCE_CAPACITY_GAP`.

---

## MAJOR

### M1. Empty `runtime.assets` cannot be both explicit-empty and clock-valid

`runtime.assets` is `collection("runtime")`. Freshness requires **every** citation range — including `coverage_citations` — to contain `runtime.source_updated_at`. Empty collections also require **every** coverage excerpt `=== adapter.empty_marker`.

Those two rules cannot hold together: the empty marker is a locked, page-independent string and cannot contain the per-observation business time. `empty_marker` is not per-draft, so it cannot be set to the timestamp either.

Effect: “runtime applies, inventory is empty” is unsatisfiable. The only ready paths are non-empty assets or full runtime exemption (all `runtime.*` **missing** and no `runtime_target`). Fail-closed, not false-ready, but it contradicts the packet contract that empty collections are a first-class evidenced state.

### M2. Checked/render JSON carries two `ready` bits that can diverge

`checkDraft` correctly sets top-level `ready` from current `gaps`. The embedded `draft.mutation_result` is the historical retry snapshot (by design for `create`/`update` replay).

`BusinessEvidenceService.read` / `renderDraft` return that full record. After the freshness window, `json.ready === false` while `json.draft.mutation_result.ready === true` is possible. Markdown uses `view.ready` (safe). The JSON side-channel is the false-ready leak into the next public-tools packet.

Mutation replay of `mutation_result` itself is specified; the problem is **not stripping it from the checked view**.

The repository test only asserts `checked_at` inequality on an always-unready draft. It does not pin “historical `mutation_result.ready` stays true, current `read().ready` is false.”

---

## NIT

1. **Non-runtime relations use `observed_at` + `mutable_ms`**, not the tests/runtime business clock. `tests_commit` can go `stale` while `tests.*` fields remain supported (or the reverse). Fail-closed, but clocks are not one vocabulary.

2. **Relations cannot be removed.** Merge is spread-only. A mistaken `runtime_target` permanently blocks exemption.

3. **Missing `pilot.json` on first create locks `contract: null` forever** for that scope (`PILOT_CONTRACT_IMMUTABLE` + digest). Intended, but that scope can never become ready.

4. **Capture-before-lock observations never gain coverage** (append-only). Collections stay `COVERAGE_UNKNOWN`. Operational order is mandatory and unstated in this core.

5. **`required_fields` is not per-kind.** A shared pilot that lists `release.id` makes every `development_trace.v1` hit `PILOT_FIELDS_SCHEMA_MISMATCH`.

6. **Render autolinks.** Markdown specials and HTML are escaped (`<script>`, `![secret](...)`, `<img` covered). `:` `/` are not, so `source.url` can still autolink. Newlines become renderer-owned `<br>` after escaping (OK).

7. **Runtime/tests clocks use `token: false`.** A prefix of a longer ISO string can verify (e.g. `2026-09-07` inside `2026-09-07T05:55:00Z`).

8. **Empty `requirement.acceptance_criteria` can be field-supported, but mapping always fails `!ids.size`.** Ready is unreachable. Likely intended; same shape as M1, weaker business case.

9. **Test gaps vs stated contract:** no case for `SOURCE_NAMESPACE_MISMATCH`; no successful `mapping_id` / `user_confirmed` path; no story source outside `requirement.id`’s `system_key`; no immutable field surviving `observed_at` staleness; criteria-mapping test name claims locked namespaces but only mutates case id / partial coverage.

10. **Whole-page citations** (scenario) make “same cited range” weak; the tight-range guard is the real one and **is** tested (`cite("SYS-1")` → `SOURCE_TIME_UNVERIFIED`).

11. **`coverage_basis` only walks field citations**, not relation citations.

12. **Endpoint `external_id` is `join("@")`.** Values containing `@` can collide. Mapping authors must know this join.

---

## What holds (in-scope)

| Area | Result |
|---|---|
| **Schemas** | Strict create/update/read; two kinds; no caller owner/scope/status; derived relations not writable; collection uniqueness / member indexes. |
| **Citations** | `exactExcerpt` + `excerptSupportsValue`; clipped `prod` in `non-prod` refused; NFC/code-point offsets. |
| **Namespaces** | Single `system_key` per field; relation endpoints `{system_key, kind, external_id}`; native IDs agreeing is not enough. |
| **Clocks** | Immutable skips TTL; runtime/tests require same observation + time inside the field range; future skew `>5min` unverified; old mutable → `stale`. |
| **Coverage** | Adapter/scope/digest/frame/pagination/virtualization/`user_pilot_declaration`; empty marker exact; truncated scalar ≠ complete collection. |
| **Criteria mapping** | `criterionIdentity(req, original text)` + case token on the source page; hash not required on the page; all standards covered. |
| **Story** | Derived; same `system_key` as `requirement.id`; creative text uncited; missing text blocks ready. |
| **Runtime exemption** | Locked `allowed` + all `runtime.*` **missing** + no `runtime_target`; `{value:"N/A", citations:[]}` is unverified and **cancels** exemption. Fields stay `missing`, not fake-supported. |
| **Pilot lock** | First create in the same transaction; later file edits ignored; store refuses pilot rewrite. |
| **Concurrency / replay / capacity** | Sync critical section; idempotent reply is the original revision **before** stale-revision checks; digest mismatch → `IDEMPOTENCY_CONFLICT`; byte/count caps include replay; no eviction; corrupt versions/dup ids/bad replay fail closed without overwrite. |
| **Ready label** | `齐备待复核` / still-need-human; passing tests do not print `研发完成`; `TESTS_NOT_PASSING` on non-pass. |
| **Inert markdown** | Title/story XSS and image syntax escaped in the tested production chain. |

---

## Not counted against this packet

Public MCP/tool executor, Packs, version bump, multi-platform/model acceptance (#457), multi-process writers (explicitly unsupported). Machine claim `tsc + 20/20 + production build` is taken as given, not re-run.

**Before public tools:** drop `mutation_result` from checked/render JSON (keep it only on the replay path), and either special-case empty runtime collections for the clock rule or document that empty runtime inventory is not a representable ready state.
