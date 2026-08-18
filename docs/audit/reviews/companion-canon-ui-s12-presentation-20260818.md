# Presentation adversary — companion-canon-ui-s12

**Family**: PRESENTATION (320px density · C″ one rail · cruise overflow · whisper Mode · filled mark · send arrow · hover/focus · legal contrast)  
**Role**: Independent. Not the implementer. Working-tree inspect only.  
**Date**: 2026-08-18  
**Blast**: T2  
**Evidence**: `[inspected]` static layout + token arithmetic. No headless render this pass.

Capability (from prompt): Surface L0 Panel chrome; no new L2; 装配 entry only; Board stays `/board`; 急停 not buried.

---

## 1. 320px width budget (C″ visual)

Rail is `display:flex; gap:2; padding:6px 10px; flex-wrap` default nowrap. No `overflow-x` containment. `[inspected]` `StatusRail.tsx:465-476`.

Content box at 320 viewport: **300px**.

| Child | Preferred | Shrink | Source |
|-------|-----------|--------|--------|
| 设置 gear | 32 | 0 | `ghostBtn` `:490-504` |
| Brand「CMspark」 | ≤96 | n/a | **hidden** when cruise **or** disconnected `:213-218` |
| Cluster (Mode whisper 28 + 新对话 32 + 历史 32) | 92–94 | **0** | `:483-488`, ModeBadge whisper 28 `:56-57`, hamburger 32 `ThreadList.tsx:1684-1698` |
| 巡航/值守 | content ~40, cap 56 | **1**, `minWidth:0`, ellipsis | `:515-534` |
| 断连「未连接」 | content ~56, cap 72 | **1**, `minWidth:0`, ellipsis | `:547-567` |
| 已连 conn | 28 (dot only) | 0 | `:535-546` |
| ⋯ | 32 | 0 | `ghostBtn` |

**Cruise + disconnect** (the REJECT case):

- Non-shrink + 4×2 gaps: 32 + 94 + 32 + 8 = **166**
- Short labels actual: 值守/巡航 ≈40 + 未连接 ≈56 = **96**
- Total ≈ **262 / 300**. Slack ≈ **38px**.
- Worst-case both pills at `maxWidth` (56+72): **294 / 300**. Slack ≈ **6px**. Still no wrap, no paint-off-edge.

S0 leftover (“`flexShrink:0` cruise + 92px cluster overflows”) is **gone**. Cruise and conn now shrink + ellipsis. Brand is not on the canvas in this state, so it cannot collide.

**Idle connected (brand on):** gear 32 + brand ~62 + cluster 94 + dot 28 + ⋯ 32 + gaps 8 ≈ 256 / 300. Brand is **left-of-gear flow**, not absolute-centered (`:477-514`). R2 P1 collision is **fixed**.

Cluster `marginLeft: auto` packs Mode + 新对话 + 历史 + status + ⋯ to the right. One continuous bar. Not two rails.

---

## 2. S2 / presentation DoD

| ID | Claim | Hold? | Where |
|----|--------|-------|-------|
| S2.1 | `createBlankThread` `config_override: {}`; EmptyState uses `emptyStateCopy` | yes | `ThreadList.tsx:61`; `ChatView.tsx:1551`; tests exist |
| S2.2 | DESIGN / App THESIS no「畅所欲问」 | yes | `App.tsx:1-6` first viewport is「要我帮你做什么？」; `DESIGN.md` composer copy is 描述任务 / 问这页 |
| S2.3 | Dead rail styles + `IconPlus` gone | yes | `StatusRail` style map is live keys only; no `export function IconPlus` in `icons.tsx` |
| S2.4 | Legal `tokens.textMuted` ≥11px | **letter yes / contrast no** | `App.tsx:2180-2185` `fontSize:11` + `tokens.textMuted` (`#a3a3a3`) |
| S2.5 | Connected `role="status"`; disconnected is a button | yes | `StatusRail.tsx:253-289` |
| S2.6 | InvitationRows hover + focus-visible | **focus yes / hover dead** | `ChatView.tsx:1490-1511` vs `:1708` |
| S2.7 | Send is circular up-arrow | yes | `icons.tsx:218-224` `M12 19V6` + chevron; `App.tsx:2152-2155` `radiusPill` 32×32 |
| S2.8 | CompanionMark filled stamp, not outline cat, not 看山 fox | yes | `icons.tsx:196-215` fills only; ink disc + triangles + indigo spark; no snout/tail/orange fox |
| Cruise | 值守/巡航 chip; full string on title/aria; click 解除 | yes | `autopilot-tier.ts:89-96`; `StatusRail.tsx:238-251` |
| S1.2 | Empty capsule = 装配 + field + send | yes | `App.tsx:1671-1699`, `:1720-1728` hide attach/mic until first char |
| Mode whisper | 28px icon, title still names level | yes | `ModeBadge.tsx:17-18, 56-57, 84` |

Claimed S2 chrome is **in the tree**. Hover is present as CSS but inert (finding P1-1). That is a defect, not a missing file.

---

## 3. Findings

### P1-1 — InvitationRows `:hover` is a no-op `[inspected]`

