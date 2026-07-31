# CMspark Design System

> Quiet-professional chrome：SVG 图标 + `sidepanel/ui/tokens.ts` 为主；emoji 仅用于消息内容，不用于工具栏。

## Colors

Canonical source: `chrome-extension/src/sidepanel/ui/tokens.ts` (+ `riskColor` / `statusColor` helpers).

| Token | Value | Usage |
|-------|-------|-------|
| Accent | `#2563eb` | 主按钮、active tab、user bubble |
| Accent soft | `#dbeafe` / `#e8f0fe` | 选中底、L1 header tint |
| Error | `#dc2626` | 危险 / 停止 |
| Success | `#16a34a` | 连接 / LIVE |
| Warning | `#d97706` | connecting / 注意 |
| Background | `#ffffff` / `#fafbfc` | 面板主底 / 顶底 chrome |
| Text | `#111827` / `#4b5563` / `#9ca3af` | 正文 / 次级 / 占位 |
| Border | `#e5e7eb` | 分割线、输入框 |

Dark (L2 SafetyStrip / Cockpit): bg `#0f1115`, elevated `#161a22`, text `#e8eaed`, live `#4ade80`, danger `#f87171`, **warning `#fbbf24`**.

**P2 rule:** do not introduce Material hexes (`#4A90D9`, `#F44336`, …). Prefer `tokens.*`. Secondary panels (Settings/MCP/Apps) may still carry legacy hex — migrate monotonically.

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

**Source of truth:** `tokens.radiusSm/Md/Lg` in `sidepanel/ui/tokens.ts` (UIUX v2).

| Token | Value | Usage |
|-------|-------|--------|
| sm | `6px` | chips, icon buttons, menu items |
| md | `8px` | menus, inputs, cards |
| lg | `12px` | composer capsule, elevated surfaces |
| pill | `999` | ModeBadge |

Do not invent other radii for Panel chrome.

## Components Quick Reference

### Connection Status
Helpers: `connectionColor` / `connectionLabel` / `connectionDotShadow` in `tokens.ts`.

| State | Color token | Label |
|-------|-------------|--------|
| Connected | `tokens.success` (`#16a34a`) | 已连接 |
| Connecting | `tokens.warning` (`#d97706`) | 连接中 |
| Disconnected | `tokens.danger` (`#dc2626`) | 未连接 |

**Forbidden:** Material `#4CAF50` / `#FF9800` / `#F44336` on status dots. Offline recovery uses `DisconnectedBanner` + toast only — **no `alert()`** on reconnect path.

### Mode badge (P0)
- L0 `聊` · L1 `网页` · L2 `计算机` / `计算机 · LIVE` — see `sidepanel/mode/mode-controller.ts`
- **Ontology:** product L0/L1/L2 = Surface axis = UI `CapabilityLevel` `chat|browser|computer` — [ADR-020](adr/020-capability-model-three-axes.md)
- L1 header tint: `tokens.modeBrowserBg` (`#dbeafe`); BottomBar tabs filtered by capability level
- ContextBar (§4 / P0 IA cut 2026-07-27): L0 Skills·Know·Hist · L1 Tabs·Skills · L2 Panel empty; packs/board/mcp/apps via BottomBar「更多」
- **StatusRail** (ex-Header): ThreadList + title + ModeBadge (pin-on-badge) + connection (token colors) + ⋯ menu (Craft/export/NB/logs/settings) — no permanent power-icon strip
- **FocusBand** (UIUX v2 §4.3): single slot Confirm > L2 Safety+急停 > Fleet > L1 Context; hard cap ≤80px; 急停 never buried under L2 task
- FleetStrip: hidden when idle single-agent; show only multi-worker / locks / intents (**not** pending confirms — those are MinimalConfirm / FocusBand)

### Cockpit (P1)
- Extension popup `tabs/cockpit.html` (~720×560); SW mirror hydrates computer task + pending confirms
- Panel L2: SafetyStrip (abort + minimal confirm); Panel send hard-gated while task running/paused
- **P1 content-split (D10′):** Panel full security modal removed; *any* pending confirm → SafetyStrip MinimalConfirm + Cockpit ConfirmElevated (background opens Cockpit on every `security.confirmation.request`)
- **L1 ContextStrip:** current tab chip + user-only「展开工作区」(D9′ — never auto from step count)
- **ComputerTaskBar:** removed from Panel — step timeline only in Cockpit dual-track
- UI labels: FleetStrip / SafetyStrip / MinimalConfirm all use **「确认台」** for the same Cockpit window; empty state shows purpose copy — [confirm-center-user-guide.md](confirm-center-user-guide.md)
- Known: `cockpitWindowId` is in-memory — SW death may orphan a window until next open (P2)

### Message Bubbles (P2)
- User: `tokens.userBubbleBg` (`#2563eb`) white text
- Assistant: `tokens.assistantBubbleBg` (`#f3f4f6`)
- Empty: mode-aware L0/L1/L2 copy (see ChatView `EmptyState`)

### Tool Call Card
- Border / status via `statusColor()`
- No emoji status chrome (✓ / ! / …)

### Buttons
- Primary: `tokens.accent` bg, white text
- Danger: `tokens.danger`

### Input / Composer (P2)
- Unified capsule: attach + textarea + send inside one bordered surface
- Radius: `tokens.radiusLg` (12px)
- Settings live in StatusRail ⋯ (not composer)

### Motion
- Transitions ≤200ms; `prefers-reduced-motion` disables animations

---

*设计系统基于代码审计提取，持续同步。*
