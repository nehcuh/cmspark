# Mission Pack P0 — Implementation Handoff

| Field | Value |
|-------|--------|
| Date | 2026-07-26 |
| Branch | `feat/mission-pack-p0` |
| Worktree | `.claude/worktrees/mission-pack-p0` |
| Status | **P0 implemented + dual external review fixes landed** |

## Commits

```
git -C .claude/worktrees/mission-pack-p0 log --oneline main..HEAD
```

## What shipped (P0)

| Area | Files |
|------|--------|
| Validator | `companion/src/packs/validator.ts`, `types.ts` |
| Audit | `companion/src/packs/audit-log.ts` |
| Engine | `companion/src/packs/pack-engine.ts` |
| Builtin pack | `companion/src/packs/builtin/appsec-prd-review/**` |
| Thread | `applyPackPatch`, `system_prompt_append`, snapshot fields |
| Adapter | append merge order |
| Config | `capability_profile`, `modules.appsec` default off |
| WS | `pack.*`, `modules.*` |
| UI | `PacksPanel`, BottomBar「任务包」, mode tabs L0/L1 |
| Tests | `packs-*.test.ts`, `thread-pack-patch.test.ts` |

## Verification (executed in worktree)

- `npm --prefix companion test` → **1865 pass / 0 fail** (after fixes)
- `npm --prefix chrome-extension test` → **239 pass / 0 fail**

## External review (implementation)

| Reviewer | Verdict | Path |
|----------|---------|------|
| Claude | APPROVE_WITH_CHANGES (78%) | `docs/audit/reviews/mission-pack-p0-impl-claude-*.md` |
| Pi | APPROVE_WITH_CHANGES (88%) | `docs/audit/reviews/mission-pack-p0-impl-pi-*.md` |

### Must-fixes applied after review

1. Atomic apply without pre-restore mutation (switch packs)
2. Freeze snapshot on re-apply
3. `extractUserAppendPortion` merge
4. Audit file 0o600 create-before-append
5. MCP ids ∩ configured servers
6. Regression tests for re-apply / user append

### Deferred (non-blocking / P1+)

- Force-reinstall builtins every startup → version check
- Zip-slip symlink integration test
- Dedicated Icon for 任务包 tab
- Shell / NetSec / DevSec workspace (later plans)

## How to continue

```bash
cd /Users/huchen/Projects/cmspark/.claude/worktrees/mission-pack-p0
# optional: push branch
git push -u origin feat/mission-pack-p0
# open PR when ready
gh pr create --base main --head feat/mission-pack-p0 --title "feat: Mission Pack P0" --body "..."
```

## Not done (out of P0 scope)

- Shell PTY / Cockpit terminal
- NetSec scanners
- DevSec workspace_root folder picker
- pack.export
- Merge to main (await your PR approval)
