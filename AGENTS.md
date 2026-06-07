# CMspark Agent Configuration

> **Version**: 0.2.0
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

---
*CMspark Agent v0.2.0*
