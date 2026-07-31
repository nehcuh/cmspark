# CMspark Design System

> Quiet-professional chrome：SVG 图标 + `sidepanel/ui/tokens.ts` 为主；emoji 仅用于消息内容，不用于工具栏。

## Colors

Canonical source: `chrome-extension/src/sidepanel/ui/tokens.ts` (+ `riskColor` / `statusColor` / `connectionColor*` helpers).

### Semantic roles (UIUX v2 §5.2 — intent, not raw hex)

Use role names in specs and AI implementer prompts. **Implement with the mapped `tokens.*` fields** (TS object uses camelCase; roles below are the design-intent names).

| Role | Light (`tokens.*`) | Dark (`tokens.*`) | Light hex | Dark hex |
|------|--------------------|-------------------|-----------|----------|
| `surface.canvas` | `bg` | `darkBg` | `#fafbfc` | `#0f1115` |
| `surface.elevated` | `bgElevated` | `darkElevated` | `#ffffff` | `#161a22` |
| `surface.muted` | `bgMuted` | — | `#f3f4f6` | — |
| `text.primary` | `text` | `darkText` | `#111827` | `#e8eaed` |
| `text.secondary` | `textSecondary` | `darkMuted` | `#4b5563` | `#9aa0a6` |
| `text.muted` | `textMuted` | `darkMuted` | `#9ca3af` | `#9aa0a6` |
| `border.subtle` | `border` | `darkBorder` | `#e5e7eb` | `#2a2f3a` |
| `border.strong` | `borderStrong` | `darkBorder` | `#d1d5db` | `#2a2f3a` |
| `accent.primary` | `accent` | `darkAccent` | `#2563eb` | `#5b8def` |
| `accent.soft` | `accentSoft` / `bgActive` | — | `#dbeafe` / `#e8f0fe` | — |
| `status.live` | `success` | `darkLive` / `darkSuccess` | `#16a34a` | `#4ade80` |
| `status.warn` | `warning` | `darkWarning` | `#d97706` | `#fbbf24` |
| `status.danger` | `danger` | `darkDanger` | `#dc2626` | `#f87171` |
| `risk.high` | `danger` | `darkDanger` | `#dc2626` | `#f87171` |
| `risk.medium` | `warning` | `darkWarning` (+ orange mid) | `#d97706` | `#fbbf24` |
| `mode.l0` | `modeChatBg` / `modeChatText` | — | `#f3f4f6` / `#374151` | gray chip |
| `mode.l1` | `modeBrowserBg` / `modeBrowserText` | — | `#dbeafe` / `#1e40af` | blue soft chip |
| `mode.l2` | `modeComputerBg` / `modeComputerText` | LIVE pulse on Cockpit | `#052e16` / `#4ade80` | green-on-dark |

**Legacy aliases (still valid in docs):** Accent = `accent.primary`; Error = `status.danger`; Success = `status.live`; Warning = `status.warn`; Background = `surface.*`; Text / Border as above.

Dark surfaces: L2 SafetyStrip / **Cockpit** only. Panel stays light in v2 (K6); tokens for dark are prepared for Cockpit + L2 chrome.

**P2 rule:** do not introduce Material hexes (`#4A90D9`, `#F44336`, `#4CAF50`, …). Prefer `tokens.*`. Secondary panels (Settings/MCP/Apps) may still carry legacy hex — migrate monotonically.

## Typography

| Token | Value |
|-------|-------|
| Font Family | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` (`tokens.font`) |
| Font Code | `ui-monospace` / `'SF Mono', Menlo, Consolas, monospace` (`tokens.fontMono`) |
| Size xs | `11px` (code, timestamp, StatusRail secondary) |
| Size sm | `12px` (button, label) |
| Size md | `13px` (body, input, rail title) |
| Size lg | `15px` (heading) |

Scale for chrome: **11 / 12 / 13 / 15** only.

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
| lg | `12px` | composer capsule, elevated surfaces, Cockpit cards |
| pill | `999` | ModeBadge / LIVE chip |

Do not invent other radii for Panel or Cockpit chrome (no `10px` / `4px` ad-hoc).

## Components Quick Reference

### Connection Status
Helpers (light): `connectionColor` / `connectionLabel` / `connectionDotShadow`  
Helpers (dark / Cockpit): `connectionColorDark` / `connectionDotShadowDark` (+ same `connectionLabel`)

| State | Light role | Dark role | Label |
|-------|------------|-----------|--------|
| Connected | `status.live` → `tokens.success` | `tokens.darkLive` | 已连接 |
| Connecting | `status.warn` → `tokens.warning` | `tokens.darkWarning` | 连接中 |
| Disconnected | `status.danger` → `tokens.danger` | `tokens.darkDanger` | 未连接 |

**Forbidden:** Material `#4CAF50` / `#FF9800` / `#F44336` on status dots. Offline recovery uses `DisconnectedBanner` + toast only — **no `alert()`** on reconnect path.

