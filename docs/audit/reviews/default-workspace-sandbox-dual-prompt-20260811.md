# Dual external review — default-workspace-sandbox Scheme 1

## Role
You are an **independent** re-reviewer. An adversarial agent already produced a report.
Your job: **confirm or reject** that report against the **real diff and code**. Prefer machine-checkable claims. Do not rubber-stamp.

## Batch
`default-workspace-sandbox-scheme1`

## Blast tier
**T2** (workspace_* UX + default FS sandbox under home). Security-adjacent: host_read expands without folder-picker when root unset.

## Capability declaration
```text
Surface:      L1
L2-classes:   host_read (workspace_list_dir / workspace_read_file)
Compose:      module devsec-workspace (unchanged gate)
Autonomy:     single
Trust:        default sandbox ~/CMspark-projects when thread.workspace_root unset;
              setWorkspaceRoot still requires native folder-picker;
              MUST NOT auto-write thread.workspace_root
Channel:      community
```

## Product contract (Scheme 1)
1. Null/empty `workspace_root` → list/read under `~/CMspark-projects` (mkdir 0o700 if missing).
2. **No** auto-bind / write of `thread.workspace_root`.
3. Explicit `workspace_root` wins over sandbox.
4. Path containment under effective root; no `..` escape.
5. `shell_exec` / `normalizeShellCwd` must **not** force CMspark-projects.
6. `setWorkspaceRoot` still requires `consumeNativePick`.
7. `requireModule("devsec-workspace")` still gates workspace_*.

## Prior independent adversary (read fully)
`docs/audit/reviews/default-workspace-sandbox-adversary-20260811.md`

Adversary VERDICT: **APPROVE_WITH_NITS**

Notable adversary nits (verify true/false yourself):
- Stale tool catalog copy still says must pick folder
- In-home symlink root may expand host_read under home
- ChatView legacy bind hints; missing recoverability test for `default_sandbox_unavailable`
- Existing dir not re-chmod 0o700

## Machine evidence (implementer session)
- `npx tsx --test tests/capability-workspace.test.ts tests/project-dir.test.ts` → 12 pass
- `npx tsx --test tests/security-thread.test.ts` (with workspace tests) → 41 pass total in combined run
- `npx tsc --noEmit -p companion` → exit 0

Re-run at least the workspace tests if tools allow; report exit codes.

## Files / areas
- `companion/src/capability/workspace.ts` (`ensureDefaultSandboxRoot`, `effectiveWorkspaceRoot`, `resolveUnderWorkspace`)
- `companion/src/capability/project-dir.ts` (`cmsparkProjectsRoot`)
- `companion/src/capability/user-gate-copy.ts`, `security.ts`
- `companion/src/capability/shell.ts` (negative: no cwd force)
- tests: `capability-workspace.test.ts`, `security-thread.test.ts`
- UI: `PacksPanel.tsx`, `gate-error-copy.ts`
- docs: `mission-pack-usage.md`
- optional: `tool-definitions-catalog.json` (stale copy nit)

## Required review axes
1. **Outcome**: Scheme 1 DoD met?
2. **Trajectory**: scope appropriate?
3. **Component**: file:line findings
4. **ADR-020**: trust monotonicity — silent host_read without gesture OK for home sandbox only?
5. Confirm adversary was not too soft (missed blockers) or too harsh (nits as blockers)

## Verdict rules
- **REJECT** if: auto-binds thread.workspace_root; escape past root; setWorkspaceRoot no longer needs pick; shell forced to sandbox; module gate removed; unrecoverable silent FS expansion outside home.
- **APPROVE_WITH_NITS** if contract holds and only catalog/docs/UX polish remain.
- **APPROVE** if fully clean including catalog/docs alignment.

End with EXACTLY one line:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
