# CMspark UI Redesign — Three Capability Modes (L0 / L1 / L2)

| Field | Value |
|-------|--------|
| Status | **Approved design** (interview + dual external review + section sign-off) |
| Date | 2026-07-26 |
| Brief | `docs/decisions/v1.3/ui-three-mode-redesign-brief-2026-07-26.md` |
| Reviews | Claude + Pi `APPROVE_WITH_CHANGES` → synthesis `docs/decisions/v1.3/ui-three-mode-redesign-review-synthesis-2026-07-26.md` |
| Surfaces | Chrome Side Panel + Extension Cockpit window (Companion native HUD = roadmap) |

---

## 1. Problem

Side Panel (~320px) is a **feature landfill**: chat, ComputerTaskBar, six-panel BottomBar, heavy security modals, and slideouts compete in one column. A binary “chat vs work” mental model under-describes the product: **browser automation ≠ desktop computer use**. Tokens in `docs/DESIGN.md` exist; **information architecture does not**.

---

## 2. Product model

### 2.1 Three capability levels (progressive)

| Level | Name | Capability | Default surface |
|-------|------|------------|-----------------|
| **L0** | 聊 | Q&A, writing, planning; little/no control | Side Panel |
| **L1** | 网页 Agent | Browser tools (tabs, navigate, click, forms, cookies, page shots) | Side Panel; **user** may expand to Cockpit |
| **L2** | Computer Use | `host_computer` / desktop; steps, screenshots, session trust | **Cockpit required**; Panel keeps safety strip |

Same **thread** and **agent store**. Level and surface change with scenario complexity — not three separate apps.

### 2.2 Locked decisions

| ID | Decision |
|----|----------|
| D1 | L0 / L1 / L2 ontology (not binary chat/work) |
| D2 | Progressive escalation; **de-escalation hysteresis** (quiescence or pin release + task end) |
| D3 | Smart default from tools / confirm queue / tray; pin blocks auto-down only |
| D4 | L2 primary focus = live task; pending confirm elevates over task chrome **in Cockpit** |
| D5 | Context tools mode-split + command-first (`/` + settings for low-freq) |
| D6 | Mode signal first (badge + tint); full dual-skin dark HUD in **P2** |
| D7 | L2 dual-track: step rail + compact dialogue |
| D8 | L2 = Extension Cockpit via `chrome.windows`; Companion native = roadmap |
| D9′ | L1 Cockpit = **user-initiated only** (「展开工作区」); **no** auto-promote by step count |
| D10′ | L2 Panel = TaskChip + **mandatory abort** + **minimal confirm** (content-split) |
| D11′ | Close Cockpit ≠ stop task; managed warning when running; Chip reopens |
| D12′ | L2 input ownership: Cockpit = conductor; Panel = follow-up queue / non-task chat |
| D13 | Persistent mode badge + escalate toast; no silent escalation |
| D14 | Confirm timeout when unfocused (e.g. 60s auto-deny + toast); pending indicator both surfaces |
| D15 | L2 task-end = terminal `ok \| fail \| aborted` + quiescence (not last tool_result alone) |
| D16 | Tray-initiated L2 opens/focuses Cockpit; Panel can show Chip |

### 2.3 Explicit non-goals

- Computer Use SPI / success-contract redesign (separate briefs)
- Thread model rewrite
- Companion native HUD in v1
- Unrelated App.tsx rewrite beyond mode shells

---

## 3. Architecture

### 3.1 Controllers

```
CapabilityLevel:  chat | browser | computer     // L0 | L1 | L2
SurfaceLayout:    panel | cockpit

ModeController → (CapabilityLevel, SurfaceLayout)
  from: tool activity, computer task state, confirm queue, tray entry, user pin
```

Do **not** use a single boolean `isWorkMode`.

Shared store: threads, messages, tasks, confirmations. **Two renderers, one state.** Companion remains source of truth; surfaces rehydrate on reconnect / SW restart.

### 3.2 Level derivation (highest wins)

1. Active `host_computer` task ∨ tray CU entry ∨ L2-class confirm → **L2**
2. Else browser tools within quiescence ∨ explicit web-op → **L1**
3. Else → **L0**

### 3.3 Transitions

| Direction | Timing | UX |
|-----------|--------|-----|
| Up | Immediate | Badge + toast; L2 opens/focuses Cockpit |
| Down | Task terminal + quiescence (~20–30s, configurable) | Badge only (no toast spam) |
| Pin | User | Blocks auto-down until unpin |

Closing Cockpit does **not** change CapabilityLevel.

---

## 4. Side Panel IA (§2)

### Vertical order (fixed)

1. **Header** — threads, **mode badge**, connection, settings  
2. **ContextStrip** — L1 only: current tab/target +「展开工作区 ↗」  
3. **SafetyStrip** — L2 or pending confirm: Chip + abort + minimal confirm  
4. **ChatStream** — primary scroll; denser tool cards in L1  
5. **ContextBar** — 2–3 mode-split entries + `/`  
6. **Composer** — L2 placeholder:「排队跟进…」

### Per level

| | L0 | L1 | L2 (panel) |
|--|----|----|------------|
| Badge | 聊 | 网页 | 计算机 |
| Middle | Chat only | ContextStrip + tool cards | SafetyStrip; chat may dim |
| ContextBar | Skills · Know · Hist | Tabs · Skills | Minimal / hidden |
| Composer | Normal | Normal | Follow-up queue |

**Header declutter:** Craft / NotebookLM / logs → settings or `/`.

**ComputerTaskBar:** remains in panel for **P0**; relocates to Cockpit in **P1**.

