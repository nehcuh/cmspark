# Dual/triple review: Companion-canon Side Panel UI S1+S2

## Role

You are an **independent** reviewer. You are **not** the implementer. Inspect **current working-tree code**. Do not rubber-stamp. Do not award points for long writing.

## Capability declaration

```text
Surface:      L0 Panel chrome（空态 / 顶栏 / 输入 / FocusBand）
L2-classes:   none new
Compose:      装配 entry chrome only
Autonomy:     Board stays /board only
Trust:        settings 可发现；急停不得埋
Channel:      unchanged
```

**Blast**: T2

## User-locked cuts (must still be true)

- **C″** One rail empty **and** in work: 设置 + 新对话 + 历史; Mode/connection whisper; **no** `hasMessages` costume dump of the whole rail.
- **D″** Agent-honest empty: L0 must **not** say operate-the-tab; L1 is page task; no 「随便聊」; 装配 has human gloss.
- 急停 / 确认 never buried. Chinese chrome. Original character, not 看山 fox. No new L2 tools.

## Slice DoD (verify or bust)

| ID | Claim | Where |
|----|--------|--------|
| S1.1 | Empty L1 does **not** hang FocusBand webpage strip; confirm / 急停 still win | `focus-band-priority.ts` `FocusBand.tsx` tests |
| S1.2 | Empty capsule = 装配 + field + send; attach/听写 after first char | `App.tsx` InputArea |
| S1.3 | ⋯「设置」and thread-drawer 设置 match gear (disconnected → connection) | `StatusRail.tsx` `ThreadList.tsx` |
| S1.4 | ComposeDrawer has no ⋯「编排」; Board = `/board` | `ComposeDrawer.tsx` |
| S2.1 | `createBlankThread` `config_override: {}`; EmptyState consumes `emptyStateCopy` | `ThreadList.tsx` `ChatView.tsx` tests |
| S2.2 | DESIGN.md / App THESIS no 「畅所欲问」 | `docs/DESIGN.md` `App.tsx` header |
| S2.3 | Dead rail styles + `IconPlus` gone | `StatusRail.tsx` `icons.tsx` |
| S2.4 | Legal `tokens.textMuted` ≥11px | `App.tsx` styles.legal |
| S2.5 | Connected conn is `role="status"`; disconnected is a button | `StatusRail.tsx` |
| S2.6 | InvitationRows hover + focus-visible | `ChatView.tsx` |
| S2.7 | Send is circular up-arrow | `icons.tsx` IconSend |
| S2.8 | CompanionMark is filled stamp, not outline cat, not 看山 fox | `icons.tsx` |
| Cruise | Rail chip is 值守/巡航; full label on title/aria; click still 解除 | `autopilot-tier.ts` `StatusRail.tsx` |

## Machine (this session)

- `npm --prefix chrome-extension test` → **714 pass**, tsc 0

## Also check (three layers)

1. **Outcome**: Do S1+S2 DoD actually hold? C″ D″ still true?
2. **Trajectory**: Diff scope = Side Panel chrome + tests + DESIGN. Drive-by?
3. **Component**: file:line for every finding.

ADR-020: no new L2 tools; 急停 still FocusBand > empty greeting.

## Output

1. Findings with **file:line**, severity P0/P1/P2
2. Whether C″ and D″ **actually hold**
3. Final line exactly one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```

REJECT if C″ or D″ is false, 急停 buried, Trust/`createBlankThread` poison, or a claimed S1/S2 item is not in the code.
