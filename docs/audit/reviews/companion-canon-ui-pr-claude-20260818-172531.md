# Dual review: companion-canon-ui PR cut — independent verification

## Machine checks [executed]

| Command | Result |
|---|---|
| `npx tsc --noEmit` (chrome-extension/, main `tsconfig.json`) | **exit 0** |
| `npm --prefix chrome-extension test` | **715 pass / 0 fail, exit 0** |
| Patch freshness | Patch body byte-identical to live `git diff` (only a 92-line context header prepended) — **not stale** |
| Repo tsc scope note | `npm test` runs `tsc -p tsconfig.test.json`; main config verified separately above — both green |

## Claims table — all 14 verified [inspected]

| Claim | Evidence |
|---|---|
| Empty copy SoT | `empty-state-copy.ts:7-41`; `ChatView.tsx:1551-1552` consumes only |
| `createBlankThread` clean | `ThreadList.tsx:61` `config_override: {}`; locked by `tests/create-blank-thread.test.ts` |
| Empty L1 hides webpage strip | `focus-band-priority.ts:78` (`hasThreadMessages !== false`), wired at `FocusBand.tsx:111`; confirm/急停 rank above (priority chain + `secondaryAbort`) |
| Left rail = thumbtack | `ModeBadge.tsx:42` (`whisper ? IconPin`), `icons.tsx:161-168` |
| Settings only in ⋯, connection-aware | `StatusRail.tsx:408-422` (`connectionState !== "connected" ? "connection" : "model"`); history drawer menu (`ThreadList.tsx:1342-1410`) has no 设置 |
| History = fixed portal | `ThreadList.tsx:1274-1277` — body portal, `position:fixed; left:8; right:8; width:auto` |
| 装配 chip above field | `App.tsx:1658` renders `ComposerChips` unconditionally; `meta-slash.ts:306-328` includes 装配 at every level; capsule (`App.tsx:1659-1764`) holds only attach/textarea/mic/send — no pencil, no IconEdit |
| Attach/听写 after first char | `App.tsx:1668-1675` and `1705-1712` (hidden when `messages.length===0 && !text.trim()`) |
| Cruise chip short/full | `autopilot-tier.ts:89-96` (值守/巡航); `StatusRail.tsx:228,234` full title/aria; `disarmCruise` `StatusRail.tsx:177-181` one-click |
| Legal line in padding | `App.tsx:1937-1939` inside `inputArea` (padding `8px 14px 12px`, `flexShrink:0`, `App.tsx:2089-2096`) |
| Invite CSS-only hover | `ChatView.tsx:1490-1499` class-based; `styles.inviteRow` (1701-1715) has **no** `color` — regression guard test present |
| CompanionMark filled | `icons.tsx:207-226` (`fill="#171717"`) |
| Send circular up-arrow | `App.tsx:2137-2150` (`radiusPill: 999` = tokens.ts:84) + `IconSend` `M12 19V6` |
| No 畅所欲问/随便聊 | grep of src + DESIGN.md + PRODUCT.md: zero hits (exit 1) |

## C″ / D″

- **C″ holds.** Empty rail keeps persistent chrome (pin badge, new-chat, history trigger, connection, ⋯); `hasMessages` (`StatusRail.tsx:60`) gates only three per-item ⋯ actions (提取技能 / 导出线程 / 导出摘要， lines 304-351) — no whole-rail costume dump.
- **D″ holds.** L0 copy「要我帮你做什么？问问题、写文案」— no operate-the-tab; L1「要对这页做什么？总结、提问，或让我操作当前标签」— page task; no 「随便聊」; 装配 carries human gloss「打开装配（技能、场景、知识）」.

## ADR-020 checklist

Declaration present and accurate. No new L2 tools, no new confirmation dialect, no new runtime; Board confined to `/board` (`meta-slash.ts:385-387` guard, StatusRail.tsx:435-443 note); 急停 FocusBand-first (`FocusBand.tsx:138-140` secondary abort under confirm; SafetyStrip primary for L2); trust display change is display-only — full tier label survives on title/aria + SafetyStrip. No `securityConfirmations.request` touched → originWs N/A. Trajectory clean: chrome + tests + DESIGN/PRODUCT only; no drive-by into companion/bridge/security.

## Findings (all P2, non-blocking)

1. **P2** `ThreadList.tsx:1726-1740` — `styles.panel` base still carries dead `position:"absolute"; top:"100%"; left:0; width:300` that the sole call site (1273-1281) fully overrides. Functional layout is the fixed portal, but a future second use of `styles.panel` without overrides silently regresses to the clipped 300px dropdown. Recommend cleaning the base object.
2. **P2** `autopilot-tier.ts:89-96` — `trustStatusChipShort` collapses all cruise tiers (网页巡航 / 全自动 / 全自动+协议) to the same「巡航」; tier distinction is hover/aria-only on a 320px rail. Deliberate per comment and SafetyStrip keeps the full label — noting the at-a-glance loss.
3. **P2** `icons.tsx:217-223` — CompanionMark hardcodes raw hex (`#171717`, `#4f46e5`) instead of tokens; minor token drift vs the rest of the chrome.
4. **P2** `tests/create-blank-thread.test.ts`, `tests/companion-canon-s12.test.ts` — several assertions are source-text greps rather than behavior; brittle under rename but acceptable as chrome-shape locks (behavioral tests exist for priority/tier logic).

No blocking issues. C″/D″ true, 急停/确认 surface-first, no poison in `createBlankThread`, machine green on both tsconfigs.

VERDICT: APPROVE_WITH_NITS
