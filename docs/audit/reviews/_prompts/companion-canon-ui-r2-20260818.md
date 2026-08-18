# Dual/triple review: Companion-canon Side Panel UI R2

## Role

You are an **independent** reviewer. The implementer already ran R1 five-path adversarial (all REJECT), user cut **C″ 一条栏** + **D″ Agent 诚实**, then implemented. You are **not** the implementer. Inspect **current working-tree code**, not the R1 synthesis alone.

## Capability declaration

```text
Surface:      L0 Panel chrome（空态 / 顶栏 / 输入）
L2-classes:   (none new)
Compose:      装配 entry chrome only
Autonomy:     none
Trust:        settings 可发现；急停不得埋
Channel:      unchanged
```

**Blast**: T2

## User-locked cuts (must still be true)

- **C″** One rail empty **and** in work: 设置 + 新对话 + 历史; Mode/connection whisper; **no** `hasMessages` costume dump.
- **D″** Agent-honest empty: L0 must **not** say operate-the-tab; L1 is page task; no 「随便聊」; 装配 has human gloss.

## Implementer claimed (verify or bust)

| Claim | Where to look |
|-------|----------------|
| ModeBadge + ⋯ always on rail | `StatusRail.tsx` |
| Conn = dot; label only when not connected | `StatusRail.tsx` |
| Gear → `connection` if disconnected else `model` | `StatusRail.tsx` |
| `createBlankThread` uses `config_override: {}` not DeepSeek | `ThreadList.tsx` |
| L0 hint not 「操作当前标签」; L0 row 起草 not 随便聊 | `ChatView.tsx` EmptyState |
| Placeholder L0 描述任务 / L1 问这页 | `meta-slash.ts` |
| 装配 button in composer + aria on attach/⋯ | `App.tsx`, `StatusRail.tsx` |

## Machine (already run this session — re-run if you doubt)

- `tsc --noEmit -p chrome-extension/tsconfig.json` → 0
- `npm --prefix chrome-extension test` → 703 pass

## Also check

1. ADR-020: no new L2 tools; 急停 still FocusBand > empty greeting
2. 320px rail after C″: settings + ModeBadge + new + history + ⋯ + conn — overflow/collision with centered title?
3. L1 empty still has FocusBand 网页条 (R1-B leftover)
4. Composer still 装配+attach+mic vs quiet 看山 field
5. Character still line-SVG
6. Tests cover new placeholders; any missing EmptyState tests?

## Output

1. Findings with **file:line**, severity P0/P1/P2
2. Whether C″ and D″ **actually hold**
3. Prioritized **UI/UX optimization backlog** (max 8 items) if you would ship next
4. Final line exactly one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```

REJECT if C″ or D″ is still false, or Trust/createBlankThread still poison.
