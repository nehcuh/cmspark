# CMspark Side Panel UI/UX Redesign v2 — Quiet Agent Shell

| Field | Value |
|-------|--------|
| Status | **Revised after adversarial A+B (MAJOR_REVISE → ready dual-review)** |
| Date | 2026-07-31 |
| Adversarial | `docs/audit/reviews/sidepanel-uiux-v2-adversarial-A-2026-07-31.md` · `…-B-…` |
| Surfaces | Chrome Side Panel (~320px) · Extension Cockpit · (Native HUD out of scope) |
| Supersedes / extends | [2026-07-26 three-mode redesign](2026-07-26-ui-three-mode-redesign.md) (IA already landed P0–P2) |
| Ontology | [ADR-020](../../adr/020-capability-model-three-axes.md) Surface × Composition × Autonomy |
| Tokens | [docs/DESIGN.md](../../DESIGN.md) · `sidepanel/ui/tokens.ts` |

---

## 0. Why this doc exists

Three-mode (L0/L1/L2) and Cockpit content-split **shipped**, but daily feel remains:

1. **Visually noisy** — mixed radius/hex, dense chrome, emoji residual, half-migrated Material status dots.  
2. **Interactively expensive** — vertical stack of Header → ContextStrip → SafetyStrip → Chat → FleetStrip → BottomBar → Composer squeezes the message stream; secondary panels still “slide under” chat without a clear modal hierarchy.  
3. **Ontology not legible** — users still experience “功能杂”：Skill / Pack / MCP / Board live in BottomBar overflow without a **Composition vs Surface** story.

This redesign **does not** invent a fourth capability axis or a second agent runtime. It **refines presentation and interaction** so ADR-020 reads as product, not only as architecture.

---

## 1. Research synthesis — community design skills & philosophies

### 1.1 Skills / workflows available in this toolchain

| Source | Skill / pattern | Use here |
|--------|-----------------|----------|
| Grok Build | `$design` write→review loop | Design-doc quality gate |
| OMX | `$design` (repo DESIGN.md SoT); `$visual-ralph` for pixel implement | Post-approval visual lock |
| Mattpocock | `design-an-interface` (multi-option interfaces) | Optional API-shape exploration |
| Community (2026) | Semantic design systems + agent skills/MCP for UI codegen | Tokens + component contracts for AI implementers |
| Brad Frost / Chromatic | **Agentic design systems** — examples, states, constraints for agents | Component matrix with empty/loading/error/disabled |

**Deprecation note:** `omx-frontend-ui-ux` is a shim → use design + visual-ralph, not that skill.

### 1.2 Agent UX principles (2025–2026 consensus)

Synthesized from agent-UI writing (transparency / control / status / recovery), progressive delegation, and side-panel density practice:

| # | Principle | Product implication for CMspark |
|---|-----------|----------------------------------|
| P1 | **Transparency** | Tool steps, risk, and “why confirm” always visible at the right surface (Panel minimal / Cockpit elevated — keep D10′). |
| P2 | **Human agency** | Abort always one gesture; pin level; never silent L2; Pack cannot relax globals (ADR-020). |
| P3 | **Progressive disclosure** | L0 chat-first; composition tools behind `/` + one “装配” entry; power chrome only when Surface needs it. |
| P4 | **Status is first-class** | Connection + mode + task + confirm queue in a **single status rail**, not 4 strips. |
| P5 | **Structured recovery** | Offline / tool error / confirm timeout → same toast+banner grammar; no `alert()`. |
| P6 | **Semantic system** | Tokens carry *intent* (`surface.chat`, `risk.high`) not just hex — for humans and future AI implementers. |
| P7 | **Density budget** | Side Panel: ChatStream height targets — **L0 idle ≥55%**; **worst-case (L2+confirm) ≥40%** of panel; FocusBand hard-capped (see §4.3). |

### 1.3 Side-panel specific patterns

- **One primary scroll region** (chat); secondary content = drawer / overlay / separate window (Cockpit).  
- **Command palette** (`/`) for low-frequency IA (already S1) — expand to full “装配中心” rather than more BottomBar tabs.  
- **Thumb zone**: composer + primary actions bottom-fixed; destructive actions never next to Send.  
- **Confirmation elevation**: keep content-split; never re-introduce full security modal into 320px panel.

---

## 2. Product constraints (locked)

### 2.1 From ADR-020 (non-negotiable)

