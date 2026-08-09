All checks complete. Summary of my review:

**Fix verification (adversarial traces):**

1. **abortThreadChat gate leak (REJECT blocker 1)** — FIXED. `abortThreadChat` (message-router.ts:139-141) bumps generation then calls `releaseMultiAgentLlmLoop`, which is idempotent (`holders.has` guard). The run's `finally` (line 744-749) CAS-skips on the bumped generation, so release happens exactly once. I traced all interleavings: abort-then-new-run, supersede-then-abort, double-abort, non-multi-agent threads (no-op release), and gate-acquire-failure between supersede and successor — no double release, no leak, no premature successor-slot clobber. The only gate-acquire point (line 617, chat.create) is covered since workers run through the router (`listLlmActiveThreadIds` is the fleet RunBusy source). All 5 abort call sites (`chat.abort`, `fleet.stop_all`, `worker.pause`, `worker_cancel`, `stop_thread`) return their own acks.

2. **file.upload generation gating (REJECT blocker 2)** — FIXED. file.upload (lines 935-1017) now uses `nextLlmGeneration` + CAS on catch/finally + drain-on-supersede. Supersede trace confirms: predecessor's `finally` cannot delete the successor's controller (gen mismatch), and gate accounting stays correct (file.upload never acquires the gate; chat.create's re-entrant acquire + successor `finally` release exactly once).

3. **Tests** — `llm-supersede-generation.test.ts` asserts abort frees the gate and the slot is re-acquirable. All abortControllers.delete sites are now CAS-gated or owned (verified no ungated deletes remain). Machine green: 31 targeted tests + 45 prior P0 suite tests pass, TypeScript compiles clean.

**ADR-020 checklist:** R2 diff is fix + test only — no new tools/gates/UI entry points, so missing capability declaration = nit. No new confirm family, no trust-monotonicity change, no originWs regression (R1 originWs scoping still passes `pending-tool-origin-ws`), no new runtime, no experimental-layer dependence.

**Nits (non-blocking):**

1. R2 prompt lacks the ADR-020 Surface/Compose/Autonomy/Trust/Channel declaration (fix-only diff, so nit per checklist).
2. Behavior change worth documenting: after `abortThreadChat`, the aborted run's catch suppresses the `chat.aborted` broadcast (gen mismatch). Requesters still get explicit acks, but multi-peer connections on the same thread no longer receive the broadcast.
3. `llmLoopGeneration` map entries persist per-thread for process lifetime (no cleanup on normal completion) — negligible, but could be pruned.
4. No dedicated test for the file.upload generation-CAS supersede branch itself — only the abort-release path is tested; the upload CAS is verified by code inspection.

VERDICT: APPROVE_WITH_NITS
