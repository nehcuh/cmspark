I'll review only `design-r6.md` for issue #453, looking for concrete contradictions in derived identities, the coverage writer, and immutable source metadata. No edits, commands, or extra files.# Independent design review — #453 / `design-r6.md` (R6)

Read-only review of `/private/tmp/cmspark-w1-review-snapshot/design-r6.md` only. No other files, reports, commands, or subagents. Scope is remaining concrete contradictions in this bounded contract, focused on derived identities, the coverage writer, and immutable source metadata.

R6 does close the previous holes it names: `tests.criteria_mapping` / `architecture_target` / `story_requirement` are explicit exceptions with R6-over-general priority; coverage is written once by the Companion Observation constructor; persisted source is the tuple `(tab_id, origin, url, navigation_key)` rather than “sanitized URL only.” Those three claims are internally aligned. What remains are a few places where two sentences still fork the implementation.

## 1. Derived identities

**Mostly closed.** Forward-only IDs (`system_id@revision`, `requirement.id + "#" + hex(SHA-256(NFC text))`, `JSON.stringify([criterionId, caseId])`) are not parsed back, so `@` / `#` inside native IDs do not become ambiguous. `criteria_cases` as a read-only derived relation, with `INVALID_RELATION` on submit, is consistent with “模型不得提交该关系以覆盖推导结果” given the R6 priority clause.

**Nit D1 — criterion hash bytes are not defined.** Observation digest is explicitly UTF-8 SHA-256. Criterion IDs are only `SHA256(NFC 标准原文)`. For non-ASCII acceptance criteria (the actual domain) UTF-16 vs UTF-8 hashes diverge, and submitted members must equal the verifier’s encoding. Pin “UTF-8 bytes of the NFC string, lowercase hex,” same as Observation digest.

**Nit D2 — `JSON.stringify` is the canonical member codec with no separators/escaping rule.** In this Companion that is ES `JSON.stringify` (`["id","case"]`, no spaces). The idempotency serializer in the same R6 block is a different “recursive serialize.” Keep mapping members on `JSON.stringify`; do not reuse the idempotency canonicalizer.

**Nit D3 — `story_requirement` has no story endpoint triple.** Exception correctly forbids inventing a remote story ID, but every other relation is `{system_key, kind, external_id}` × 2, and `mappings[]` must “精确对应双方端点.” Treat this relation as field-derived (draft present ∧ `story.requirement_id` == supported `requirement.id` ∧ story criteria cite the supported full set). Do not require a fabricated story `external_id`, and do not expect `mappings[]` to bind it.

**Nit D4 — evaluation order vs §8 step 1.** Step 1 marks a missing required relation as `missing` before collections run. `criteria_cases` is required on the fixed list, must not be submitted, and is only derivable after `tests.criteria_mapping` is `supported`. Under R6 priority, skip it in step 1 and emit it after the mapping field is `supported`. If step 1 is applied uniformly, `development_trace.v1` can never be 齐备.

None of these make the derived-ID rules unsound if R6 wins; D1 and D4 must be pinned or two honest implementations disagree.

## 2. Coverage writer

Intent is implementable: unique writer = Observation constructor, inside the persist path, using the snapshot locked at first `draft_create` (empty snapshot if no valid file); pre-lock Observations stay `unknown` and are not patched; verifier must not re-run adapters against the live file.

**Nit C1 — “歧义” is still undefined, and Observation has no `binding_system_key`.** Matching is specified as origin + `binding_system_key` + exact scope. Origin lives on the Observation; `binding_system_key` lives on `collection_scopes` and must be joined through `bindings[].origins`. That join is fine.

What is not fine if read literally: `development_trace.v1` will register several collections (`requirement.acceptance_criteria`, `story.acceptance_criteria`, `tests.case_ids`, `tests.criteria_mapping`, `defects.ids`) on the same DevOps origin, often with `scope.kind=document` and `static_declaration_v1`. One document read then matches many rows. If “歧义” means “more than one `collection_scopes` row,” every such read stays `unknown`, step 5 can never pass, and the schema is unimplementable.

