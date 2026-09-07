I'll read only `453-foundation.md` and review it against correctness, isolation, atomicity, and schema/coverage contracts.# #453 Foundation Review (independent, packet-only)

Scope judged: internal deterministic evidence/storage/pilot-contract primitives. Public capture/draft/Pack/MCP wiring is out of scope. Evidence: **[inspected]** this packet only. Machine totals (4957/16/16) are **[assumed]** as claimed, not re-executed.

## What holds

**Scope isolation.** `EvidenceStore` binds `dataDir + sha256(JSON [chat,threadId]|[mcp,grantId,sessionId])`. Path-like ids (`../thread`) cannot escape. No public tool, no model-supplied path, no observation id from the caller. `capture()` is a trusted method; mutate callbacks are internal. Two in-process instances always `read()` from disk; the async-then queue of 32 sync transactions is a valid single-loop serialization test, not a multi-process claim.

**Atomicity / capacity.** Transaction is sync read → mutate → immutability checks → `validateFile` → pretty-size → `atomicWriteJSON`. Thenables fail closed after the sync mutate body and **do not write**. Observation prefix is immutable (content edit / `shift` rejected). Unknown schema and corrupt JSON throw without replace. Count 64, 64KiB UTF-8 **after** NFC, 4MiB pretty snapshot, 16 drafts: overflow skips and does not evict. `capacity_gap` `false`→`true` cannot grow bytes (`false` is longer). Per-record oversize sets the bit without inserting. External/failed/provenance-free results never create a file.

**Capture contract.** Server UUID + server clock. Content NFC/CRLF-normalized; digest is sha256 of that. Provenance is a whitelist (scope/channel/frame/truncated + conservative coverage defaults). Browser `complete_for_scope` / extra keys are dropped. `siteTargetFromBridge` refuses query/fragment/userinfo by requiring `input.url === origin+pathname`. Title is not copied. `get_page_text` must be document scope; channel ∈ {cdp,isolated,main,dom}; frame must be top.

**Pilot / coverage.** Schema 1 only. Origins are WHATWG `url.origin` after rejecting credentials, search, hash, non-`/` path, and `*` hostnames. Shared-origin rows require unique selector+literal; match is exact origin + observed selector + whole-source token-boundary literal (so clipping `non-prod` cannot prove `prod`). Completeness is **insert-only**, post-lock, top-frame, `truncated === false`, unique binding, matching collection scope, `static_declaration_v1`/`1` only, basis `user_pilot_declaration`. Pre-lock stays `unknown`. Adapter version conflict → no completeness. Lock is write-once. Missing config loader → `{contract:null, digest:sha256("null")}`. Derived `story_requirement`/`criteria_cases` cannot appear in `mappings`.

**Unicode.** Code-point half-open offsets; NFC of both source and excerpt; token classes include `-`, so `non-prod` is one token. Tests cover emoji, combining acute, CRLF, and boundary fabrication.

These primitives are safe to later hang an authenticated executor on.

---

## Findings

### MAJOR

None that break stated foundation invariants.

### NIT

1. **`pilot-contract.ts` `parsePilotContract` / `source_bindings`** — `DERIVED_RELATIONS.has(relation) && relation !== "criteria_cases"` **allows** `criteria_cases` in `source_bindings` while rejecting `story_requirement`. Mappings correctly reject both. Brief says derived relations “cannot be manually mapped” (mappings). The exception looks intentional but is **untested** and is the only future-facing hole in the relation catalog.

2. **`pilot-contract.ts` `parsePilotContract`** — mutates `binding.origins` in place. `validateLockedPilot` on every `read()` therefore mutates in-memory contract state. Harmless if origins are already canonical; surprising on the read path.

3. **`store.ts` `capture`** — selector accepted as any string, including `""`. Empty selector cannot match a nonempty contract selector, but it can still persist.

4. **`pilot-contract.ts` `exactContractOrigin`** — `pathname === "/"` after WHATWG resolution, so `https://host/foo/..` and `https://host/.` count as exact origins. Ports/protocol are not guessed; path collapse is.

5. **Coverage gaps (future load-bearing, not current failures):** `loadPilotContract` ENOENT/null digest and non-ENOENT throw; `freshness` / `runtime_not_applicable`; locked_pilot digest mismatch; `get_page_text` + selector skip; title-absent assertion (code does not persist title; tests only regex secrets); record-count overflow from `capacity_gap: false` (current 16/16 test pre-sets the bit via oversize).

6. **`content.ts` `criterionIdentity`** — `requirementId` is NFC-normalized but not digested. A later parser that splits on `#` would be ambiguous. Not used for storage in this milestone.

---

## Scope check

Intentionally absent and **not** used as reject reasons: public capture tool, executor hook, draft checker/editor/render, Pack/MCP registration, consumer rules that completeness requires digest+adapter (called out as next milestone), enterprise config, real pilot acceptance.

---

VERDICT: APPROVE_WITH_NITS
