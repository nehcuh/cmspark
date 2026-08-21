# Dual rereview (Claude + Kimi) — web act-loop WAVE-1 **implementation**

You are a **Pi-style second judge**. Confirm or reject the independent adversaries. Do **not** rubber-stamp. Implementer cannot self-APPROVE.

## Blast
T2 L1 web tools + classifyError + prompt Rule 12/7/8/12b. Trust freeze: click not L2; finder in extension IIFE.

## SoT
`docs/superpowers/specs/2026-08-21-web-act-loop-design.md` (LOCKED; Kimi spec nits F1–F6 folded as spec-text only)

## Adversary reports (read full, not summaries)
- `docs/audit/reviews/web-act-loop-impl-adversary-locator-20260821.md` → APPROVE_WITH_NITS
- `docs/audit/reviews/web-act-loop-impl-adversary-budget-20260821.md` → APPROVE_WITH_NITS
- `docs/audit/reviews/web-act-loop-impl-adversary-win32-20260821.md` → REJECT (first pass)
- `docs/audit/reviews/web-act-loop-impl-adversary-win32-rereview-20260821.md` → APPROVE_WITH_NITS after fold

## Machine (must treat as claims to re-verify if you can run commands)
- chrome-extension `npm test`: 789 pass (pre-fold); WAVE-1 locator+type-fallback 17/17 after fold
- companion `npx tsc -p tsconfig.test.json` exit 0
- companion compiled `web-act-loop-wave1` + `dom-script-budget`: 15/15
- companion `tsc --noEmit` exit 0

## Fold after win32 REJECT
- `classifyInteractiveFailure`: URL-first WRONG_ORIGIN; "Debugger is not attached" → CDP_ATTACH_FAILED not ELEMENT_NOT_FOUND
- wave1 test: no import.meta; process.cwd() for adapter source lock
- linux Rule 12/12b: CU not available; darwin/win32 12b NEVER for browser-DOM
- scroll exhaust no longer suggests host_computer

## Your job
1. Outcome: DoD 1–20 actually held in code, not just adversary prose?
2. Trajectory: any leftover hop (evaluate / host_computer / osascript on win32) in tool results or prompts this wave touched?
3. Component: file:line if you find a miss the adversaries waived.
4. Confirm or reject each adversary VERDICT. Over-loose APPROVE → you REJECT.

Capability ADR-020: no new L2 class; click off L2_GATE_TOOLS.

End with exactly one line:
`VERDICT: APPROVE` or `VERDICT: APPROVE_WITH_NITS` or `VERDICT: REJECT`
