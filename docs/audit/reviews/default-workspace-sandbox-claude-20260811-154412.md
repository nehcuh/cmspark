I have independently verified the implementation against the contract and the adversary report. Here are my findings.

## Independent review — `default-workspace-sandbox-scheme1`

### Machine evidence [executed]
- `npx tsx --test tests/capability-workspace.test.ts tests/project-dir.test.ts` → **12 pass / 0 fail, exit 0**
- `npx tsx --test tests/security-thread.test.ts` → **29 pass / 0 fail, exit 0**
- `npx tsc --noEmit` → **exit 0**
- `git diff --stat` matches patch file (8 files, 210/29) — not stale.

### Contract verification (Scheme 1) — all PASS

| # | Requirement | Result | Anchor |
|---|---|---|---|
| 1 | null/empty root → `~/CMspark-projects` mkdir 0o700 | PASS | `workspace.ts:44-102` ensureDefaultSandboxRoot; test null list/read |
| 2 | MUST NOT auto-bind `thread.workspace_root` | PASS | `companion-dispatch.ts:524-535` only reads `thread?.workspace_root`; no `threadManager.update` on read path |
| 3 | Explicit root wins | PASS | `workspace.ts:124-133`; "explicit preferred" test |
| 4 | Path containment; no `..` escape | PASS (in-home symlink nit N2 below) | `workspace.ts:135-159`; escape test |
| 5 | `shell_exec` cwd not forced to sandbox | PASS | `shell.ts:201-217` `normalizeShellCwd`; no project-dir import |
| 6 | `setWorkspaceRoot` requires `consumeNativePick` | PASS | `workspace.ts:166-183` unchanged |
| 7 | `requireModule("devsec-workspace")` gates | PASS | `workspace.ts:189,218`; gate-blocks test |

### ADR-020 capability checklist
- Declaration present (L1 / host_read / module devsec-workspace / single / community).
- Surface stays L1; no L2 elevation. Pack-first respected (no new runtime). Trust monotonicity intact (god-mode still cannot impersonate folder-picker bind; module enable is the consent story). Channel community appropriate.
- `classifyError` adds `default_sandbox_unavailable` / `cannot create default sandbox` to recoverable list — Scheme 1 hard-gate stays recoverable (`security.ts:765-767`).

### Adversary nits — independent confirmation

| ID | Claim | Verified | Anchor |
|----|-------|----------|--------|
| N1 | Stale LLM catalog still says "workspace_root already set" + "stop and ask user to pick" | **TRUE** | `companion/src/bridge/tool-definitions-catalog.json:658` (and L675 read_file desc is silent on sandbox) |
| N2 | In-home symlink root passes after realpath | **TRUE** | `workspace.ts:87-94` only checks `realpath ⊆ home`; expands host_read under home w/o gesture. Not a containment escape past home. |
| N3 | ChatView legacy hard-bind hint drift | **TRUE** | `chrome-extension/src/sidepanel/components/ChatView.tsx:840-841` still matches old tokens and returns "需要先绑定工作区" copy |
| N4 | No direct test for `default_sandbox_unavailable` recoverability | **TRUE** | `security-thread.test.ts` only softens legacy `WORKSPACE_ROOT_NOT_SET_ERROR`; recoverability verified by code-read only |
| N6 | Pre-existing dir not re-chmod 0o700 | **TRUE** | `workspace.ts:67-69` mkdir-if-missing only |

### Additional findings (mine)

- **M1 (nit)**: `effectiveWorkspaceRoot` at `workspace.ts:109-118` is **dead code** — no production caller (grep confirms only used in its own file + tests). The real flow goes `dispatch → workspaceListDir(thread?.workspace_root) → resolveUnderWorkspace → ensureDefaultSandboxRoot`. Either remove or wire in.
- **M2 (nit)**: `WORKSPACE_ROOT_NOT_SET_ERROR` is now exported but unused in production (import removed from `workspace.ts`; only tests import it).
- **M3 (nit)**: `humanizeChatErrorForUser:56` regex catches `默认使用沙箱`, which is also the body of the (now unused) `WORKSPACE_ROOT_NOT_SET_ERROR` constant — theoretical only since constant is unused.
- **N8 (nit)**: `CLAUDE.md` Common Issues still says "workspace_root not set / 任务包相关: Side Panel → 任务包 → 选择工作区 绑定本机目录后再用 workspace_*"; ADR-014 doc drift (adversary flagged).

### Adversary calibration check
Adversary was **not too soft**: blocking criteria (auto-bind, escape past root, picker bypass, shell force, module gate removal) all independently verified absent. Adversary was **not too harsh**: every nit is a genuine polish item, none mislabelled as a blocker.

### Outcome / Trajectory / Component
- **Outcome**: Scheme 1 runtime + security DoD met.
- **Trajectory**: Scope tight (8 tracked files + docs); no shell/module/catalog regression introduced; `project-dir.ts`/`shell.ts` correctly untouched.
- **Component**: file:line anchors above all check out.

### Nits to land before declaring Scheme 1 UX "done" (non-blocking)
- N1: update `tool-definitions-catalog.json:658,675` to describe default-sandbox happy path.
- N3: update `ChatView.tsx:840-841` regex/copy to match Scheme 1 messaging.
- N4: add one-liner test asserting `default_sandbox_unavailable` → `recoverable`.
- N2: harden or explicitly document accepted in-home symlink risk.
- M1/M2: clean dead exports.
- N6: optional best-effort chmod 0o700 on existing dir.
- N8: refresh `CLAUDE.md` Common Issues + ADR-014 refs.

VERDICT: APPROVE_WITH_NITS
