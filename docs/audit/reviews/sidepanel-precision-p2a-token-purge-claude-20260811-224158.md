## Summary

Phase 2a is a mechanical hex→`tokens.*` purge across 12 secondary-panel files + 2 docs. The capability declaration (Surface: L0 Panel secondary chrome; no new L2/Compose/Autonomy/Trust/Channel) matches the diff: every hunk is style-only, no JSX structure / handler / confirm-flow changes. ADR-020 axes fit, pack-first, trust-monotonicity, originWs are all N/A — the confirm/急停 paths in `SettingsSlideout` (SECURITY_ARM_PHRASE / ENT_B_PHRASE / autopilot arm) retain identical logic; only their palettes swapped. ThreadGraph canvas approach (`strokeStyle = token + globalAlpha`) is correct — pixel output unchanged, alpha restored to 1 after stroke.

## Spot-checks

- `McpPanel` mode-button `#fff` → `tokens.bgElevated` (text-on-accent) — ✓ correct, white preserved via `bgElevated`.
- `AppsPanel` `#047857`/`#d1fae5` → `tokens.success`/`tokens.successSoft` — ✓ semantic.
- `SettingsSlideout` `#C62828` (danger button bg) → `tokens.danger` + `#fff` → `tokens.userBubbleText` — ✓ consistent with Phase 1 mapping.
- `ThreadGraphApp` legend swatches: `opacity: 0.6` on bare border-only spans — ✓ equivalent to old `rgba(...,0.6)` borderColor.
- `PacksPanel` `#b45309` (trust amber) → `tokens.warning` — ✓ semantic.
- Confirm/急停 / FocusBand paths: only color literals changed; no `request(`, `forceConfirm`, or scope/phrase logic edited. ✓ B1/B2 clear.

## Blocking

- `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx:3224-3225` — code block for `installCommands` (Whisper / Python env setup) now renders **invisible text**:
  - `background: tokens.darkElevated` = `#141820` (dark navy).
  - `color: tokens.borderStrong` = `rgba(15, 23, 42, 0.12)` — a 12%-opacity dark-navy intended for borders, not text.
  - Composited over `#141820` the text comes out at ≈rgb(19,24,33) vs background rgb(20,24,32) — contrast ratio ~1.0. Pre-existing was `#e0e0e0` on `#1e1e1e` (clearly readable). The correct token is `tokens.darkText` (`#f1f5f9`) or `tokens.darkMuted` (`#94a3b8`); reaching for `borderStrong` as a text color is the wrong mapping. This harms a real user-facing setup flow (local-ASR install commands the user must read + copy), so I can't APPROVE as-is.

## Nits (non-blocking)

- `PacksPanel.tsx:1637` and `SettingsSection.tsx:57` — tautological fallback `tokens.border || tokens.border` (the `||` was a defensive guard for a removed hex literal; now redundant — drop the `||` clause).
- `McpServerForm.tsx:532-535` — `criticalTag` has `background: tokens.dangerSoft` *and* `border: 1px solid ${tokens.dangerSoft}` — same color on both, border disappears against bg. Original (`#fef2f2` bg + `#fecaca` border) had subtle definition; consider `borderStrong` or `danger` for the border.
- `McpPanel.tsx:535` — error/dead `borderColor: tokens.dangerSoft` is paler than the original `#fecaca`; intentional but slightly weaker hazard frame. Fine if it matches Phase 1 spec.

VERDICT: REJECT
