I have everything I need. Let me record findings.

## Independent review — Wave B H1 ThreadHandoff **plan** (pre-code)

### Patch freshness
The diff in `wave-b-h1-thread-handoff-plan-diff-20260807-104642.patch` is the dirty working tree (Wave A scene-knowledge residue: `knowledge_refs`/`active_knowledge_ids` in packs/types/validator/etc.). It contains **no Wave B H1 code** — which is correct, since this is a **plan** review (the only Wave B H1 artifact is the new plan file itself, line 72 of the patch index). Not stale.

### Rejection gates
- **R1 (merge into Digest/Export/global knowledge)** — PASS. H-D1 + non-goals ("Changing Digest extract", "Auto-write project-knowledge"). File map only touches `context-budget*` / `runtime-context-budget` / `adapter` / ChatView chip — no Digest/Export paths.
- **R2 (raw reasoning_content as notice body)** — PASS. H-D4 + H-D7: notice body = `formatHandoffForNotice(handoff)` labeled bullets; reasoning only as optional input slices (≤1500 tok), never the body.
- **R3 (removes M1 floor)** — PASS. H-D6 cascade H1→M2→M1; `context-budget-m2.ts` retained as fallback; success criterion #2.
- **R4 (schema inventable / unclosed)** — PASS. `ThreadHandoff` frozen with `HANDOFF_CAPS` (5/8/8/8/8 entries; 120/160/120/120/80 chars). Inject prefix `[context_handoff]` locked (H-D2). `isOmitNotice` extended to 3 prefixes (H-D3).
- **R5 (mid_loop re-extract latency bomb)** — PASS. H-D8 + `shouldRunM2` already returns false for mid_loop (`context-budget-m2.ts:88`); Task 3 mirrors `retainMidLoopRollingSummary` for re-attach.

### Must-answer
1. **Schema + caps adequate?** Yes. Maps to Mem0's Facts/Decisions/Constraints/Open-todos + artifacts (§2.4 of parent). All grounding helpers exist: `llmExtract`, `buildRedactedTranscript` (`context-budget.ts:162`), `shortSha256`, `shouldRunM2`, `retainMidLoopRollingSummary`, `sanitizeRuntimeContextBudget`.
2. **Reuse `context_compaction_m2` gate OK?** Yes. H1 is strictly richer M2; user-disables-M2 semantics stay coherent (no H1 either). Naming leak acknowledged in plan.
3. **Cascades + retain correct?** Yes. H-D6 + Task 3 nest M2 inside H1 failure; mid_loop retain mirrors existing helper; Task 4 adds `handoff?` to meta with sanitize.
4. **Implementable without invention?** Yes. All signatures sketched, file map complete, no TBD.

### ADR-020 capability declaration
Present and correct (Surface L0 / Compose none / Autonomy n/a / Trust no-elevation F-S5 / Channel unchanged). Trust monotonicity preserved — H1 reuses `redactMessagesForCompaction` (F-S5) verbatim. P1-1..P1-4 watchlist all clean.

### Non-blocking nits

- **N1 — Cap-layer consistency.** Raw schema max ≈ 4440 chars (5×120 + 8×160 + 8×120 + 8×120 + 8×80) but `formatHandoffForNotice` caps at ≤2000 chars. Plan should specify the overflow policy (drop later sections in priority order vs truncate within section). Currently ambiguous.
- **N2 — H1 failure audit.** H-D9 only specifies audit on success (sha256+bytes). On H1 fail → M2 fallback, no `h1_error` audit line is required. For monitoring context-poisoning regressions vs M2 baseline, add a one-line `h1_error` field on failure (no full text needed).
- **N3 — mid_loop mode honesty carryover.** `retainMidLoopRollingSummary` carries an N7 docstring ("mode 'm2' = carries notice, not fresh gen this pass"). Mirroring for H1 should require the same honesty note for `mode = "h1"` after re-attach. Implied by "mirror" but not explicit.
- **N4 — Doubled latency on cascade.** H1 fail → M2 fires means two sequential llmExtract calls (≤90s worst case). Add a `h1_fallback_to_m2` counter in audit so real-world failure rate is observable. Not blocking Wave B but worth a TODO.
- **N5 — Reasoning slice source.** H-D7 says "optional redacted reasoning slices from dropped msgs' `reasoning_content`" — add one sentence in Task 2 specifying: assistant msgs only, run through `scrubSecretPatterns`, truncate to 1500 tok alongside the 2500 tok dropped transcript. Already implied by "redacted" but should be explicit.
- **N6 — Config tooltip.** `context_compaction_m2` now gates H1 too. Plan acknowledges the doc rewrite; add a Settings UI tooltip string update task so the toggle label isn't misleading once H1 chips appear.

VERDICT: APPROVE_WITH_NITS
