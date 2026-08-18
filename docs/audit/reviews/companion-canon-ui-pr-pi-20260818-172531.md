All claims verified against real code, and all three machine gates re-run green. Compiling findings.

## Findings

**Machine (re-run, all green)**
- `npx tsc --noEmit` in `chrome-extension/` → **exit 0**
- `npm --prefix chrome-extension test` → **715 pass / 0 fail / exit 0**
- Main `tsconfig.json` (`tsc --noEmit -p tsconfig.json`, not just test config) → **exit 0**
- Patch freshness: `git diff` body matches `companion-canon-ui-pr-diff-20260818-172531.patch` exactly (only the 92-line review header differs). Not stale.

**C″ / D″ — both hold**
- C″: `EmptyState` is gated purely on `messages.length === 0 && !streamingContent && !streamingReasoning && !processingLabel` (`ChatView.tsx:505`) — no `hasMessages` costume dump of the rail. FocusBand hides the L1 webpage strip on empty via `hasThreadMessages: state.messages.length > 0` (`FocusBand.tsx:111`) + `showL1Context` gate (`focus-band-priority.ts:78`), while confirm/急停 branches ignore it (test `focus-band-priority.test.ts` S1.1 asserts).
- D″: `empty-state-copy.ts` — L0 `要我帮你做什么？` (no operate-the-tab), L1 `要对这页做什么？` (page task), no 「随便聊」, 装配 glossed `打开装配（技能、场景、知识）`. Only consumer is `ChatView.tsx:1552`. Tests assert all of it.

**Claim-by-claim (all present)**
- `createBlankThread` `config_override: {}` — no DeepSeek stamp (`ThreadList.tsx:52-64`); matches the server-canonical blank-thread shape (`useWebSocket.ts:1013-1016`), background `thread.create` just forwards. Not poison.
- Settings only in StatusRail ⋯, connection-aware (`StatusRail.tsx:416-421`); no left gear, no history-drawer 设置; ModeBadge whisper = `IconPin` thumbtack.
- History panel is a `createPortal` → body, `position:fixed; left:8; right:8; width:auto; zIndex:10050` (`ThreadList.tsx:1274-1280`) — not the 300px absolute dropdown.
- 装配 chip unconditional above field (`App.tsx:1658`); no 装配/pencil inside capsule; attach/听写 appear after first char (`App.tsx:1671,1707`); legal line in-flow inside input area (`App.tsx:1937`).
- Cruise rail short `值守`/`巡航` (`autopilot-tier.ts` `trustStatusChipShort`), full detail in title/aria, click disarms — SafetyStrip keeps the full chip.
- Invite hover/focus via `.invite-row` CSS only, `styles.inviteRow` has no `color` (test S2.6 asserts).
- CompanionMark filled stamp (`fill="#171717"`), original mark not fox; `IconSend` circular up-arrow `M12 19V6`; no `畅所欲问` anywhere in sidepanel/DESIGN.md/PRODUCT.md.

**ADR-020:** declaration present (Surface L0 · Compose chip · Autonomy /board · Trust via ⋯); no new L2 tools; 急停 stays FocusBand `secondaryAbort`; no bare「中层 Agent」; no new `securityConfirmations.request` (no originWs exposure); trust monotonicity untouched. Trajectory clean — all changes are sidepanel chrome + tests + DESIGN/PRODUCT + review artifacts; zero drive-by into companion/bridge/security.

**Nits (non-blocking)**
1. **P2 — DESIGN.md over-claims chip hiding.** This same diff writes "ComposerDock chips … hidden on empty stream" and "Hide ComposerChips while the stream is empty" (`docs/DESIGN.md`), but `App.tsx:1658` renders `<ComposerChips>` unconditionally — chips are visible on the empty stream (which matches the prompt's own claim "装配 chip above the field always"). Doc SoT and code disagree inside the PR; DESIGN.md should be corrected.
2. **P2 — unmentioned behavior delta.** `createBlankThread` also changed `active_skill_ids` from `["browse"]` to `[]` (`ThreadList.tsx:64`), beyond the claimed `config_override` fix. It aligns with the server's own blank-thread shape (`useWebSocket.ts:1016/1055`), so not a regression — but fresh threads no longer pre-activate the browse skill and the PR description doesn't mention it.
3. **P2 — attach button edge case.** On an empty thread, attach stays hidden while dictating until `text`/`liveOverlay` appears (its hidden-condition omits `voice.listening`/`processing`, unlike the mic's, `App.tsx:1671`). Cosmetic; resolves as soon as any text lands.

VERDICT: APPROVE_WITH_NITS