```text
Surface:      L0 聊 | L1 网页 | L2 计算机
Composition:  Skill · Knowledge · MCP · Pack · user-env
Autonomy:     single loop → multi-worker → Board
Trust:        rises with Surface; Pack cannot relax globals
```

UI mapping (unchanged):

| Surface | Panel | Cockpit |
|---------|-------|---------|
| L0 | Default home | Closed |
| L1 | Chat + context; user「展开工作区」 | Optional light workspace |
| L2 | Safety chip + abort + minimal confirm | Required conductor |

**Forbidden in copy/UI:** bare「中层 Agent」. Use「装配 / 组合能力」.

### 2.2 From three-mode redesign (keep, with one intentional chrome delta)

D1–D16 remain in force for product semantics (mode ontology, hysteresis, content-split, L1 user-only expand, tray L2 → Cockpit, etc.).

**Intentional IA delta (D5′ / K2′)** — supersedes three-mode §4 *implementation* of permanent ContextBar / BottomBar tab row only:

> Mode-split permanent tabs → **≤3 mode-aware chips + `/` + 装配 entry + shared ContextPanelHost**.  
> D5 *intent* (command-first, low-freq via settings/`/`) is preserved; the permanent tab strip is not.

Dual-review should treat D5′ as an explicit product IA change, not silent scope creep.

### 2.3 Explicit non-goals

- Redesign Companion native HUD (P3a spike separate).  
- New capability modules or confirm dialects.  
- Thread model rewrite.  
- Full App.tsx rewrite in one PR — shell extraction only.  
- Dark mode for entire Panel in v2-P0 (tokens prepared; optional v2-P2).

---

## 3. Current pain audit (code-grounded)

| Area | Today | Pain |
|------|-------|------|
| Vertical chrome | Header + ContextStrip + SafetyStrip + FleetStrip + BottomBar + Composer | Chat squeezed; cognitive “strip stack” |
| BottomBar | Mode-filtered tabs + overflow | Still feels like landfill when「更多」opened |
| Header | Thread + badge + connection + ⋯ menu | ⋯ hides Craft / export / NB / logs / settings — discoverability uneven |
| Status | Badge + connection + toasts + banners | No unified grammar |
| Visual | tokens.ts exists; residual Material dots (`#4CAF50`) in docs/code paths | Inconsistent “quiet-professional” |
| Composition | Skills/Know/Pack/MCP/Apps as panels | No mental model vs Surface badge |
| Offline | `alert()` reconnect path in App.tsx | Breaks in-extension tone |
| Live log | Fixed field normalize (2026-07-31) | Still a power feature in ⋯ |

---

## 4. Target information architecture

### 4.1 Panel shell — three zones only

```text
┌─────────────────────────────────────┐
│  A. StatusRail (fixed, ~40–48px)    │  mode · connection · thread · menu
├─────────────────────────────────────┤
│  B. FocusBand (0–2 rows, collapsible)│  L1 context | L2 safety | confirm mini
│     (never both Context + full fleet)│  Fleet → only multi-agent active
├─────────────────────────────────────┤
│  C. ChatStream (flex 1, primary)    │  ≥55% height L0 target
├─────────────────────────────────────┤
│  D. ComposerDock (fixed)            │  / palette · attach · input · send
│     + optional slim ContextChips    │  NOT a second BottomBar
└─────────────────────────────────────┘
```

**BottomBar permanent tab strip is retired only after host extraction** (see §4.7 migration). Replacement surfaces:

1. **ContextPanelHost** — single owner of panel bodies + data loaders + `cmspark:open-context-panel` (extracted from BottomBar; **not optional**).  
2. **Context chips** under composer (mode-aware, max 3 primary) → open Host.  
3. **`/` command palette** with **full parity matrix** (§4.8) → open Host.  
4. **「装配」entry (P0 minimum)** — one button/chip opens bottom sheet *section list*; full section UIs can land in P1 but **entry is P0** so Pack/MCP stay discoverable without memorizing slash.  
5. Board is **not** under 装配 — see §4.5 / Autonomy.

### 4.2 StatusRail (Zone A)

| Element | Behavior |
|---------|----------|
| Mode badge | L0 `聊` / L1 `网页` / L2 `计算机·LIVE` — `aria-live="polite"`; **pin stays on badge** (not buried in ⋯) |
| Connection | Dot + text tooltip (connected / reconnecting / offline) — **tokens only** |
| Thread | Title + switcher (compact ThreadList popover) |
| Menu (⋯) | Settings, secrets, export, Craft, NotebookLM, logs |

