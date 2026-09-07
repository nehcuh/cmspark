## #464 Final Incremental Review — Independent Verdict

**VERDICT: APPROVE**

### Delta since correction gate (4 items)

1. **Best-effort catch moved to post-persistence only** — `terminal.review.submit` now wraps *only* the `code_review.handback.message` push. `service.receive()` and `addMessage()` failures still surface as `CODE_REPORT_INVALID_OR_PERSIST_FAILED`. Correct ordering: durable receipt → durable history → optional push. A dead socket can no longer masquerade as a persistence failure, and a real persistence failure can no longer be masked. No regression found `[inspected]`.
2. **Regression test matches** — new test throws from `sendToExtension` after open, asserts `terminal.review.received` returns, same-payload retry returns `deepEqual` (idempotent `receive`), history length stays 1, and a *different* payload correctly conflicts with `CODE_REPORT_ALREADY_RECEIVED` (uppercase regex passes). Also confirms denial/identity-mismatch/closed-during-confirmation paths never persist. This is exactly the regression the prior gate wanted pinned `[inspected; 23/23 exit0 reported]`.
3. **Extension `Thread.execution_policy?: "default" | "plan_readonly" | null`** — honest declaration ("enforced again by the server"), optional, no UI expression added. Type-only; no runtime surface.
4. **`listWithPreviews` spreads `...t`** — carries `execution_policy` (and all other server fields) to the panel hook and `thread.updated`. Runtime enforcement remains server-side per-frame: policy is revalidated at open, post-confirmation, and on every subsequent terminal.* message (thread flip to `plan_readonly` kills the live PTY). No permission bypass present: `terminal.open` L2 is unconditional-fire, untouched by cruise/auto-approve/allow-all-schemes; `user_gesture:true` required for open and report import.

### Concrete regressions assessed

- **Outcome/trajectory**: retry-after-interruption now converges to the persisted receipt instead of failing or double-writing; the `code-review-${receipt.id}` message-id dedup is the correct heal key. Reconnect under a new WS owner yields `TERMINAL_SESSION_NOT_OWNED`, but state is already durable — acceptable.
- **Component**: changes stay inside handler / thread-manager / extension type boundaries; no schema or API crossing.
- **Security**: no environment serialization (`buildTerminalEnv` test keeps `DEEPSEEK_API_KEY`, strips `CMSPARK_OUTBOUND_GRANT`/`ws_secret`), no L2 skip path, TOCTOU revalidation (peer, thread policy, workspace, cwd, review JSON) unchanged and tested.

### P2 / carry

- No P2 remains attributable to this delta. `pendingOpen` is module-global single-slot — consistent with the single-live-PTY model; not a regression.
- **Nit (non-blocking, unverifiable from packet)**: extension `execution_policy` union may go stale if companion adds policy values; field is display-only today, so zero functional impact. Fold into future UI work when policy is first rendered.
- **Carry** `[reported, not executed here]`: full extension test suite was still running at review time (production build exit0). Delta is a type addition + pass-through hook consumption, so regression risk is low — confirm green before tagging release.

Machine evidence accepted as stated: Companion build exit0, PTY 23/23 exit0 (matches the 23 tests in packet), prior full Companion 4996 pass/23 skip, settings 20 pass, extension production build exit0.
