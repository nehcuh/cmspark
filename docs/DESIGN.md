# CMspark Design System

> **Precision Instrument Desk**（精密仪器台）— Operate / Restrained.  
> Quiet-professional chrome：SVG 图标 + `sidepanel/ui/tokens.ts` 为主；emoji 仅用于消息内容，不用于工具栏。  
> Direction SoT: [sidepanel-precision-instrument-redesign](superpowers/specs/2026-08-11-sidepanel-precision-instrument-redesign.md) · Product: [PRODUCT.md](../PRODUCT.md)

## Colors

**Sole hex source of truth:** `chrome-extension/src/sidepanel/ui/tokens.ts` (+ `riskColor` / `statusColor` / `connectionColor*` helpers).  
Specs and this doc map **role → `tokens.*` only**. Do not copy hex into tables here — read live values from `tokens.ts`.

### Semantic roles (UIUX v2 §5.2 — intent, not raw hex)

Use role names in specs and AI implementer prompts. **Implement with the mapped `tokens.*` fields** (TS object uses camelCase; roles below are the design-intent names).

| Role | Light (`tokens.*`) | Dark (`tokens.*`) |
|------|--------------------|-------------------|
| `surface.canvas` | `bg` | `darkBg` |
| `surface.elevated` | `bgElevated` | `darkElevated` |
| `surface.muted` | `bgMuted` | — |
| `text.primary` | `text` | `darkText` |
| `text.secondary` | `textSecondary` | `darkMuted` |
| `text.muted` | `textMuted` | `darkMuted` |
| `border.subtle` | `border` | `darkBorder` |
| `border.strong` | `borderStrong` | `darkBorder` |
| `accent.primary` | `accent` | `darkAccent` |
| `accent.soft` | `accentSoft` / `bgActive` | — |
| `status.live` | `success` | `darkLive` / `darkSuccess` |
| `status.warn` | `warning` | `darkWarning` |
| `status.danger` | `danger` | `darkDanger` |
| `risk.high` | `danger` | `darkDanger` |
| `risk.medium` | `warning` | `darkWarning` |
| `mode.l0` | `modeChatBg` / `modeChatText` | — |
| `mode.l1` | `modeBrowserBg` / `modeBrowserText` | — |
| `mode.l2` | `modeComputerBg` / `modeComputerText` | LIVE pulse on Cockpit |

**Legacy aliases (still valid in docs):** Accent = `accent.primary`; Error = `status.danger`; Success = `status.live`; Warning = `status.warn`; Background = `surface.*`; Text / Border as above.

**Contrast policy (empty / guidance):** Prefer `tokens.textSecondary` for empty-state copy (`暂无*` / `无匹配*` / ChatView `emptyKicker`). Reserve `tokens.textMuted` for non-essential decorative meta (timestamps, secondary labels).

Dark surfaces: L2 SafetyStrip / **Cockpit** only. Panel stays light in v2 (K6); tokens for dark are prepared for Cockpit + L2 chrome.

**P2 rule:** do not introduce Material hexes (`#4A90D9`, `#F44336`, `#4CAF50`, …). Prefer `tokens.*`.

**Lag note (residual accent hex):** W5 (2026-08-11) mapped Board `tool_verified` → `tokens.accent`, Apps text → `tokens.accentText`, UIA badge bg → `tokens.accentSoft`. `SettingsIntentBar` was already clean (W1–W3). No remaining `#2563eb` product accent on Side Panel named surfaces; OCR gray `#e5e7eb` and mass gray ladders deferred.

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
**Exemption:** icon-sized glyphs inside a ≤20px badge (e.g. StatusRail brand mark letter, cruise ×) may use 9–10px — not body chrome.

## Spacing

| Token | Value | Usage |
|-------|-------|-------|
| xs | `4px` | inline gap |
| sm | `6px` | compact padding |
| md | `12px` | standard padding |
| lg | `16px` | section padding |
| xl | `20px` | page padding |

## Border Radius

**Source of truth:** `tokens.radius*` in `sidepanel/ui/tokens.ts` (Precision Instrument Phase 1).

| Token | Value | Usage |
|-------|-------|--------|
| sm | `6px` | chips, icon buttons, menu items |
| md | `8px` | menus, inputs, cards |
| lg | `12px` | elevated surfaces, FocusBand, Cockpit cards |
| composer / bubble | `14px` | `radiusComposer` / `radiusBubble` — hero chat surfaces |
| sheet | `16px` | bottom sheet / 装配 drawer top corners |
| menu | `10px` | popup menus (StatusRail ⋯) |
| pill | `999` | ModeBadge / LIVE chip |

Do not invent ad-hoc radii outside this ladder.

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
- L1 header tint: `tokens.modeBrowserBg`
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
- User: `tokens.userBubbleBg` + `tokens.userBubbleText` (values live in `tokens.ts` only — currently indigo accent family, not legacy blue)
- Assistant: `tokens.assistantBubbleBg` + `tokens.assistantBubbleText`
- Empty: mode-aware L0/L1/L2 copy (see ChatView `EmptyState`); kicker / guidance use `tokens.textSecondary`

### Tool Call Card
- Border / status via `statusColor()`
- No emoji status chrome (✓ / ! / …)

### Buttons
- Primary: `tokens.accent` bg, white text
- Danger: `tokens.danger` (light) / `tokens.darkDanger` (Cockpit)

### Input / Composer (Precision Instrument Phase 1 + PR4)
- Unified capsule: attach + textarea + send inside one bordered surface
- **Solid** elevated surface + `borderStrong` — **no** glass/`backdrop-filter`, **no** canvas gradient shell
- Radius: `tokens.radiusComposer` (14px); send = flat `tokens.accent` (no purple→blue gradient)
- Mode chips row above capsule (see ComposerDock chips above); 装配 via chip / `/装配` / Cmd+K
- Settings live in StatusRail ⋯ or `/settings` (not in 装配 Board path)
- Chip row height ceiling: ≤40px — density budget Scenario B  
  (`docs/audit/reviews/sidepanel-density-budget-20260811.md`). Phase 1 does not change strip min/max heights → static budget re-run not required unless a constant is edited.

### StatusRail / shell (Phase 1)
- Solid `tokens.bgElevated` rail — no glass blur / no vertical gradient
- Type scale chrome only **11 / 12 / 13 / 15**; empty title = 15 not 18
- Hierarchy: **stream first, status second, assembly third**

### Motion
- Phase 1 freeze: `transitionFast` 150ms / `transition` 220ms (tighten in Phase 3)
- LIVE pulse on Cockpit L2 chip only; **`prefers-reduced-motion: reduce` disables animations** (Panel App + Cockpit shell)

---

*设计系统基于代码审计提取，持续同步。UIUX v2 PR7: semantic roles + Cockpit StatusRail grammar. 2026-08-11: sole hex SoT = tokens.ts; empty/guidance contrast policy B; **Precision Instrument Desk Phase 1** shell (flat canvas, radius 14/16, no glass).*