### 4.3 FocusBand (Zone B) — hard state machine (not soft prose)

**Single slot.** Max **one primary row** (≤56px) + optional **one secondary line** (≤24px). Total FocusBand ≤ **80px**. Overflow actions open Cockpit or popover — never a third bar.

| Priority (highest wins primary) | Content | Abort visible? |
|----------------------------------|---------|----------------|
| P0 Confirm pending | MinimalConfirm (tool + risk + Allow/Deny/Stop) | Stop in confirm row |
| P1 L2 task active (no confirm) | TaskChip + **急停** (mandatory) | **Yes — always in primary when L2** |
| P2 Multi-worker / locks / intents | Fleet summary (1 line); expand → Autonomy panel / Cockpit | — |
| P3 L1 context | tab chip +「展开工作区」 | — |
| P4 idle | empty | — |

**Hard rules:**

1. **Confirm does not bury 急停.** When L2 task **and** confirm: primary = MinimalConfirm that **includes** Abort/Stop control (or primary=Confirm + secondary line with 急停 always visible). Violating D10′ is a bug.  
2. Fleet never claims primary over Confirm or L2 Safety. **Implementation:** remove `pending > 0` from `FleetStrip` visibility — pending confirm chrome is owned by MinimalConfirm in FocusBand only.  
3. L1 Context yields to Confirm.  
4. No dual full-height ContextStrip + SafetyStrip + FleetStrip stack.

### 4.4 ComposerDock (Zone D)

```text
[ / 装配 ]  [chips: Skills·Tabs·…] 
┌──────────────────────────────────┐
│  attach │  textarea…        │ ➤ │
└──────────────────────────────────┘
```

| Level | Placeholder | Chips (≤3) + fixed |
|-------|-------------|---------------------|
| L0 | 问点什么，或 / 装配 | **装配** · Skills · Know |
| L1 | 描述网页任务… | **装配** · Tabs · **工作区** (Host `packs` → workspace picker) |
| L2 | 排队跟进…（conductor 在确认台） | **确认台** · **装配** · (no Abort here) |

**Abort never lives next to Send** (§1.3 thumb zone). L2 急停 stays in FocusBand / Safety only.

Send shortcut respects settings (Enter / Cmd+Enter).

### 4.5 装配 Drawer (Composition plane only)

**Name:** 装配（not「工具」or「中层」）  
**Open via:** `/装配` · Composer **装配** chip · empty-state link · (P0) same entry opens thin section list even before full P1 chrome  

**Composition sections only** (ADR-020 Axis B):

1. **Skills** — activate/craft  
2. **Knowledge** — site/global  
3. **Packs** — mission packs  
4. **MCP** — servers  
5. **Apps / user-env** — host apps + secrets (enterprise-aware copy)  

**Not in 装配 (Autonomy — Axis C):**

- **Board / Fleet / multi-worker** → FocusBand fleet summary, StatusRail when active, Cockpit, `/board`, ⋯「编排」. Never labeled as 组合/装配.

Each Composition section shows **attach target**: “挂到当前线程 · Surface Lx” so Composition ≠ deeper agent.

**Landfill guards:** only one secondary surface open at a time (drawer **or** ContextPanelHost body **or** Settings). Opening one closes the other.

### 4.6 Cockpit (confirm center) — keep, polish only

- Keep dual-track + ConfirmElevated.  
- Visual: align StatusRail grammar (L2 · LIVE, connection).  
- No new primary chrome; fix spacing/type scale to match Panel tokens.

### 4.7 ContextPanelHost + BottomBar migration (blocking for implementers)

Today `BottomBar.tsx` is not “tabs only” — it owns `activePanel`, panel mounts, `loadPanelData`, and `cmspark:open-context-panel`.

**Replace-before-remove sequence (mandatory):**

| Step | Deliverable | BottomBar strip |
|------|-------------|-----------------|
| M1 | Extract **ContextPanelHost** (registry + open/close + loaders + event listener) | Keep strip |
| M2 | Chips + `/` + 装配 entry all call Host API; **slash parity matrix complete** (§4.8) | Keep strip optional |
| M3 | Flag `ui.bottomBarStrip=false` hides tab row only | Host remains |
| M4 | Delete strip chrome after one release / acceptance | Host only |

**PR2 must not delete BottomBar** without M1 in the same or prior PR.

### 4.8 Slash / open-panel parity matrix

