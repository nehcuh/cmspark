# UI Redesign Brief — Three Capability Modes (L0/L1/L2)

> Status: Active design (post dual review amendments)  
> Date: 2026-07-26  
> Scope: Product UX / IA / interaction model for CMspark Side Panel + Cockpit  
> Not in scope: line-by-line code review, implementation plan, Computer Use SPI  
> Review: Claude + Pi → `APPROVE_WITH_CHANGES`; synthesis in `ui-three-mode-redesign-review-synthesis-2026-07-26.md`

---

## 1. Context

CMspark is a **browser-resident AI agent**: Chrome Side Panel ↔ WebSocket ↔ local Companion. Capabilities today include:

- Chat / streaming / threads
- Browser tools (CDP/tabs: navigate, click, form, cookies, page screenshot…)
- Computer Use (`host_computer`, desktop apps, coordinate injection, confirmations)
- Skills, Knowledge, MCP, Apps, Obsidian export, Mermaid, security confirmations, tray pairing

**Current UI pain (observed in product + code):**

- Side Panel ~320px is a **feature landfill**: Header + Chat + ComputerTaskBar + BottomBar (6 panels: Tabs/Hist/Skills/Know/MCP/Apps) + Input + multiple slideouts/modals
- One visual system extracted post-hoc (`docs/DESIGN.md`): flat `#4A90D9`, emoji icons, inline styles — tokens exist, **IA does not**
- Execution chrome (ComputerTaskBar, security dialogs, tool cards) **competes with conversation** in the same narrow surface
- Binary mental model “chat vs work” under-describes the product: **browser automation ≠ desktop computer use**

---

## 2. Locked product decisions (interview + dual-review amendments)

| ID | Decision |
|----|----------|
| D1 | **Three capability levels**: **L0 聊 · L1 网页 Agent · L2 Computer Use** (not binary chat/work) |
| D2 | **Progressive escalation** on the same thread: L0 → L1 → L2; **de-escalation has hysteresis** (not per-message) — only after quiescence timer or pin release + task-end |
| D3 | **Smart default** from tool activity, confirm queue, tray task entry; user can pin a level (pin blocks auto-down only; auto-up still allowed when safety requires larger surface) |
| D4 | **L2 primary focus** = live task; **pending confirmation elevates** over task chrome (in Cockpit) |
| D5 | Context tools: **mode-split + command-first** — L0: Skills/Know/Hist; L1 panel: Tabs + Skills; L2/cockpit: Tabs/Apps/MCP; low-freq → `/` + settings |
| D6 | **Mode signal first, full dual-skin later**: P0–P1 = persistent mode badge + header tint; P2 = L2 full dark HUD tokens. L0/L1 stay light quiet professional |
| D7 | **L2 content** = dual-track (step rail + compact dialogue); tool noise on step rail |
| D8 | **Surfaces**: L0 always Side Panel; **L2 requires Extension Cockpit window** (Companion native = roadmap) |
| D9′ | **L1 default stays in Side Panel**; Cockpit promote is **user-initiated only** (「展开工作区」). **No auto-promote by step count / screenshot density** in v1 |
| D10′ | **L2 panel safety strip (not chip-only)**: TaskChip + **mandatory one-click abort** + **minimal confirm** (tool, risk color, allow/deny/stop, “打开详情”). Heavy preview/nonce/whitelist live in Cockpit (**content-split confirm**) |
| D11′ | Closing Cockpit **hides surface, does not stop task**; managed close warning when task running; Panel Chip always reopens Cockpit |
| D12′ | **Input ownership**: L2 active → Cockpit is conductor for task instructions; Panel input = **follow-up queue** or non-task chat — **not parallel task send** |
| D13 | **Persistent mode badge** in header (L0/L1/L2) + short toast on escalate; transitions announced, not silent |
| D14 | **Confirm timeout policy** when unfocused (e.g. 60s auto-deny + toast); Panel always shows pending-confirm indicator if queue non-empty |
| D15 | **Define L2 task-end** before ModeController: prefer `task terminal state (ok/fail/aborted) + quiescence` over “last tool returned” |
| D16 | **Tray-initiated L2**: open/focus Cockpit; ensure Panel can open with TaskChip if only tray entry |

### Explicit non-decisions (open)

- L1 promoted cockpit vs L2: same window shell + theme swap? (decide after P1 data)
- Icon system (emoji → SVG) timing
- Full token refresh of `docs/DESIGN.md` (P2 with dual-skin)
- Companion native HUD (roadmap)
- Exact quiescence timer values (implementation knobs)

---

## 3. Model under review

### 3.1 CapabilityLevel × SurfaceLayout

```
CapabilityLevel:  chat (L0) | browser (L1) | computer (L2)
SurfaceLayout:    panel | cockpit

Rules:
  L0 → panel only
  L1 → panel default; cockpit only on user “expand workspace”
  L2 → cockpit required; panel keeps TaskChip + abort + minimal confirm
```

