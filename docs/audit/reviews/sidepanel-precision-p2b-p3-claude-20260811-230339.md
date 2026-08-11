Review complete. Writing up the verdict now.

---

## Summary

Phase 2b+3 ships shared `SectionHeader` / `popupMenuStyles` / `PanelBanner` components, tightens motion tokens (150/220 → 120/180ms), and finishes the ThreadList residual-hex purge. Pure L0 panel-chrome refactor — no new tools, no new gates, no autonomy/trust elevation. Capability declaration is present and accurate.

## Spot-checks [executed]

- **Tests** — `npm test` in `chrome-extension/`: **622/622 pass** (9.4s).
- **Typecheck** — `npx tsc --noEmit`: **EXIT 0**.
- **`tokens.ts`** (tokens.ts:69-71) — only the two motion values changed; `userBubbleText: "#ffffff"` intact.
- **Reduced-motion override** preserved at App.tsx:1679 and CockpitApp.tsx:685 — global motion tighten doesn't regress a11y.
- **`popupMenuStyles`** (popupMenuStyles.ts:7-63) — minWidth 200, padding 6, radiusMenu, shadowLg; menuItem 9/11 padding, fontSize 12; menuTrigger 32×32. Lock-step with StatusRail baseline.
- **`PanelBanner`** (PanelBanner.tsx:1-146) — 4 tones, all token-mapped; `role` prop defaults to "alert"; `panelBannerBtnStyles` exported for call sites.
- **`DisconnectedBanner` wiring** (App.tsx:1602-1626) — `onRetry` (重新连接) and `handleOpenLogs` preserved 1:1; native `open_directory` path + hint fallback + `wordBreak: break-all` intact. Disconnect recovery UX preserved.
- **MinimalConfirm** (MinimalConfirm.tsx:392,405) — only opacity transition speed (150→120ms); no semantic change to confirm gating.
- **ADR-020 declaration** present and matches diff (Surface=L0, no L2/Compose/Autonomy/Trust/Channel changes).

## Rejection gates

- **B1 confirm/急停 / disconnect recovery** — not weakened. DisconnectedBanner recovery affordances preserved; confirm code paths untouched (only animation speed).
- **B2 new L2 tools / trust elevation** — none.
- **B3 density budget via growing chrome** — net neutral. Minor (~4–8px) growth in specific spots, offset by ThreadList hex purge and popup consolidation.

## Nits (non-blocking)

1. **`tokens.userBubbleText` semantic leak** — used for toast/banner/CTA/danger button text now, not just user chat bubbles (App.tsx:1837, ThreadList.tsx:1637/1718/1779, PanelBanner.tsx:87). Value is correct (`#ffffff`); naming is leaky. Future cleanup: rename to `onAccentText` / `inverseText`.
2. **ThreadList `menuBtn` row mismatch** (ThreadList.tsx:1669, used at :1171) — `menuTrigger` 32×32 sits between inline `选择`/`+ 新建` buttons (~22–24px tall). Intentional StatusRail alignment per spec, but visually dominates the row; worth a smoke test in browser.
3. **McpPanel `menuDropdown` minWidth override 100** (McpPanel.tsx:483) — popupMenuStyles gives minWidth 200 + heavy chrome (padding 6, shadowLg); McpPanel shrinks to 100. Two-character items ("删除") under a heavy chrome frame may feel visually weighted. Verify visually.
4. **OutboundMcpSettingsSection case change** (OutboundMcpSettingsSection.tsx:153) — was UPPERCASE 12/700 letterSpacing 0.4; now mixed-case 13/600 letterSpacing -0.01em via SectionHeader. Intentional but notable visual shift; confirm with design.
5. **SectionHeader ~4px/chrome growth** (SectionHeader.tsx:33-37) — padding `8px 0 6px` + marginBottom 4 + border ≈ 19px vertical vs original Knowledge ~15px. Multi-group panels (KnowledgeSubPanel) accumulate this.
6. **Task-reference comment** (SettingsSection.tsx:79) — `// Phase 2b — align with SectionHeader (13/600, no 14/700 chrome drift)` references task context; per project convention prefer trimming or dropping.
7. **PanelBanner default role** (PanelBanner.tsx:48) — `role` prop accepts `"alert" | "status"` but defaults to "alert" for all tones including `info`/`neutral`. Future non-critical callers may want explicit `role="status"`.

VERDICT: APPROVE_WITH_NITS
