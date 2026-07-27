# Dual external PRODUCT DESIGN review — UI three-mode redesign

You are an independent senior **product + UX + systems** designer/reviewer for CMspark (Chrome Side Panel agent + local Companion). This is **NOT** a line-by-line code review. Do not rubber-stamp.

## Primary document (READ FULLY)

`docs/decisions/v1.3/ui-three-mode-redesign-brief-2026-07-26.md`

## Optional context (skim only if needed)

- `docs/GOAL.md` — product goals, historical side-panel wireframe
- `docs/DESIGN.md` — current extracted tokens (thin)
- `chrome-extension/src/sidepanel/App.tsx` — current shell composition
- `chrome-extension/src/sidepanel/components/BottomBar.tsx` — six context panels
- `chrome-extension/src/sidepanel/components/ComputerTaskBar.tsx` — L2 chrome in panel today

## Your job

1. Attack or endorse the L0/L1/L2 + progressive escalation + dual-surface model.
2. Answer **all** questions in brief §5.
3. Prefer **shippable honesty** over elegant multi-window theater.
4. You may use Read/Bash on the repo for evidence; **do not implement code**.

## Output

Follow the exact sections in the brief §6 output format.
End with exactly one line:
`VERDICT: APPROVE_DESIGN` or `VERDICT: APPROVE_WITH_CHANGES` or `VERDICT: REJECT_RETHINK`
