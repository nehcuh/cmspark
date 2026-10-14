• UserPromptSubmit hook

  {"systemMessage": "🎯 VibeSOP routed: builtin/code-review (88% confidence)\nALTERNATIVE SKILLS (if 'builtin/code-review' doesn't fit, load one of these):\n  1. builtin/deep-diagnosis-optimization (36%)\n  2. builtin/systematic-debugging (32%)\n  3. builtin/test-generation (32%)\n\n\nNEXT STEP (MANDATORY): read /Users/huchen/.local/share/uv/tools/vibesop/lib/python3.13/site-packages/vibesop/builtin_skills/code-review/SKILL.md\nDo NOT proceed without reading this file.\nIf the skill doesn't match, load an alternative skill above.", "hookSpecificOutput": {"additionalContext": "[ACTIVE SKILL: builtin/code-review]\nYou MUST follow this skill's workflow. Do not skip steps.\n\n请先读取 /Users/huchen/.local/share/uv/tools/vibesop/lib/python3.13/site-packages/vibesop/builtin_skills/code-review/SKILL.md ，然后严格按照该 skill 的工作流程执行「builtin/code-review」。不得跳过任何步骤。", "hookEventName": "UserPromptSubmit"}}

• The skill workflow is clear. The context file is ~12.7k lines; let me check the layout of the supporting files first, then divide the deep review work.

• Structure mapped. I'll read the implementer/verification records myself, and delegate the four deep diff reviews to parallel subagents.

• Now the verification records at the tail of the context file:

• All four deep reviews are back. Here is the consolidated independent review.

  # Code Review — Convergence wave r2 (base 6594c053, four groups)

  **Scope**: CI (stdio close boundary), Office (#614/615/616), Cooperation (#576/619/621), Availability (#491/486). Frozen source verified against the manifest SHA-256 in `context-r2.md` — all 35 files hash-match; reviewed tree equals frozen tree. Diff read end-to-end; context-r2.md read in full (machine card, manifest, four implementer records, native diagnosis, r1/r2/r3 eval JSONs, #576/577 acceptance).

  ## Correctness & security passes (the user's five critical checks)

  1. **stdio: protocol closes, process timeout stays failure — PASS.** Deadline-exceeded teardown emits `McpStdioTeardownError` → `McpClient` sets `_closing` + status `error` inside `onerror` (which the SDK protocol invokes *before* its own `_onclose` settlement), so no `disconnected`/restart signal escapes; protocol `onclose` still fires exactly once and rejects pending SDK RPCs with `ConnectionClosed` (r1's defect, verified fixed in the real-SDK test). No path misreports an unconfirmed teardown as clean. HTTP cleanup semantics unchanged (rethrow is stdio-only).
  2. **Metadata notices never reach LLM/knowledge body — PASS.** Warning is pushed only into the `files` metadata sibling key (`message-router.ts:1797`), model-visible `content` is built from message + file content only, history rebuild serializes only `content`/tool calls, and `knowledge.import` body is `loaded.text` only. Structurally unreachable. (One deliberate pre-existing exception: render-only vision page-coverage text at `message-router.ts:1792`, predates #614, test-locked.)
  3. **XML budgets/auth preserved — PASS.** The new catch wraps only `DOMParser` construction/`parseFromString` (`odf-expansion.ts:210-217`); all budget refusals, namespace validation, chart/accounting branches, and ZIP/container checks execute outside it. The catch is a pure rethrow of the fixed Chinese refusal. Auth untouched.
  4. **Actual worker input completeness — PASS.** `parseFleetAssessment` rejects `user_input` subtasks whose facts aren't already supplied; the narrowed hint forbids guessing/worker-first identification/future-parent-output; dispatch goes through goal-match + capability + attempt-budget + confirmation gates. No fabricated-entity path found.
  5. **Cache/voice stale generations — PASS.** Voice: stale gen can't deliver transcripts (re-checked after readiness wait, upload, and backoff; `capture` nulled only when `=== handle`; every acquire path releases its handle). Cache: dirty retry is gated by the *current* disk fingerprint, so an outdated index can't resurrect; EISDIR diagnostic can't conflate real computation failure; no retry loop.

  ## Findings

  **P0 (must-fix): none. P1 (should-fix): none.**

  **P2 (nits — follow-ups, none blocking):**
  - `companion/src/mcp/client.ts:215-217` — in `connect()`'s catch, a bare `cleanupTransport()` can now (stdio) throw and replace the original startup error, skipping `this.client = null`. Misleading message + one dangling reference; no unhandled rejection.
  - `companion/src/mcp/client.ts:158-163` + `:276` — duplicate identical `status_changed("error")` emission per teardown failure.
  - `companion/src/message-router.ts:1792` — render-only vision warning intentionally model-visible; tension with #614's "never injected" wording (pre-existing, documented).
  - `chrome-extension/src/sidepanel/hooks/useWebSocket.ts:476` — a hypothetical `files`-only `chat.user` frame would be dropped by the empty-content guard; unreachable today.
  - `companion/package.json:42` vs `docs/office-import-contract.md` — officeparser is caret-ranged (`^7.2.3`) while tests/docs treat it as locked; producer-quirk contracts unguarded against minor upgrades.
  - `companion/src/orchestrator/fleet-assessment.ts:8` — "open-ended comparisons may choose subjects" sits beside the never-guess rule; only conceivable smuggle route for a motivated model, mitigated by the semantic corpus (r3 passed both attack cases).
  - `chrome-extension/src/sidepanel/voice/local-stt-adapter.ts:862` — stop during gUM prompt yields `onEnd` without preceding `onStart` (intended by #486; verify UI state machine tolerates unpaired events).
  - `chrome-extension/src/sidepanel/voice/local-stt-adapter.ts:319-325` — theoretical sid-reuse vector (matches `sessionId` only); unreachable since callers generate fresh session ids.
  - Test gaps (P2): voice mid-wait supersession branch (`:508-515`) untested; cache lacks negatives for dirty-not-persisted-after-drift and computation-failure-clears-dirty.
  - `companion/src/skills/skill-engine.ts:484-488` — after the first cache-write failure all later persistence failures are permanently silent; operators get one diagnostic ever.

  Test quality overall: assertions strengthened, not weakened; r1/r2 model failures retained and correctly interpreted (failed/invalid never credited as negatives — harness asserts `unevaluated === 0`); no skips/timeouts relaxed; the one rewritten legacy test encoded the old buggy behavior and its replacement is strictly stronger.

  ## VERDICT: **APPROVE_WITH_NITS** (0×P0, 0×P1, 11×P2 across four groups)

  Scope of this verdict: the frozen diffs are review-clean and push-ready at code level. This is **not** release/merge approval — per the machine card and your instruction, Linux ARM64 (locked public cache install) and exact per-head/merged-main CI remain pending gates; #615's real large business corpus and #618/626 T4 remain blocked and must not be fake-closed; #619 performance and #621 CDP encoding remain explicitly deferred. No component was approved by its own implementer.

