# CMspark Design System

> **Consumer assistant canon**（看山质量杠 · Comp A 角色居中）— Operate.  
> 白底陪伴空态：填色角色印记 + 22px 招呼 + 句子行 + 安静输入。SVG 图标；emoji 仅用于消息内容。  
> Direction SoT: `.impeccable/mocks/comp-a-centered.png` · Product: [PRODUCT.md](../PRODUCT.md)  
> Form SoT: [2026-08-26-product-form-deepening-design.md](superpowers/specs/2026-08-26-product-form-deepening-design.md)

## Product surfaces (2026-08-26 · ChatShell honesty 2026-08-27 #239 · Capture 卡片 2026-08-28 #241)

Home is **logged-in Chrome + hard gates**, not the Side Panel. Tokens below still govern Side Panel / Cockpit craft.

| Surface | Design job |
|---------|------------|
| 召唤器 | Mac Swift = collapsed bar + **展开对话** (旧条; 本票不翻). HTML Capture 卡片 **360×420** (inner `OVERLAY_WINDOW_SIZE`; 流式 `chat.token`): 看山, **要我帮你做什么**, 📎 🎙, **开始会议**, **打开浏览器并打开侧栏**. HTML 听写不再「听写在侧栏」. **No** `当前页` on overlay. F-I-4: Companion 不调 `chrome.*`; 失败 toast **请点工具栏 C**; extension SW 开侧栏. **贴回侧栏** still not a filled button. Same 看山 paper as Operate; no Allow/Deny. Not a five-rail WorkBuddy. |
| Side Panel | Operate when watching the page. ChatShell empty + **弹出对话框**. Empty: **要对这页做什么** / **当前页：** / 3 template chips fill composer (do not send). 装配 stays outside the shell. Chat column **本轮步骤** is L0 RunProgress (H1 seed or run_progress_propose this user turn): **≤3 items expanded, ≥4 collapsed**; wrap **always sticky**; expanded `<ul>` `maxHeight min(40vh,240px)` + inner scroll — never StatusRail / FocusBand / overlay. `n/m` counts tickable seed|user rows (drafts excluded). **`tool_result` ticks only when that seed row has an exact `tool`**; otherwise click-only. Existing `run_progress` is not overwritten by a later H1. **Not** Mission Board. |
| 确认台 / Cockpit | Confirm. Night-world of the same craft. Overlay never borrows this dialect. |
| 租手 | No new visual chrome in coding agents. Confirm still lands on 确认台 / Mac tray. |

Copy contract (Chinese chrome): `弹出对话框` / `当前页：` / `打开确认台` / `打开浏览器` / `打开浏览器并打开侧栏` / `请点工具栏 C` / `纪要在侧栏` / `展开对话` (Mac 旧壳) / `本轮步骤`. Forbidden: `展开工作台`, `去侧栏批准`, HTML `听写在侧栏`. **贴回侧栏** still not a filled button. Do not label RunProgress `进行中` (collides with Mission Board intents).

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
| `brand.mark` (empty-state imprint ONLY, never danger) | `brandRed` | — |
| `status.live` | `success` | `darkLive` / `darkSuccess` |
| `status.warn` | `warning` | `darkWarning` |
| `status.danger` | `danger` | `darkDanger` |
| `risk.high` | `danger` | `darkDanger` |
| `risk.medium` | `warning` | `darkWarning` |
| `mode.l0` | `modeChatBg` / `modeChatText` | — |
| `mode.l1` | `modeBrowserBg` / `modeBrowserText` | — |
| `mode.l2` | `modeComputerBg` / `modeComputerText` | LIVE pulse on Cockpit |

**Legacy aliases (still valid in docs):** Accent = `accent.primary`; Error = `status.danger`; Success = `status.live`; Warning = `status.warn`; Background = `surface.*`; Text / Border as above.

**Contrast policy (empty / guidance):** Prefer `tokens.textSecondary` for empty-state hint and `暂无*` / `无匹配*`. Reserve `tokens.textMuted` for non-essential decorative meta (timestamps, secondary labels). Empty greeting uses `tokens.text`.

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
**Exemption:** empty-state greeting is **22px** (`tokens.emptyTitle`). Icon-sized glyphs inside a ≤20px badge may use 9–10px.

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
| **Panel** `StatusRail` | ModeBadge whisper（28px 图标，title 仍带层级）；品牌点 `CompanionMark` 小标常驻（巡航/断连不藏） | 已连 `role=status` 圆点；断连被动状态（单 CTA = 底部 `DisconnectedBanner`） | 新对话 + 历史 chevron · 巡航短词 `值守`/`巡航` · ⋯ |
| **Cockpit** header | Chip `L2 · LIVE` / `L2` / `确认` / `工作区` (same Surface grammar) | Dot + **label text** (`connectionColorDark` + `connectionLabel`) | Thread id · fleet summary · 急停 · 收起 |

Grammar must match: mode chip · connection · secondary context. Cockpit is dark; Panel is light. Type scale 11–13; rail min-height ~40–44px.

