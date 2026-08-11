# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-11 (S65 END · default workspace sandbox · #165/#166)
- **Main tip**: `origin/main` @ **`06fcd96`** — Merge #166 nits; prior #165 Scheme 1 sandbox (`ec6d0f5`); #164 Thread History IA earlier same day
- **Ship**: `workspace_*` fallback to `~/CMspark-projects` when `workspace_root` unset (**no** auto-bind); folder-picker still required for explicit bind; shell cwd unchanged
- **Nits cleared (#166)**: catalog/ChatView copy; reject symlink sandbox root; chmod 0o700; `resolveEffectiveWorkspaceRoot`; ADR-014/CLAUDE/mission-pack docs
- **Gates**: adversary + Claude+Pi dual APPROVE_WITH_NITS; CI green; artifacts under `docs/audit/reviews/default-workspace-sandbox-*`
- **Open PR: 0** (this session)
- **Next**: true-machine smoke (list sandbox without bind); Windows/Mac backlog; optional message-router split; clean worktrees/stash
- **Do not commit**: `.tmp-ci-*` / diagnosis-report / dist-package

### 2026-08-11 (S63 END · #162/#163 on main · stale remotes deleted)
- **Then tip**: `a32659e` #163 C10; #162 multi-adv; squash-stale remotes deleted
- **Superseded tip**: main now `06fcd96` via #164/#165/#166
<!-- handoff:end -->