---

## 5. Cockpit IA (§3)

**Window:** extension page, default ~720×560, resizable. v1: one cockpit for active L2 task/thread.

### Vertical priority

1. **TitleBar** — name, `L2 · LIVE` (or `L1 · 工作区`), thread, **急停**, 收起  
2. **ConfirmElevated** — if queue non-empty, **always above** TaskDock  
3. **TaskDock** — goal, progress, budget, layer  
4. **DualTrack** — left steps/screenshots; right user + assistant conclusions  
5. **ContextBar** — Tabs · Apps · MCP  
6. **Composer** — task conductor  

### Confirm content-split

| Piece | Panel SafetyStrip | Cockpit ConfirmElevated |
|-------|-------------------|-------------------------|
| Tool + risk color | ✓ | ✓ |
| Allow / Deny / Stop | ✓ | ✓ |
| Preview / full_preview | — | ✓ |
| Nonce / whitelist / session-trust | — | ✓ |
| Queue + timeout | optional badge | ✓ |

On new confirm: `windows.update({ focused: true, drawAttention: true })`. Unfocused timeout → auto-deny + toast.

**L1 expand:** same shell, light skin, user-only.

---

## 6. Interaction states (§4)

| State | Behavior |
|-------|----------|
| Loading | Stream/tool indicators; L2 progress; **abort always enabled** |
| Empty | L0 welcome; L1 no-tab guidance; empty cockpit → 等待任务 |
| Error | Recoverable (amber) vs hard (red); step-row errors in L2 |
| Success | Terminal green; then eligible for down-level |
| Offline | Banner both surfaces; cockpit read-only; no new sends |
| Confirm pending | Both surfaces; timeout policy |
| Follow-up queue | Neutral panel composer + queued delivery copy |

---

## 7. Visual language (§5)

### Mode signal (P0–P1)

| Level | Badge | Header |
|-------|-------|--------|
| L0 | Neutral `聊` | Default light |
| L1 | Blue `网页` | `#eef4ff` tint + accent |
| L2 | Green `计算机` + LIVE | Dark SafetyStrip / Cockpit shell |

### Token direction

- Extend `docs/DESIGN.md` with semantic roles (`surface.bg`, `text.primary`, `risk.*`, `status.live`).
- P1: Cockpit may use hardcoded dark shell.  
- P2: resolve light/dark from tokens; full L2 HUD.  
- Transitions ≤200ms; `prefers-reduced-motion`; WCAG AA body; badge `aria-live="polite"`; risk never color-only.  
- New controls: text/geometry over emoji-only.

---

## 8. Phasing & acceptance (§6)

### P0 — Mode awareness (1–2 wk, no new window)

**Deliver:** ModeController, badge, toast, BottomBar split, hysteresis stub.  
**Keep:** ComputerTaskBar + full confirm modal in panel.

**Accept:**

- [ ] Chat → L0; first browser tool → L1 badge + toast  
- [ ] Active `host_computer` → L2 badge  
- [ ] L0 BottomBar not full six-pack  
- [ ] No mode yo-yo on short interleaved text  
- [ ] No regression on chat / confirm / computer flows  

### P1 — L2 Cockpit MVP (2–3 wk)

**Deliver:** Cockpit window, dual-track, content-split confirm, Panel safety strip, input ownership, tray open, timeout, rehydrate.

**Accept:**

- [ ] L2 opens Cockpit; Panel has Chip + **mandatory abort** + minimal confirm  
- [ ] Heavy preview path in Cockpit; Panel allow/deny still works  
- [ ] Close Cockpit mid-task: continues; Chip reopens; Panel abort works  
- [ ] Panel is not parallel task conductor  
- [ ] SW restart / reconnect: state matches companion  
- [ ] Offline: both surfaces, no silent sends  

### P2 — Polish (~2 wk)

**Deliver:** L1 expand (user-only), semantic tokens + dark HUD, close warning, queue UX, pin polish.

**Accept:**

- [ ] L1 expand never auto from step count  
- [ ] New components use tokens  
- [ ] Reduced-motion / AA spot-check  

### P3+

Companion native HUD · SVG icons · multi-window · MCP-as-mode if data justifies.

---

## 9. Implementation boundaries

| Module | Responsibility |
|--------|----------------|
| `ModeController` | Derive level + surface; pin; hysteresis timers |
| `TaskChip` / `SafetyStrip` | Panel L2 safety (abort, minimal confirm, reopen) |
| `CockpitApp` | Extension page shell; dual-track; ConfirmElevated |
| Shared store / WS | Single writer discipline for sends; companion authority |
| BottomBar | Mode-filtered tabs |

Bounded refactor of `App.tsx` monolith only as required to host shells — no opportunistic rewrite.

---

## 10. Open knobs (implementation, not product forks)

- Quiescence seconds (default 20–30)  
- Confirm timeout seconds (default 60)  
- Whether L1-expanded and L2 share one window instance with theme swap (decide after P1)  
- Exact follow-up queue flush rules when Cockpit regains focus  

---

## 11. Approval log

| Section | Status |
|---------|--------|
| §1 Shell + three modes (post-review) | Approved |
| §2 Side Panel IA | Approved |
| §3 Cockpit IA | Approved |
| §4 State machine + interaction states | Approved |
| §5 Visual language | Approved |
| §6 Phasing + acceptance | Approved |
| Dual review amendments | Incorporated (D9′–D16) |

---

## 12. Next step

Create an **implementation plan** (writing-plans / P0-first vertical slice) starting with ModeController + badge + BottomBar split, with no Cockpit dependency.
