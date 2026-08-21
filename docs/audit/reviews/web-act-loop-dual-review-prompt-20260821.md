# Dual rereview (Claude + Kimi) — web act-loop DIRECTION

You are an independent rereviewer. You did not write the diagnosis or the fold.

## Read in this order

1. `docs/audit/reviews/web-act-loop-direction-20260821.md` (**fold — this is what you approve/reject**)
2. `docs/audit/reviews/web-act-loop-diagnosis-20260821.md` (pre-fold; adversaries attacked it)
3. `docs/audit/reviews/web-act-loop-adversary-browser-20260821.md`
4. `docs/audit/reviews/web-act-loop-adversary-policy-20260821.md`
5. `docs/audit/reviews/web-act-loop-adversary-surface-20260821.md`
6. Spot-check live code if you doubt a citation:
   - `chrome-extension/src/background/browser-bridge.ts` click/typeText
   - `companion/src/bridge/tool-definitions-catalog.json` click
   - `companion/src/security.ts` recoverable `element not found`
   - `chrome-extension/src/background/find-element-by-text.ts`

ADR-020 checklist: `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Task

Confirm or reject the **folded wave-1 direction**:
- W1 shared resolveLocator + fail-closed ELEMENT_* + stop liar `success:true` on type/hover/fill_form
- W3′ typed attach/origin errors + success-loop budget + osascript **budgeted last-resort** (NOT http scheme ban)
- W2 snapshot wave-2
- NOT host_computer as web default

Look for: fold still overclaiming click({text}) as a7ubt9 save; W3′ too vague to implement; missed Trust leak (text click as evaluate-without-L2); missed `shell_exec osascript -e` bypass.

This is **direction-lock**, not a git diff of a feature. REJECT if wave-1 is still the old W3 scheme ban or if W1 is claimed to have saved Zhihu Draft.js.

End with exactly one line:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
