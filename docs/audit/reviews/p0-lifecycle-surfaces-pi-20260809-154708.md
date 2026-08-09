Review complete. I inspected the patch against the live repo (`git diff` matches the patch — not stale), traced the SEC-D generation-CAS control flow across all LLM-loop and abort paths, verified SEC-E/SEC-F/VOICE-01/MCPO-01 against real code, and ran the machine command (all 21 targeted tests pass; path/redact suites 48 pass/1 macOS-skip; tsc clean).

**ADR-020 checklist:** declaration present and consistent; axes fit (L2 host_computer bugfix, Composition outbound grant, no new agent runtime); trust monotonicity holds (require_grant tightened to `true`, silent PATH whisper fallback removed); originWs bound on pending tools and stdio L2 uses the origin-bound requestConfirmation channel; pack-first not violated. Checklist itself passes — the problems are concrete lifecycle bugs inside this batch's own DoD.

---

**BLOCKING 1 — SEC-D incomplete: multi-agent gate slot leaks on abort (regression).**
`abortThreadChat` (companion/src/message-router.ts:136) now bumps `llmLoopGeneration`, so the aborted run's `finally` (companion/src/message-router.ts:740-746) CAS-skips `releaseMultiAgentLlmLoop` (line 744). Every abort path (`chat.abort` :1067, `worker.pause` :2560, `fleet.stop_all` :2524, `worker_cancel` companion/src/server.ts:3687, `stop_thread` server.ts:3090) calls `abortThreadChat` and none of them release the gate. Pre-diff, the `finally` released unconditionally — no leak. I verified empirically against the compiled modules: after 5 aborted workers the cap (5) is exhausted and a legitimate new worker fails `MULTI_AGENT_LLM_CAP` (active=5, holders=[w1..w5] remain). Multi-agent orchestration permanently degrades after aborts. Fix: `abortThreadChat` must itself call `releaseMultiAgentLlmLoop`, or the `finally` must release when the generation was bumped by an abort (map entry already gone) rather than by a successor run.

**BLOCKING 2 — SEC-D incomplete: `file.upload` chat path is not generation-gated.**
companion/src/message-router.ts:936-937 registers `uploadController` in the shared `abortControllers` map, but the catch (lines 1000-1004) emits `chat.aborted`/`chat.error` unconditionally (stale emit for a successor — violates DoD #3), and the `finally` (line 1006) does `abortControllers.delete(thread_id)` unconditionally — the exact predecessor-clobbers-successor bug (violates DoD #1). Repro: upload a file (vision chat starts), then send a new message on the same thread → supersede aborts the upload chat, which then emits a stale `chat.aborted` and deletes the successor's controller, disabling later cancel of the successor.

**Non-blocking nits**
- `companion/tests/pending-tool-origin-ws.test.ts`: the `applyConnectionCloseGracePeriod` test never exercises the 5s grace timer — it only asserts state before any timer fires; "only kills matching origin" isn't actually machine-verified (the `handleToolResult` origin-mismatch test is solid).
- `host-skylight.swift:668`: the `raw.count == 1 && cuWindowNumber(raw[0]) == 0` fallback can return an unmatched window when the number key is absent — same wrong-PID class SEC-F is fixing, though edge-case.
- No test covers the SEC-D generation CAS at all; an abort→gate-release test would have caught Blocker 1.

VERDICT: REJECT
