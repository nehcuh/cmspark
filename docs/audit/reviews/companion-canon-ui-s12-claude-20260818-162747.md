All verification complete. Here is my review.

---

# Independent review — companion-canon-ui-s12

**Patch currency `[executed]`**: patch file `companion-canon-ui-s12-diff-20260818-162747.patch` matches current `git status` / working tree exactly (base b3f1098, same 20 modified + same untracked files). Not stale.

## Findings

### P1 (blocking) — production build broken; "tsc 0" claim is false

- **`chrome-extension/src/sidepanel/components/ChatView.tsx:1716`** — `inviteRow` style object declares `color` twice (`color: tokens.text` at :1709, `color: "inherit"` at :1716). `npx tsc --noEmit` fails: `error TS1117: An object literal cannot have multiple properties with the same name`, exit 1 `[executed]`.
- Impact: `npm run build` = `tsc --noEmit && plasmo build` (package.json) — the shipping path per project CLAUDE.md fails. The DoD machine claim "tsc 0" only holds for `tsconfig.test.json` (explicit include list of pure modules + `empty-state-copy.ts`; excludes ChatView.tsx), so the 714-pass run masked it. This is exactly the over-claiming category the review is told to catch.
- Fix is trivial: delete :1716 (`color: "inherit"`) — inline `tokens.text` at :1709 plus `.invite-row` CSS already set color; runtime rendering is unaffected (last-wins `inherit` resolves to the same `tokens.text` from `.empty`), but the compile error blocks merge.

### P2 nits (non-blocking)

1. `chrome-extension/tests/companion-canon-s12.test.ts:8-45`, `create-blank-thread.test.ts:6-18` — assertions are source-text regex on component files, not behavior; brittle to rename/refactor. `createBlankThread` is exported — it could be imported and tested directly.
2. `ChatView.tsx:1490-1499` — `inviteRowCSS` injects a document-global `<style>` per InvitationRows render. Matches the existing `markdownCSS` pattern, but a scoped data-attribute would avoid class collisions.
3. `tokens.ts:32-33` — `bgHover` == `bgMuted` (`#f4f4f5`); hover affordance on muted surfaces now relies on non-bg cues only. Cosmetic.

## Slice DoD verification (all `[inspected]` against working tree; tests `[executed]`)

| ID | Status | Evidence |
|----|--------|----------|
| S1.1 | ✓ | `focus-band-priority.ts:78` `showL1Context = isBrowserContext && hasThreadMessages !== false`; confirm branch :79-88 keeps `secondaryAbort: l2AbortRequired` untouched (急停 not buried); `FocusBand.tsx:111` passes `hasThreadMessages`, :114 null on empty. Tests `focus-band-priority.test.ts:78-107` |
| S1.2 | ✓ | `App.tsx:1659-1661` chips hidden on empty; :1673-1682 装配 always present; :1683-1699 attach gated on `!text.trim()`; :1720-1738 voice mic likewise; send always in capsule |
| S1.3 | ✓ | `StatusRail.tsx:200-213` gear → `connection !== "connected" ? "connection" : "model"`; ⋯设置 :422-436 same route; ThreadList drawer 设置 same (test S1.3 asserts all three) |
| S1.4 | ✓ | `ComposeDrawer.tsx:122-124`「任务板不在装配内 — 使用 /board」; no 编排 |
| S2.1 | ✓ | `ThreadList.tsx:52-69` `config_override: {}` — matches pre-existing pattern at `useWebSocket.ts:1013`; consumers optional-chained (`App.tsx:889-894`) → inherits live config, **no DeepSeek/trust poison**. `ChatView.tsx:1551-1569` EmptyState consumes `emptyStateCopy` only |
| S2.2 | ✓ | `畅所欲问` grep across repo sources: zero hits; `App.tsx:1-6` THESIS header present |
| S2.3 | ✓ | `IconPlus` gone from `icons.tsx` (grep: only the test's negative assertion); dead rail styles (threadIdBadge / spacer / cruiseX / iconBtn / brandMark) removed from StatusRail |
| S2.4 | ✓ | `App.tsx:2180-2185` legal `fontSize: 11`, `tokens.textMuted` |
| S2.5 | ✓ | `StatusRail.tsx:253-267` connected = `<span role="status">` dot; :268-290 disconnected = button → connection settings |
| S2.6 | ✓ | `ChatView.tsx:1490-1499` `.invite-row:hover, :focus-visible` → accent + `shadowFocus` |
| S2.7 | ✓ | `icons.tsx:218-225` IconSend = vertical up-arrow; `App.tsx:1759` send gray at rest, `tokens.accent` armed, `radiusPill` |
| S2.8 | ✓ | `icons.tsx:196-216` CompanionMark = filled `#171717` stamp, white eyes, indigo sparkle — original mark, not outline cat, not 看山 fox |
| Cruise | ✓ | `autopilot-tier.ts:88-97` `trustStatusChipShort` → 值守/巡航; `StatusRail.tsx:242-248` title+aria carry full `trustStatusChip` detail; click still disarms (解除) |

## C″ / D″ — both actually hold

- **C″ ✓**: rail always renders 设置 gear + 新对话 + 历史 chevron (`StatusRail.tsx:200-237`); ModeBadge `whisper`; connected = dot-only, disconnected = short-label button; brand hides only under cruise/disconnect (:214). `hasMessages` gates only the work-only ⋯ menu items (提取技能/导出) — unchanged from base, not a rail costume dump.
- **D″ ✓**: `empty-state-copy.ts` — L0「问问题、写文案，或描述任务。」(no operate-the-tab, no 随便聊); L1 is page-task「总结、提问，或让我操作当前标签。」; 装配 rows carry human gloss「打开装配（技能、场景、知识）」. Asserted in `empty-state-copy.test.ts`.

## ADR-020 / trajectory

- Capability declaration present and honest: L0 chrome only, no new L2 classes, Compose = existing drawer entry, Board stays `/board`, channel unchanged. No tools, gates, confirm families, or `securityConfirmations.request`/originWs surfaces touched — checklist items 2-7 N/A or pass. Pack-first untriggered (no new scenario).
- Trajectory clean: diff = Side Panel chrome + tests + DESIGN/PRODUCT copy. No drive-by into companion/bridge/background. `npm test` → 714/714 pass `[executed]`.

## Summary

Design intent, safety invariants (C″/D″, 急停, trust), and all 13 DoD items are genuinely in the code — but the build gate is broken by a one-line duplicate property and the machine claim "tsc 0" does not hold for the full project. Per the checklist, a failing `npm run build` blocks merge, so this cannot be an APPROVE_WITH_NITS despite the trivial fix.

Blocking issue:
- ChatView.tsx:1716 — duplicate `color` in `inviteRow` → `tsc --noEmit` exit 1, `npm run build` fails; DoD machine claim "tsc 0" is over-claiming (test tsconfig subset masked it).

VERDICT: REJECT
