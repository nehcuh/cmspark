• UserPromptSubmit hook

  {"systemMessage": "🎯 VibeSOP routed: builtin/code-review (88% confidence)\nALTERNATIVE SKILLS (if 'builtin/code-review' doesn't fit, load one of these):\n  1. builtin/deep-diagnosis-optimization (36%)\n  2. builtin/systematic-debugging (32%)\n  3. builtin/test-generation (32%)\n\n\nNEXT STEP (MANDATORY): read /Users/huchen/.local/share/uv/tools/vibesop/lib/python3.13/site-packages/vibesop/builtin_skills/code-review/SKILL.md\nDo NOT proceed without reading this file.\nIf the skill doesn't match, load an alternative skill above.", "hookSpecificOutput": {"additionalContext": "[ACTIVE SKILL: builtin/code-review]\nYou MUST follow this skill's workflow. Do not skip steps.\n\n请先读取 /Users/huchen/.local/share/uv/tools/vibesop/lib/python3.13/site-packages/vibesop/builtin_skills/code-review/SKILL.md ，然后严格按照该 skill 的工作流程执行「builtin/code-review」。不得跳过任何步骤。", "hookEventName": "UserPromptSubmit"}}

• Both diffs are fully embedded in `kimi-context.md` and the standalone `.diff` files match (20 files / 45 hunks in itcra, 5 files in cmspark). Let me pin exact line numbers for the findings.

