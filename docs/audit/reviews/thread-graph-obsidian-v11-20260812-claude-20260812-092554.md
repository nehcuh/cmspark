Verification complete. Let me record findings.

**Blocker re-verification (read against actual current source, not just synthesis):**

| # | Claim | Confirmed at |
|---|-------|-------------|
| C1 | `layoutSignature` (ids+deg+edges) gates reseed | ThreadGraphApp.tsx:217-238, applied at 250-258 — same sig only refreshes radii, keeps x/y/pin ✓ |
| C2 | fit when sim exhausts (320) not just energy | ThreadGraphApp.tsx:355-360 — `settled \|\| exhausted` triggers fit ✓ |
| C3 | pointerleave only clears hover, not drag | ThreadGraphApp.tsx:541-546 — `onPointerLeave` keeps dragRef; `endDrag` on Up/Cancel releases capture ✓ |
| C4 | screen-constant hit pad | ThreadGraphApp.tsx:476 — `HIT_PAD / scale` ✓ |
| C5 | sticky pin only after real drag | ThreadGraphApp.tsx:516 temp-pin on down; line 496 `n.pinned = drag.moved`; line 542 `moved` requires >2px ✓ |

**Bonus fixes confirmed:** `persistPanelPref` is the only path that writes `localStorage`; node-click and `openThread` call bare `setPanelOpen(true)` (transient). ✓

**ADR-020:** Surface L0, no L2/Compose/Autonomy lift, no Trust change, no new tools/gates/primary-UI entry. Capability declaration matches diff. ✓

**Machine:** `cd chrome-extension && npm test` → 628 pass / 0 fail [executed]. ✓

**Out-of-scope confirmed:** `companion/src/host-use/darwin/host-integrity.ts` is a single-line SHA256 pin rotation (1 line), unrelated to thread-graph. ✓

**Residual nits (non-blocking, agreeing with synthesis):**
- N1 (correctness): No `ThreadGraphApp` canvas-level integration tests; only `tag-colors` + `force-layout` unit tests. Defense-in-depth via signature test would catch C1-class regressions.
- N2 (correctness): `fittedRef` stays true across resize; large viewport changes won't re-fit. Minor since users can wheel-zoom.
- N3 (correctness/style): `colorByIdRef.current = tagColors.colorById` mutated mid-render (ThreadGraphApp.tsx:241-243) — works because refs, but is the React "write-ref-in-render" anti-pattern. Safe here; flag for cleanup.
- N4 (UX): Toolbar `top: 12 + height` can collide with float panel `top: 64` on narrow widths.
- N5 (UX/a11y): Canvas lacks role="img" / keyboard node nav.
- N6 (spec): Design §3.1 left-rail still describes the old layout vs §6 floating chrome (doc debt).
- N7 (security, defense-in-depth, out of diff scope): `prepareThreadGraphSnapshot` could runtime-slim unknown keys; not introduced here.

No blockers remain. All Round-1 REJECT issues are truly fixed in code; capability declaration is accurate; tests green.

VERDICT: APPROVE_WITH_NITS