| Target | `/` command | Chip / 装配 | Host panel id |
|--------|-------------|-------------|---------------|
| Skills | `/skills` | L0 chip / 装配 | `skills` |
| Knowledge | `/knowledge` | L0 / 装配 | `knowledge` |
| History | `/history` | 装配 or Hist chip | `history` |
| Tabs | `/tabs` | L1 chip | `tabs` |
| Packs | `/packs` | **装配** (P0) | `packs` |
| 工作区 (L1 chip) | — | L1 chip | `packs` (workspace subsection / `workspace.pick`) |
| MCP | `/mcp` | **装配** (P0) | `mcp` |
| Apps | `/apps` | 装配 | `apps` |
| Board | `/board` | ⋯ 编排 / fleet (not 装配) | `board` |
| Settings | `/settings` or ⋯ | ⋯ | settings slideout |
| 确认台 | `/cockpit` | L2 chip | opens cockpit window |

Empty state L0 lists: 总结本页 · **装配** · `/packs` as visible hints (not slash-only).

### 4.9 Esc / overlay priority stack

Highest → lowest (Esc peels one layer):

1. Open modal dialogs (McpServerForm, craft, notebooklm)  
2. ContextPanelHost body / 装配 drawer  
3. Thread popover / slash palette  
4. Confirm: **Esc → Deny** (existing MinimalConfirm safe default). Overlays above peel first.

---


## 5. Visual system v2

### 5.1 Design thesis

**Quiet Agent Shell** — one accent, soft neutrals, geometry over emoji, mode tint subtle (not neon). Density over decoration.

### 5.2 Token roles (extend `tokens.ts` / DESIGN.md)

| Role | Light | Dark (Cockpit/L2 strip) |
|------|-------|-------------------------|
| `surface.canvas` | `#fafbfc` | `#0f1115` |
| `surface.elevated` | `#ffffff` | `#161a22` |
| `text.primary` | `#111827` | `#e8eaed` |
| `text.secondary` | `#4b5563` | `#9aa0a6` |
| `border.subtle` | `#e5e7eb` | `#2a2f3a` |
| `accent.primary` | `#2563eb` | `#5b8def` |
| `status.live` | `#16a34a` | `#4ade80` |
| `status.warn` | `#d97706` | `#fbbf24` |
| `status.danger` | `#dc2626` | `#f87171` |
| `mode.l0` | gray chip | — |
| `mode.l1` | blue soft chip | — |
| `mode.l2` | green-on-dark chip | LIVE pulse |

**Migrate:** connection colors from Material `#4CAF50/#FF9800/#F44336` → status tokens.  
**Radius:** 6/8/12 only. **Type:** 11/12/13/15. **Motion:** ≤200ms + `prefers-reduced-motion`.

### 5.3 Component states matrix (agentic DS)

Every chrome component documents: **default · hover · active · disabled · loading · empty · error**.

Priority polish list: StatusRail, ModeBadge, MessageBubble, ToolCard, MinimalConfirm, Composer, 装配 Drawer, ThreadPopover.

### 5.4 Wireframe (L0)

```text
┌─ StatusRail ──────────────────────────┐
│ [聊]  ·  已连接  │ 今日笔记…  ▾  │ ⋯ │
├───────────────────────────────────────┤
│                                       │
│   Empty: 今天想聊什么？                 │
│   快捷: 总结本页 · /装配 · 导入        │
│                                       │
│   (messages…)                         │
│                                       │
├───────────────────────────────────────┤
│  芯片: Skills  Know  Hist              │
│  ┌──────────────────────────── [➤] ┐  │
│  │  消息…                           │  │
│  └──────────────────────────────────┘  │
└───────────────────────────────────────┘
```

### 5.5 Wireframe (L1 + confirm)

```text
┌─ StatusRail [网页] 已连接 ─────────────┐
├─ FocusBand (single):                  │
│  ⚠ evaluate · 允许 拒绝  ── tab·展开↗ │  ← confirm primary; context secondary line
│  ChatStream (tool cards denser)       │
├─ chips: 装配  Tabs  工作区 ───────────┤
│  Composer                             │
└───────────────────────────────────────┘
```

---

## 6. Interaction redesign

### 6.1 Primary flows

| Flow | v2 behavior |
|------|-------------|
| First open | L0 empty state with 3 intent chips (not 6 icons) |
| Start browser work | First browser tool → L1 badge + soft toast; ContextStrip appears |
| Confirm | MinimalConfirm in FocusBand; Cockpit elevated for heavy preview |
| L2 start | Cockpit open/focus; Panel Safety strip; composer queue mode |
| Composition | `/` or 装配 drawer — never force leave chat to “find MCP” |
| Offline | Banner + disable send; **no `alert()` on reconnect path** (v2-P0 scope; other alerts migrate monotonically) |
| Errors | Tool card inline + optional toast; severity color + text |

