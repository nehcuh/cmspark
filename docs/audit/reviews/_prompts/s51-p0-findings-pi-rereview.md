# Pi re-review — S51 multi-lane findings (pre-implementation)

You are an independent adversarial reviewer (Pi). Re-review candidate findings from post-ship multi-lane review of CMspark main `6d2cdcf..14e1b28`.

## Mandatory method

1. **Inspect live tip code** with Read/Bash — do not rubber-stamp lane reports.
2. For each candidate: from **user product path**, decide REAL product/security defect vs theoretical/nit/design-OK.
3. Confirm or refute orchestrator P0s. Prefer fail-closed only when user-reachable.

## Candidates (confirm or refute)

### C1 — Trust cookie survives soft-delete → hard-delete re-restores cruise (claimed HIGH)

Claim:
- `releaseTrustBeforeThreadGone` restores globals from `mission_pack_trust_snapshot` but does not clear the cookie.
- Soft-delete (`mode: trash`) leaves cookie on thread.
- Hard-delete from 回收站 calls release again → can re-enable cruise the user turned OFF after trash.

User path: Trust scene apply (cruise ON) → trash thread → Settings turn cruise OFF → permanent delete → cruise ON again without pack.apply.

Files to inspect:
- `companion/src/packs/pack-engine.ts` `releaseTrustBeforeThreadGone`, `restoreTrustFromThreadCookie`
- `companion/src/message-router.ts` `thread.delete` / `thread.batch_delete`
- `companion/src/threads/thread-manager.ts` `trash` / `restore`

### C2 — mid_loop recompact drops M2 rolling summary from LLM **request** (claimed HIGH)

Claim:
- pre_loop M2 attaches `[context_summary]` with rolling summary.
- mid_loop runs M1-only (`shouldRunM2` mid_loop false), replaces with plain `[context_omitted]`.
- Meta keep path preserves summary for UI「查看摘要」but does **not** re-attach into `messages` for the next LLM call.

Files:
- `companion/src/llm/adapter.ts` `runContextBudgetPass`
- `companion/src/llm/context-budget.ts` `attachRollingSummaryToMessages`, `buildOmitNotice`
- `companion/src/llm/context-budget-m2.ts` `shouldRunM2`

### C3–C5 (lane nits) — classify only

- Soft-delete retains messages on disk (recycle bin design?)
- Windows voice permission copy macOS-only
- single hard-delete no broadcast

## Prior HOLDS (spot-check, do not re-open unless regression)

- #126 install strip / spawn allowTrust:false / unapply restore
- #128 shell tree kill on chat.abort
- #130 data: residual no phase2 / no schemeOk expand

## Output format

```markdown
# Pi re-review S51 findings
## C1 Trust trash cookie — CONFIRM | REFUTE | DOWNGRADE
evidence + user impact
## C2 mid_loop M2 request — CONFIRM | REFUTE | DOWNGRADE
evidence + user impact
## Other nits
## Fix priority order (if any confirmed)
## VERDICT
```

Final line MUST be exactly one of:
- `VERDICT: APPROVE` — no P0; ship as-is OK
- `VERDICT: APPROVE_WITH_NITS` — no P0; only non-blocking nits
- `VERDICT: REJECT` — at least one confirmed P0 must fix before closeout

If REJECT, list concrete blocking issues with file:line before the VERDICT line.