• Review complete. I read both diffs end-to-end (itcra.diff: 20 files / 45 hunks; cmspark.diff: 5 files), all embedded production context (store.py, worker.py, orchestration.py, extensions.py, llm.py, enterprise-browser.ts, enterprise-service.ts, enterprise-http.ts, contract doc), and the machine card. Scope in one line: r7 adds an owner-bound enterprise-browser human channel to ITCra (cookie BFF + worker execution client + resume/wake logic + UI dialog) plus CMspark-side review-context and native-serialization fixes, addressing the three r6 findings.

  ## r6 findings — verified fixed (with regression tests)

  - **Blocked async event loop**: `opening`, `preparing`, `decision` all offload via `run_in_threadpool`; `test_slow_browser_work_does_not_block_other_human_logout` proves a stalled Companion POST no longer blocks logout. One remnant below (P2-1).
  - **Stale-job approval after config change**: `decision_sync` (`app/enterprise_browser.py:516-544`) now fences on the live job row (status must be `running`/`waiting_browser`, op must be in `browser_waits`, `job_inputs_current` inside the transaction), and all invalidators (`capabilities.py`, `main.py` model/scope/cancel routes) include `waiting_browser` and call `cancel_browser_waits`. The parametrized test `test_original_pending_approval_cannot_dispatch_after_job_change_without_wake` exercises real endpoints with no wake between mutation and decision → 409, zero effects. Solid.
  - **Diagram BrowserWaiting swallowed**: `orchestration.py` re-raises `BrowserWaiting` from the diagram stage, parallel failures aggregate wait records, and `worker.py` converts them to `waiting_browser` with claim released. `test_diagram_browser_wait_releases_job_and_resumes_only_original_diagram` covers it.
  - **Native Chrome serialization**: `guard.rule ?? null` + explicit-null test (JSON.stringify would have masked it) and the isolated-check script now hard-fails on `undefined` args. Correct.

  ## Findings

  **P1-1 — Closing/logout cancels an approval that was already submitted** — `app/static/enterprise-browser.js:75` (approve handler) and `:64` (`close()`). After the decision POST returns 200, `decisionInFlight` is cleared in `finally` *before* the refresh poll runs, but `approval` still holds the just-approved operation until the next poll (up to 3s, or indefinitely if the user is faster than the network). `close()`/`logout()` then take `decisionInFlight||approval` and POST `/cancel`. On the Companion, a pre-dispatch cancel voids the operation even though `approval_used` was consumed — the human clicked "批准", got success, the effect never runs, and the job later fails `BROWSER_OPERATION_STOPPED`. This contradicts the Companion contract ("a successfully completed 202 response transfers work to the service; ending a poll is not cancellation"). Reproduce with the existing Playwright harness by delaying the `/decision` response, clicking approve, then closing before the poll refresh. Fix: clear `approval` immediately on a successful decision POST (keep a separate `decisionSubmitted` marker) and exclude submitted ops from `cancelPending`.

  **P1-2 — `decision_sync` holds the global SQLite lock across a network dispatch** — `app/enterprise_browser.py:543`. The `EnterpriseClient.post('/execute')` runs inside `store.transaction()` (BEGIN IMMEDIATE + process-wide RLock), so every API and worker DB access stalls for up to the 20s httpx timeout if the Companion is unreachable. I understand the r6-mandated fence (job/config check → decision claim → dispatch admission must be atomic), and Companion `/execute` normally answers 202 immediately, but the lock hold should be bounded — e.g. a short dedicated timeout for this call, or a guard-thread/lease so a wedged Companion can't freeze the whole instance. `cancel_browser_waits` shows the right pattern (network outside the transaction, short transaction to merge).

  **P2-1 — `login` runs scrypt inline in the async event loop** — `app/enterprise_browser.py:381`. n=16384 scrypt is ~50-100ms of CPU per attempt inside `async def login`; every other request on the loop stalls. Move the hash into `run_in_threadpool` like the other routes.

  **P2-2 — ITCra signs expired challenges instead of refreshing them** — `app/enterprise_browser.py:311` (`proof()` has no `expires_at` check). Companion challenges carry a 120s TTL; if the human approves an older challenge, Companion rejects `HUMAN_PROOF_INVALID` and its tick then cancels the op (`APPROVAL_EXPIRED`), turning a refreshable wait into a job failure. Fail earlier with `APPROVAL_TARGET_CHANGED` so the UI re-polls and renders the fresh challenge.

  **P2-3 — Companion 503 during model-driven `enterprise_open`/`prepare` fails the job instead of waiting** — `app/enterprise_tools.py`. `HTTPException` from `open_session`/`prepare_operation` is not a `BrowserWaiting`, so a transient Companion outage at open/prepare time marks the job failed (no bounded wait, unlike the read-outage path which is tested). Documented behavior says only read outages keep the wait, so this is a consistency nit, not a silent violation — but a transient 503 killing a multi-stage job is worth a retry-to-wait conversion.

  **P2-4 — `proof()` doesn't verify `operation_digest`'s value client-side** — `app/enterprise_browser.py:311`. `expected` includes `operation` but not `operation_digest`; the field is only required to be present. Companion still validates the full payload, so no forgery path — just defense-in-depth laziness.

  **P2-5 — dismissed panel never auto-reopens for that change** — `app/static/enterprise-browser.js` `close()` sets `dismissed=true` and `watch()` returns early until the user clicks 企业浏览器 again. A later approval request on the same change is invisible (no badge). Intended dismissal semantics, but worth a pending-approval indicator.

  ## Test gaps (necessary, currently missing)

  - No test for the 900s `BROWSER_WAIT_EXPIRED` deadline in `wake_browser_jobs` (`app/enterprise_resume.py:27`) — every other failure branch is covered.
  - No test for the P1-1 window (close/logout after a successful decision POST but before poll refresh).
  - No concurrent double-decision test (two simultaneous POSTs); replay is only tested sequentially.
  - No test for P2-2 (decision on an expired challenge).
  - No test that a *session-id* entry in `browser_waits` is handled by `cancel_browser_waits` (it silently skips non-operation records — safe, but unasserted).

  ## Verdicts

  - **ITCra component: APPROVE** — no P0 found; worker/human boundary (in-memory sessions vs shared SQLite, tested forgery attempt), RBAC hierarchy, proof replay/tamper, idempotency/aliasing, parallel-stage checkpoint/resume, and stale-UI-response fencing all hold up under inspection, and the r6 regressions are real endpoint-level tests.
  - **CMspark component: APPROVE** — the `rule ?? null` serialization fix, undefined-arg guard in the isolated checker, and the review-context change (origin/path + attribute allowlist, `element_token`/query excluded, both asserted in tests) are correct.

  Per the packet rules: **overall merge remains BLOCKED** — real T4 acceptance (human scan, second enterprise principal, qualified business URL/readiness markers, native Chrome receipts) is still pending and machine/fixture success is explicitly not evidence of it. The two P1s should land before or with the acceptance run; the P2s and test gaps are should-fix.
