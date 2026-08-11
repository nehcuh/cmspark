All context gathered. Here's my review.

---

# Dual review — Side Panel 「精密仪器台」redesign (design gate)

## Summary

This is a **design-gate review** of the SoT at `docs/superpowers/specs/2026-08-11-sidepanel-precision-instrument-redesign.md` (Phase 1 shell foundation before any code). The declared capability surface is `L0 Panel chrome`, no new L2 tools, no compose/autonomy elevation, no trust elevation, unchanged channel — a pure presentation reset. Direction **Operate / Restrained (精密仪器台)** is appropriate for the product: PRODUCT.md's primary audience is power users in a ~320px panel whose #1 job is "talk & act / know status" — a flat cool-neutral instrument desk with indigo-as-spark directly matches the documented anti-references ("avoid Inter-purple gradient cards… nested card cages… emoji toolbar chrome… noisy multi-strip status landfill").

## Spot-check (verified against real code)

- **Diagnosis is grounded, not hand-waving.** Confirmed in tree: `App.tsx:1692` container gradient `linear-gradient(180deg, ${tokens.bg}, #eef0f6)`; `App.tsx:1700-1701` inputArea `backdropFilter: blur(14px)` over `rgba(255,255,255,0.62)`; `App.tsx:1706-1711` composerCapsule dual shadow (`shadowMd` + inset white ring); `ChatView.tsx:1616` empty title `fontSize: 18`; `StatusRail.tsx` rail has gradient + `backdropFilter: blur(16px)`. Every P1 item targets a real defect.
- **Token deltas match SoT.** `tokens.ts` currently has `bg #f5f6fa` → proposed `#f4f5f8`; `radiusComposer/radiusBubble 18` → 14; `radiusSheet 20` → 16; composer dual-shadow → single soft. All deltas align with the actual file.
- **Confirm/急停 not weakened.** FocusBand priority machine kept; `dangerSurface` confirm fill preserved; trust declaration + acceptance R4 + rejection gate R1 all explicitly require 急停 visible. Phase 1 touches FocusBand only as hairline/padding (P1-5), vertical footprint unchanged (`outer` padding is `"2px 10px 0"`, `FocusBand.tsx:242`).
- **Density budget safe.** Radius/shadow/background changes are height-neutral; empty-title 18→15 *shrinks* chrome; no new status bands (anti-pattern bans new strips without a density note); `inputArea` padding (12/14/16) untouched; R6 requires re-measure or note. Idle 72.2% / worst 45.8% hold.
- **ADR-020 clean.** No new capability axis, no new L2-classes, no bare 「中层 Agent」anywhere (grep clean), no new confirm family, no `securityConfirmations.request` → originWs N/A, no new runtime, no god-mode/auto_approve touches. Compose/Autonomy are explicitly presentation-only ("装配 entry chrome only" / "Fleet/Board presentation only").
- **No feature invention.** Phase 1 = token deltas + shell style edits + DESIGN.md sync. Graph stays full-page/separate; SettingsSlideout rewrite explicitly deferred to Phase 2 (R4 gate passes).

## Blocking issues

None. All four rejection gates (R1–R4) and the ADR-020 checklist pass.

## Nits (non-blocking)

1. **First-viewport sketch vs budget SoT**: sketch says StatusRail `~40px`, density budget SoT constant is `minHeight: 44` (`StatusRail.tsx`). "Quieter density" must not silently shrink below 44 without re-measuring — R6 already anticipates this; keep the 44 constant.
2. **Type-scale enforcement ambiguity**: R2 mandates "only 11/12/13/15" in StatusRail/empty/composer, but composer textarea is currently `fontSize: 14` (`App.tsx` textarea) and StatusRail uses 9–10px labels (brandMark 9, connLabel/cruise 10). The 14→15 implication for the textarea and whether 9/10px micro-labels are exempt should be pinned in the impl ticket to avoid mid-PR churn.
3. **"Composer glass blur + dual border" wording** (Section 4) is slightly imprecise — it's glass + `borderStrong` + inset-ring *shadow*, not a literal dual border. Intent is clear; no action needed beyond implementer fidelity to the capsule description in P1-2.
4. **P1-5 wording risk**: "no competing full-width fills" should be read as removing fills on *non-critical* strips — the FocusBand confirm/急停 `dangerSurface` fill must stay (the trust declaration says so, but a one-line explicit carve-out in the impl ticket would make R1 unmissable).
5. **Batch hygiene**: the attached patch file (`sidepanel-precision-instrument-design-diff-…patch`) is not stale (git status matches), but it contains unrelated in-progress work from other batches — thread-graph impl (`background/thread-graph.ts`, `tabs/thread-graph.tsx`), icon regeneration, and a security-relevant `CMSPARK_HOST_SHA256` pin change in `companion/src/host-use/darwin/host-integrity.ts`. None of that belongs to this design gate; reviewers should not treat it as implicitly approved here. The SoT itself is the review subject.

## Scope

Phase 1 shell foundation is correctly bounded, phasing is sound (shell → secondary → motion), and it is implementable today without inventing features.

VERDICT: APPROVE_WITH_NITS
