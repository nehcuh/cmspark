# Dual external IMPLEMENTATION review — UI Mode P0 + P1

You are an independent senior **product + extension systems** reviewer for CMspark. This is an **implementation review** of a feature branch, not a rubber-stamp. Do not implement code.

## Primary document (READ FULLY)

`docs/decisions/v1.3/ui-mode-p0p1-impl-review-brief-2026-07-26.md`

## Spec (P0/P1 accept criteria)

`docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md` — especially §6 P0/P1 and design decisions D9′–D16 / content-split / SafetyStrip.

## Prior design review (context only)

`docs/decisions/v1.3/ui-three-mode-redesign-review-synthesis-2026-07-26.md`

## Code to inspect (READ — do not skim filenames only)

**P0**

- `chrome-extension/src/sidepanel/mode/mode-controller.ts`
- `chrome-extension/tests/mode-controller.test.ts`
- `chrome-extension/src/sidepanel/hooks/useCapabilityMode.ts`
- `chrome-extension/src/sidepanel/store/agentStore.tsx` (mode-related)
- `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` (NOTE_BROWSER_TOOL)
- `chrome-extension/src/sidepanel/components/BottomBar.tsx`
- Header badge wiring in `chrome-extension/src/sidepanel/App.tsx`

**P1**

- `chrome-extension/src/background/cockpit-window.ts`
- `chrome-extension/src/background/index.ts` (cockpit handlers + auto-open)
- `chrome-extension/src/tabs/cockpit.tsx`
- `chrome-extension/src/cockpit/CockpitApp.tsx`
- `chrome-extension/src/sidepanel/components/SafetyStrip.tsx`
- `chrome-extension/src/sidepanel/components/MinimalConfirm.tsx`
- L2 branching in `chrome-extension/src/sidepanel/App.tsx`
- `chrome-extension/tests/cockpit-window-logic.test.ts`

Optional: compare full Panel `SecurityConfirmationDialog` in `App.tsx` vs Cockpit `ConfirmElevated` for security parity.

## Your job

1. Attack or endorse the implementation against the approved design + P0/P1 accept list.
2. Answer **all** questions in brief §4.
3. Call out security/focus/abort blind spots hard.
4. You may use Read/Bash/Grep on the repo; **do not** implement fixes.

## Output

Follow brief §5 format exactly.
End with exactly one line:
`VERDICT: APPROVE_IMPL` or `VERDICT: APPROVE_WITH_FIXES` or `VERDICT: REJECT_REWORK`
