Actual model: deepseek-v4-pro.

# Independent review — #453 internal evidence/storage/pilot foundation

**Scope (one line):** Foundation primitives for deterministic internal evidence capture — content normalization/digest/excerpt/canonicalization, evidence store (atomic sync transactions, capacity, immutability), and schema1 pilot-contract validation/coverage stamping, with fixtures recorded from real `BrowserBridge.execute` output. Public tool/draft/checker/Pack wiring intentionally deferred. Read-only packet review; no commands run. Claims about machine test runs (4934 pass, Foundation 16/16, build exit 0) are taken from the packet as `[assumed]`; all code findings below are `[inspected]`.

---

## Correctness pass

**content.ts** — Normalization, digest, and excerpt logic is sound. `exactExcerpt` validates safe-integer half-open code-point ranges against NFC/CRLF-normalized content and rejects `end <= start` (packet L31–37). `excerptSupportsValue` correctly enforces whole-source token boundaries *outside* the citation range while matching only *inside* it (L43–56) — clipping `prod` out of `non-prod` is refused because `-` is in `tokenPart`, verified by the test at L442–453. NFC code-point offset semantics are proven by the `Café`/`Cafe\u0301` cases (L435–436). No off-by-one found: `end` is exclusive, `citation.end <= points.length`, loop guard `start + needle.length <= citation.end` all consistent.

`canonicalRequest` (L74–95) is deterministic, order-insensitive for object keys, order-sensitive for arrays, preserves explicit `null`, rejects `undefined`/`NaN`/`Infinity`/fractions/non-plain objects. One nuance: it silently rejects zod-parsed `optional` fields carrying `undefined` values (e.g., `"freshness": undefined`) with `INVALID_CANONICAL_REQUEST` rather than a schema error — rejected either way, so no hole.

**pilot-contract.ts** — Strict schema1 import is correctly fail-closed: unknown version → `PILOT_CONTRACT_SCHEMA_UNSUPPORTED` (L143), ambiguous same-origin bindings require unique selector+literal discriminators (L153–159), duplicates rejected, origins normalized through `exactContractOrigin` (no credentials/query/hash/path/wildcard, L136–140). `observationBinding` (L187–197) matches exact origin + exact observed selector + token-bounded literal; a two-row same-selector/different-literal configuration where both literals occur degrades to `matches.length === 2 → undefined`, i.e. coverage is *not* granted — the safe failure direction the packet promises. `applyPilotCoverage` (L200–214) only upgrades at insertion, only `truncated === false` + `frame === "top"`, only `static_declaration_v1/1`, stamps `contract_digest` + `coverage_basis: "user_pilot_declaration"` — matches the declared "user-assumed static scope" contract; conflicting adapter versions correctly refuse (L206). Digest over the *normalized* contract is idempotent under re-parse (re-normalization of origins and NFC are stable), so `validateLockedPilot` round-trips.

**store.ts** — Transaction atomicity holds for the declared model: `read → snapshot → mutate → immutability check → validateFile → capacity check → atomicRename` with zero `await` (L350–366) is one JS critical section; the 32-instance microtask interleave test (L646–655) is the right proof for the declared single-process/no-multi-writer scope. Immutability detection covers both removals and in-place edits via pre/post stringify of the original prefix (L357–359); the async-mutation guard rejects promise-returning callbacks after mutate has run, before any write, so the in-memory state is discarded (L356). Failed transactions leave bytes untouched (test L613–627); unknown schema/corruption fails closed without rewrite (test L629–644); extension fields survive read-modify-write (L598–611). `capture()` whitelists tool, `success`, provenance schema/capture_status, scope shape, channel, frame, truncated, and rebuilds the observation entirely from whitelisted fields — browser-supplied `complete_for_scope` and arbitrary keys are dropped (test L669–692). Target redaction through `siteTargetFromBridge` strips query/fragment/credentials; the `?token=private` case is skipped (L720–722), and the raw-URL secret never reaches the persisted file. Capacity rejection is content-preserving and records the `capacity_gap` bit; false→true is a 5→4 char shrink so the gap write cannot itself breach the 4MiB cap (L387–389, 413–416).

**Producer support** — `siteTargetFromBrowser` computes `navigation_key` as an HMAC of the full href *after* stripping credentials, and stores only `origin + pathname` (L848–861); `siteTargetFromBridge` enforces `navigation_key` hex64 and URL field equality against the reconstructed redacted target (L877–884). No secret crosses the boundary. `atomicWriteJSON` (io.ts) is the standard temp+rename+chmod pattern with tmp cleanup on failure; same-directory rename is atomic on both POSIX and Windows per its own comment — consistent with the declared crash-safety requirement.

---

## Security pass

- **No new execution authority**: `capture`/`transaction` are internal, never registered as public tools; observation IDs are `randomUUID`, model cannot supply identity (L370–373, 400).
- **Path safety**: store path is `path.join(dataDir, "business-evidence-v1", <sha256 hex>.json)` — scope parts are validated non-empty strings and only their hash reaches the filesystem (L62–66, 330–332); `"../thread"` inputs are inert (test L590–596).
- **No secret persistence**: URL credentials/query/fragment blocked at the target boundary; title and arbitrary browser fields excluded by whitelist; fixtures contain no real enterprise config or keys (L7).
- **Injection**: no shell/SQL/command surface anywhere; all external input flows through zod strict schemas or explicit whitelists before touching state.
- **Trust boundary**: capture requires `capture_status: "eligible"` and the documented caller duty that the result came from the local authenticated executor (L5) — the one residual trust point is declared, not hidden.

