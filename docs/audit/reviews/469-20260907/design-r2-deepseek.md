## Verdict: APPROVE_WITH_NITS

Re-judged against the corrected premise — ContextPanelHost is a vertical stack inside the App column, not a fixed-width column — and against the packet's own safety/UX contract. No prior MAJOR lock remains open. The nits below are non-blocking documentation/testability clarifications; none reopen trust or require another design cycle before implementation starts.

## Closure of own prior conditions

1. **Layout premise / fixed-width column** — CLOSED. Correction accepted: vertical stack, preserved as-is. The 36dvh/28dvh cap addresses the real problem (existing fixed `maxHeight:320` stealing vertical area) without introducing a horizontal column.
2. **Vertical-area theft / FocusBand squeeze** — CLOSED. Cap is viewport-relative, short screens scroll conversation content rather than the composer, and confirmation/stop remain in FocusBand with no overlay and no second sticky header.
3. **Confirmation integrity** — CLOSED. Handlers, button order/roles, initial focus, timeout, whitelist, and auto-approve copy/defaults frozen; Cockpit DOM/handlers byte-unchanged; only shared surface colors/type/spacing/focus-visibility restyle.
4. **Duplicate new-thread header / duplicate state** — CLOSED. New conversation owned solely by WorkspaceNavigation; StatusRail is the single conversation header; recent rows are store projections with no duplicate loader/thread cache/Agent/confirmation center.
5. **Large/small viewport and zoom evidence** — CLOSED at design level. 320 no-overflow, 759/760 breakpoints, and 200% zoom are gated in the browser harness with confirmation and settings flows.
6. **Evidence visibility / dangerous-action approval** — CLOSED. Decision-critical evidence ≥ baseline, confirmation distinct from tool success, FocusBand priority authoritative, no implicit approval introduced.
7. **Native capture claim** — CLOSED. Only shared web surfaces are verified; native surfaces remain separately tracked, and no native cross-platform pixel acceptance is claimed.
8. **Production validation gate** — CLOSED, conditional on Nit N1 persisting the distinct-machine wording into the written contract.

## Safety / UX assessment

- **Safety**: The design's strongest property is that layout changes are explicitly bounded away from trust policy. Every load-bearing confirmation attribute is enumerated and frozen; the style-change allowance is narrow and reviewable. FocusBand remains the single authoritative stop/confirmation surface.
- **UX**: Single header with text-labeled 导航 avoids the icon-only ambiguity and duplicate new-thread affordance that motivated earlier objections. Title/context separation (header title vs FocusBand page/context) is coherent. Projected recent rows plus preserved full history avoids data divergence.
- **A11y**: WCAG 2.2 AA "practices" framing with honest non-certification is appropriate. 32px/36px targets, non-color risk labels, focus return, and no nested interactives are the right commitments.
- **Testing**: 759/760 and 200% zoom with synthetic transport are the correct gates for a responsive redesign; production build + full suites + external dual review are appropriate for code-level change.

## Nits

- **N1** — The conversation context states production code gets a *distinct machine* and *dual gate*, but the Implementation constraints paragraph only says "external dual reviews." Add one sentence: production verification runs on a machine distinct from the development machine, with dual review before merge. This prevents the gate from living only in surrounding conversation context.
- **N2** — "Short windows" for the 28dvh switch is unspecified. Define the height threshold (e.g., viewport height below a named breakpoint) and make one harness assertion: FocusBand confirmation/stop remains fully visible with ContextPanelHost open at 320×568 and at 200% zoom.
- **N3** — Since confirmation surfaces receive shared-token color restyles, add a one-line acceptance criterion that destructive/warning text keeps ≥4.5:1 contrast and non-color encoding; keep as surface-only confirmation in the diff.

N1–N3 are editorial/acceptance additions, not design blockers. With those recorded, the packet can proceed to implementation under this contract.
