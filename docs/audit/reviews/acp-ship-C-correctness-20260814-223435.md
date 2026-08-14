All evidence gathered. Here is the adversarial C-correctness review.

---

# Ship review — feat/coding-agent-panel ACP residual → PR

## Summary

Independent adversarial C-correctness pass over the ACP residual batch. I re-derived the diff from the live worktree (the referenced `.patch` file does not exist under `docs/audit/reviews/`), read all must-read files, and re-verified the claimed evidence: **88/88** `acp-*.test.ts` pass (node --test on compiled `.test-dist`), companion `tsc --noEmit` clean, extension `tsc --noEmit` clean.

The batch is generally well-constructed: TOCTOU snapshotting of the Mode C flag (propose-time capture, exercised in `acp-handlers-gates.test.ts` both directions) is the right call; `buildAcpAgentEnv` is correctly wired into **both** spawns (ACP protocol path and CLI bridge); Ghostty handling matches the documented `open -na Ghostty.app --args -e …` form; `open_local_terminal` snapshot + `local_terminal` outcome are propagated end-to-end to panel/chip for Stop honesty; `normalizeLocalTerminalApp` rejects metachars and the config.set allow-list narrows ACP mutation to boolean `enabled` only.

I found **no blockers**. I did find **4 bugs**, one of which (the `applyable` clobber) defeats a headline feature of this batch's primary UX, plus several suggestions. One bug was reproduced empirically.

## Issues

### bug — applyable `pending_diffs` clobbered: panel Apply button + chip retention dead for propose_diff
- `companion/src/acp/manager.ts:417` builds `session.pending_diffs` **without** an `applyable` field; `manager.ts:133` ships them verbatim on every `acp.session.event`.
- The only `applyable` producer is `companion/src/ws/lifecycle.ts:537-544`, on `acp.handback.message` (computed inside the `handbackSink`).
- In `finishSession` the order is: `handbackSink` (broadcasts `acp.handback.message` with `applyable`) → `pushTimeline("session closed")` → `emitProgress` (broadcasts final `acp.session.event` with un-applyable `pending_diffs`).
- Reducer `agentStore.tsx:950-956`: `hasPendingDiff` = `pd.some(d => d.applyable === true)`. The final `session.event` therefore **clobbers** `hasPendingDiff=true` back to `false` for every closed propose_diff session with diffs.
- Result: `CodingAgentPanel.tsx:1078` / `CodingSessionChip.tsx:124` / `CodingSessionShell.tsx` apply buttons never render, and the chip auto-dismiss guard (`agentStore.tsx:958-965`, comment "应用 diff 必须 stay reachable") no longer retains the chip — the Apply flow is dead end-to-end in the panel this batch makes the primary UX. Pre-existing (ordering/logic unchanged by this batch), but it directly undermines the batch's core promise and is listed as a focus ("applyable pending_diffs"). No test covers the reducer ordering. Fix: emit `applyable` in manager's `pending_diffs` (same predicate as lifecycle) or make the reducer prefer the handback-derived flag when state transitions to closed.

### bug — B-lite git status mislabels any exit-128 repo as "非 git"
- `companion/src/acp/git-status.ts:94` `notARepo` returns true for **any** `code === 128`, then `:146` maps it to `is_repo: false` → panel renders "非 git".
- Git uses 128 for many non-"not-a-repo" fatals: **"detected dubious ownership"** (root/other-user-owned repos — common after sudo or Docker bind mounts) and "bad config line" among them.
- **Reproduced**: created a real repo, corrupted `.git/config` → `getWorkspaceGitStatus` returned `{ is_repo: false, branch: null, dirty_count: 0 }` (verified via compiled module). Fix: key `notARepo` on stderr content (`/not a git repository/i`), not the bare exit code; or return `error` + `is_repo:false` distinct from "非 git" so the UI doesn't assert a false negative.

### bug — unbounded WS emit frequency on streaming (both transports); progress-caps only caps per-payload, not rate
- `manager.ts:680` `emitProgress(..., true)` on **every** stdout/stderr chunk (previously 800ms-throttled), plus a force emit per timeline item (`pushTimeline`), plus timeline now `slice(-60)` with details up to 2000 chars (`timeline.ts` cap).
- A chatty CLI emitting ~20 lines/s produces ~20–40 WS events/s, each JSON-encoding up to ~120KB of timeline + 12KB tail, via un-throttled synchronous `client.send` (`ws/lifecycle.ts:348-365`). ACP `raw_line` path (`protocol-session.ts:56-60`) is equally unthrottled.
- This contradicts the progress-caps intent ("WS + store do not grow without limit"): the tail is capped, but frequency and timeline payload are not. Recommend coalescing (e.g. 150–250ms latest-wins) while preserving the no-newline streaming property, or bounding timeline bytes in the emit.

