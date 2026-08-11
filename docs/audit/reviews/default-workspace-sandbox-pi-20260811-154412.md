All verification complete. Here is my independent re-review.

## Independent verification results

**Patch freshness:** The patch file's diff hunks are byte-identical to the current `git diff` (diffed programmatically, no divergence). Working tree has exactly the 8 tracked files + untracked review docs/workflow file.

**Scheme 1 contract — re-verified against live code:**

| # | Contract | Evidence |
|---|---|---|
| 1 | Null root → `~/CMspark-projects` mkdir 0o700 | `workspace.ts:44-102`; probe: fresh mkdir mode = **700**; test passes |
| 2 | No auto-bind of `thread.workspace_root` | `companion-dispatch.ts:524-536` passes `thread?.workspace_root` read-only; no `threadManager.update` anywhere in fallback path |
| 3 | Explicit root wins | `resolveUnderWorkspace` trim-nonempty branch; "explicit preferred" test |
| 4 | Containment / no escape | realpath + `path.relative` gate; `../` and absolute rel rejected; probe: **outside-home symlink rejected** |
| 5 | `shell_exec` not forced | `shell.ts:201-216` — params → workspaceRoot → `process.cwd()` only, no project-dir import |
| 6 | `setWorkspaceRoot` still needs picker | `consumeNativePick` gate unchanged |
| 7 | Module gate intact | `requireModule("devsec-workspace")` first lines of both tools; module-gate test green |

**Machine evidence (re-run):**
- `tsx --test capability-workspace + project-dir` → **12 pass, exit 0**
- `tsx --test security-thread` → **29 pass, exit 0** (12+29=41 matches implementer claim)
- `tsc --noEmit -p companion` → **exit 0**

**Adversary nits — all independently confirmed, none over- or under-stated:**
- **N1 (stale catalog): TRUE** — `tool-definitions-catalog.json:657-658` still says "Requires … AND workspace_root already set. If error says workspace_root not set, stop and ask the user…" — directly undercuts the Scheme 1 happy path for the LLM.
- **N2 (in-home symlink root): TRUE** — probe: `~/CMspark-projects` → in-home secret dir → `ensureDefaultSandboxRoot` returns `ok:true` at realpath target; list/read would serve that tree without a picker. Outside-home symlink correctly fails. Requires local symlink planting; stays within home; correctly non-blocking.
- **N3 (ChatView legacy hint): TRUE** — `ChatView.tsx` `toolResultUserHint` still hard-binds. Note: `WORKSPACE_ROOT_NOT_SET_ERROR` is now dead in production (only test-imported), but "workspace_root not set" tokens still surface via `ensure_project_dir(prefer=workspace)` (`project-dir.ts`) — hint is reachable only on a genuinely bind-requiring path.
- **N4 (missing recoverability test): TRUE** — `security-thread.test.ts` tests only legacy tokens; my classify probe confirms `default_sandbox_unavailable` → `recoverable`.
- **N6 (no re-chmod of existing dir): TRUE** — probe: pre-existing 0755 stays 755; contract says "mkdir 0o700 **if missing**" so technically compliant.
- **N8 (CLAUDE.md:109,121 / ADR-014 drift): TRUE** — still frame pick-first as the DevSec story.
- N5/N7/N9 (non-bind integration test, `escapes workspace_root` recoverability, untracked `.rhai`) — accurate as stated.

**ADR-020 checklist:** Declaration present and accurate (L1 host_read / devsec-workspace compose / single autonomy / trust = default sandbox + picker-required bind / community). No new runtime, no new "中层 Agent", no new confirmation family → originWs item N/A. Trust monotonicity holds: god-mode/auto-approve still can't skip bind; the sandbox expansion is Trust-side (single 0o700 dir under home), not a loosening of L2 gates. `effectiveWorkspaceRoot` is test-only; production path goes through `resolveUnderWorkspace` (noted, harmless).

**REJECT criteria scan:** no auto-bind, no escape past root, picker still required, shell not forced, module gate intact, no silent expansion outside home. None triggered.

**Adversary calibration:** neither too soft nor too harsh — every nit verified real and correctly non-blocking; no missed blockers.

VERDICT: APPROVE_WITH_NITS