## Contract / capacity / coverage pass

- All declared ceilings enforced on write: 64 observations, 16 drafts, 64KiB normalized-UTF-8 content, 4MiB pretty-serialized scope (L272, 304, 314, 362). No eviction path exists; overflow preserves old file bytes (tests prove it).
- Pilot freeze semantics correct: pre-lock capture stays `unknown` (test L523–535); `locked_pilot` set-once enforced at store level with `PILOT_CONTRACT_IMMUTABLE` (L360); store refuses later changes.
- Missing config → `{contract: null, digest: sha256("null")}` which is exactly `canonicalRequest(null)` — digest scheme is self-consistent between `loadPilotContract` and `validateLockedPilot` (L132, 182).
- Derived relations `story_requirement`/`criteria_cases` are rejected in `mappings` (L170); schema catalogs, `freshness` (3 positive int ms overrides), and pinned `source_bindings` shape all match the packet's declared contract.

---

## Findings (packet line refs)

**BLOCK: 0. MAJOR: 0.**

**NIT-1 — error-code inconsistency for corrupt locked pilot** (`pilot-contract.ts` L130–134, `store.ts` L305): `validateLockedPilot` recomputes the digest via `parsePilotContract`, so a corrupted-but-parseable `locked_pilot` inside the evidence file raises a raw ZodError or `PILOT_CONTRACT_SCHEMA_UNSUPPORTED` instead of `PILOT_CONTRACT_CORRUPT`. Failure mode: error-code-driven handlers misclassify corruption as schema drift. Fails closed regardless; suggest catching parse errors and rethrowing `PILOT_CONTRACT_CORRUPT`.

**NIT-2 — provenance payload not re-validated on read** (`store.ts` L306–321): `validateFile` checks `provenance` is merely an object; scope/channel/frame/truncated/coverage flags of *persisted* observations are not shape-checked. A structurally valid but tampered file could present `complete_for_scope: true` through `read()`. This is tolerable only because the foundation stamps `contract_digest` + `adapter_id/version` and the declared checker-milestone rule requires their match — I flag it so the checker milestone enforces that rule unconditionally (do not trust completeness without digest+adapter match).

**NIT-3 — `source_bindings` asymmetry for derived relations** (`pilot-contract.ts` L164–166): `criteria_cases` is allowed in `source_bindings` while `story_requirement` is rejected. Looks deliberate (cases→criteria needs cross-system namespaces) but means cross-system story→requirement binding is unavailable to contracts. Fail-safe direction (rejection), no block — confirm intent in the checker milestone.

**NIT-4 — `canonicalRequest` renders `-0` as `"0"`** (`content.ts` L87): `String(-0)` produces a theoretical digest collision with `0`. Unreachable today (zod `int().positive()` rejects `-0` in the only numeric contract fields) — worth a defensive `Object.is(item, -0)` throw.

**NIT-5 — `bindings` lacks `.min(1)`** (`pilot-contract.ts` L117): a zero-binding contract with no collection scopes validates and locks a useless config. Safe (coverage can never apply); consider rejecting as invalid config.

**NIT-6 — read-size check is not atomic with the read** (`store.ts` L337–338): a file grown between `statSync` and `readFileSync` (external writer) is fully buffered before the byte-length check. Consistent with the declared single-process/no-multi-writer model — noted only.

**NIT-7 — ceiling interaction (informational)** (`store.ts` L272, L362): 64 × 64KiB = exactly 4MiB of content alone, so the 4MiB pretty-printed file cap binds *before* the 64-record cap for full-size records (roughly 63 max). Capacity rejection remains content-preserving and gap-recorded, but callers should not assume 64 full-size records persist.

**NIT-8 — capacity-error surface from capture** (`store.ts` L412–417): any `EVIDENCE_CAPACITY` (including a pre-existing drafts overflow that the gap bit cannot repair) triggers the gap transaction; if that second transaction also throws, `capture` throws instead of returning `skipped/CAPACITY`. Fail-closed, but broader than the reason string implies.

## Coverage adequacy

Tests cover the high-risk contracts well: NFC/CRLF normalization and code-point offsets, token-clipping refusal, scope hashing with hostile inputs, canonicalization invariants, schema-unknown/corruption fail-closed, atomicity under failed transactions, synchronous multi-instance mutation, immutability enforcement, capacity with gap bit, secret non-persistence, pre/post-lock coverage freeze, unknown/clipped/conflicting adapter negatives, and same-origin environment discrimination — all against a fixture produced by the real `BrowserBridge.execute` path (recorder script, L935–967), which the packet correctly labels as a wire fixture, not enterprise acceptance. Minor untested paths (e.g., `loadPilotContract` ENOENT→null, non-default-port origin binding) are low-risk and covered indirectly by construction.

---

**VERDICT: APPROVE_WITH_NITS**

No unsound primitive or storage contract found; all declared invariants (atomicity, capacity, immutability, fail-closed reads, redaction, pilot freeze/coverage rules) are implemented and test-proven. The eight nits are future-safety annotations, none of which weaken the foundation for the intended authenticated executor/service integration, and none requires scope expansion into the deferred milestones.