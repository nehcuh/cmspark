# CMspark Design System

> Quiet-professional chrome：SVG 图标 + `sidepanel/ui/tokens.ts` 为主；emoji 仅用于消息内容，不用于工具栏。

## Colors

| Token | Value | Usage |
|-------|-------|-------|
| Accent | `#2563eb` | 主按钮、active tab |
| Accent soft | `#dbeafe` / `#e8f0fe` | 选中底、L1 header tint |
| Error | `#dc2626` | 危险 / 停止 |
| Success | `#16a34a` | 连接 / LIVE |
| Warning | `#d97706` | connecting / 注意 |
| Background | `#ffffff` / `#fafbfc` | 面板主底 / 顶底 chrome |
| Text | `#111827` / `#4b5563` / `#9ca3af` | 正文 / 次级 / 占位 |
| Border | `#e5e7eb` | 分割线、输入框 |

Dark (L2 SafetyStrip / Cockpit): bg `#0f1115` / `#141820`, text `#e8eaed`, live `#4ade80`, danger `#f87171`.

## Typography

| Token | Value |
|-------|-------|
| Font Family | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` |
| Font Code | `'SF Mono', 'Fira Code', monospace` |
| Size xs | `11px` (code, timestamp) |
| Size sm | `12px` (button, label) |
| Size md | `13px` (body, input) |
| Size lg | `15px` (heading) |

## Spacing

| Token | Value | Usage |
|-------|-------|-------|
| xs | `4px` | inline gap |
| sm | `6px` | compact padding |
| md | `12px` | standard padding |
| lg | `16px` | section padding |
| xl | `20px` | page padding |

## Border Radius

| Token | Value |
|-------|-------|
| sm | `4px` |
| md | `6px` |
| lg | `8px` |

## Components Quick Reference

### Connection Status
- Connected: green dot `#4CAF50`
- Connecting: yellow dot `#FF9800`
- Disconnected: red dot `#F44336`

### Mode badge (P0)
- L0 `聊` · L1 `网页` · L2 `计算机` / `计算机 · LIVE` — see `sidepanel/mode/mode-controller.ts`
- L1 header tint `#eef4ff`; BottomBar tabs filtered by capability level

### Cockpit (P1)
- Extension popup `tabs/cockpit.html` (~720×560); SW mirror hydrates computer task + pending confirms
- Panel L2: SafetyStrip (abort + minimal confirm); Panel send hard-gated while task running/paused
- Known: `cockpitWindowId` is in-memory — SW death may orphan a window until next open (P2)

### Message Bubbles
- User: white bg, `#4A90D9` border-left
- Assistant: `#f5f5f5` bg
- Error: `#F44336` text on light red bg

### Tool Call Card
- Border: `#e0e0e0`
- Running state: yellow indicator
- Success: `#4CAF50` checkmark
- Error: `#F44336` cross

### Buttons
- Primary: `#4A90D9` bg, white text, `6px 16px` padding, `6px` radius
- Secondary: white bg, `#4A90D9` border+text
- Danger: `#F44336` bg, white text

### Input
- Border: `1px solid #e0e0e0`
- Focus border: `#4A90D9`
- Padding: `8px 12px`
- Radius: `6px`

---

*设计系统基于代码审计提取，持续同步。*