### 6.2 Keyboard

| Key | Action |
|-----|--------|
| `/` | Open palette (when input empty or after space rules existing) |
| Esc | Close drawer / palette / thread popover (priority stack) |
| Cmd/Ctrl+K | Optional alias to 装配 (if not conflict) |
| Enter / Cmd+Enter | Send per settings |

### 6.3 Accessibility

- Focus trap in 装配 drawer and thread popover.  
- Confirm buttons min 44×32 hit target.  
- Risk never color-only (label + icon geometry).  
- Screen reader: mode changes via `aria-live`.

---

## 7. Mapping: user pain → design response

| User complaint | Response |
|----------------|----------|
| 太丑 | Quiet tokens + kill Material dots + consistent radius/type + message density |
| 不方便 | Kill BottomBar strip; chat-first height; 装配 drawer + `/`; StatusRail merge |
| 功能杂 | Composition drawer labeled 装配; Surface badge only three words |
| 确认吓人/乱 | Keep content-split; FocusBand priority; Cockpit = 确认台 branding consistency |
| 合盖耗电 (related) | Out of UI scope — separate WS fix landed; UI must not add idle timers that spam WS |

---

## 8. Phasing & acceptance

### v2-P0 — Host extract + StatusRail + FocusBand (1.5–2 wk)

**Deliver:** StatusRail; **ContextPanelHost extract**; FocusBand state machine; Context chips + **装配 P0 entry** (section list); slash parity matrix; connection token colors; offline banner without `alert()`.

**Accept:**

- [ ] L0 idle: ChatStream height ≥55% at 640px panel height.  
- [ ] L1+confirm and L2+confirm: ChatStream ≥40%; FocusBand ≤80px; **急停 visible whenever L2 task active**.  
- [ ] ContextPanelHost opens packs/MCP/skills/… from chips, `/`, and 装配 entry.  
- [ ] Pack/MCP reachable in ≤2 clicks **or** 1 visible 装配 entry + 1 section tap (no slash memorization required).  
- [ ] BottomBar **strip** may still exist behind flag; Host is SoT for panels.  
- [ ] Offline reconnect path: no `alert()`.  
- [ ] Mode badge + connection use tokens in touched code.  
- [ ] No regression: D10′ content-split, L2 Cockpit open, abort.

### v2-P1 — Retire strip + full 装配 drawer + visual pass (1–1.5 wk)

**Deliver:** Hide/remove BottomBar tab strip; full 装配 sections UI; ToolCard/MessageBubble density; empty states; Board under Autonomy chrome only.

**Accept:**

- [ ] No permanent BottomBar tab row (flag default off).  
- [ ] 装配 opens full Composition sections; Board **not** inside 装配.  
- [ ] Copy never says「中层 Agent」.  
- [ ] WCAG AA spot-check primary text.

### v2-P2 — Cockpit + density polish (~1 wk)

**Deliver:** Cockpit StatusRail alignment; FocusBand motion; DESIGN.md semantic roles fully listed; remaining Material hex purge in Panel chrome.

**Accept:**

- [ ] Cockpit + Panel status grammar match.  
- [ ] `prefers-reduced-motion` honored.  
- [ ] DESIGN.md + tokens.ts in sync (radius 6/8/12; connection status tokens).

---

## 9. Key Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| K1 | Keep ADR-020 / three-mode locks | Avoid product fork; fix presentation |
| K2 / D5′ | Retire permanent BottomBar **strip after** ContextPanelHost | Replace-before-remove; reclaim height |
| K3 | Composition = 「装配」 only (no Board) | ADR-020 Axis B; Board = Autonomy |
| K4 | StatusRail + FocusBand **state machine** | Hard priority; 急停 never buried |
| K5 | Quiet Agent Shell tokens | Consistent quiet-professional; AI-implementable semantics |
| K6 | No full Panel dark mode in P0 | Scope control; Cockpit already dark for L2 |
| K7 | Cockpit remains 确认台 | Existing user guide / branding |
| K8 | Abort never adjacent to Send | Thumb-zone / mis-tap safety |
| K9 | 装配 entry in P0 | Avoid slash-only discoverability cliff |

---