**⋯ menu IA (#321 PR-3):** grouped under `会话 / 能力 / 诊断` section labels.
- 会话：提取技能 · 导出为 Markdown · 导出摘要
- 能力：NotebookLM 导入 · 离线导出当前页（原「导出当前页 (NB)」）
- 诊断：日志（LogBar 入口）· 设置 · 密钥与环境
Bottom `role=note` 保留装配/`/board` 可发现性。导出菜单点击仍发同一 `thread.export_obsidian`（scope thread / summary）。

**Toast (#321 PR-3):** single queue (`ToastHost` / `useToastQueue`) with `info | warning | error` tones; renders as a bounded column (burst serialised, never piled); position DOM-anchored under the rail — no `top:52` rail-height constant. `cmspark:toast` event, 自动匹配技能与能力提升提示 all route through the one queue.

### Mode badge (P0)
- L0 `聊` · L1 `网页` · L2 `计算机` / `计算机 · LIVE` — see `sidepanel/mode/mode-controller.ts`
- **Ontology:** product L0/L1/L2 = Surface axis = UI `CapabilityLevel` `chat|browser|computer` — [ADR-020](adr/020-capability-model-three-axes.md)
- L1 header tint: `tokens.modeBrowserBg`
- **BottomBar permanent tab strip (PR5):** gated by `ui.bottomBarStrip` in `sidepanel/ui/flags.ts` — **default `false`**. Host remains SoT; panels open via Composer chips / `/` / 装配. Set flag `true` only for smoke/rollback. Legacy tab sets (if re-enabled): L0 Skills·Know·Hist · L1 Tabs·Skills · L2 empty + overflow「更多」
- **ComposerDock chips** (UIUX v2 PR4 §4.4): always above the field (including empty). L0 装配 · L1 装配·Tabs·工作区 · L2 确认台·装配 — open Host / 装配 drawer; **no Abort next to Send**
- **装配 P0** bottom-sheet section list → Host (`skills`/`knowledge`/`packs`/`mcp`/`apps`/`history`); Board is Autonomy (`/board` only — no ⋯「编排」)
- **Slash parity** (§4.8): `/skills` `/knowledge` `/history` `/tabs` `/packs` `/mcp` `/apps` `/board` `/settings` `/cockpit` `/装配`
- **FocusBand** (UIUX v2 §4.3): single slot Confirm > L2 Safety+急停 > Fleet > L1 Context; hard cap ≤80px; 急停 never buried under L2 task. **Empty L1 hides the webpage strip**; confirm / 急停 still take the slot.
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

### Message Bubbles (P2 · #321 PR-4 canon revision)
This is a **canon fix**, not "aligning with canon". `tokens.ts` used to say indigo spark only on character + armed send while `userBubbleBg` was a filled indigo slab (`=== accent`). PR-4 closed that contradiction.

- User (shipped variant **A — paper + hairline**): `tokens.userBubbleBg` (white) + `tokens.userBubbleInk` + `tokens.userBubbleBorder`. Not a filled indigo slab.
- Variant **B — left indigo bar** (screenshot alternative, not live): same paper fill, `3px` `tokens.accent` left edge, no full indigo fill. User picks A vs B.
- `tokens.userBubbleText` remains **on-accent / on-danger glyph** (send armed, filled buttons). Do not reuse it as bubble copy.
- Assistant: `tokens.assistantBubbleBg` + `tokens.assistantBubbleText`
- Empty: red calf imprint `CompanionMark` **48px** (`tokens.brandRed` — brand, never `danger`; #323) + 22px greeting + sentence rows above the fold (see ChatView `EmptyState`); no kicker. Guidance uses `tokens.textSecondary`

### Tool Call Card
- Border / status via `statusColor()`
- No emoji status chrome (✓ / ! / …)

### Buttons
- Primary: `tokens.accent` bg, white text
- Danger: `tokens.danger` (light) / `tokens.darkDanger` (Cockpit)

### Input / Composer (companion canon + #321 PR-4)
- Unified capsule: textarea + circular up-arrow send; **minHeight ~52** (was 72). Voice capsule / PTT / Attach sit beside the field (32px) and still fit; the voice status capsule is a sibling, not inside the minHeight.
- 装配 lives on the ComposerDock chip above the field (`/装配` / Cmd+K still work); do not duplicate it inside the capsule. L0 装配 chip is **quiet** (same hairline as siblings; `primary` flag kept).
- Empty capsule = field + send; attach / 听写 appear after the first character
- **Solid** white surface — **no** glass/`backdrop-filter`
- Radius: `tokens.radiusComposer` (16px); send is circular; `tokens.sendDisabledBg` unarmed, `tokens.accent` when armed
- Empty-state placeholder: L0 `描述任务，或粘贴截图…` · L1 `问这页，或描述操作…` (`composerPlaceholder`)
- ComposerChips stay visible on the empty stream so 装配 is not duplicated inside the capsule
- Settings: StatusRail gear and ⋯「设置」 share the same route (disconnected → connection, else model)
- Legal line under empty capsule: `tokens.textMuted` ≥11px
- Chip row height ceiling: ≤40px — density budget Scenario B  
  (`docs/audit/reviews/sidepanel-density-budget-20260811.md`). Phase 1 does not change strip min/max heights → static budget re-run not required unless a constant is edited.

### StatusRail / shell (Phase 1)
- Solid `tokens.bgElevated` rail — no glass blur / no vertical gradient
- Type scale chrome only **11 / 12 / 13 / 15**; empty greeting is the one **22px** exemption (`tokens.emptyTitle`)
- Hierarchy: **stream first, status second, assembly third**

### Motion
- Phase 3: `transitionFast` **120ms** / `transition` **180ms**
- LIVE pulse on Cockpit L2 chip only; **`prefers-reduced-motion: reduce` disables animations** (Panel App + Cockpit shell)

### Shared chrome (Phase 2b)
- `SectionHeader` — secondary panel section titles (13/600)
- `popupMenuStyles` — ⋯ menus (StatusRail / ThreadList / MCP / Apps)
- `PanelBanner` — disconnected / warn / danger / info strips

---

*设计系统基于代码审计提取，持续同步。UIUX v2 PR7: semantic roles + Cockpit StatusRail grammar. 2026-08-18: consumer assistant canon（看山质量杠 · Comp A）；空态 D″ + C″ 一条栏。Cockpit 夜世界仍是下一表面。*
