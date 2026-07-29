# Ship note — Windows download UX / platform tools (P0)

**Date:** 2026-07-29  
**Reviewer:** Pi-only (`win-dl-g1-pi-20260729-230722.md`)  
**Verdict:** `APPROVE_WITH_NITS` (nits applied: executor uses `shouldL2GateOsascript`)

## Shipped (P0)

| Change | Files |
|--------|--------|
| Full catalog vs LLM-filtered tools | `companion/src/bridge/tool-definitions.ts` |
| Pack validator uses full catalog | `companion/src/packs/validator.ts` |
| Adapter platform filter + Rule 8 | `companion/src/llm/adapter.ts` |
| Early-reject before L2 | `companion/src/server.ts` |
| message-router first-line platform fail | `companion/src/message-router.ts` |
| browse skill no longer steers Windows to osascript | `companion/builtin-skills/browse.md` |
| Tests | `bridge.test.ts`, `security-gates.test.ts` |

**Tests:** bridge + security-gates — **85 pass / 0 fail** (executed 2026-07-29).

## Not shipped (P1)

`browser_download` / chrome.downloads — provisional in plan; needs transport spike.

## Plan / workflow

- Plan: `docs/superpowers/plans/2026-07-29-windows-download-platform-tools.md`
- Workflow: `.grok/workflows/windows-download-platform-with-gates.rhai` (Gate reviews: **Pi-only** per user)

## Residual nits (non-blocking)

- executeCompanionTool still validates params slightly before last platform guard (defense-in-depth only; primary reject is before L2).
