# Independent Design Review — #474 (packet-only, no code examined)

## VERDICT: APPROVE_WITH_NITS

No BLOCK findings. Scope discipline is correct (visual-only, no install/replace, user-authorized redesign honored). Follow-ups below are non-blocking for T2.

## Findings

**P0/P1** — none.

**MAJOR-1 · Portability: dual-source geometry drift risk.** Same 24-grid is specified for JS export module and Swift native paths, but nothing pins the two implementations together. Drift presents as tray icon ≠ exported PNG/SVG. Verification gates each side independently (Swift offscreen render; JS export sizes/colors) but never against each other. Recommend a cross-implementation golden test: Swift offscreen render pixel-diffed against the JS-exported PNG/ICO at matching scales (tolerance budget at 16px). Non-blocking, cheap to add later.

**MAJOR-2 · Accessibility: color is the only in-icon state channel.** Green/red/yellow discriminates exclusively by hue; red-green is the canonical CVD failure, and the compensating text channels (tooltip, VoiceOver, status details) all require hover/focus interaction. I flag this despite the user's explicit tri-color authorization — not as push-back, but as a recorded follow-up: Swift native paths make per-state shape variation nearly free (e.g., slash/bar for stopped, partial stroke for unknown). Recommended, not required for this ticket.

**NIT-1 · State correctness: "detecting" needs a bound.** Unbounded yellow on a hung probe/grep demotes the state signal permanently. Specify a timeout → unknown, or an explicit "error" red-variant with distinct tooltip text.

**NIT-2 · Legibility: 24→16 is non-integer downscale.** Thick strokes + few nodes is the right recipe, but bilinear-downsampled 24px marks blur at 16px. Ensure the exported 16 is snap-aligned/hand-checked, not naive scaling. The planned light/dark 16–32 preview matrix is good — make it a pass/fail gate, including the central four-point spark collapsing at 16px.

**NIT-3 · Legibility/accessibility: yellow on light menu bar.** Low-contrast amber risks washing out against light/tinted menubars. Pick a deeper amber or add a hairline outline in preview verification.

**NIT-4 · Product clarity: extension icon is brand, tray is state.** Extension mark is always green while tray carries red/yellow — a user glancing at the always-green extension icon may read it as "running". One-line clarification in tooltip/docs.

**NIT-5 · Product clarity: menu without state header.** Removing the duplicate Agent status header is right, but start/stop/restart lose state context. Suggest graying out the current-state action (e.g., "Stop" disabled when already stopped); the verification already covers action-mapping drift, which is the important half.

## Per-lane assessment

- **State correctness**: sound — WS-as-independent-status and "unknown ≠ stopped" are the right calls; NIT-1 only.
- **Product clarity**: clean, user-backed metaphor; NITs 4–5.
- **Small-icon legibility**: right design posture; NITs 2–3.
- **Accessibility**: text channels retained correctly; MAJOR-2 deferred with rationale.
- **Build portability**: shared JS module + SVG-as-auditable-asset is good; MAJOR-1 deferred.

Proceed; record MAJOR-1/MAJOR-2 as follow-up items.