### StatusRail (Panel Zone A + Cockpit title bar)

| Surface | Mode | Connection | Other |
|---------|------|------------|--------|
| **Panel** `StatusRail` | ModeBadge L0 `聊` / L1 `网页` / L2 `计算机` · LIVE; pin-on-badge | Dot + tooltip (`connectionColor*`) | Thread switcher · ⋯ menu |
| **Cockpit** header | Chip `L2 · LIVE` / `L2` / `确认` / `工作区` (same Surface grammar) | Dot + **label text** (`connectionColorDark` + `connectionLabel`) | Thread id · fleet summary · 急停 · 收起 |

Grammar must match: mode chip · connection · secondary context. Cockpit is dark; Panel is light. Type scale 11–13; rail min-height ~40–44px.

### Mode badge (P0)
- L0 `聊` · L1 `网页` · L2 `计算机` / `计算机 · LIVE` — see `sidepanel/mode/mode-controller.ts`
- **Ontology:** product L0/L1/L2 = Surface axis = UI `CapabilityLevel` `chat|browser|computer` — [ADR-020](adr/020-capability-model-three-axes.md)
- L1 header tint: `tokens.modeBrowserBg` (`#dbeafe`)
- **BottomBar permanent tab strip (PR5):** gated by `ui.bottomBarStrip` in `sidepanel/ui/flags.ts` — **default `false`**. Host remains SoT; panels open via Composer chips / `/` / 装配. Set flag `true` only for smoke/rollback. Legacy tab sets (if re-enabled): L0 Skills·Know·Hist · L1 Tabs·Skills · L2 empty + overflow「更多」
- **ComposerDock chips** (UIUX v2 PR4 §4.4): L0 装配·Skills·Know · L1 装配·Tabs·工作区 · L2 确认台·装配 — open Host / 装配 drawer; **no Abort next to Send**
- **装配 P0** bottom-sheet section list → Host (`skills`/`knowledge`/`packs`/`mcp`/`apps`/`history`); Board is Autonomy (`/board` only)
- **Slash parity** (§4.8): `/skills` `/knowledge` `/history` `/tabs` `/packs` `/mcp` `/apps` `/board` `/settings` `/cockpit` `/装配`
- **FocusBand** (UIUX v2 §4.3): single slot Confirm > L2 Safety+急停 > Fleet > L1 Context; hard cap ≤80px; 急停 never buried under L2 task
- FleetStrip: hidden when idle single-agent; show only multi-worker / locks / intents (**not** pending confirms — those are MinimalConfirm / FocusBand)

### Cockpit (确认台)
- Extension tab `tabs/cockpit.html` (~720×560); SW mirror hydrates computer task + pending confirms
- Panel L2: SafetyStrip (abort + minimal confirm); Panel send hard-gated while task running/paused
- **P1 content-split (D10′):** Panel full security modal removed; *any* pending confirm → SafetyStrip MinimalConfirm + Cockpit ConfirmElevated (background opens Cockpit on every `security.confirmation.request`)
- **L1 ContextStrip:** current tab chip + user-only「展开工作区」(D9′ — never auto from step count)
- **ComputerTaskBar:** removed from Panel — step timeline only in Cockpit dual-track
- UI labels: FleetStrip / SafetyStrip / MinimalConfirm all use **「确认台」** for the same Cockpit window; empty state shows purpose copy — [confirm-center-user-guide.md](confirm-center-user-guide.md)
- **PR7:** title bar = dark StatusRail (mode chip + connection tokens + type scale); radii 6/8/12; `prefers-reduced-motion` honored on LIVE pulse / button transitions
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
- Danger: `tokens.danger` (light) / `tokens.darkDanger` (Cockpit)

### Input / Composer (P2 + PR4)
- Unified capsule: attach + textarea + send inside one bordered surface
- Radius: `tokens.radiusLg` (12px)
- Mode chips row above capsule (see ComposerDock chips above); 装配 via chip / `/装配` / Cmd+K
- Settings live in StatusRail ⋯ or `/settings` (not in 装配 Board path)

### Motion
- Transitions ≤200ms (`tokens.transition` / `transitionFast`)
- LIVE pulse on Cockpit L2 chip only; **`prefers-reduced-motion: reduce` disables animations** (Panel App + Cockpit shell)

---

*设计系统基于代码审计提取，持续同步。UIUX v2 PR7: semantic roles + Cockpit StatusRail grammar.*
