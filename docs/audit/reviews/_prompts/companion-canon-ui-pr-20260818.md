# Dual review: Companion-canon Side Panel UI — PR cut

You are an **independent** reviewer. You are **not** the implementer. Inspect the **current working tree**. Re-run machine commands if you doubt the claim. Do not rubber-stamp. Do not award points for long writing.

## Capability declaration

```text
Surface:      L0 Panel chrome（空态 / 顶栏 / 输入 / FocusBand）
L2-classes:   none new
Compose:      装配 is ComposerDock chip + /装配 / Cmd+K — not a capsule icon
Autonomy:     Board stays /board only
Trust:        settings via ⋯; 急停 / 确认 never buried; cruise chip still one-click 解除
Channel:      unchanged
```

**Blast**: T2

## User-locked cuts (must still be true)

- **C″** One rail empty **and** in work. No `hasMessages` costume dump of the whole rail.
- **D″** Agent-honest empty: L0 must not say operate-the-tab; L1 is page task; no 「随便聊」; 装配 has human gloss.
- 急停 / 确认 never buried. Chinese chrome. Original character, not 看山 fox. No new L2 tools.

## Current chrome (verify or bust)

| Claim | Where |
|-------|--------|
| Empty copy SoT; EmptyState only consumes it | `empty-state-copy.ts` `ChatView.tsx` |
| `createBlankThread` `config_override: {}` — no DeepSeek stamp | `ThreadList.tsx` |
| Empty L1 hides FocusBand webpage strip; confirm / 急停 still win | `focus-band-priority.ts` `FocusBand.tsx` |
| Left rail = thumbtack pin (not chat-bubble, not settings gear) | `ModeBadge.tsx` `StatusRail.tsx` `icons.tsx` IconPin |
| Settings only in StatusRail ⋯ (connection-aware); no left gear; no history-drawer 设置 | `StatusRail.tsx` `ThreadList.tsx` |
| History list is a **fixed portal** `left:8; right:8` — not a 300px dropdown clipped off the 320 edge | `ThreadList.tsx` |
| 装配 chip above the field always; **no** pencil/装配 button inside the capsule | `App.tsx` |
| Attach / 听写 after first character on empty | `App.tsx` |
| Cruise rail = 值守/巡航 short; title/aria full; click disarms | `autopilot-tier.ts` `StatusRail.tsx` |
| Legal line inside input padding (not clipped at window bottom) | `App.tsx` |
| Invite hover/focus via CSS only (no inline `color` on `inviteRow`) | `ChatView.tsx` |
| CompanionMark filled stamp, not outline / not fox | `icons.tsx` |
| Send is circular up-arrow | `icons.tsx` `App.tsx` |
| DESIGN.md / App THESIS have no 「畅所欲问」 | `docs/DESIGN.md` `App.tsx` |

## Machine (re-run if you doubt)

Implementer last ran this session: `npx tsc --noEmit` in `chrome-extension/` exit 0; `npm --prefix chrome-extension test` **715 pass**. **You must re-run both** and report exit codes. Also confirm main `tsc --noEmit` (not only `tsconfig.test.json`).

## Also check

1. ADR-020: no new L2 tools; 急停 still FocusBand-first
2. Trajectory: Side Panel chrome + tests + DESIGN/PRODUCT + review artifacts. Drive-by into companion/bridge/security?
3. Invite `color` cascade cannot regress (inline color on `inviteRow` = REJECT)
4. History panel must not use `position:absolute; left:0; width:300` as the live layout

## Output

1. Findings with **file:line**, severity P0/P1/P2
2. Whether C″ and D″ **actually hold**
3. Final line exactly one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```

REJECT if C″/D″ false, 急停 buried, createBlankThread poison, main tsc fails, capsule still has 装配 icon, history still clips, or a claimed item is missing.