## 10. Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Full Figma redesign then rewrite | Slow; ontology already coded — polish shell first |
| Single “Work mode” toggle | Rejected in D1 three-mode; under-describes L1 vs L2 |
| Put Pack/MCP as Surface levels | Violates ADR-020 Composition axis |
| Move all confirm back to Panel modal | Violates D10′; 320px cannot hold preview |
| Emoji-heavy “friendly” chrome | Conflicts DESIGN.md quiet-professional |

---

## 11. Open Questions

| # | Question | Default if unanswered |
|---|----------|----------------------|
| Q1 | 装配 drawer: bottom sheet vs right overlay? | Bottom sheet (thumb-friendly, 320px) |
| Q2 | Cmd+K for 装配? | Yes if no conflict with OS |
| Q3 | Keep LogBar as ⋯ entry only? | Yes |
| Q4 | FleetStrip inside FocusBand vs only Cockpit? | FocusBand when multi-agent; else Cockpit |

---

## 12. PR Plan

### PR1 — StatusRail + offline hygiene + token connection colors
- Files: `App.tsx` Header→StatusRail, `tokens.ts`, **`DESIGN.md`** (radius SoT → 6/8/12; connection Material hexes → status tokens)  
- Replace offline `alert()`; no Material status dots in touched paths  
- Deps: none  
- Doc deltas for “底栏” copy: PR4/PR5  


### PR2 — ContextPanelHost extract (no strip delete)
- Files: peel host/registry/loaders/listener from `BottomBar.tsx` → `ContextPanelHost.tsx`  
- BottomBar becomes thin tab chrome calling Host  
- Deps: PR1  

### PR3 — FocusBand state machine
- Files: new `FocusBand.tsx`; wire ContextStrip / SafetyStrip / Fleet into priority table §4.3  
- Accept: L2+confirm keeps 急停 visible  
- Deps: PR1  

### PR4 — Composer chips + slash parity + 装配 P0 entry
- Files: ComposerDock chips; expand `META_PANEL_SLASH`; 装配 bottom-sheet section list → Host  
- Deps: PR2  

### PR5 — Hide/remove BottomBar strip (flag)
- Files: BottomBar strip only; default flag off after smoke  
- Deps: PR2, PR4  

### PR6 — Full 装配 drawer sections + visual density
- Files: `ComposeDrawer` sections; ChatView/tool cards; empty states  
- Board **not** in drawer  
- Deps: PR4  

### PR7 — Cockpit alignment + DESIGN.md semantic roles
- Files: cockpit shell; DESIGN.md  
- Deps: PR1, PR6  

Ship gate: **v2-P0 accept (PR1–PR4)** before strip removal (PR5).

---

## 13. Implementation boundaries

| Do | Don't |
|----|-------|
| Extract StatusRail / FocusBand / ComposerDock | Rewrite thread store |
| Soft-deprecate BottomBar behind flag if needed | Delete Cockpit content-split |
| Token-only new colors | New Material hex |
| Copy: 装配 / 确认台 / 聊·网页·计算机 | 中层 Agent |

---

## 14. Success metrics (honest)

| Metric | Scope |
|--------|--------|
| ChatStream ≥55% | L0 idle @ 640px panel height |
| ChatStream ≥40% | L1+confirm and L2+confirm @ 640px |
| FocusBand ≤80px | All levels |
| Pack/MCP path | ≤2 clicks **or** 装配 entry + section (documented) |
| Offline | No `alert()` on reconnect path (P0); other alerts tracked separately |
| Ontology | Zero「中层 Agent」in new UI copy; Board not under 装配 |
| Safety | 急停 visible whenever L2 task active |

---

## 15. Adversarial revision log (2026-07-31)

| Source | Verdict | Addressed |
|--------|---------|-----------|
| Critic A | MAJOR_REVISE | Board out of 装配; FocusBand hard cap; Host migration; D5′; height worst-case; PR resequence |
| Critic B | MAJOR_REVISE | Panel host gap; P0 装配 entry; FocusBand/急停; no Abort-by-Send; slash matrix; Esc stack; landfill one-surface rule |

---

## 16. References

- ADR-020 capability three axes  
- UI three-mode redesign 2026-07-26  
- docs/DESIGN.md tokens  
- confirm-center-user-guide.md  
- Agent UX principles (transparency, agency, progressive delegation) — industry 2025–26 synthesis  
- Semantic / agentic design systems (Figma semantic DS, Brad Frost agentic DS talks)

---

*End of design draft — awaiting adversarial critique then Claude+Pi dual-review.*
