Review written to `docs/audit/reviews/multi-agent-orchestrator-claude-20260727-101050.md`.

**Verdict: APPROVE_WITH_CHANGES, 78% confidence.**

The synthesis is the right artifact — it identifies the multi-tool episode lease as the correct unit, places enforcement in Companion `createToolExecutor` (mirroring `host_computer` `COMPUTER_TASK_BUSY`), and kills the tempting wrong answers (Extension-only lock, holding HARD across 45s L2, null worker whitelist, pinned-tabs-as-ownership). I verified every code anchor in its grounding block against the repo.

**Four blockers** that must land before any P0 code:

1. **`pendingToolCalls` (`server.ts:139`) has no `thread_id` binding** — synthesis lists the fix in P1, but the P0 cancel path it specifies (abort + reject worker-owned pending + release leases) is **impossible to implement** without it. Mis-sequenced.
2. **`isToolAllowed` (`thread-manager.ts:499`) has zero call sites outside the file** — every `tool_whitelist` / `WORKER_HARD_DENY` / orchestrator-narrow-surface rule is theater until wired at `createToolExecutor` entry as the first check.
3. **`Thread` schema lacks `parent_thread_id`/`orchestrator_run_id`/`worker_role_label`/`capability_elevation_level`** — audit attribution and HITL display require them.
4. **`security.confirmation.request` payload lacks `worker_id`/`parent_thread_id`/`orchestrator_run_id`/`tabId`** — Confirm Center and stop_thread targeting require them.

**Two silent product forks** the synthesis makes without owning the trade-off:

- **SOFT_RESERVED→approve→TAB_LOCKED race** (treated as "recoverable" — actually a binary choice: block early = serialize multi-worker; post-confirm = user approves doomed actions). Recommendation: block early for P0.
- **`evaluate` in `WORKER_HARD_DENY`** — makes workers near-useless for adversarial SPAs (the codebase's own `browser-bridge.ts:188-190` acknowledges ISOLATED-vs-MAIN world fallback). Recommendation: allow under standard L2.

**State-machine hole:** locked conclusions #6 (renew on each tab-tool entry) and #7 (don't hold HARD across 45s L2) **contradict** for the same-holder + same-tab + L2-tool case. The state machine diagram doesn't describe this transition. Spec must add a `HELD_PENDING_L2` sub-state that retains exclusivity without firing idle_ttl.

Full review (20 ordered MUST-FIX, 11 open product calls, section-by-section attacks on tab-lock / orchestrator / Dashboard / HITL, plus what the synthesis got right) in the file above.
