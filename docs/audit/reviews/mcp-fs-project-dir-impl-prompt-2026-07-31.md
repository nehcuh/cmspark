# Pi / dual review: MCP path UX + ensure_project_dir + allow-dir expand (PR #99)

**Batch ID:** `mcp-fs-project-dir-impl`  
**Stage:** Implementation review  
**PR:** https://github.com/nehcuh/cmspark/pull/99  
**Branch:** `fix/mcp-fs-path-ux` vs `main`  
**Date:** 2026-07-31  
**Trigger thread:** #6zhrh6 (`Parent directory does not exist` → 不可恢复错误)

**Capability declaration (implementer)**

```text
Surface:      L0 (companion tools + MCP); L2 confirm for allow-dir expand only
L2-classes:   mcp-allow-dir-expand (criticalApis force confirm, originWs-bound)
Compose:      ensure_project_dir + MCP filesystem; Pack-first not required (infra/tools)
Autonomy:     n/a (same agent loop; one auto-retry after allow-dir expand)
Trust:        allow-dir only under $HOME; blocked .ssh/.aws/Keychains/Mail; originWs on confirm
Channel:      n/a (no enterprise module change)
```

---

## Your job

Independent senior review of the **real diff** (use Read/Bash on the repo).

1. Verify #6zhrh6 class of bugs is fixed (parent missing / allowlist denial not turn-killing).
2. Verify P1 `ensure_project_dir` is safe (no path escape outside home/workspace).
3. Verify P2 dynamic allow-dir: L2 required, home-only, sensitive paths blocked, one retry, no silent expand on deny.
4. Hunt security regressions (TOCTOU, allow-dir outside home, god-mode bypass of expand confirm, race on applyConfig).
5. Check tests adequacy and missing cases.
6. End with exactly one line:
   - `VERDICT: APPROVE`
   - `VERDICT: APPROVE_WITH_NITS`
   - `VERDICT: REJECT`

---

## What landed (implementer claim)

| # | Change | Files |
|---|--------|--------|
| P0a | MCP `isError` → `enhanceMcpError` | `server.ts` |
| P0b | parent missing / allowlist tokens → recoverable | `security.ts` |
| P0c | enhance hints for parent mkdir / MCP panel | `server.ts` enhanceMcpError |
| P1 | `ensure_project_dir` under workspace or `~/CMspark-projects` | `project-dir.ts`, catalog, schemas, server case |
| P1b | system prompt 10b | `llm/adapter.ts` |
| P2 | Access denied under home → L2 → add args → applyConfig → retry once | `allow-dir-expand.ts`, `tryExpandFilesystemAllowDirOnDenial` in server.ts |
| Docs | mcp.md | `docs/mcp.md` |
| Tests | project-dir, allow-dir-expand, mcp-error-hints, security-thread | `companion/tests/*` |

---

## Review checklist (answer each)

### Recoverability
- [ ] `Parent directory does not exist` is recoverable (no chat.error kill by default)
- [ ] Bare isError path was fixed (not only throw path)
- [ ] enhanceMcpError keeps machine tokens for classifyError

### ensure_project_dir
- [ ] Cannot escape workspace_root or home
- [ ] sanitize strips `..` / separators
- [ ] Prefer workspace when set; home fallback under CMspark-projects only

### Allow-dir expand
- [ ] Only Access denied (not parent-missing) triggers expand offer
- [ ] Only paths under realpath(home); blocked sensitive subtrees
- [ ] User deny does not expand
- [ ] originWs bound on confirmation
- [ ] force confirm / criticalApis set so god-mode does not skip
- [ ] Retry is single-shot (no loop)
- [ ] applyConfig / replaceMcpServers correctness

### Product / ADR-020
- [ ] No new primary Side Panel entry (tool only)
- [ ] Trust not elevated silently
- [ ] Clear user-facing / LLM-facing copy

### Tests
- [ ] Parent-missing enhance tested
- [ ] Allow-dir home-only tested
- [ ] Missing: integration of tryExpand + mock confirm? (note if gap)

---

## Out of scope (do not reject solely for these)
- Full UI for “pick project name” beyond tool
- Auto-mkdir entire nested tree inside MCP server itself
- Expanding allow-dir outside home by design

---

## Diff location
Read: `docs/audit/reviews/mcp-fs-project-dir-impl-diff-*.patch` if present, and/or:

```bash
git diff origin/main...HEAD
```

Key files to open:
- `companion/src/server.ts` (executeMcpTool, enhanceMcpError, ensure_project_dir case)
- `companion/src/mcp/allow-dir-expand.ts`
- `companion/src/capability/project-dir.ts`
- `companion/src/security.ts` (recoverable tokens)
- `companion/src/bridge/tool-definitions-catalog.json`
