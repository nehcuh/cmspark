I have enough context. The patch file is just the diff of an untracked design doc (no code changes), and the design is a SoT spec, not an implementation. I'll synthesize the review now.

---

## Summary

The Thread History IA design is a product/UX SoT (no code changes; pure spec). Its capability declaration is clean — pure L0 navigation metadata, no Composition primitives, no L2, trust monotonicity preserved — and its P0 scope (Timeline + multi-select + batch_delete + local search) targets the right user pains (find/connect/clean). The biggest conceptual risk — silent AI deletion — is correctly excluded by design principle #3. However, several protocol/UX details are under-specified enough that an implementer reading the spec cold will diverge; none require re-architecture, but they should be pinned before coding.

## What holds

- **ADR-020 alignment** (`docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md:455-457`): digest/tags explicitly **not** Composition primitives; no L2 sneak; no Pack-first breach; multi-agent aligns with ADR-015 (`parent_thread_id`/`orchestrator_run_id` already exist on `Thread`, `thread-manager.ts:53-57`).
- **Trust-release invariance** is correctly called out at `spec:260` and is testable against existing `releaseTrustBeforeThreadGone` (`pack-engine.ts:391`, `message-router.ts:1080,1094`).
- **Digest reuse** of `buildSummaryTranscript` + `llmExtract` is real (`summary-export.ts:65`, `llm-extract.ts`); the "≠ NotebookLM long-summary" guardrail at `spec:213` is the right cost brake.
- **Default-off scheduled digest**, AI-suggest-never-auto-delete, and "summary_card only" `@` policy are the right safety postures.
- **Timeline as default axis** is the correct product call (vs Tag/Graph) for the JTBD "find recent".

## Gaps / underspec (would block clean implementation)

