# CMspark Design System

> 从现有 Side Panel inline styles 提取，作为 UI 一致性的基准

## Colors

| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#4A90D9` | 按钮、链接、active 状态 |
| Primary Hover | `#3A7BC8` | 按钮 hover |
| Error | `#F44336` | 错误提示、危险操作按钮 |
| Success | `#4CAF50` | 成功状态、连接指示 |
| Warning | `#FF9800` | 警告、connecting 状态 |
| Background | `#fff` | 主背景 |
| Background Alt | `#f5f5f5` | 次级背景、卡片 |
| Text Primary | `#333` | 正文 |
| Text Secondary | `#666` | 辅助文字 |
| Text Muted | `#999` | 禁用/占位 |
| Border | `#e0e0e0` | 分割线、输入框边框 |

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