Do **not** model as a single boolean `isWorkMode`.

### 3.2 Escalation / de-escalation

```
L0 → L1: first browser tool call, or explicit “operate on this page” (+ toast + badge)
L1 panel → L1 cockpit: USER ONLY (“展开工作区”) — no auto heuristic in v1
L1 → L2: host_computer / desktop-class tools / tray CU task → open/focus Cockpit
L2 end → L1 if browser task still active, else L0 — only after task terminal + quiescence
User pin: blocks auto-down; auto-up still allowed for safety surfaces
```

### 3.3 Surface responsibilities

| Surface | L0 | L1 panel | L1 cockpit (user expand) | L2 cockpit | L2 panel |
|---------|----|----------|--------------------------|------------|----------|
| Full message timeline | ✓ | ✓ (+ tool cards) | compact dual-track | compact dual-track | ✓ dimmed ok |
| Current tab strip | — | ✓ | ✓ | optional | — |
| Step rail / screenshots | — | light (in cards) | ✓ light | ✓ dark HUD | — |
| Confirm minimal (4-line) | if needed | if needed | ✓ | ✓ | **always if queue** |
| Confirm heavy (preview/nonce) | rare inline | rare inline | ✓ preferred | ✓ elevated | link「详情」 |
| Abort | — | soft stop | ✓ | ✓ primary | **mandatory on Chip** |
| Context bar | Skills Know Hist | Tabs + Skills | Tabs Apps MCP | Tabs Apps MCP | minimal / hidden |
| Composer | normal | normal | normal | task conductor | follow-up queue |

### 3.3b Side Panel IA (§2) — vertical order

```
1 Header     — threads, mode badge (L0/L1/L2), connection, settings
2 ContextStrip — L1 only: current tab/target +「展开工作区」
3 SafetyStrip  — L2 or pending confirm: TaskChip + abort + minimal confirm
4 ChatStream   — primary scroll; tool cards denser in L1
5 ContextBar   — mode-split 2–3 entries + /
6 Composer     — L2 placeholder =「排队跟进…」
```

**Header declutter:** Craft / NotebookLM / logs → settings or `/` (not always-on icon row).
**ComputerTaskBar:** leave panel in P0; relocate to Cockpit in P1; L2 panel uses SafetyStrip only.

### 3.3c Cockpit IA (§3) — L2 (+ optional L1 expand)

**Window:** Extension page via `chrome.windows.create` (default ~720×560, resizable). One cockpit per active L2 task/thread (v1: single cockpit; multi-thread later).

**Vertical priority (top → bottom):**

1. **TitleBar** — product name, `L2 · LIVE` (or `L1 · 工作区`), thread id, **急停**, 收起/关闭  
2. **ConfirmElevated** — when queue non-empty: **always above TaskDock**; heavy preview, full_preview, nonce, whitelist, session-trust; queue index + timeout countdown  
3. **TaskDock** — one-line goal, progress, budget, layer badge (from existing ComputerTaskBar semantics)  
4. **DualTrack** — left: step rail (seq, status, caption, thumbs); right: compact dialogue (user + assistant conclusions only; tool noise stays left)  
5. **ContextBar** — Tabs / Apps / MCP  
6. **Composer** — **task conductor** (primary instruction path during L2)

**Confirm content-split (with Panel D10′):**

| Piece | Panel SafetyStrip | Cockpit ConfirmElevated |
|-------|-------------------|-------------------------|
| Tool name + risk color | ✓ | ✓ |
| Allow / Deny / Stop | ✓ | ✓ |
| Preview image / full_preview | — | ✓ |
| Nonce / whitelist / session-trust | — | ✓ |
| Queue depth | badge optional | ✓ index + timeout |

**Focus / timeout (D14):** on new confirm → `windows.update({ focused: true, drawAttention: true })`; Panel chip shows pending; unfocused timeout (e.g. 60s) → auto-deny + toast (policy knob).

**Close (D11′):** UI「收起」preferred; if task running, short managed warning that close ≠ abort; Panel Chip remains. OS chrome close → same state sync via `windows.onRemoved`.

**L1 expand reuse:** same shell, light skin, `L1 · 工作区` badge; no LIVE dark chrome required until P2 tokens.

**§1 amended decisions — APPROVED** (user 2026-07-26).  
**§2 Side Panel IA — APPROVED** (user 2026-07-26).  
**§3 Cockpit IA — APPROVED** (user 2026-07-26).

### 3.4 ModeController & interaction states (§4)

**Derive CapabilityLevel (highest wins):**

1. Active `host_computer` task ∨ tray CU entry ∨ L2-class confirm in queue → **L2**
2. Else browser tools within quiescence window ∨ explicit web-op → **L1**
3. Else → **L0**

