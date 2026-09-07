I'll read the packet and follow its review instructions exactly.**Independent correction review · #469 design · packet-only · no cross-lane**

This review uses only `/private/tmp/cmspark-469-design-r2/packet.md`. No prior-session MAJOR list is in this conversation; the packet’s listed locks are treated as the correction set and closed or left open explicitly below. User-authorized UI redesign, no trust-policy change.

## Verdict

**APPROVE_WITH_NITS**

The stacked ContextPanelHost alternative is acceptable on safety and UX. It is not judged against a horizontal column. All packet-listed MAJOR locks are closed in this revision. Residual gaps are specification nits, not unclosed majors.

## ContextPanelHost (the correction under test)

**Source (as given):** vertical stack in `App` `flexDirection: column`, not a fixed-width column. Current `maxHeight: 320` already steals vertical space.

**Proposal:** keep that stack; cap `36dvh` / `28dvh` on short windows; close supporting panels before configuration; do not overlay pending confirmation; FocusBand stays the confirmation/stop authority.

**Safety.** Overlay of pending confirmation is forbidden, and confirmation DOM/handlers/order/initial focus/timeout/whitelist/auto-approve copy stay unchanged. A viewport-relative cap is safer than a 320px cap on short windows (`28dvh` of a short viewport is well under 320px), so this reduces the existing steal rather than adding a new covering surface. Stacked layout cannot sit beside FocusBand and hide it in z-order the way a side column or overlay could.

**UX.** Same host, same open/close model, same jobs (knowledge/scenes/skills/MCP/apps/meetings). Wide unused horizontal space is a product choice, not a safety defect; the packet asks not to revive a horizontal column. Progressive disclosure still holds: supporting work is on demand, conversation stays the dominant column.

**Residual (nit, not major):** “Do not overlay” is not the same as “do not displace.” A tall stacked panel can push FocusBand/stop above the viewport if the column scrolls as a whole. Outcome language already requires confirmation and stop to stay visible, composer not to scroll away on short screens, and FocusBand priority to remain authoritative. That is enough to accept the alternative. Implementers still need a concrete conflict rule (below).

## Prior MAJOR locks — explicit closure

| Lock | Status |
|---|---|
| Narrow trigger is text **导航**, explicit drawer | **CLOSED** — IA names the control; principles require text labels |
| StatusRail is the single conversation header; no second new-thread control | **CLOSED** — new conversation owned only by WorkspaceNavigation |
| Recent nav is a projection of the existing store; full history keeps its owner | **CLOSED** — no duplicated loader, thread cache, Agent, or confirmation center |
| Confirmation DOM / handlers / button order / roles / initial focus / info (evidence + copy/defaults) | **CLOSED** — visual restyle limited to shared tokens (color, type, spacing, focus); Cockpit confirmation DOM/handlers byte-unchanged; decision-critical evidence at least as visible as baseline |
| Harness covers 759 / 760 and 200% zoom | **CLOSED** — named in implementation constraints with wide/narrow/short, keyboard, message/tool/confirmation/settings |
| Native capture not claimed | **CLOSED as non-claim** — open question remains; browser harness does not certify Swift/Windows chrome |

No other own MAJOR from this reviewer is outstanding. A positive verdict does not waive these; they are closed because the text now locks them.

## Nits (should be written in before implementation, not blockers)

1. **Confirmation vs panel height (in-viewport, not only non-overlay).** Add one layout sentence: FocusBand confirmation and stop remain inside the viewport while ContextPanelHost is open; the panel may only shrink the message scroller (or must collapse) and must yield if both compete on short windows. “Protects FocusBand” / “stay visible” already state the outcome; this names the mechanism so “no overlay” is not implemented as “no `position: absolute`” while confirmation scrolls away.

2. **Define “short window”** for the 28dvh cap (height threshold the harness will use). Without it, 28dvh vs 36dvh is not testable as specified.

3. **36dvh on tall viewports can exceed today’s 320px** (e.g. ~389px at 1080). Fine if intentional (“use more space when available”). If the goal is “steal no more than baseline on tall screens,” cap with `min(36dvh, 320px)`. Pick one and lock it.

## What is already sound

- Trust boundary: layout does not change policy; no implicit approval; confirmation stays distinct from tool success.
- One header, one new-conversation owner, store projection — no dual cache.
- 320px first-class; 760px persistent 220px nav; 200% zoom and long title/URL wrap-or-truncate without hiding actions.
- Settings is one named dialog; supporting panels close first; no second sticky header.
- A11y: 4.5:1 for newly styled ordinary text, non-color risk labels, 32/36px targets, Escape + focus return, no nested interactives; no false WCAG certification claim.
- Empty-state suggestions fill input and never send.
- No new production dependency; tokens remain the only new color owner; native surfaces separately tracked.

Production code still needs its own machine/dual gate; this verdict is design-only.
