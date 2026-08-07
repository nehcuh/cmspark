I have everything needed. Here's my independent review.

---

## Review: Wave B H1 ThreadHandoff — plan (pre-code)

**Artifact checked:** `docs/superpowers/plans/2026-08-07-wave-b-h1-thread-handoff.md` (read in full). Grounded against `context-budget.ts`, `context-budget-m2.ts`, `adapter.ts:491–641` (`runContextBudgetPass`), `runtime-context-budget.ts`, `llm-extract.ts`, parent analysis §4.1/§4.3/Wave B, and the ADR-020 checklist.

**Patch-file note:** The attached `.patch` (`wave-b-h1-thread-handoff-plan-diff-20260807-104642.patch`) is *not stale* — it exactly matches the current working-tree `git diff` (9 files, +200/−9) — but it is **mislabeled**: it contains the **Wave A scene-knowledge impl diff** (PacksPanel `knowledge_ids`, pack-engine `active_knowledge_ids`, etc.), not the Wave B plan. The plan is a new untracked doc, so it has no git diff. Process noise, not a plan defect.

### Rejection gates (R1–R5) — all pass

- **R1 (merge into Digest/Export / global knowledge):** PASS. H-D1 + non-goals explicitly keep H1 runtime-budget-only; `thread.recall`/embedding and auto project-knowledge are Wave C/non-goals.
- **R2 (raw reasoning as primary notice body):** PASS. Notice body is labeled bullets from schema (H-D4); reasoning is only an optional capped (1500 tok) *extract input* (H-D7, §4.3 compliant). Never injected raw.
- **R3 (removes M1 turn-safe drop):** PASS. M1 stays the floor; H-D6 keeps M2/M1 fallback; `compactMessagesTurnSafe` untouched.
- **R4 (schema unclosed/inventable):** PASS. Schema frozen with per-field caps enforced in sanitize + extract prompt; inject prefix `[context_handoff]` defined; `updated_at` present. (Parent SoT suggested `last_compact_at`; `updated_at` is equivalent — acceptable.)
- **R5 (mid_loop re-extract):** PASS. H-D8 + success criterion 3; `shouldRunM2` already returns false on `mid_loop` (`context-budget-m2.ts`), and retain-only is mirrored.

### ADR-020 capability checklist

- **Declaration present and complete** (Surface L0 request-path / L2-classes none / Compose none / Autonomy n/a / Trust no elevation + F-S5 / Channel unchanged). Not a pure-docs change but declaration satisfies all six axes.
- **Axes fit:** correct axis (Surface); no composition surface, no new runtime, no "中层 Agent" framing. Uses existing `llmExtract` — no new framework (checklist #6).
- **Pack-first:** no new scenario surface; chip change is a modal enhancement, not new primary Side Panel chrome (checklist #2 OK).
- **Trust monotonicity / originWs / confirm dialects:** no elevation, no new confirm family, no `securityConfirmations.request` changes — no P1-watchlist touch (P1-1..P1-4 n/a).

### Must-answer

1. **Schema fields + caps adequate?** Yes — 5×120 goals / 8×160 decisions / 8×120 constraints / 8×120 todos / 8×80 artifacts, sanitize+prompt enforced; zh labels match §4.1 mapping.
2. **Reuse `context_compaction_m2` gate?** OK. H-D10 documented; single gate keeps "m2-path" semantics, and "no new config key" is an explicit Wave B non-goal. Users who disabled m2 get M1-only — consistent.
3. **Cascades/retain correct?** Yes, with two implementation pins (nits 1–2 below): H1-fail→M2→M1 maps cleanly onto the existing `adapter.ts:534` block, and retain must carry the structured `handoff` through `prevMeta` (the current `MidLoopRetainInput` only carries `rolling_summary`/sha/bytes — needs a `handoff` field plus `"h1"` in the mode union).
4. **Implementable without invention?** Yes — every primitive exists (`llmExtract` raw-text + fence unwrap, `buildRedactedTranscript`, `attachRollingSummaryToMessages` pattern, `sanitizeRuntimeContextBudget`, thread update validation). Verified `llm-extract.ts` returns raw text (plan's parse step is required, not assumed).

### Nits (non-blocking)

1. **Reasoning-slice redaction mechanism unpinned (H-D7).** `redactMessagesForCompaction` reconstructs assistant messages *without* `reasoning_content` (`context-budget.ts`), so slices must be scrubbed separately — pin the scrubber (reuse `SECRET_BODY_RE`) in the plan or the "redact same as M2 F-S5" claim is unproven.
2. **Retain-helper type gap (Task 3).** `retainMidLoopRollingSummary`/`MidLoopRetainInput` (`context-budget.ts`) are typed `"m1" | "m2"` with no `handoff` in `prevMeta`; Task 3 says "extend or add" — make it explicit that the helper must carry structured handoff (not just formatted text) so mid_loop re-attaches `[context_handoff]` and the chip renders sections. Also mirror the N7 mode-honesty note for `mode:"h1"` on mid_loop.
3. **Double-LLM worst case on H1 fail → M2 fallback.** H-D6 is a fine decision, but a H1 timeout followed by M2 retry doubles pre_loop latency (~45s→90s). Suggest: fall back to M2 only on fast-fail errors (parse/empty), skip on timeout/abort.
4. **Notice dedup test.** `attachHandoffNotice` must replace the existing `[context_omitted]`/`[context_summary]` notice (mirror `attachRollingSummaryToMessages`); add a test asserting exactly one budget notice in the request after attach. Also no explicit test for the H1→M2→M1 cascade — worth one mocked test beyond the listed unit tests.
5. **Chip fallback dual-truth.** Storing `formatHandoffForNotice` into `rolling_summary` is a good fallback but creates two representations; ensure mid_loop retain prefers the structured handoff over the formatted text so the request prefix stays `[context_handoff]`.

None of these block a pre-code plan; the impl gate (G4) can verify them against code.

VERDICT: APPROVE_WITH_NITS