The only reading consistent with a single Observation-level coverage triple is: **ambiguity = conflicting `adapter_id`/`adapter_version` among matches; several field paths sharing one adapter are not ambiguity.** “未知版本” is already a separate bullet, which supports that reading — but it is not written down. Write it down.

**Nit C2 — adapter/digest match must not apply to adapter-less citations.** “核对器要求 Observation 的 `contract_digest`、`adapter_id`/`version` 与草稿快照一致” sits in the coverage paragraph. Applied to every citation, it breaks the product:

- Pre-lock Observations (explicitly kept, `unknown`, re-read only for 契约覆盖) would be unusable for scalars once a real contract is locked.
- Scalar-only pages (release/artifact/commit) have no `collection_scopes` row, so no adapter is frozen; `change_material.v1` required scalars would stay `unverified`.
- That contradicts step 5: “部分/截断 Observation 内的具体字段可 supported.”

Required interpretation: digest/adapter equality is a **coverage-use** check (step 5 / 齐备展示). Scalar/token checks use origin bindings + excerpts only. `unknown` coverage ⇒ no adapter_id, and that is a valid Observation.

**Nit C3 — `complete_for_scope` is both a 3-state enum (`complete_for_scope` / `partial` / `unknown`) and a boolean (`complete_for_scope=true`).** Verifier predicates still work (`true` + `truncated=false` + pagination/virtualization not `unknown`). Freeze one record shape: tri-state `coverage` plus the two pagination enums, or a boolean plus `unknown` as a third state — not both.

**Nit C4 — “顶层读取” vs selector scope.** Frame is always `top` in this version. `static_declaration_v1` must fire on a top-frame **selector** read when that is the registered scope; otherwise named selectors in `collection_scopes` never get `complete_for_scope`. Read 顶层 as top frame, not `kind=document`.

C1/C2 are the only remaining coverage forks that can make the bounded schemas impossible. Both have a single reading that matches the rest of R6.

## 3. Immutable source metadata

R6’s persistence paragraph is consistent with §1 redaction: store WHATWG `origin`, `url = origin + pathname` (no userinfo/query/fragment), opaque `navigation_key` hashed at the **browser** boundary from the userinfo-stripped full URL (query/fragment included), never reverse the hash, never rewrite origin on context switch.

No remaining contradiction that blocks implementation.

**Nit S1 — two clocks.** Extension 采集时间 is listed on the read result; `Observation.observed_at` is Companion now and is the freshness clock. Persist one read timestamp (`observed_at`). Do not keep a second source-metadata time that freshness ignores.

**Nit S2 — constructor is the writer of stored URL fields.** Extension may send a leaky URL. “不能进入证据文件” is a persist invariant: constructor validates/coerces to origin + pathname or refuses the Observation (`不可解析`). It must **not** recompute `navigation_key` (that stays browser-boundary).

**Nit S3 — pathname serialization.** `origin + pathname` for a root URL is `https://example.com/` (WHATWG pathname `/`), not `https://example.com`. Use WHATWG serialization so the stored `url` is deterministic.

## Out of scope (not used against the verdict)

Static_declaration_v1 asserting completeness for every matching origin+scope, including a partial list page at that origin, is an accepted pilot assumption (`coverage_basis=user_pilot_declaration` + §10 page-structure gate). It is not a new R6 contradiction.

---

**Closed by R6 (for the record):** derived-ID exceptions vs “值必须在摘录中”; coverage not written by extension/model/verifier; origin + `navigation_key` persisted beside sanitized `url`; empty-contract lock; pre-lock Observations not backfilled; MCP audit captures without material APIs.

**Remaining work is interpretation pins, not new design surface:** UTF-8 for criterion hashes; `criteria_cases` skipped in step 1; coverage ambiguity = adapter conflict only; digest/adapter check only when using coverage; one coverage schema; story relation has no fake story id.

VERDICT: APPROVE_WITH_NITS
