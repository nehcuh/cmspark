# Independent review — companion-canon-ui-s12

## Verification method
Inspected the patch plus current working tree (git status/diff confirm the patch matches HEAD+working changes; `b3f1098` base). Ran `npm test` (714 pass ✓) and `npx tsc --noEmit` on both tsconfigs.

## DoD verification (all S items traced to code)

| ID | Result | Evidence |
|----|--------|----------|
| S1.1 | ✓ | `focus-band-priority.ts:45-46` `showL1Context = isBrowserContext && hasThreadMessages !== false`; confirm/`secondaryAbort` paths untouched; `FocusBand.tsx:111` passes `hasThreadMessages: state.messages.length > 0`; test `focus-band-priority.test.ts` "S1.1 empty L1 hides webpage strip…" asserts `empty`/`confirm`/`secondaryAbort:true` |
| S1.2 | ✓ | `App.tsx:1659` chips hidden when empty; `App.tsx:1677-1692` 装配 (`openCompose` + IconCraft) always; attach gated `!(messages empty && !text.trim() && !liveOverlay)`; `App.tsx:1720-1733` 听写 gated likewise |
| S1.3 | ✓ | Gear `App.tsx`/`StatusRail.tsx` `connectionState !== "connected" ? "connection" : "model"`; ⋯「设置」menu item same route; `ThreadList.tsx:1291` drawer 设置 same route |
| S1.4 | ✓ | `ComposeDrawer.tsx:123` "任务板不在装配内 — 使用 /board"; no ⋯「编排」 in drawer (residual 编排 hits are `meta-slash.ts:96` /board description, WorkerScopeBar, ChatView thread copy — pre-existing) |
| S2.1 | ✓ | `ThreadList.tsx:52-63` `createBlankThread` → `config_override: {}` (no DeepSeek stamp, `active_skill_ids: []`); `ChatView.tsx:1556-1565` EmptyState consumes `emptyStateCopy` |
| S2.2 | ✓ | grep 「畅所欲问」 → zero hits in DESIGN.md / App.tsx |
| S2.3 | ✓ | `threadIdBadge`/`spacer`/`iconBtn`/`brandMark`/`cruiseX` deleted; `IconPlus` zero hits in `chrome-extension/src` |
| S2.4 | ✓ (mechanical) | `App.tsx:2180-2183` legal = fontSize 11 + `tokens.textMuted` (see nit) |
| S2.5 | ✓ | `StatusRail.tsx` connected → `<span role="status">` dot; disconnected → `<button>` with label → opens connection |
| S2.6 | ✓ | `ChatView.tsx:1490-1500` `inviteRowCSS` `:hover` + `:focus-visible` with `shadowFocus` |
| S2.7 | ✓ | `icons.tsx` IconSend `M12 19V6` / `M6 12l6-6 6 6` (up-arrow); sendBtn `radiusPill` circular |
| S2.8 | ✓ | `icons.tsx` CompanionMark — filled circle + wings + indigo spark, `aria-hidden`, not fox/outline |
| Cruise | ✓ | `autopilot-tier.ts` `trustStatusChipShort` → 值守/巡航; rail pill `title/aria` use full `cruiseDetail` incl. 解除; onClick still `disarmCruise` (clear_cruise) |

**C″ holds** — single rail always shows 设置 gear + whisper ModeBadge + 新对话 + 历史 chevron; brand "CMspark" hidden only when cruise/disconnected; `hasMessages` (StatusRail.tsx:60) now only gates ⋯ menu actions (export/summarize), not a rail dump.
**D″ holds** — L0 "要我帮你做什么？" (no operate-the-tab), L1 "要对这页做什么？" page task, no 「随便聊」, 装配 carries (技能、场景、知识) gloss, original mark.

**ADR-020** — declaration present and honest (Surface L0 chrome; no new L2 classes/tools; Compose = entry chrome only; Autonomy Board stays `/board`). Trust monotonic: `trustStatusChipShort` is display-only, disarm unchanged; `createBlankThread` removes the DeepSeek/trust stamp → trust fix, not poison. No new `securityConfirmations.request` → originWs untouched. Pack-first / no new runtime: n/a, no capability added.

## Findings

**P1 — blocking: build is broken by this diff**
- `chrome-extension/src/sidepanel/components/ChatView.tsx:1709` + `:1716` — `styles.inviteRow` declares `color: tokens.text` **and** `color: "inherit"` → `TS1117: An object literal cannot have multiple properties with the same name`. `npm run build` (`tsc --noEmit && plasmo build`) fails; the extension cannot be built. The machine's "tsc 0" claim only holds for `tsconfig.test.json`, which excludes ChatView.tsx, so `npm test` cannot catch it. The duplicate was introduced here (HEAD had `suggestChip`, not `inviteRow`). Fix is one-line (drop line 1716) but the tree as-is must not merge.

**P2 nits**
- `App.tsx:2183` — legal line `tokens.textMuted` (#a3a3a3) at 11px ≈ 2.5:1 contrast on white, below WCAG AA 4.5:1 for normal text. S2.4 is met mechanically (11px + textMuted) but the trust-reassurance line is weak — consider `textSecondary`.
- `App.tsx:1680-1691` — attach-button hide condition omits `!voice.listening` (unlike the 听写 gate at 1721), so during voice listening with empty text and null `liveOverlay` the attach icon appears before any character — slightly off S1.2's "after first char".

## Verdict rationale
Every S1/S2 item, C″, D″, and the ADR-020 axes check out. But a compile error introduced by this diff breaks the production build, and the machine's "tsc 0" over-claims because the test tsconfig doesn't cover the changed component. That is a concrete, blocking defect — not a nit.

P1: `chrome-extension/src/sidepanel/components/ChatView.tsx:1716` — duplicate `color` key → TS1117, `npm run build` fails.

VERDICT: REJECT
