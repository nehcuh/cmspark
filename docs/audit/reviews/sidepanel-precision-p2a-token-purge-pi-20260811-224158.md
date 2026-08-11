# Dual External Review — Phase 2a Token Purge

## Verification of inputs
- **Patch freshness:** Working tree is clean and matches HEAD (`538de70`). Patch body is byte-identical to `git show HEAD` minus the review-context header — **not stale**.
- **Capability declaration:** Present and complete (Surface L0 colors-only; no new L2 classes; Compose/Autonomy/Trust/Channel unchanged). ADR-020 checklist satisfied — no new confirm dialect, no trust/autonomy elevation, no runtime, originWs N/A (no new `request(` paths), and no "中层 Agent" language anywhere. Axes fit correctly for a pure presentation change.

## Spot-checks performed
- **Token existence:** All tokens referenced in the diff exist in `sidepanel/ui/tokens.ts`; `tsc --noEmit` clean.
- **Logic-safety scan:** machine-filtered every `+` line in the patch — **zero** non-style additions (no onClick/onChange/handler/request/dispatch/estop/confirm changes). Confirm/急停/FocusBand/Security regions in `SettingsSlideout` (arm chips ~2205–2451, advanced-gate confirms ~2559–2768, audit log) and `McpServerForm` `confirmTrusted` (line 399) are color-only.
- **Purge completeness:** 0 residual six-digit hex in all 11 changed source files.
- **Tests:** `npm test` → **622 pass / 0 fail**; typecheck green.
- **ThreadGraph canvas (Q4):** `tokens.accent` (#4f46e5 = rgb(79,70,229)) @ 0.45 and `tokens.textMuted` (#94a3b8 = rgb(148,163,184)) @ 0.55 reproduce the original rgba values **exactly**; `globalAlpha` reset to 1 after stroke. Legend 0.8→0.85 opacity is a trivial delta. **Acceptable.**

## Semantic mapping audit (Q1)
- `#dc2626→danger` (identical), `#C62828/#b91c1c/#b71c1c→danger`, `#047857→success`, `#b45309/#B26B00/#8a5a00→warning`, `#fef3c7/#fff7ed→warningSoft`, muted grays → `textMuted`/`textSecondary`, borders → `border`/`borderStrong`. Danger stays danger, muted stays muted, borders stay borders. No new palette invented.

## Blocking issues
**None.** B1 (trust/confirm/急停 behavior) — untouched. B2 (new L2/feature invention) — none. B3 (mass wrong mapping harming safety chrome) — no mass mapping; the one wrong mapping below is a single help block, not safety chrome.

## Nits (non-blocking, fix-worthy)
1. **`SettingsSlideout.tsx:3225` — legibility regression on dark code block:** install-commands code block now `background: tokens.darkElevated` (#141820) with `color: tokens.borderStrong` (rgba(15,23,42,0.12) — ~12% black). Text becomes nearly invisible on the dark surface (was `#e0e0e0` on `#1e1e1e`, ~9:1 contrast). This is a text→border-token mapping; should be `tokens.darkMuted`/`darkText`. Single instance, non-security → nit, but the only substantive one.
2. **AppsPanel `warningsBox` / `errorBox`:** border now `tokens.warningSoft`/`dangerSoft` — identical to the background, so the box outline that existed (`#fde68a`/`#fecaca`) disappears. Use the solid `warning`/`danger` for border or accept outline-less boxes.
3. **Dead fallbacks:** `tokens.border || tokens.border` in `PacksPanel` `styles.item` and `SettingsSection.section` — no-op leftovers.
4. **`McpServerForm` `addRowBtn`:** dashed border `#aaa` → `tokens.textMuted` (text token as border) — pragmatic, slightly off the borders→border* rule.
5. **McpPanel `ServerCard` error border:** `#fecaca` (red-200) → `dangerSoft` (red-50) — error state border becomes very subtle; within danger family but may be hard to notice.
6. **`AppsPanel.presetUndetectedBadge`:** background `#f3f4f6` → `tokens.border` (border token as background) — visually similar in light mode, semantically odd.
7. **`userBubbleText` reused as on-accent button text** (`submitBtn`/`saveBtn`/toggleBtns): value-correct (#fff on #4f46e5, and `userBubbleBg === accent` per design SoT) but semantically off-label; a dedicated on-accent token would be cleaner.

All 7 nits are non-blocking; none affect logic, safety chrome, or contrast on any security-critical surface. Docs updates (DESIGN.md, spec status) are accurate and stay in lock-step.

VERDICT: APPROVE_WITH_NITS
