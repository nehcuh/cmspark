All five prompt verify-items pass, the ADR-020 capability declaration is present and correct, and the design-review nits (N1 honest mode label, N5 dynamic-workflow merge, N8 CLI copy-first scope, N2 originWs auto-bind via l2-admission framework) are folded in. Findings and verdict below.

---

# Dual Review — `acp-coding-handoff-impl`

## 1. Summary

- **Patch is not stale.** HEAD is `23515e0 fix(acp): harden spawn error message typing` (post-patch polish to `manager.ts`); the diff under review is `6c7a170` + that fix. Working tree only has the two untracked review artifacts. I inspected the real code, not just the patch file.
- **ADR-020 fit is correct.** ACP is placed on **Composition** (`coding-handoff` Pack + `companion/src/acp/*` client + Markdown task-package export). UI copy uses `编程接力` / `审查` / `起草`; no `中层 Agent` / `第二 runtime` / `ACP 面板` language anywhere in `copy.ts`, `pack.yaml`, or component chrome.
- **Trust stance is conservative and matches the design.** `config.acp.enabled=false` default; `sanitizeAcpConfig` hard-codes `allow_exec=false` and forces unknown profiles to `review_readonly`; manager runtime tautology at `manager.ts:81-82` also collapses to `review_readonly`. All 6 `acp_*` tools are in `WORKER_HARD_DENY`; `acp_propose_session` and `acp_start_session` are in `L2_GATE_TOOLS`. `l2-admission.ts:1184-1190` auto-binds `{ originWs: ws }` for non-outbound calls, so the new confirms inherit originWs (P1-2 ✓). ACP taint forces L2 on high-blast tools post-handback (`l2-admission.ts:744-755`), and `adapter.ts:302-307` clears the taint on the next user message.
- **Catalog lockstep ✓.** `COMPANION_TOOLS` (+6), `tool-definitions-catalog.json` (+6 function defs), `WORKER_HARD_DENY` (+6), `L2_GATE_TOOLS` (+2) all agree.
- **Phase A copy-first ✓.** `doOpenTerminal` in `CodingTaskPackageModal.tsx:238-257` calls `copyTextToClipboard` first, then sends a best-effort `coding_handoff.open_terminal_hint` chrome message; no `host_app`/`host_cli`/free-exec in the Phase A path.
- **No blocking issues found.** Ten non-blocking nits below.

## 2. Blocking issues

None.

## 3. Nits (non-blocking, prioritized)

1. **`chrome-extension/src/sidepanel/composer/meta-slash.ts:359-368` — unreachable resolver block (real dead code).** The new `if ((skill as MetaSlashEntry).metaKind === "coding_handoff" || skill.name === "code" || skill.name === "编程")` was inserted *after* `return META_PANEL_SLASH.find((e) => e.metaKind === "cockpit") ?? null` *inside* the `if (tags.includes("meta-cockpit"))` branch. It can never run. The feature still works because the earlier `byName` lookup at lines 347-350 catches `name === "code"` / `"编程"`, but the dead nested block is misleading and indicates the resolver path wasn't exercised. Move the new `if` *out* of the cockpit branch (and after the `meta-cockpit` return), or delete it and rely on `byName` alone.

2. **`companion/src/tool/l2-admission.ts:215-269` — empty L2 preview for ACP confirms.** The preview-string cascade has branches for `shell_exec` / `netsec_port_scan` / `spawn_worker` / `ask_user` / `host_cli` / `board_complete` / `skill_install` but nothing for `acp_propose_session` / `acp_start_session`. The fallback at line 268-269 collapses to `""`, so the Confirm Center modal will render with an empty code preview. The user is asked to approve spawning an external coding agent without seeing `agent_id`, `goal`, or `workspace_root`. Token binding (`securityPolicy.validateTokenFor`) still validates params server-side, so this is UX, not security. Add two branches (e.g., `agent=${finalParams.agent_id} goal=${(finalParams.goal||"").slice(0,200)}` and `session_id=${finalParams.session_id}`) so the approver sees what they're approving.

3. **`CodingTaskPackageModal.tsx:241-256` — `coding_handoff.open_terminal_hint` has no handler.** Grep across the repo finds 7 files referencing `coding_handoff`/`open_terminal_hint`; the dispatcher in the modal is the *only* producer — there is no consumer in `background/` or anywhere else. The toast honestly says "若终端未出现，请手动粘贴", so there is no user-visible failure, but the chrome message is dropped into the void. Either wire it (e.g., reuse `host_app` whitelist to `open -a Terminal`/`x-terminal-emulator`) or delete the message and keep the copy-only path. As written, it is technically dead.

4. **`companion/src/acp/manager.ts:67-69` and `81-82` — dead code + tautology.** The `if (server.policy.profile !== "review_readonly" && !server.policy.allow_write) { /* comment */ }` block is empty. Line 81-82 `server.policy.profile === "review_readonly" ? "review_readonly" : "review_readonly"` is a tautology that silently demotes any configured `propose_diff` / `agent_default` profile to `review_readonly`. Safe — but the dead branch and tautology will mislead future readers. Either drop both, or surface an audit log when demotion happens.

5. **`companion/src/acp/manager.ts:117-119` and `243-246` — state-machine states are unobservable.** `state = "confirmed"; runningCount++; state = "running"` runs in one synchronous tick, so `acp_get_status` can never observe `confirmed`. Similarly `state = "handback"; markAcpHandbackSeen(...); state = "closed"` — `handback` is never observable. The type system reserves `AcpSessionState = "idle" | "offered" | "confirmed" | "running" | "handback" | "closed"` but only `offered`, `running`, `closed` are reachable externally. Either drop the unused states from the union or yield between transitions so polling clients can render them.

