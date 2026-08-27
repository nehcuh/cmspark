# CMspark Agent Configuration

> **Version**: 0.5.3 (keep in lock-step with companion/package.json)
> **Platform**: CMspark Browser Agent

## Tool Environment

The following development tools are available on this system. Use them when working with the corresponding ecosystems:

- **nvm** (Node Version Manager): When working with Node.js projects, use `nvm use` to switch to the correct Node.js version before running any Node.js commands. Run `nvm ls` to see available versions.
- **uv** (Python package manager): When working with Python projects, **always use `uv` instead of `pip`** for package management.
  - Use `uv run python` or `uv run pytest` to run Python scripts and tests
  - Use `uv add <package>` to install project dependencies
  - Use `uv pip install <package>` for ad-hoc installations
  - Use `uv sync` to sync the project environment

---

## Routing Protocol

All non-trivial tasks are routed through the `workflows/` directory:

1. **Analyze** the user request to determine the task type
2. **Match** against available Workflow templates in `workflows/`
3. **Execute** the matched Workflow following its phases

### 需求设计 Issue-first（锁定 · 2026-08-27）

任何需求设计必须**先**在 GitHub 建 Issue，再写 spec/plan。禁止只在 `docs/superpowers/` 里设计。模板：`.github/ISSUE_TEMPLATE/design.md`。本季余项：#228 T1 · #229 召唤器 P2 · #230 残留。例外：无新需求的 typo/文档；已有行为的 bugfix。

Available Workflow categories:
- `workflows/bridge-*.ts` — bridge/ module fixes and reviews
- `workflows/dev-router.ts` — development task routing (bug-fix / feature / refactor / review)

For custom workflows: create a new `.ts` file in `workflows/` following the `meta` + phase function pattern.

## Skills

Run `skill.list` via WebSocket or read `companion/src/skills/` to see available skills.

## Session Lifecycle

When the user signals session end, run `session-end`.

Signals: "that's all for now", "heading out", "收工", "再见", `/session-end`.

Details: read `docs/session-lifecycle.md`.

## Quick Commands

When the user types `/dev-*`, run the corresponding workflow in `workflows/`.

## CMspark-Specific Notes

- Use `read` to load skill files from `companion/src/skills/`
- Use existing tools (read, write, edit, bash) for all operations
- Session management is handled by CMspark; use `/new`, `/resume`, `/fork` commands
- Compaction is automatic — no manual memory flush needed

## MCP Support

- User-facing guide: `docs/mcp.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md#mcp-相关`
- Core implementation: `companion/src/mcp/` (`client.ts`, `manager.ts`, `aggregator.ts`, `transport.ts`, `confirm-cache.ts`)
- UI: `chrome-extension/src/sidepanel/components/McpPanel.tsx`, `McpServerForm.tsx`
- MCP meta tools (`mcp_list_resources`, `mcp_read_resource`, `mcp_get_prompt`) are exposed dynamically based on connected server capabilities — they are NOT in the static `getToolDefinitions()` list.

---
*CMspark Agent v0.5.3*