### bug — `pendingStartAfterPick` flag survives panel close → auto-start on reopen
- `CodingAgentPanel.tsx:225-231` (falling branch) clears enable-poll timers and `setStarting(false)` but **not** `pendingStartAfterPickRef.current`; the pick-result listener (`:356-370`) is removed on close, so a late cancel/error is missed.
- On reopen, `:639-654` sees `pendingStartAfterPickRef.current === true` with a now-bound `effectiveWorkspace` and **auto-fires `sendUiStart()`** without any 启动 click. Scenario: user clicks 启动 (no workspace) → picker opens → closes panel → picks folder → reopens panel → session starts unprompted (and if ACP was off, an enable+start chain fires). Fix: clear the flag in the falling branch (and/or on open rising before seed).

### suggestion — login-shell probe is a synchronous event-loop block up to 5s on first ACP start
- `agent-env.ts:86-110`: `getLoginShellEnv` uses `execFileSync(shell, ["-lic","env -0"], {timeout: 5000})`, invoked synchronously from `buildAcpAgentEnv` inside `manager.start` before the first `await` (`manager.ts:474-478`). First ACP session start can freeze the whole Companion (WS heartbeats, confirmations) for up to 5s, worse with slow interactive shells (oh-my-zsh/nvm).
- Also `:71-74` caches `{}` permanently after a failed probe — never retried until process restart. Recommend an async probe warmed at boot with a placeholder cache, and a retry-once on failure.

### suggestion — Mode C terminal is seeded with the *restrictive bridge* prompt, contradicting "完整 TUI/权限在此"
- `manager.ts:175` passes `buildUserPrompt(session)` into the host terminal. Review mode says "Do NOT modify files, run package installs, or git push"; propose_diff says "output a unified diff the host can apply" — both are nonsense in the interactive terminal where the user expects full capability, and they actively hobble the terminal agent (`manager.ts:444-470`).
- The Mode C terminal should get an interactive-flavored prompt (task + context + note that this is a full interactive session), not the sandboxed bridge prompt. Related B-axis note: the sidebar process is a **second full agent run**, not a passive "监视桥" — copy (confirm-copy.ts, modeCDualProcessBanner) says "监视" optimistically; the dual work/duplicate permission prompts are real and worth surfacing honestly.

### suggestion — Mode C task temp file never cleaned
- `open-local-terminal.ts:640-655` writes `cmspark-mode-c-*.md` (0o600, good) but never unlinks; the CLI bridge path does unlink its prompt file (`manager.ts` close handler). Files accumulate in `/tmp` and may contain page context/task text. Best-effort cleanup (delayed unlink after the interactive agent reads, or on shutdown).

### nit — dead `codex` branch
- `open-local-terminal.ts:181-184`: the `id === "codex"` branch returns the identical string as the generic case.

### nit — "正在打开本机终端…" shown before start
- `manager.ts:136-139` derives `local_terminal: "pending"` from the snapshot as soon as the session is `offered`; panel/chip (`CodingAgentPanel.tsx` modeCLikely) show the opening banner while the terminal has not even begun to open (it opens in `start()`). Cosmetic; "pending" during offer is defensible as "promised".

## Axis verdicts

- **A Security/Trust**: Strong. Env merge order correct and markers win; `CMSPARK_*` reserved; config.set allow-list narrowed to boolean `enabled` (servers/policy wire payloads ignored); git fixed-argv/shell:false with 3s timeout; terminal pref metachar rejection; `open`/osascript args are non-shell. Residual nits: client-supplied `workspace_root` on `coding.git_status` with no thread binding probes arbitrary dirs (git porcelain lists untracked filenames — modest disclosure, user's own machine; consider requiring thread binding or deny-listing), and the Mode C `/tmp` prompt file hygiene above.
- **B UX/Honesty**: Mostly strong (Mode C snapshot/outcome drive Stop copy; transport honesty for CLI bridge; L0 paste transparency; Warp open-only degrades honestly). Deduct for the Mode C restrictive-prompt contradiction and the "监视桥" overstatement.
- **C Correctness/Races**: This is where the batch is weakest — the applyable clobber (feature-dead), git 128 mislabel (reproduced), unthrottled WS streaming, and the pendingStartAfterPick stale-flag race. None are ship-blocking alone, but the applyable one should be fixed before this lands as the primary UX.

## Overall

**APPROVE_WITH_NITS** → leaning **REQUEST_CHANGES** only if the Apply-diff flow is considered in-scope for this PR. Given the batch explicitly markets the panel as the primary UX with propose_diff + Apply, I recommend fixing the applyable clobber (one-line change) before merge; everything else can ship with follow-ups.

## Ship ready: YES_WITH_NITS (strongly recommend the applyable + git-128 fixes first)

## Must-fix before PR

1. **applyable clobber** (`manager.ts:417/133` + `agentStore.tsx:950-956`): final `acp.session.event` must not reset `hasPendingDiff` to false for closed propose_diff sessions — emit `applyable` in manager `pending_diffs` (mirror lifecycle.ts:537-544 predicate) or make the reducer merge on closed. Otherwise the panel's 应用 diff button and chip retention are dead.
2. **git-status 128 mislabel** (`git-status.ts:94`): match stderr `/not a git repository/i` instead of bare `code===128` so dubious-ownership/config-error repos aren't falsely shown as "非 git".

Everything else (WS emit throttling, pendingStartAfterPick close-race, login-shell async probe, Mode C prompt + temp-file cleanup) can be follow-ups, but the first two should land with this PR.
