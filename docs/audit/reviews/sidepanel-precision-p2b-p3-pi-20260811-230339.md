All checks complete. The refactor is internally consistent — removed style keys have no dangling references, `tsc --noEmit` is clean, and the full suite is green.

## Summary

Pure L0 panel-chrome diff (Surface axis): new shared `SectionHeader` / `popupMenuStyles` / `PanelBanner` components, popup-menu and section-title alignment to the StatusRail instrument grammar, Phase 3 motion token tighten, DisconnectedBanner + LogBar/toast hex→token conversion, ThreadList residual hex purge, and docs/spec updates. Capability declaration present and accurate (`Surface: L0`, no L2/Compose/Autonomy/Trust/Channel changes) — matches ADR-020 checklist: no new runtime, no new confirmation dialect, no trust elevation, no `securityConfirmations.request`, no originWs surface touched.

## Spot-checks

- **Patch freshness**: code-diff portion of the patch file matches `git diff HEAD~1..HEAD` exactly (only header context + unstaged `memory/session.md` notes differ). Not stale.
- **Must-answer 1 (density)**: SectionHeader 13/600 + meta 11 mirrors the SettingsSection alignment; `popupMenuStyles` reproduces StatusRail's exact menu values (padding 9/11, 12px type, gap 9, radiusMd, 32×32 trigger). AppsPanel (minWidth 180) and McpPanel (minWidth 100) override the shared minWidth correctly.
- **Must-answer 2 (motion)**: only `tokens.ts` values changed (150→120 / 220→180); no layout-height or density changes from motion. Verified `transitionFast`/`transition` usages are transition-only.
- **Must-answer 3 (disconnect UX)**: `App.tsx:1603-1626` — same title/copy, `role="alert"` (PanelBanner default), same 重新连接/查看日志 actions, hint preserved with `wordBreak: "break-all"`, `handleOpenLogs` intact (`App.tsx:1579`), `bannerStyles` fully removed with no dangling refs.
- **Must-answer 4 (security)**: `git diff --name-only` shows zero security/confirm/急停/capability files touched. Gates B1/B2 clear.
- **Must-answer 5 (tests)**: `npx tsc --noEmit` exit 0; `npm test` → 622 pass / 0 fail.
- No new ad-hoc hex introduced anywhere in the diff (`#` matches are only PR refs in session notes).

## Blocking

None. Rejection gates B1/B2/B3 all clear — the only chrome growth (ThreadList ⋯ → 32×32) is an explicit, spec'd lock-step with StatusRail, and the header row accommodates it within the existing 8px padding budget.

## Nits (non-blocking)

1. `ThreadList.tsx:1576-1579` — the list `panel` keeps hardcoded `borderRadius: 8` + `boxShadow: "0 4px 12px rgba(0,0,0,0.12)"` while its neighbors were tokenized; could use `tokens.radiusMd` / `tokens.shadowMd` (out of declared scope, cosmetic).
2. StatusRail menu silently narrowed 220→200 via shared `minWidth` (no local override, unlike Apps/MCP). Acceptable as new lock-step value, but worth an explicit note/override if 220 was intentional.
3. ThreadList header row now mixes a 32×32 trigger with ~24px sibling buttons (选择/新建) — visually fine (centered) but a minor height mismatch within the row.
4. `data-section-header={title}` (`SectionHeader.tsx:24`) has no consumer or test hook — harmless, but either query it in a test or drop it.
5. New DisconnectedBanner hint paragraph drops the old explicit `lineHeight: 1.45` (inherits 1.5 from PanelBanner body) — cosmetic.

VERDICT: APPROVE_WITH_NITS
