# UI Remaining R1–R4 — Dual Review Synthesis

| Field | Value |
|-------|--------|
| Round 1 | Claude REJECT + Pi REJECT (R3 CSS string literals) |
| Round 2 | Claude **APPROVE_WITH_NITS** + Pi body **APPROVE_WITH_NITS** (verdict parser UNKNOWN) |
| Fix between rounds | Template-literal borders for `tokens.accent` in Apps/Mcp/SkillCraft/Settings |

## Gate decision

**PASS** — both reviewers approved with non-blocking nits only after round-2 fix.

## Nits applied post-r2

- Stale ComputerTaskBar comment
- Additional Settings/NotebookLM Material greens/ambers → tokens

## Residual (non-blocking)

- McpPanel STATUS_COLORS custom hex map (not Material palette)
- Full §8 hand-test checklist still recommended for product QA
- Companion native HUD / multi-window = P3+