`ChatView.tsx:1492` `.invite-row:hover { color: ${tokens.accentText} }` is defeated by inline `styles.inviteRow.color: tokens.text` at `:1708`. Inline style > class. Mouse hover does not recolor. `:focus-visible` box-shadow (`:1493-1497`) is **not** set inline, so keyboard ring works.

S2.6 is half-shipped. Fix: drop `color` from the inline object (keep it on `.invite-row`) or hover a property that is not inlined (`background`, `opacity`).

Not a REJECT: the CSS exists, focus works, C″/D″/320 overflow/fox bars are clean.

### P2-1 — Legal line fails WCAG at the token they were told to use `[inspected]`

`App.tsx:1954`, `:2180-2185` — 「本地 Companion · 确认后才会执行危险操作」 is `tokens.textMuted` `#a3a3a3` @ 11px on `#ffffff`. Contrast ≈ **2.5:1** (AA normal text is 4.5:1). DESIGN.md:39 reserves `textMuted` for decorative meta; this sentence is a trust claim. S2.4 letter (`textMuted` ≥11) is met. Use `textSecondary` (`#737373`, ≈4.6:1 on white) or drop the line.

### P2-2 — Rest send arrow is almost invisible `[inspected]`

`App.tsx:1758-1759`, `:2152-2158` — idle send is white glyph on `#e4e4e7`. Contrast ≈ **1.3:1**. The 32px disc is visible; the up-arrow (the S2.7 point) is not, until armed (`tokens.accent`). `#e4e4e7` is also a raw hex off the token ladder. Idle `color: tokens.textMuted` (or `textSecondary`) on the gray disc.

### P2-3 — Rail icon buttons have no hover / no `:focus-visible` `[inspected]`

`StatusRail.tsx:490-504` `ghostBtn` is a flat 32×32. Global `App.tsx:2073-2077` transitions background but nothing sets a hover fill. InvitationRows got the S2.6 treatment; the actual 320 rail (设置 / 新对话 / 历史 / ⋯) did not. UA outline remains (no global `outline:none` on buttons). Density is fine; discoverability is weaker than the empty-state rows they bothered to style.

### P2-4 — Type / density ladder drift `[inspected]`

DESIGN.md:58 chrome scale is **11 / 12 / 13 / 15** only.

- Brand `fontSize: 14` — `StatusRail.tsx:506`
- Composer textarea `fontSize: 14` — `App.tsx:2128`
- Invite rows `fontSize: 14` — `ChatView.tsx:1709` (content, not chrome — softer)
- Rail `minHeight: 48` — `StatusRail.tsx:475` vs DESIGN.md:108 “~40–44px”

None overflow 320. They just ignore the SoT the same batch updated.

### P2-5 — Cruise+disconnect slack is real but unguarded `[inspected]`

6px worst-case / ~38px with real labels. No `overflow-x: hidden` on the rail. Cluster is `flexShrink: 0`. One extra 32px control, or a non-overlay scrollbar eating ~15px, and the math flips. Not overflowing **now**. Do not put a third pill on this row.

### P2-6 — Pinned Mode whisper ring paints into neighbors `[inspected]`

Cluster `gap: 0` (`StatusRail.tsx:486`). Whisper ModeBadge pinned uses `1.5px` accent border + `0 0 0 3px accentSoft` (`ModeBadge.tsx:61, 66-68`). Layout width holds; the glow sits on 新对话. Cosmetic.

---

## 4. C″ / D″

**C″ (one rail empty **and** in work) — HOLDS visually.** `[inspected]`

Same rail in both states: 设置 + 新对话 + 历史. Mode is 28px whisper. Connection is a 7px `role="status"` dot when live, a short button when not. `hasMessages` (`StatusRail.tsx:60`, `:318-365`) only disables ⋯ export/craft — it does **not** costume-dump or restyle the bar. Brand hide is cruise/disconnect, not message-count. R2 centered-wordmark collision is gone.

**D″ (agent-honest empty) — HOLDS** (secondary for this family). `[inspected]`

`empty-state-copy.ts:33-40` L0 = 要我帮你做什么？ / 起草 / 装配 gloss; no 随便聊; no 操作当前标签. L1 (`:22-31`) is the page-task surface. ChatView EmptyState only consumes that helper (`:1551`).

**Fox / character — not copied.** `[inspected]` `icons.tsx:196-215` is a filled ink stamp + indigo spark. Product.md:37 / plan “不做：复制看山狐狸” is respected.

**急停** — FocusBand still sits above ChatView (`App.tsx:230-236`). Empty L1 returns `null` (`FocusBand.tsx:111-114`) and does not eat the confirm/急停 slot (`focus-band-priority.ts:78-88`).

---

## 5. Trajectory

Inspected Side Panel chrome + tokens + DESIGN + S12 tests. No new L2 tool, no Board in 装配 (`ComposeDrawer.tsx:122-123` `/board` footnote). Presentation scope matches the slice.

---

REJECT bars from the prompt: 320 cruise+disconnect overflow — **no**. C″ costume dump — **no**. 看山 fox — **no**. Claimed S2 chrome missing — **no** (hover is broken, not absent).

VERDICT: APPROVE_WITH_NITS
