# S0 slice adversarial — 2026-08-18

**Scope**: S0.1 (D″ L0 copy) + S0.2 (320 rail whisper / left brand)  
**Machine**: `tsc` 0 · extension tests **706 pass** (incl. `empty-state-copy.test.ts`)

| 路 | VERDICT |
|----|---------|
| Product (S0.1) | **APPROVE** |
| Presentation (S0.2) | **APPROVE_WITH_NITS** |

**Slice 结论**: S0 **过门（AWN）**。实现者不得把整单 UI 当 merge-ready。

## 验过

- L0 无「当前打开的页面 / 操作当前标签 / 随便聊」；有起草 + 装配 gloss
- L1 仍有页任务
- `EmptyState` 只消费 `emptyStateCopy`
- ModeBadge `whisper`：28px 图标，无字，title 仍带层级名
- 字标左贴齿轮，非绝对居中；cruise / 断连时隐藏

## Nits（不挡 S0，可进 S1/S2）

- 巡航芯片 `flexShrink: 0` + 右侧 92px 簇：单巡航贴边，巡航+断连会横向溢出
- 已连接 conn 点仍带 pill padding
- rail `position: relative` 残留

下一步：S1，或先收巡航溢出 nit。
