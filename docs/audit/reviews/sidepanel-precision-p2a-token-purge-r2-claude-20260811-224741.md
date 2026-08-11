TypeScript compiles clean. Review complete.

---

# Review — `sidepanel-precision-p2a-token-purge-r2`

## Summary

Mechanical hex → `tokens.*` purge across 12 secondary-surface files. All token names resolve against `chrome-extension/src/sidepanel/ui/tokens.ts`. No JSX structure changes, no handler/state changes, no new tools or feature invention. Capability declaration (L0 secondary chrome, no L2/Compose/Autonomy/Trust/Channel change) matches the diff exactly. TypeScript compiles clean. **Patch file matches working tree.**

## Spot-checks `[inspected]`

**Token existence** — every name used in the diff (`accent, bgElevated, bgMuted, bgActive, text, textSecondary, textMuted, border, borderStrong, accentSoft, accentText, success, successSoft, warning, warningSoft, danger, dangerSoft, userBubbleText, darkElevated, darkText`) is defined in `tokens.ts:6-93`.

**Semantic mappings** — verified correct:
- danger reds (`#dc2626`/`#b91c1c`/`#C62828`/`#b71c1c`) → `tokens.danger` ✓
- danger fills (`#fef2f2`/`#fee2e2`) → `tokens.dangerSoft` ✓
- success (`#047857`/`#166534`/`#2e7d32`/`#065f46`) → `tokens.success` ✓
- warnings (`#f59e0b`/`#b45309`/`#854d0e`/`#B26B00`/`#92400e`) → `tokens.warning` ✓
- `#fff` on indigo accent → `userBubbleText` (or `bgElevated`, both `#ffffff`)
- muted grays (`#888`/`#999`/`#9ca3af`) → `textMuted`; `#666`/`#555`/`#374151` → `textSecondary`; `#333`/`#222` → `text` ✓

**Purge completeness** — grep `#[0-9a-fA-F]{3,8}` across all 12 touched files returns only one match: a `React #310` issue-reference comment in `SettingsSlideout.tsx:357`. Zero stray color hex. ✓

**No logic changes** — `git diff` for `^[+-]\s*(onClick|onChange|disabled|checked)` in SettingsSlideout returns nothing. Handlers (`handleGodModeConfirm`, `handleAutoApproveDangerousConfirm`, `handleEnterpriseAutoApproveConfirm`, `handleAutopilotArmConfirm`) untouched. ✓

**Trust/confirm/急停 paths** — Phrase constants (`SECURITY_ARM_PHRASE`, `ENT_B_PHRASE`, `SECURITY_ARM_CONFIRM_PHRASE`), the three cruise flags (`auto_approve_dangerous` / `auto_approve_enterprise_tools` / `allow_all_schemes`), FocusBand, and 急停 are not in the diff. **B1 not triggered.** ✓

**ThreadGraph canvas alpha** (`ThreadGraphApp.tsx:235-244, 411-427`) — Standard pattern: `ctx.strokeStyle = tokens.accent/textMuted` (solid) + `ctx.globalAlpha = 0.45/0.55` set immediately before `stroke()` and reset to `1` immediately after, in a synchronous draw loop with no exception surface. No state leakage between draws. Legend `<span>` swatches use `opacity` on empty elements. Acceptable.

**Rejection gates**:
- B1 (Trust/confirm/急停 change): **not triggered**
- B2 (New L2 tools / feature invention): **not triggered**
- B3 (Mass wrong mapping): **not triggered**

## Nits (non-blocking)

1. **`#fff`-on-accent semantic inconsistency**: Active toggles in `AppsPanel.tsx:43`/`McpPanel.tsx:143` use `tokens.bgElevated`, while primary CTAs (`McpServerForm.tsx:610`, `OutboundMcpSettingsSection.tsx:376`, `SettingsSlideout.tsx` multiple, `UserEnvSection.tsx:49`) use `tokens.userBubbleText`. Both render `#ffffff` — visually identical, but `userBubbleText` is the semantically correct name for "text on accent fill". Unify in a follow-up.

2. **`dangerSoft` as border color reduces visible affordance** — `dangerSoft` is `#fef2f2` (near-white), designed as a fill. Using it as a border on `bgElevated` (`#ffffff`) or on a `dangerSoft` fill makes borders nearly invisible:
   - `SettingsSlideout.tsx:2255` — selected autopilot tier uses `dangerSoft` for BOTH border AND background → selected outline disappears
   - `SettingsSlideout.tsx:2369` — autopilot confirm container (`#E0B4B4` → `dangerSoft`)
   - `SettingsSlideout.tsx:2743` — godmodeConfirm container (`#E0B4B4` → `dangerSoft`)
   - `UserEnvSection.tsx:275` — delete button border (`#f0c0c0` → `dangerSoft`); text still red so affordance survives
   Suggestion: introduce a `dangerBorder` token (or use `tokens.danger` + reduced opacity) for danger-surface borders. Visual QA recommended.

3. **Warning borders over-darkened**: Light peach borders (`#f0d0a0`, `#E0C090`) on warning surfaces became `tokens.warning` (`#d97706`, dark amber). Grid lines in the enterprise-auto-approve table (`SettingsSlideout.tsx:2649-2683`) and ARM-phrase confirm boxes become noticeably heavier. Still semantically correct; visual QA recommended.

4. **Dead fallbacks** — `PacksPanel.tsx:1579` `tokens.accentSoft || tokens.bgActive` and similar `||` chains in `SettingsSlideout.tsx:1648, 1991` are now dead (tokens are static). Cosmetic cleanup opportunity.

5. **ThreadGraph legend swatch opacity rounding** (`ThreadGraphApp.tsx:413, 419`): `opacity: 0.6` and `0.85` are fine for `<span>` elements with no children, but a comment explaining the alpha intent (matching the canvas `globalAlpha`) would help future maintainers.

## Verdict

Ready to merge on tests green. Token migration is correct, complete, and semantically sound; no safety/trust/confirm path is touched; the nits above are visual-polish follow-ups, not blockers.

VERDICT: APPROVE_WITH_NITS
