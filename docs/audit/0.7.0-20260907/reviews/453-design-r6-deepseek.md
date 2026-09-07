Actual model: deepseek-v4-pro, invoked through Claude Code CLI. User accepted Grok + DeepSeek review gate.

# Design Review — design-r6.md (#453 pilot-contract, derived identities, coverage writer, source metadata)

Read-only review of the packet. Focus areas per instruction: derived identities (§8/§11 + R6 exceptions), coverage writer (§3), immutable source metadata. No commands run, no files touched.

## Core areas — soundness check

**Derived identities.** `criterionId = requirement.id + "#" + SHA256(NFC criterion text)` and `criteria_mapping = JSON.stringify([criterionId, caseId])` are deterministic and safe: the checker recomputes from already-supported `requirement.id`/`acceptance_criteria`, requires exact equality with checker-generated canonical JSON, never requires the hash or JSON literal on-page, and derives `criteria_cases` read-only (model submission → INVALID_RELATION). No way for a model to inject a fake derived identity. The architecture endpoint (`system_id + "@" + revision`, explicitly labeled derived, components verified natively) is consistent with §8 rule 6's namespace rule. This holds.

**Coverage writer.** Single writer (Companion Observation constructor, pre-ingestion), contract snapshot locked at first `draft_create` per scope, re-reads required for pre-lock observations, no retroactive amendment. Ordering is implementable: constructor reads the scope's locked-contract record; absent record (pre-first-draft_create) → unknown. Consistent.

**Immutable source metadata.** `observed_at` (Companion clock) vs `source_updated_at`/`source_revision` (content-only, unknown when absent, never back-filled) is consistent with §8 freshness windows and the "no collection-time substitution" rule. `contract_digest`/`adapter_id` frozen at ingestion; checker never reinterprets old records from the live file. Consistent.

## Findings (nits — none rise to REJECT)

1. **Checker digest requirement vs pre-lock observations (coverage × citation rules).** §3: "核对器要求 Observation 的 contract_digest、adapter_id/version 与草稿快照一致" reads as blanket over all citations. But observations ingested before the scope's first `draft_create` (and post-lock observations with no matching adapter) carry coverage=unknown and no digest/adapter — and §8 rule 1 allows any successful in-scope Observation with exact excerpts to support scalars. Read literally, those observations could never support even a scalar, making the first draft permanently unverified. The safe reading: digest/adapter checks bind only coverage-bearing determinations (adapter_id present); scalar citations need only exact-excerpt/token checks. Pin this explicitly.

2. **Per-draft vs per-scope contract lock wording.** §11 "每份草稿锁定配置的 SHA-256 和快照" conflicts in wording with §3 "同 scope 的第一次 draft_create 原子锁定…后续草稿复用该快照". Per-scope lock with per-draft digest recording is the consistent reading; reword §11 to say each draft *records* the scope's locked snapshot digest.

3. **Canonical JSON serialization unpinned.** `JSON.stringify([criterionId, caseId])` equality is specified only as "exactly equals checker-generated canonical JSON". Self-consistent (checker always regenerates), but the stringify semantics (ES JSON.stringify: minimal escaping, no whitespace, no `/` escaping) should be pinned so candidate generation and cross-runtime comparison can't diverge on non-ASCII/control characters in caseIds. Also pin the derived `kind` names (`acceptance_criterion`, `test_case`) — currently only the architecture endpoint's `kind` is named.

4. **"顶层读取" vs selector scopes.** static_declaration_v1 — the only adapter shipped this version — assigns `complete_for_scope=true` only on "顶层读取", yet §10/§11 allow collection declarations with `scope.kind: selector`. If "顶层" were read as document-kind-only, selector-registered collections could never reach completeness, dead-ending the only adapter. Presumed intent (top frame; §3 "frame 指明当前实现为 top") is fine — state it.

5. **architecture_target relaxation omits the target side.** R6 lists only `architecture.system_id`/`architecture.revision` + source_binding; since R6 overrides general rules, state explicitly that the target end still requires its full native `target.system_id` in the relation citation — the exception covers only the derived `@` literal. Similarly state whether `story_requirement` citations are checked at all, given R6 reduces it to field equality.

6. **Freshness override structure.** §11 `freshness: 毫秒` is a single scalar but §8 defines three per-group windows (24h mutable / 15min runtime / 24h tests). Specify the override's shape (per group? per field?).

7. **Minor:** `criteria_cases` appears in the fixed relation list yet is rejected on submit — §9's relations map docs should carry the same note as R6. Idempotency-cache bounds/eviction unspecified (unbounded growth; harmless but unbounded). "显式对应" for criteria_mapping is operable only via full-value co-occurrence within cited ranges + source_binding — acceptable given §8's "规则/人工真值核对", but worth one sentence.

## Contradiction scan (no action needed)

Capacity/atomicity (§4/R6 partial-vs-atomic), missing/empty/[] semantics, revision/idempotency ordering, scope hashing and tool-param scope prohibition, MCP grant/session binding and revocation, origin normalization consistency (§1 vs §11), and TARGET_CHANGED/navigation_key boundary rules all check out as internally consistent across sections.

**VERDICT: APPROVE_WITH_NITS** — no remaining concrete contradiction makes the contract unimplementable or unsound; items 1–6 are wording/ambiguity risks that should be pinned before implementation to prevent divergent (fail-closed but overly strict, or dead-path) implementations.
