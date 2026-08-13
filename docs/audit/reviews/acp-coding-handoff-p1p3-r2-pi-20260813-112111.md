## Review: coding-handoff P1–P3 batch (R2 — truncation fix)

I read the R2 diff (`HEAD~1..HEAD`, commit `fdbd712`), the full current source of every security-relevant file, ran the TypeScript build, ran the `acp-diff-apply` tests, and manually exercised multi-hunk / context-mismatch / new-file paths against the compiled module.

### Verification gates

| Check | Result |
|---|---|
| `acp_apply_diff` tool always HITL | ✅ `companion-dispatch.ts:361-378` requires `security_token` + `validateTokenFor`; signature binds `session_id`+`paths` (`security-policy.ts:101`) |
| `acp.apply_diff` WS always HITL | ✅ `handlers.ts:213-224` → `confirmOrDeny`; `confirmOrDeny` returns `false` when no confirm channel (`handlers.ts:35-41`) — fail-closed |
| Never waived by cruise/god-mode | ✅ `l2-admission.ts:790-793` — `acpForceConfirm` is OR-ed into `forceConfirm` *before* the full-autonomy-cruise waiver, so it is never skipped; also in `L2_GATE_TOOLS` (`:65`) |
| Path escape rejected | ✅ `diff-apply.ts:61` (abs/null-byte) + `:181` (`../`/`..`) + realpath containment (`:190-193`); final-component symlink neutralized by `atomicWriteText` rename (`io.ts:32-45`) |
| Follow-up requires confirm | ✅ `followup` → `propose` (offered) → `confirmOrDeny` → `start` (`handlers.ts:119-186`), same L2 gate as `ui_start` |
| No free shell | ✅ `spawn(server.command, args, …)` with no `shell:true` (`manager.ts:309-329`); command is `realpath`'d absolute (`discover.ts:141`), args are fixed presets |
| Catalog lockstep | ✅ `acp_apply_diff` in `companion-tools.ts:41`, `tool-definitions-catalog.json:1284`, `security-policy.ts:101`, `orchestrator/constants.ts:31` (WORKER_HARD_DENY), `l2-admission.ts:65/791`, `companion-dispatch.ts:361`, `handlers.ts:219` |

### Blocking-issue resolution

The prior Pi REJECT (truncation of modified files) is genuinely fixed. `reconstructFromHunks` is gone; `parseHunks` + `applyHunksToLines` now apply hunks against existing file content with strict context matching and refuse (`hunk_context_mismatch`) on any mismatch. The committed regression test "applies partial hunk without truncating rest of file (Pi B1)" passes, and I confirmed empirically: a 30-line multi-hunk edit preserves all 30 lines, and a stale/mismatched hunk leaves the file byte-identical. `tsc -p tsconfig.test.json` is clean; the 3 `acp-diff-apply` describe blocks pass (2799 total tests; the only failures are pre-existing unrelated `computer-*` suites).

### Nits (non-blocking)

- `manager.ts:322` — `CMSPARK_ACP_MODE` is hardcoded to `"review_readonly"` even for `propose_diff` sessions; the child sees a misleading mode (informational only, no gating effect).
- `diff-apply.ts:215-241` — a hunkless modified file (binary `diff --git`, mode-only, or rename diff) is rewritten via a UTF-8 read/join/write with zero hunks applied: it silently no-ops a mode change and can corrupt a binary file. Should skip with an explicit reason when `hunks.length === 0 && newContent == null`. Gated by HITL + the "（无 hunk）" summary note, and the spawned agent already has workspace write access anyway, so low severity — but worth a `no_hunks` skip.
- `applyHunksToLines` always appends a trailing `\n` even when the original file lacked one (cosmetic).
- `handlers.ts:174-178` — the confirm dialog label uses the top-level `mode` (defaults `review_readonly`) rather than the inherited `followMode`; a non-chip client that omits `msg.mode` could get a mislabeled confirm. The chip always sends explicit `mode`, so unreachable via current UI.
- Test coverage is thin: no committed multi-hunk / context-mismatch / delete regression tests (I verified multi-hunk and mismatch manually, but they aren't in the suite).
- Pre-existing nit still unaddressed: the "应用 diff" button (`agentStore` `hasPendingDiff`) appears for delete-only pending diffs, which then no-op under `delete_not_allowed`.

VERDICT: APPROVE_WITH_NITS
