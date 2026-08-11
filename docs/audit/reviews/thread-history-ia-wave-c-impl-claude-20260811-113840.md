I've inspected the diff, the untracked Wave C files (`companion/src/threads/related.ts`, `chrome-extension/src/sidepanel/utils/thread-related.ts`, and their tests), the spec, and run the test suites. Verdict below.

## Findings

### Acceptance — all met [executed]
- **C-1** `thread.related` pure local: companion handler `message-router.ts:1379-1403` + client mirror `chrome-extension/src/sidepanel/utils/thread-related.ts`. Signals = co-tag (Jaccard × 3.0) + TF cosine (× 1.5, threshold 0.08) + time (× 0.5, 7-day window). **No `@` edges** (C.1b deferred — `scoreRelatedPair` only emits the three signals above). ✓
- **C-2** 🔗 on every row (`ThreadList.tsx:699-708`), top-3 via `findRelatedThreads(seed, filtered, 3)`; click → `handleSelect(h.thread_id)`. ✓
- **C-3** Graph is a portal popup (`graphOverlay zIndex 10080`), triggered only from `⋯ → 🕸 关联图谱`; never replaces time axis. Empty state handled. Edges from `buildRelatedEdges` over digests. ✓
- **C-4** `digestLintStats` returns `{untagged, stale, isolated}`; rendered in cleanup helper header. ✓
- **S9** All weights are top-level `const` in both mirrors — no UI/settings surface. ✓

### Rejection gates — all clear
- R1 popup-only (graph not default nav); R2 no embedding/graphDB/llm_wiki; R3 no `@`; R4 no Knowledge dual-write; R5 no L2/confirm; R6 tests pass: **extension 614/614**, **companion 2700/2700 + 20 skipped**, thread-related suites green. ✓

### ADR-020 capability
Surface L0, Composition none, Autonomy n/a, Trust/Channel unchanged — declaration in prompt matches diff. No new tools, gates, primary UI chrome, or runtime. ✓

### Must-answer
1. C-1..C-4 + S6/S9 met (S6 = no `@` edges confirmed). ✓
2. Still L0 only — ephemeral scores, no Skill/Knowledge/Pack dual-write. ✓
3. A→B→C pipeline shippable — A r2 + B already both_ok, C is the closing slice; no cross-wave coupling introduced. ✓

## Non-blocking nits

1. **Patch diff is incomplete** — `thread-history-ia-wave-c-impl-diff-20260811-113840.patch` only captures tracked-file mods (Wave A/B remnants + small wire-up). The 4 untracked Wave C files (`companion/src/threads/related.ts`, `chrome-extension/src/sidepanel/utils/thread-related.ts`, + 2 tests) are the actual core implementation and were omitted. Diff-capture issue, not a code issue — regenerate with `git add -N` + `git diff HEAD`.
2. **Client mirror tokenizer divergence** — `chrome-extension/src/sidepanel/utils/thread-related.ts:36-55` does not filter `STOP_WORDS` that the companion's `semantic-match.tokenize` filters. Minor ranking skew between mirror and companion; UI hint only, harmless.
3. **`digestLintStats` is O(n²)** — calls `findRelatedThreads(live, 1)` per thread (`thread-related.ts:194`). Fine at typical scale (<300 threads); would degrade on large libraries. Could reuse one `buildRelatedEdges` pass + degree count.
4. **Thin companion tests** — `companion/tests/thread-related.test.ts` has 2 happy-path tests; skips trashed seed, no-digest seed, and `buildRelatedEdges` cap behavior. The extension mirror has fuller coverage, so not blocking.
5. **Unused WS bridge today** — `background/index.ts:825-833` dispatches `thread.related` to companion, but current UI uses the local mirror exclusively. Spec-prescribed (mirror + server), not dead code per spec; flag for awareness.

VERDICT: APPROVE_WITH_NITS