6. **`companion/src/acp/manager.ts:262-285` cancel() — stale status window.** When `cancel` kills a running child, `session.state` is *only* mutated if the prior state was `"offered"`. For a `"running"` session, state stays `"running"` until the async `close` handler fires. An `acp_get_status` poll in that window reports `running` despite the user having pressed 停止. Optimistically transition to `"closed"` (or add `"cancelling"`) so the UI matches intent.

7. **`companion/src/acp/manager.ts:134` — prompt file written inside user workspace.** `${session.workspace_root}/.cmspark-acp-review-prompt.md` lands in the user's source tree. It is `chmod 0o600` and `unlinkSync`'d at session end (line 247-251), but a companion crash or `SIGKILL` during a hang leaves the file behind. The path is passed as `argv[1]` only when `args.length === 0`, so location is not load-bearing — prefer `os.tmpdir()` to avoid contaminating the repo. (If you keep it in-workspace, also add a `.gitignore` entry recommendation to the user docs.)

8. **`CodingTaskPackageModal` workspace from thread (`App.tsx:1602-1604`).** `workspaceRoot` is sourced from `activeThread.workspace_root`. If the user previously bound the default sandbox (`~/CMspark-projects`), the Phase A copy will hand the sandbox path to the external agent as if it were a real repo. `doCopy` does reject the *unbound* case (flashes `workspaceMissingBody` and calls `onRequestWorkspace`), but the sandbox-bound case slips through and produces a low-value task package. Consider rejecting sandbox paths in `buildCodingTaskPackage` (or in the modal) with the same `选择工作区` redirect.

9. **No spawn/start tests in `companion/tests/acp-handback-workspace.test.ts`.** The suite covers `frameAcpHandback` / `neutralizeDelimiterBreakout` / `resolveAcpWorkspaceRoot` / `isPathInsideWorkspace` / taint / `sanitizeAcpConfig`, but nothing exercises `propose()` / `start()` / `cancel()` / `shutdown()` with a mocked `child_process.spawn`. The two invariants — `runningCount >= 1` global reject and "thread already has offered/running" per-thread reject — are not tested. Non-blocking for ship (Phase B is default-off) but should land before any user toggles `acp.enabled=true` in anger.

10. **`companion/src/acp/manager.ts:144-148` args heuristic is opinionated.** When `server.args` is empty, the manager unconditionally pushes `promptPath` as `argv[1]`. That happens to fit `claude`/`gemini` only loosely (Claude Code's non-interactive mode is `-p`, not a bare path). The body also writes the prompt to stdin (lines 184-189), which is the actual robust path for most CLIs. Consider dropping the `args.push(promptPath)` heuristic and relying on stdin + the documented "configure `args` yourself" contract, to avoid surprising users whose agent interprets a bare path differently.

## 4. ADR-020 capability checklist — pass/fail notes

| Check | Result | Note |
|-------|--------|------|
| Axes fit (Composition vs Surface vs Autonomy) | ✅ pass | `companion/src/acp/*` is a Composition client; tools are propose/collect/cancel shaped, no free-fire `run`. No `中层 Agent` / `第二 runtime` language in UI copy. |
| Pack-first | ✅ pass | `coding-handoff` Pack + skill + slash `/code`/`/编程`; no new BottomBar tab; no ACP panel; settings section is one block. |
| Confirm dialects | ✅ pass | ACP L2 reuses `L2_GATE_TOOLS` + `SecurityConfirmationManager` + `securityPolicy.validateTokenFor`; no third dialect invented. (Nit 2: preview text missing — non-blocking.) |
| Trust monotonicity | ✅ pass | `autoConfirmEligible` does not apply (L2_GATE_TOOLS path requires `security_token`); ACP taint forces L2 post-handback for `host_cli`/`shell_exec`/`evaluate`/`osascript_eval`/`acp_*`; god-mode cannot skip. |
| originWs on new confirms | ✅ pass | `l2-admission.ts:1184-1190` auto-binds `{ originWs: ws }` for all non-outbound calls; ACP is not outbound, so it inherits. |
| No new runtime | ✅ pass | Single tool-loop preserved; ACP is a stdio client. |
| Experimental layers on write paths | N/A | v1 has no apply/shell-in-agent/auto-spawn; profile runtime-collapsed to `review_readonly`. |
| Capability declaration present | ✅ pass | Prompt body has Surface / L2-classes / Compose / Autonomy / Trust / Channel block. |

P1 watchlist: P1-1 (god-mode step-up) — no `config.set` surface change beyond `acp.enabled` toggle (default false; no escalation); P1-2 (originWs) — satisfied by framework; P1-3 (evaluate integrity) — N/A; P1-4 (shell structure) — N/A (shell-in-agent banned v1).

## 5. Ship recommendation

- **Phase A** — ship. Copy-first, no spawn, no new chrome, honest mode footnote, `dynamic-workflow` extended (no parallel entry per design N5).
- **Phase B** — ship default-off. The L2 preview gap (nit 2) and missing spawn tests (nit 9) should be closed before asking any real user to toggle `acp.enabled=true`, but neither blocks merge of the current default-off slice.

VERDICT: APPROVE_WITH_NITS