**SurfaceLayout:** L2 → cockpit required (open/focus); L1 cockpit only on user expand; L0 → panel. Closing cockpit does not change CapabilityLevel.

**Transitions:**

| Direction | Timing | UX |
|-----------|--------|-----|
| Up (L0→L1→L2) | Immediate | Badge + toast; L2 opens cockpit |
| Down | After task terminal + quiescence (≈20–30s no L1/L2 tools) | Badge update; no toast spam |
| Pin | Blocks auto-down only | Manual override until unpin |

**Task end (D15):** `computer task` reaches terminal `ok | fail | aborted` (not merely last tool_result). Browser L1 “active” = last browser tool within quiescence window.

**Interaction states:**

| State | Behavior |
|-------|----------|
| Loading | Stream/tool indicators; L2 dock progress; abort always enabled |
| Empty | L0 welcome hints; L1 no-tab guidance; empty cockpit → “等待任务” + focus panel |
| Error | Recoverable (amber) vs hard block (red); step-row errors in L2 |
| Success | Terminal green strip; then eligible for down-level |
| Offline | Banner both surfaces; cockpit read-only; no new sends |
| Confirm pending | Both surfaces; timeout auto-deny (D14) |
| Follow-up queue | Panel composer neutral chrome + copy that delivery is queued |

**§4 ModeController — APPROVED** (user 2026-07-26).  
**§5 Visual language — APPROVED** (user 2026-07-26).  
**§6 Phasing & acceptance — APPROVED** (user 2026-07-26).  
**Full spec:** `docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md`

### 3.5 Visual language (§5)

**Principle:** mode legibility first; full dual-skin second (D6′).

#### Mode badge + header tint (P0–P1)

| Level | Badge label | Header treatment |
|-------|-------------|------------------|
| L0 聊 | `聊` · neutral gray pill | Default light chrome (`#f7f7f5` / white) |
| L1 网页 | `网页` · blue pill | Light blue header tint (`#eef4ff`) + primary accent `#4A90D9` / `#5b8def` |
| L2 计算机 | `计算机` · green-on-dark pill | Panel: dark SafetyStrip chip; Cockpit: dark shell + `LIVE` green `#4ade80` |

- Badge always visible in Panel header (and Cockpit titlebar).
- Escalate: short toast; transition ≤200ms; honor `prefers-reduced-motion`.
- Prefer text/geometry for **new** controls; do not add more emoji-only affordances.

#### Color roles (extend existing `docs/DESIGN.md`)

| Role | Light (L0/L1) | Dark (L2 Cockpit P1 shell / P2 tokens) |
|------|---------------|----------------------------------------|
| surface.bg | `#fff` / `#f7f7f5` | `#0f1115` / `#161a22` |
| text.primary | `#333` | `#e8eaed` |
| text.muted | `#999` | `#9aa0a6` |
| accent | `#4A90D9` | `#5b8def` |
| success / live | `#4CAF50` | `#4ade80` |
| warning | `#FF9800` | `#fbbf24` |
| danger / confirm | `#F44336` | `#f87171` / elevated `#2a1515` panel |
| border | `#e0e0e0` | `#2a2f3a` |

P1 may hardcode Cockpit dark shell; P2 migrates to semantic tokens resolving light/dark.

#### Typography / density

- Keep system UI stack; code/steps: SF Mono / ui-monospace.
- Panel body 13px; meta 11–12px; Cockpit step rail 11–12px mono.
- Radius: keep 6–8px; L2 cards slightly tighter padding for density.

#### Motion & a11y

- No skin flash loops; mode change is discrete swap.
- WCAG AA for body text both skins.
- Mode badge changes announced via `aria-live="polite"`.
- Risk/confirm never color-only (icon or text label required).

### 3.6 Phasing & acceptance (§6)

#### P0 — Mode awareness (no new window) · target 1–2 wk

**Ship:**

- `CapabilityLevel` enum + `ModeController` derivation from existing store signals
- Header mode badge + escalate toast
- BottomBar mode-split (L0: Skills/Know/Hist; L1: Tabs/Skills; hide/relabel rest behind `/` or settings)
- De-escalation hysteresis stub (configurable quiescence)

**Still in panel:** ComputerTaskBar, full security modal (no regression)

**Accept:**

- [ ] Pure chat stays L0 badge; first browser tool → L1 badge + toast within 1 turn
- [ ] `host_computer` active → L2 badge (even if chrome still in-panel)
- [ ] BottomBar does not show all 6 at once in L0
- [ ] No mode yo-yo on interleaved short assistant text (hysteresis)
- [ ] Existing chat / confirm / computer flows still work (regression)

#### P1 — L2 Cockpit MVP · target 2–3 wk

**Ship:**