- **G1 — `indexLock` claim is inaccurate** (`spec:202`). Says "batch_delete 必须走 indexLock（与 create/delete 同级）", but `withIndexLock` is **defined but never called** anywhere in `companion/src` (grep confirms only the definition site). Current `thread.delete`/`thread.create` are sync, lock-free. Implementer reading "同级" will skip the lock. Spec should say "**introduce** indexLock for batch_delete; optionally retrofit create/delete".
- **G2 — `batch_delete` atomicity / failure semantics undefined** (`spec:194-195, 300`). If 30 of 50 succeed and 31st trust-release throws: rollback? commit-30-and-report-failed? continue-on-error? The `thread.batch_deleted { thread_ids, failed? }` shape implies "failed list" but doesn't pin per-id ordering (release → delete → next) nor whether companion **broadcasts `thread.deleted` per id to other sessions** (today single `thread.delete` does **not** broadcast — `message-router.ts:1086-1087`; only `cleanup_empty` does at `:1104`). Two side-panels-open will desync unless spec pins this.
- **G3 — `digest.content_fingerprint` definition loose** (`spec:163`). "消息数 + 末条 id/hash 的廉价指纹" — implementer will invent. Pin to e.g. `${messages.length}:${lastMessageId}` and explicitly accept the edit-case stale risk (there's no edit feature today).
- **G4 — `@` injection system-prompt format unpinned** (`spec:228-242`). "数据段非指令段（可加 fence）" — but no exact fence (``` vs XML), no per-card token cap (only total ≤1500), no sanitization of digest content that may itself contain fences. Prompt-injection defense needs a concrete format the implementer can test against.
- **G5 — Multi-select + active-thread semantics missing** (`spec:99-112`). If `activeThreadId` is in the selected set and user confirms delete: block? pick `filtered[0]` (current `REMOVE_THREAD` behavior at `agentStore.tsx:406-410`)? create new? Not specified.
- **G6 — Worker-thread time-line policy undecided but load-bearing for P0** (`spec:417` Q2). User with 1 orchestrator + 10 workers today sees 11 flat entries. Spec says "建议默认折叠" but lists it as open question; P0 deliverables don't include folding UI. Either commit to "P0 ships flat, P1 folds" or pull folding into P0.
- **G7 — Search scope includes tags that don't exist in P0** (`spec:79`). "本地 filter（alias / id / tags）" — tags land in P1. P0 search scope should be `alias + id + first-user-message preview`.
- **G8 — Tag secret-shape regex not specified** (`spec:256`). "tags 禁止写入密钥形态（简单正则扫描）" — no pattern given. Without it, the acceptance test "tag 规范化" (`spec:340`) is untestable.

## Product / UX issues

- **P1 — Panel height vs. multi-select bottom bar.** Existing `panel.maxHeight = 320` (`ThreadList.tsx:206`). Multi-select adds a bottom action bar (`已选 N · 提取要点 · 删除 · 取消`) **plus** search bar **plus** view switcher **plus** today/month headers. With 200+ threads, the actual scroll viewport shrinks below usability. Appendix A wireframe (`spec:445-450`) implies a taller panel. Either bump panel to ~480px when multi-select active, or route to a full-height modal. Spec silent.
- **P2 — "今天/昨天/本周/月" bucketing has OR-branch** (`spec:74-76`). "「昨天」可选二级…再早进「本周」或直接月" — implementer must pick one. Pin it.
- **P3 — Multi-select entry: 3 patterns listed** (`spec:100`). "列表头「选择」或长按 / 勾选图标" — pick one primary; others optional.
- **P4 — 「整理…」 entry not in wireframe** (`spec:137` vs Appendix A). Tension.

## Architecture / ADR-020 / security

- **No ADR-020 violation.** Surface=L0, Compose=none, Autonomy aligns with existing multi-agent (no new runtime), Trust gate preserved (per-id `releaseTrustBeforeThreadGone`), Channel unchanged.
- **`@` prompt-injection**: summary_card-only default + token budget is the right posture, but needs G4 fix to be testable.
- **Trash field** (`trashed_at`) is additive on `Thread`; migration is just "absent = alive". OK.
- **No double-write with ADR-008 export** — `spec:217` correctly says export→digest writeback is `source: on_export` opt-in, not mandatory.

## P0 scope verdict

**Right-sized for find/clean, but missing two must-haves (G6 worker policy, P1 panel-height plan) that should be pinned before coding starts.** Neither requires re-architecture — they're 1-2 paragraphs of clarification.

## Blocking (must resolve before coding P0)

None. The above are all clarifications, not conceptual errors, security holes, or ADR conflicts.

## Nits (non-blocking; can fix in-spec or during impl)

- N1: G1 — replace "indexLock 同级" with "introduce indexLock for batch_delete".
- N2: G2 — pin per-id order (`releaseTrust` → `delete` → next; collect failures) and broadcast `thread.deleted` per id (and consider fixing single-delete's existing no-broadcast bug while there).
- N3: G3 — pin `content_fingerprint = ${messages.length}:${lastMessageId}` explicitly.
- N4: G4 — pin `@` system-prompt fence format, per-card token cap, digest-content sanitization.
- N5: G5 — specify active-thread-in-selection behavior.
- N6: G6 — either commit "P0 flat, P1 folds workers" or pull folding into P0 deliverables.
- N7: G7 — drop "tags" from P0 search scope; add "first-user-message preview".
- N8: G8 — provide the secret-shape regex (`/(sk-|api[_-]?key|password|secret|token)/i` or similar) so the test is deterministic.
- N9: P1 — specify panel resize/modal policy for multi-select.
- N10: P2/P3/P4 — pin bucketing rule, primary multi-select entry,「整理」location.
- N11: Add an acceptance test name anchor for batch trust-release (e.g., "companion/tests/threads.batch-delete.test.ts: releases trust per id, continues on failure, broadcasts per id").
- N12: §6 Slice A item 5 should explicitly include "tz-boundary grouping (cross-midnight)" — already implied but worth pinning since `monotonicTimestamp` is in-process only (`thread-manager.ts:158-172`) and wall-clock bucketing will hit real tz issues.

## Recommended pre-dev decisions

1. Pin G2 (failure semantics + broadcast) — this is the one most likely to cause regression whack-a-mole during impl.
2. Pin G6 (worker folding in P0 or defer) — affects Slice A UI scope directly.
3. Decide panel/modal question (P1) before estimating P0 effort — it changes the component shape.
4. Adopt N8 regex in the same PR as `validateTag()` so the acceptance test `spec:340` is meaningful.

VERDICT: APPROVE_WITH_NITS
