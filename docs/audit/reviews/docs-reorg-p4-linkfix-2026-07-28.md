# Docs reorg — Phase 4 post-archive link/nav check

**Date:** 2026-07-28  
**Product:** 0.3.0  
**Scope:** After Phase 4 `git mv` into `docs/archive/2026-07/{proposals,roadmaps,rfcs,audits}/`

## Checklist

| # | Check | Result |
|---|--------|--------|
| 1 | `rg` old paths in README / docs entry / CLAUDE / AGENTS / CONTRIBUTING | **PASS** — no live entry hits (only reorg-plan historical `git mv` lines) |
| 2 | companion `docs/decisions/*` citations still on disk | **PASS** — all lock/synthesis paths present; `phase0-linux-gate-evidence.md` / `phase0-windows-gate-evidence.md` are RUNBOOK *capture targets* (not pre-shipped) |
| 3 | `docs/README.md` archive section | **PASS** — points at `archive/2026-07/{proposals,roadmaps,rfcs,audits}` + “still in main tree” table |
| 4 | Phase 4 DoD checkbox | **PASS** — already `[x]` in `docs-reorg-plan-2026-07-28.md` |
| 5 | Entry markdown relative links | **PASS** — 235 links across README/CONTRIBUTING/CLAUDE/docs entry + Phase3 guides + ADR-017/018 → 0 broken |

## Fixes applied this pass

- `docs/decisions/v1.3/multi-agent-orchestrator-synthesis-2026-07-27.md` — evidence path → `docs/archive/2026-07/proposals/security-optimization/design-doc.md`
- `docs/audit/reviews/native-hud-brief-claude-20260727-175147.md` — menu-bar-service path → archive
- `Claude.md` / `CLAUDE.md` Related Docs — add MCP / CU / host / NotebookLM / multi-agent / TROUBLESHOOTING; arch section note
- `docs-reorg-plan` — Phase 5 post-archive status note

## Intentionally not changed

- **Archive internals** (sprint→requirements, menu-bar cross-refs): historical; leaf README already non-normative
- **`docs/docs-reorg-plan`** disposition table / sample `git mv` commands: process record
- **Runtime code** (`companion/src/**`, `chrome-extension/src/**`): FORBIDDEN this wave
- **No commit**

## Residual (optional Phase 5+ / out of scope)

- `Agents.md` references `docs/session-lifecycle.md` (file missing pre-archive; VibeSOP session docs live outside repo)
- Global sweep of all `docs/audit/**` / `docs/superpowers/**` narrative paths not required for entry DoD