- Cockpit extension page + `chrome.windows.create`
- Auto open/focus on L2; tray L2 init (D16)
- Dual-track + TaskDock (relocate ComputerTaskBar semantics)
- ConfirmElevated content-split; Panel SafetyStrip (abort + minimal confirm)
- Input ownership (D12′); close ≠ abort + Chip reopen
- Confirm timeout + drawAttention (D14)

**Accept:**

- [ ] L2 opens Cockpit; Panel shows Chip + **mandatory abort** + minimal confirm when queue non-empty
- [ ] Heavy preview/nonce only required path is Cockpit; Panel allow/deny still works
- [ ] Closing Cockpit mid-task: task continues; Chip reopens; abort from Panel works
- [ ] Panel composer during L2 does not race as second task conductor
- [ ] Dual-renderer state matches after SW restart / reconnect (rehydrate from companion)
- [ ] Offline: both surfaces show disconnect; no silent sends

#### P2 — Polish · target ~2 wk

**Ship:**

- L1「展开工作区」user-only cockpit (light shell)
- Semantic tokens + full L2 dark HUD
- Close-while-running managed warning; queue UX; pin affordance polish
- Optional user pin dark L0 (if cheap)

**Accept:**

- [ ] L1 expand never auto-fires from step count
- [ ] Tokenized skins: no hardcoded one-off colors in new components
- [ ] Reduced-motion: no jarring full-repaint animation
- [ ] AA contrast spot-check light + dark

#### P3+ roadmap

- Companion native HUD window
- SVG icon system / emoji retire
- Multi-cockpit / multi-thread windows
- MCP-as-mode only if usage data justifies

#### Out of scope for this redesign track

- Computer Use SPI / success contracts
- Thread model rewrite
- Full `App.tsx` rewrite unrelated to mode shells (bounded earned refactor only)

### 3.4 Controllers (implementation boundary)

- `ModeController` derives `(CapabilityLevel, SurfaceLayout)` from tools, task state, confirm queue, user pin
- Shared agent store (threads/messages/task/confirmations) — two renderers, one state
- Cockpit = extension page via `chrome.windows` (v1); native Companion window later

### 3.5 Relationship to existing code (evidence, not commitment)

- `chrome-extension/src/sidepanel/App.tsx` — monolithic shell (~1.4k LOC) + ComputerTaskBar + BottomBar six-pack
- `ComputerTaskBar.tsx` — L2-ish chrome currently **inside** panel
- `BottomBar.tsx` — Tabs/Hist/Skills/Know/MCP/Apps always available
- Security confirmation dialog in panel Modal today
- Product already distinguishes browser tools vs `host_computer` in companion/bridge

---

## 4. Goals / non-goals

**Goals**

1. User always knows **which capability layer** they are in (chat vs web agent vs computer)
2. Side Panel becomes excellent at L0/L1 short tasks; not a dumping ground for L2 HUD
3. L2 gets a real control surface (steps, confirm, abort, screenshots) without destroying chat
4. Progressive complexity matches agent capability growth mid-thread
5. Design stays implementable on current Extension + Companion topology

**Non-goals (this brief)**

- Redesigning Computer Use success contracts / SPI (separate briefs exist)
- Pixel-perfect visual system (tokens after IA lock)
- Replacing thread model or multi-thread semantics
- Shipping Companion native window in v1

---

## 5. Review questions (answer all)

1. **Is the L0/L1/L2 ontology correct** for CMspark, or should browser+computer collapse, or should a fourth mode exist (e.g. MCP-only / multi-agent)?
2. **Is progressive escalation on one thread sound**, or should L1/L2 be separate session types / threads?
3. **L1 promote-to-cockpit (decision D9/C)** — right default, or should L1 always stay panel-only until L2?
4. **Strict split (D10)** — does TaskChip-only panel during L2 create dangerous blind spots (missed abort, missed confirm, dual-input races)?
5. **Dual skin (D6)** — helpful mode signal or jarring / accessibility problem?
6. **Confirm elevation** — is “full confirm only on cockpit” acceptable given Chrome window focus issues?
7. **What would you reject or force-change** before any implementation plan?
8. **Phasing**: what is the smallest shippable slice that validates the model without a full rewrite?

---

## 6. Required output format

```markdown
# Review: UI Three-Mode Redesign

## Verdict
One of: APPROVE_DESIGN | APPROVE_WITH_CHANGES | REJECT_RETHINK

## Summary
(5–10 sentences)

## Answers to §5
### Q1 …
### Q2 …
…

## Must-fix before implementation
(numbered, ordered by severity)

## Nice-to-have / later
(bullets)

## Risks & failure modes
(especially multi-window focus, mode thrash, confirm missed)

## Suggested phasing
(P0 / P1 / P2 slices)

VERDICT: <same as above>
```

Be adversarial. Prefer shippable honesty over elegant diagrams. Cite repo evidence if you open files.
