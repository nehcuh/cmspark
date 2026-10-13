• UserPromptSubmit hook

  {"systemMessage": "🎯 VibeSOP routed: builtin/code-review (88% confidence)\nALTERNATIVE SKILLS (if 'builtin/code-review' doesn't fit, load one of these):\n  1. builtin/deep-diagnosis-optimization (24%)\n  2. builtin/deep-diagnosis-optimization (41%)\n  3. builtin/test-generation (37%)\n  4. builtin/systematic-debugging (32%)\n\n\nNEXT STEP (MANDATORY): read /Users/huchen/.local/share/uv/tools/vibesop/lib/python3.13/site-packages/vibesop/builtin_skills/code-review/SKILL.md\nDo NOT proceed without reading this file.\nIf the skill doesn't match, load an alternative skill above.", "hookSpecificOutput": {"additionalContext": "[ACTIVE SKILL: builtin/code-review]\nYou MUST follow this skill's workflow. Do not skip steps.\n\n请先读取 /Users/huchen/.local/share/uv/tools/vibesop/lib/python3.13/site-packages/vibesop/builtin_skills/code-review/SKILL.md ，然后严格按照该 skill 的工作流程执行「builtin/code-review」。不得跳过任何步骤。", "hookEventName": "UserPromptSubmit"}}

• Both files read. Let me verify the frozen `diff.patch` matches the COMPLETE DIFF embedded in context.md.

• Verification done: frozen `diff.patch` is byte-identical to the COMPLETE DIFF in context.md, and its sha256 matches `machine.json` (`6cb049b0…`). Review below is against the full source as supplied.

  # Code Review — Batch #550: preserve live confirmation during idle Fleet reads

  **Scope (one line):** one added guard in `releaseIdleLeasesForThread` so the idle fleet-snapshot path keeps `SOFT_RESERVED`/`HELD_PENDING_L2` leases while a confirmation is live (plus doc updates and 3 regression tests). No new authority, no dispatch/approval changes.

  ## Correctness pass

  The functional change is a single line — `tab-lease.ts:849`:

  ```ts
  if ((lease.state === "SOFT_RESERVED" || lease.state === "HELD_PENDING_L2") && keepSoftForLiveConfirm(tabId, lease, t)) continue
  ```

  I traced every lifecycle the prompt asked about against the full source:

  - **Confirmation lifecycle:** while `hasPendingConfirmation` returns true, `keepSoftForLiveConfirm` (`tab-lease.ts:311-325`) returns true → lease kept. Guard is correctly scoped to the two states a live confirm can exist in (`HARD_HELD` cannot carry a live confirm: entering L2 transitions to `HELD_PENDING_L2` at `:582`, deny returns to `HARD_HELD` clearing `confirmId` at `:683`). When confirm ends and no mutation/create/pending hold exists, the fall-through `leases.delete` at `:850` releases — DoD's "release resumes" holds.
  - **Rival ownership:** rival acquire hits `existing.holderThreadId !== holderThreadId` (`:550`) → `TAB_BUSY_CONFIRMING`/`TAB_LOCKED`; the new guard preserves this because the lease survives the snapshot. Test asserts it.
  - **Missing hook:** `keepSoftForLiveConfirm` returns false when `hasPendingConfirmation` is unregistered (`:312`) — idle release then behaves exactly as #545 left it, and the #545 "genuinely idle worker IS released" test still passes (it registers no confirm hook). Fail-closed semantics for *missing registration* are unchanged (that's `resolveHasPending`, `:223`).
  - **Throwing hook:** catch path (`:319-323`) keeps the lease and extends `softDeadline` — the new throw-test locks this. DoD's "fail-closed confirmation hook exception preserved" holds.
  - **Guard ordering:** mutationHolds (`:846`) and unexpired create hold (`:847`) and pending CDP (`:848`) are all checked *before* the confirm guard, so existing #545 protections are not weakened; the confirm check adds a keep condition only.
  - **No regressions to adjacent paths:** cancel uses `releaseLeasesForThreadPendingAware` (unchanged, force-releases pending — correct for cancel); hard-max uses `freeAtHardMax` (unchanged, never routes through idle release); `sweepExpired`/`acquireOrRenewTabLease`/`hardReacquireAfterConfirm` untouched. The added line can only *prevent* a delete it previously performed; it cannot free anything that was kept before.
  - **softDeadline extension inside idle release** (`:315`) is redundant-but-harmless here: idle release doesn't consult `softDeadline`, and the same extension already happens on the sweepExpired paths. Consistent, not a defect.

  ## Tests & contracts

  Three new tests (2 parameterized + 1 throw) directly encode the DoD: preserve while live, rival denied, release after confirm ends, throw keeps lease. On the base commit these would fail (the guard doesn't exist → lease freed at first snapshot → `releaseIdleWorkerLeases` returns 1 and `getTabLease` is null), consistent with the machine-supplied reproduction of 40 pass / 3 fail on 43 tests. Full host suite 5885 tests / 0 fail / exit 0, build exit 0 — taken as supplied, not re-inferred. Linux snapshot explicitly pending; I do not treat it as green.

  ## Findings

  **P0/P1 (must-fix): none.**

  **P2 — nonblocking observations (not defects):**
  1. `tab-lease.ts:849` — the added line (~118 chars) and the doc line at `:839` exceed the surrounding wrap width; pure formatting.
  2. `tab-lease.ts:312` — if `hasPendingConfirmation` is never registered (as opposed to throwing), an idle worker mid-confirmation loses its lease on the first 4s snapshot rather than at `softDeadline`. This mirrors pre-existing `sweepExpired` semantics and the stated production invariant that hooks are registered at server bootstrap, so it's a hardening note only.
  3. Test nit (`orchestrator-tab-lease.test.ts:1866-1875`): the throw-case test could also assert rival denial, symmetric with the live-confirm case. Coverage of the stated behavior is already adequate.

  ## Verdict

  **VERDICT: APPROVE_WITH_NITS** — push-ready; 0×P0, 0×P1, 3×P2 (all optional).
