# Side Panel 整界面重设计 — 「精密仪器台」Precision Instrument Desk

| Field | Value |
|-------|--------|
| Date | 2026-08-11 |
| Status | **Phase 1 MERGED (#168)** · **Phase 2a MERGED (#170)** · **Phase 2b+3** (SectionHeader / popup menus / motion / PanelBanner) |
| Mode | **Operate** (~320px Side Panel) |
| Direction | **精密仪器台**（用户授权「你定方向」） |
| Rhythm | 设计 dual-review → 分 PR 落地（用户选「稳」） |
| Product | [PRODUCT.md](../../../PRODUCT.md) · tokens [tokens.ts](../../../chrome-extension/src/sidepanel/ui/tokens.ts) |

## Capability declaration

```text
Surface:      L0 Panel chrome (+ visual L1/L2 badges; no new L2 tools)
L2-classes:   (none new)
Compose:      none (装配 entry chrome only)
Autonomy:     none (Fleet/Board presentation only)
Trust:        no elevation; 急停/确认视觉权重不得降低
Channel:      unchanged
```

---

## 0. Diagnosis — why it feels ugly & messy

| Symptom | Root cause in current shell |
|---------|------------------------------|
| **杂** | StatusRail + FocusBand + Scene + RunBusy + Worker 多层状态；信息同权 |
| **丑 / 玩具感** | 渐变背景、毛玻璃 composer、多层 inset 高光、气泡与工具卡圆角过大且不一致 |
| **层次弱** | 11–18px 字号漂移；muted 滥用；emoji 菜单与 Quiet-professional 冲突 |
| **双系统** | 主 chrome 用 tokens，次级面板大量遗留 hex / 另一套灰蓝 |
| **空状态** | 标题 18px 与 chrome 11–15 标尺脱节；装饰大于任务 |

**Not the problem:** Ontology (L0/L1/L2) or feature set — the **presentation** dilutes a serious agent.

---

## 1. Design thesis (contract)

**THESIS:** Side Panel is a **precision local instrument** for driving an agent — not a soft consumer chat widget. Hierarchy is **stream first, status second, assembly third**.

**OWN-WORLD (精密仪器台):**

| Token | Direction |
|-------|-----------|
| Canvas | Flat cool-neutral **solid** `#f4f5f8` — **no vertical gradient** |
| Elevated | Pure white panels with **1px hairline** border, **one** soft shadow level |
| Accent | Indigo `#4f46e5` **only** for primary CTA / focus / user bubble |
| Type | System UI stack; scale **11 / 12 / 13 / 15** only (no 18 empty titles) |
| Radius | Controls 6–8; composer/bubble **14** (down from 18); sheets 16 |
| Chrome | No glass blur on main shell; no multi-layer inset “capsule glow” |
| Icons | SVG only in chrome; menus **text labels** first |

**STORY:** User opens panel → sees connection + mode in one quiet rail → reads agent work in a clear stream → types in a grounded composer → secondary tools never compete with send/stop/confirm.

**FIRST VIEWPORT (L0 idle):**

```
┌─────────────────────────────┐  ~40px  StatusRail: mode chip · conn · thread · ⋯
│                             │
│     stream (flex 1)         │  empty: 15 title + 13 hint + chips
│                             │
├─────────────────────────────┤  chips row (compact)
│  [  composer  flat  ]  ➤   │  ~56–72px  no glass
└─────────────────────────────┘
```

**FORM:** Operate / Restrained color strategy / instrument desk.

**FINISH:** Unreviewed + undocumented is unfinished; each phase ends with dual-review + DESIGN.md sync of shipped tokens.

---

## 2. What we keep (product truth)

- L0/L1/L2 ModeBadge grammar; FocusBand priority machine; 确认台 / 急停  
- 装配 chips + slash; thread list Timeline/Tags; graph **full page** (already separate)  
- Density budget ≥55% / ≥40%  
- Confirm content-split (Panel minimal / Cockpit elevated)  

---

## 3. Phased delivery (PR-sized)

### Phase 1 — Shell foundation (highest visual impact)

| # | Change |
|---|--------|
| P1-1 | **tokens.ts** refresh: flat bg, tighter radius, single shadow ladder, kill decorative dual-shadow on composer |
| P1-2 | **App shell**: solid canvas; remove gradient + glass on `inputArea` / simplify `composerCapsule` |
| P1-3 | **StatusRail**: quieter density; text-first ⋯ menu (reduce emoji); connection as status not decoration |
| P1-4 | **ChatView**: empty state 15/13 scale; bubble radius 14; tool cards hairline not thick side-tab feel |
| P1-5 | **FocusBand / strips**: shared horizontal padding 12; hairline separators; no competing full-width fills |
| P1-6 | Sync **docs/DESIGN.md** + short surface brief |

**Out of Phase 1:** SettingsSlideout full rewrite, MCP/Apps hex purge (Phase 2).

### Phase 2 — Secondary surfaces

- Settings / MCP / Apps / Packs: token-only colors, shared section header component  
- ThreadList hamburger panel: same menu density as StatusRail  

#### Phase 2a (this PR wave) — token-only colors

Mechanical hex → `tokens.*` on secondary surfaces (no layout rewrite):

| File | Notes |
|------|--------|
| `SettingsSlideout.tsx` | Settings chrome + nested sections |
| `UserEnvSection` / `SettingsSection` / `SettingsIntentBar` | Settings subsections |
| `McpPanel` / `McpServerForm` / `OutboundMcpSettingsSection` | MCP |
| `AppsPanel` / `PacksPanel` / `NetSecSettingsSection` | Apps / Packs / enterprise |
| `AtThreadPopover` | small chrome |
| `ThreadGraphApp` | residual canvas/legend edges → tokens + alpha |

**Out of 2a:** shared `SectionHeader` component, ThreadList menu density (2b), Phase 3 motion.

#### Phase 2b — shared chrome density

| Deliverable | Location |
|-------------|----------|
| `SectionHeader` | `sidepanel/ui/SectionHeader.tsx` — title 13/600 + meta 11 |
| `popupMenuStyles` | `sidepanel/ui/popupMenuStyles.ts` — StatusRail + ThreadList + MCP/Apps menus |
| SettingsSection title | 13/600 (was 14/700) |
| ThreadList residual hex | tokens only |

### Phase 3 — Motion & polish

- reduced-motion already global; tighten transitions to **120 / 180ms** (`tokens.transitionFast` / `transition`)  
- Empty / error / disconnected banners unified → `PanelBanner` (`ui/PanelBanner.tsx`); DisconnectedBanner wired  

---

## 4. Concrete token deltas (Phase 1 proposal)

| Token | Current | Proposed |
|-------|---------|----------|
| `bg` | `#f5f6fa` | `#f4f5f8` |
| `radiusComposer` / `radiusBubble` | 18 | **14** |
| `radiusSheet` | 20 | **16** |
| `shadowMd` | dual heavy | single soft `0 1px 3px rgba(15,23,42,.06), 0 4px 12px rgba(15,23,42,.04)` |
| Shell bg | gradient | **solid `tokens.bg`** |
| Composer | glass blur + dual border | **solid elevated + 1px borderStrong** |

---

## 5. Anti-patterns (explicit bans for implementers)

- No purple→blue gradients on send or headers  
- No `backdrop-filter` on primary shell (optional only on floating menus)  
- No emoji in StatusRail / BottomBar / settings section titles  
- No new status strip components without density budget note  
- No 18px chrome titles  

---

## 6. Acceptance (Phase 1)

| # | Check |
|---|--------|
| R1 | Idle L0 screenshot: no glass composer, no canvas gradient |
| R2 | Type scale only 11/12/13/15 in StatusRail + empty + composer |
| R3 | Send remains most saturated control; mode is chip not full rail paint |
| R4 | FocusBand + Scene + RunBusy still function; 急停 still visible when required |
| R5 | `npm --prefix chrome-extension test` green |
| R6 | Density static budget still pass (or re-measure note) |

---

## 7. Dual-review gates (design)

Reject if:

- Redesign weakens confirm/急停 discoverability  
- Replaces Operate with marketing Persuade aesthetics  
- Invents new capability axis or Side Panel permanent tab landfill  

---

## 8. Next

1. **Pi + Claude dual-review this SoT**  
2. On APPROVE*: implement **Phase 1 only** → dual-review impl → PR  
3. Phase 2/3 separate PRs  

**User mandate:** 整体乱 → Phase 1 resets the visual language of the daily surface; secondary panels follow without blocking the first “this looks serious” moment.
