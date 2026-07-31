# Adversarial Review B — Side Panel UI/UX Redesign v2  
## Interaction & Implementation Risk (not brand aesthetics)

| Field | Value |
|-------|--------|
| **Verdict** | **MAJOR_REVISE** |
| Date | 2026-07-31 |
| Spec | [`docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md`](../../superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md) |
| Critic focus | Task success after BottomBar removal · discoverability · FocusBand priority · metrics · PR sequencing · landfill re-entry |
| Code cross-check | `BottomBar.tsx`, `App.tsx`, `mode-controller.ts`, `SafetyStrip.tsx`, `MinimalConfirm.tsx`, `FleetStrip.tsx`, `docs/confirm-center-user-guide.md`, `docs/mission-pack-usage.md` |
| Evidence tags | `[inspected]` static code · `[spec]` design claims · `[assumed]` unproven product behavior |

---

## Verdict: MAJOR_REVISE

Direction (quiet shell, chat height, command-first Composition, keep D10′ content-split) is sound and consistent with ADR-020 / three-mode locks. **Do not ship PR2 “retire BottomBar” as written.** The draft under-specifies the **panel host** that replaces BottomBar, leaves a **P0→P1 discoverability hole** for Packs/MCP/workspace, and treats FocusBand priority as prose rather than a hard state machine. Those are shippability defects, not polish nits.

Not **BLOCK**: ontology, confirm content-split, Cockpit, and mode derivation are correctly frozen. Not **APPROVE** / **MINOR**: without the must-change list below, implementers will either regress task paths or re-grow strip stack under a new name.

---

## Blocking

*(Issues that must be resolved in the design doc before dual-review sign-off and before any PR that removes BottomBar. Not “stop the entire redesign.”)*

### B1. BottomBar is the panel **host**, not only a tab strip — PR2 has nowhere to render Packs/MCP/Skills

**Reality today `[inspected]`:** `BottomBar.tsx` owns:

1. Primary + overflow tab chrome  
2. `activePanel` state and panel body (`PacksPanel`, `McpPanel`, `SkillsPanel`, …)  
3. `loadPanelData()` side effects (`pack.list`, `mcp.list`, …)  
4. The only listener for `cmspark:open-context-panel` (slash meta path in `App.tsx` `META_PANEL_SLASH` → `CustomEvent`)

**Spec claim `[spec]`:** §4.1 / K2 / PR2 retire permanent BottomBar; chips + `/` parity; 装配 drawer only in PR4.

**Gap:** PR2 says “Keep panel openers for Skills/Know/… via chips” but does **not** name a replacement host component, max height, close semantics, or where slash events land if BottomBar unmounts. If BottomBar is deleted without a host:

| Task | Path breaks? |
|------|----------------|
| Chat | No (ChatView independent) |
| Confirm dangerous tool | No (`SafetyStrip` / `MinimalConfirm` independent) |
| L2 abort | No (`SafetyStrip` abort / OS hotkey) |
| Open packs / workspace pick | **Yes** — `PacksPanel` only mounted under BottomBar |
| MCP list / add server flow | **Yes** — `McpPanel` + form wiring via that tree |
| Slash `/packs` `/mcp` `/board` | **Yes** — event listener dies with BottomBar |

**Required before dual-review:** Specify explicitly for P0:

- `ContextPanelHost` (name free) that mounts the same panel components, driven by chips + slash + later drawer  
- Lifecycle: open / Esc close / loadPanelData parity  
- Soft-flag: BottomBar strip off, host on — or **do not land PR2 until host ships in the same PR**

Without this, “retire BottomBar” is not a refactor; it is an incomplete feature amputation.

---

### B2. P0 acceptance “Pack/MCP ≤ 2 clicks” is false under the chip tables

**Chip tables `[spec]` §4.4:**

| Level | Chips (≤3) | Packs? | MCP? |
|-------|------------|--------|------|
| L0 | Skills · Know · Hist | ❌ | ❌ |
| L1 | Tabs · Skills · 工作区 | ❌ | ❌ |
| L2 | 确认台 · Abort link | ❌ | ❌ |

**P0 deliverables `[spec]` §8:** StatusRail, remove BottomBar, chips + `/` parity, FocusBand — **no 装配 drawer** (P1).

**Today `[inspected]`:** Packs/MCP/Board are overflow under「更多」— still **clickable without memorizing `/packs`**. Docs (`mission-pack-usage.md` §1) teach “底栏 … 任务包”.

**After P0 as written:**

- Mouse-only / non-command users lose the **visible** Pack/MCP entry until P1 drawer  
- “≤ 2 clicks from chat” (`§14`) only holds if an unlabeled overflow chip or permanent「装配」button is in P0 — neither is in the P0 accept list  
- `/` is **not a click**; it is a command vocabulary regression for the same population that already struggles with 功能杂

**Required:** Either:

1. **Pull a minimal 装配 entry into P0** (single button → bottom sheet with section list; content can be thin), **or**  
2. **Demote P0 scope:** keep BottomBar overflow (or a single「更多」) until drawer ships; measure chat height with overflow collapsed, **or**  
3. Rewrite metrics: “≤ 2 clicks **or** one `/` command from palette with discoverable labels in empty state”

Ship order “kill strip first, discoverability later” will produce support load and doc thrash (`mission-pack-usage`, confirm-center cross-links).

---

### B3. FocusBand “priority” is not a conflict-safe state machine; L2 abort must not be demoted

**Today stacking `[inspected]` (`App.tsx`):**

```text
Header
ContextStrip?          // L1
SafetyStrip?           // L2 task OR any pending confirm (includes MinimalConfirm + 急停)
ChatView
FleetStrip             // visible when workers|locks|intents|pending|expanded
BottomBar
InputArea
```

Critical cases already co-occur:

1. **L2 task running + pending confirm** — `SafetyStrip` shows TaskChip + **急停** + `MinimalConfirm` (enterprise trust row possible).  
2. **Any pending confirm** — `FleetStrip` treats `pending > 0` as visible (`FleetStrip.tsx` L41), so **Confirm chrome + Fleet strip stack** even for single-agent.  
3. **Multi-worker + confirm + L2** — three chrome families compete for vertical space.

**Spec `[spec]` §4.3:**

- “0–2 rows”  
- “Confirm elevates over task chrome”  
- “Fleet never stacks *below* Confirm as a second full bar — merge into one FocusBand with internal priority”  
- Table still lists separate max heights for Confirm (~56), L2 (~48), Fleet (~40)

**Unanswered (must write as ordered rules):**

| # | Scenario | Must remain one-gesture | Spec answer today |
|---|----------|-------------------------|-------------------|
| 1 | L2 + confirm | **急停** + allow/deny | “Confirm elevates” can be read as **hiding** task/abort row |
| 2 | Confirm + fleet pending | Deny vs stop-all vs open 确认台 | Not ordered |
| 3 | L1 ContextStrip + confirm | Tab chip + MinimalConfirm | Wireframe shows **two** FocusBand rows — contradicts “0–2” under load |
| 4 | Esc | MinimalConfirm: Esc → **deny** (`MinimalConfirm.tsx`); BottomBar: Esc → close panel; drawer/palette will add more | §6.2 “priority stack” lists drawer/palette/popover only — **omits confirm deny** |

**Three-mode lock D10′ `[inspected]`:** Panel L2 = TaskChip + **mandatory abort** + minimal confirm. FocusBand merge **must not** reinterpret “confirm elevates” as “abort optional.”

**Required in spec:**

```text
FocusBand priority (hard):
  P0  MinimalConfirm (queue head) — always full row when pending
  P0  L2 Abort control — always visible when computerTask active & not finished
      (may share the confirm row as a trailing control; must not require expand)
  P1  L2 TaskChip / progress (may compress when confirm present)
  P2  Enterprise trust chip (may fold under confirm)
  P3  ContextStrip (L1) — hide or collapse to single tab chip when P0 active
  P4  Fleet compact — suppress when pending==0 && workers==0; when pending>0
      do NOT open a second bar: badge on confirm row or 确认台 affordance only
Esc stack (hard):
  1. slash popover close
  2. 装配 / thread popover / drawer close
  3. context panel host close
  4. MinimalConfirm deny (only if no higher overlay)
  Never: Esc closes drawer AND denies in one keypress without defined order
```

Wireframe §5.5 showing two FocusBand rows under L1+confirm must be reconciled with max-height budget or acceptance will fail at L1+evaluate.

---

## Major

### M1. L2 Composer chips place “Abort” next to Send — contradicts own density / safety rules

**Spec `[spec]`:**

- §1.3: “destructive actions never next to Send”  
- §4.4 L2 chips: `确认台 · Abort link`

**Reality `[inspected]`:** Abort already lives in `SafetyStrip` (correct elevation, dark surface, away from composer). Duplicating Abort as a chip **above** the textarea re-introduces mis-tap risk and dual affordances (chip vs 急停 vs Ctrl+Alt+End).

**Fix:** L2 chips = `确认台` only (or “打开确认台”); **never** Abort in ComposerDock. Keep Abort exclusively in FocusBand Safety row.

---

### M2. Slash “parity” is incomplete even today — retiring BottomBar amplifies it

**Today `[inspected]` `META_PANEL_SLASH`:** only `packs`, `board`, `mcp`.  
Not meta-slash: skills, knowledge, history, tabs, apps. Those rely on **visible** BottomBar primary tabs at L0/L1.

**P0 chips** restore L0 Skills/Know/Hist and L1 Tabs/Skills — good.  
**Apps**, full **Board** browse, **MCP server add**, **Pack module enable + workspace.pick** remain:

- command-only until drawer, or  
- orphaned if slash listener/host missing (B1)

**Fix:** Expand meta slash table in the same PR as host (`/skills` `/knowledge` `/history` `/tabs` `/apps` `/board` `/packs` `/mcp` `/装配`), and update copy that still says “底栏「更多」”.

---

### M3. PR sequencing creates a product regression window and merge conflict magnet

| PR | Hazard |
|----|--------|
| PR2 before PR4 | Composition discoverability cliff (B2) |
| PR2 + PR3 both touch `App.tsx` shell | Parallel deps on PR1 only → conflict / double rewrite of layout |
| PR2 without host | Broken slash + no panels (B1) |
| “Soft-deprecate flag” in §13 | If flag leaves **strip + chips**, density is **worse** than today — landfill during migration |
| PR5 visual pass independent of FocusBand | Easy to polish bubbles while safety stack still broken |

**Fix sequencing (recommended):**

1. **PR1** StatusRail + offline banner (no structural IA cut)  
2. **PR2a** `ContextPanelHost` + move slash listener + optional collapse of tab *strip only* behind flag (panels still open)  
3. **PR2b / PR3** FocusBand merge with hard priority tests  
4. **PR2c** Remove permanent tab row only when chips + 装配 **entry** exist  
5. **PR4** Full 装配 sections  
6. Visual / Cockpit as planned  

Acceptance for “no permanent BottomBar” must be **gated on host + one Composition entry**, not on strip deletion alone.

---

### M4. Acceptance metrics are partly unmeasurable / over-scoped

| Metric | Problem |
|--------|---------|
| ChatStream ≥55% at 640px L0 | Measurable with DevTools; **must define chrome set** (empty FocusBand, chips only, no drawer, no logs). Good for L0 only — silent on L1+confirm where users most need chat. |
| Pack/MCP ≤2 clicks | Fails under P0 chip tables (B2); no instrumentation |
| Zero `alert()` in extension UI | Spec P0 only kills offline `alert` in `App.tsx` L204. **Many remain** `[inspected]`: BottomBar skill import, ThreadList, NotebooklmImporterPanel, logs path prompts. Claiming “zero alert()” without inventory is false marketing. |
| 10-min first-run / 3 users | Aspirational; not a gate |
| “No regression: confirm content-split, L2 Cockpit open, abort” | Checkbox only — no scenario list or test file pointers |

**Fix:**

- Split metrics: **L0 height** (gate) vs **L1+confirm height floor** (e.g. ChatStream ≥35% or FocusBand max px)  
- `alert()` inventory: P0 = connection/reconnect paths; track remaining as P1 debt table  
- Manual regression script (10 bullets): allow/deny/nonce-redirect, L2 abort ack timeout, fleet stop-all, `/packs` workspace pick, MCP list, Esc stack  

---

### M5. FleetStrip visibility rule fights FocusBand merge

**Today `[inspected]`:** `visible = workerCount > 0 \|\| lockCount > 0 \|\| openIntents > 0 \|\| pending > 0 \|\| expanded`.

Any security confirm forces Fleet chrome even with zero workers — **confirmed landfill residual** from multi-agent work. Spec Q4 defaults “FocusBand when multi-agent” but does not **delete** `pending > 0` from Fleet visibility.

**Fix:** Spec must say: remove `pending > 0` from FleetStrip show condition; pending is owned by MinimalConfirm / 确认台. Keep stop-all only when `workerCount > 0`.

---

### M6. Docs and user-facing contracts lag the IA cut

User guides still teach BottomBar:

- `mission-pack-usage.md` §1: 底栏「任务包」  
- `confirm-center-user-guide.md`: FleetStrip / SafetyStrip naming (OK if components rename carefully)  
- `META_PANEL_SLASH` descriptions: “底栏「更多」”  
- Claude.md / Agents.md common issues: Side Panel → **任务包**

**Fix:** P0/P1 PR checklist must include doc delta for pack/MCP/workspace paths; otherwise dual-review “no product contradiction” fails in the field even if ADR-020 holds.

---

### M7. 装配 drawer can re-introduce 320px landfill under a new label

**Risk vectors `[spec]` + code:**

- Six sections (Skills / Knowledge / Packs / MCP / Apps·user-env / Board) in a bottom sheet ≈ old BottomBar + more  
- `BottomBar` panel already uses `maxHeight: 320` with sticky header — comment admits Apps form was unusable at 200px; drawer will fight ChatStream ≥55% the moment it opens (acceptable if **modal** and chat height metric is idle-only — **state that**)  
- Chip overflow → drawer encourages growing chip count past 3  
- Soft-flag dual path (strip + chips + drawer) = three Composition UIs  
- Empty-state intent chips + ContextChips +「装配」button + StatusRail ⋯ = chrome creep at L0  

**Guardrails to write into §4.5 / acceptance:**

- Drawer open: ChatStream metric **waived**; idle L0 metric applies only when drawer closed  
- Max **one** secondary surface at a time (drawer **or** context panel host **or** settings — not stacked)  
- Board section hidden unless multi-worker active **or** user pin (spec says this; make it a test)  
- No second permanent tab row inside drawer (accordion or single section list, not 6 icon tabs mimicking BottomBar)  

---

## Minor

### m1. Offline hygiene is good; incomplete relative to “structured recovery”

Replacing reconnect `alert()` with banner is correct (P5). Spec should also name: disable send while disconnected (partially true via connection state), and stop using `window.confirm` for fleet stop-all without a quiet in-panel confirm (still `window.confirm` in `FleetStrip.tsx` L47) — same “breaks in-extension tone” class.

### m2. Connection tokens already partially migrated

`App.tsx` Header status dot already uses `tokens.success|warning|danger` `[inspected]`, not Material `#4CAF50`. Pain audit §3 overstates “Material dots in code paths” for the main Header; residual hex may live in FleetStrip (`#f59e0b`, `#34d399`) and L2 header tints. Scope PR1 to **inventory residual hex**, not “migrate Header from Material.”

### m3. Cmd+K / Q2 unresolved under real Chrome OS shortcuts

Side panel focus + Chrome reserved keys: default “Yes if no conflict” is fine, but P0 should not block on Cmd+K. Prefer `/` + 装配 button only until spike.

### m4. Mode badge `aria-live` and 44×32 confirm targets

Good a11y goals; MinimalConfirm layout is already dense — specify whether hit-target growth is allowed to exceed ~56px FocusBand budget (tension with height metric).

### m5. Pin mode buried in ⋯ menu

Today pin is on ModeBadge in Header. Spec §4.2 puts pin in Menu (⋯). That is a **discoverability regression** for power users who pin L1 during long browser work. Prefer keep pin on badge (current).

### m6. “工作区” chip at L1

Workspace bind lives inside `PacksPanel` (`workspace.pick`) `[inspected]`. L1 chip「工作区」implies a first-class panel; without defining whether it opens Packs section, a stub, or Settings, implementers will invent a fourth panel.

---

## Strengths

1. **Correct freeze of product forks** — ADR-020 axes, D1–D16, D10′ content-split, no confirm modal back into 320px, Pack cannot relax globals. Avoids the usual redesign temptation to re-litigate mode ontology.  
2. **Honest pain audit** — vertical strip stack is real; `App.tsx` order matches the diagram; offline `alert()` is real.  
3. **Composition naming「装配」** — makes axis B legible without a fake fourth Surface; aligns with mission-pack / MCP as attach-to-thread, not “deeper agent.”  
4. **Chat height as acceptance metric** — rare and useful; forces thrift better than aesthetic review alone.  
5. **Slash already exists (S1)** — `META_PANEL_SLASH` + `cmspark:open-context-panel` is the right extension point; redesign builds on shipped infrastructure rather than inventing a second command system.  
6. **Confirm-center contract respected** — dual-track, nonce only in Cockpit, close Cockpit ≠ stop task; user guide promises can remain true if FocusBand keeps abort + minimal allow/deny.  
7. **Phased PR intent** — shell before visual; Cockpit polish last — right risk order *if* Composition entry is not deferred past strip removal (see M3).  
8. **Non-goals** — no HUD redesign, no thread rewrite, no full App rewrite — bounds blast radius.

---

## Must-change list before dual-review

Spec edits required in `2026-07-31-sidepanel-uiux-redesign.md` (or a locked delta) before Claude+Pi dual-review:

1. **§4 / PR2 — Panel host contract**  
   - Name host component; ownership of `activePanel`, `loadPanelData`, slash event  
   - Rule: BottomBar **strip** may die only when host is live in the same release train  

2. **§8 P0 — Composition entry**  
   - Add P0 accept: permanent or composer-adjacent「装配」control that lists Packs / MCP / Skills / … (can open host sections before full drawer polish)  
   - Or explicitly keep overflow「更多」until P1 and drop “no permanent BottomBar” from P0  

3. **§4.3 — FocusBand state machine**  
   - Paste hard priority + Esc stack from B3  
   - Explicit: L2 **急停** always visible with active task; not demoted by confirm  
   - Explicit: Fleet does not show solely because `pending > 0`  

4. **§4.4 — Remove Abort from L2 chips**  
   - Align with “destructive never next to Send”  

5. **§12 — Resequence PRs**  
   - Host → FocusBand priority → strip removal → full drawer  
   - Forbid soft-flag dual chrome (strip+chips) for more than a behind-flag dev build  

6. **§14 — Metrics honesty**  
   - L0 height gate with fixed chrome matrix  
   - L1+confirm height floor or FocusBand max px  
   - `alert()` scope = inventory, not blanket zero  
   - Manual regression script for confirm / abort / packs workspace / slash  

7. **§4.5 — Landfill guards**  
   - One secondary surface at a time  
   - Drawer open waives chat-height metric  
   - Board section gated  
   - No 6-tab BottomBar clone inside drawer  

8. **Docs delta checklist**  
   - `mission-pack-usage.md`, slash descriptions, troubleshooting “任务包” path  

9. **§4.2 — Keep mode pin on badge** (or justify regression)  

10. **§4.4 L1「工作区」chip** — define exact open target (Packs/workspace subsection)

---

## Task-success matrix (post-BottomBar, if must-changes land)

| User task | Survives P0? | Condition |
|-----------|--------------|-----------|
| Chat L0 | ✅ | StatusRail + ChatStream + Composer only |
| Confirm dangerous tool (allow/deny) | ✅ | FocusBand MinimalConfirm; Esc deny ordered |
| Confirm with nonce / whitelist | ✅ | Still Cockpit only (unchanged) |
| L2 abort | ✅ | FocusBand 急停 mandatory; not composer chip |
| Open packs + select workspace | ⚠️ → ✅ | **Needs host + 装配 or retained 更多** (B1/B2) |
| Use MCP panel | ⚠️ → ✅ | Same |
| Multi-agent stop-all | ✅ | Fleet only when workers>0; not on every confirm |
| Find skills without `/` | ✅ | L0 chips if host opens SkillsPanel |

---

## Code anchors (absolute)

| Concern | Path |
|---------|------|
| Shell stack | `/Users/huchen/Projects/cmspark/chrome-extension/src/sidepanel/App.tsx` (~L167–198, META_PANEL_SLASH ~L37–63, slash open ~L638–647, offline alert ~L204) |
| Panel host + slash listener | `/Users/huchen/Projects/cmspark/chrome-extension/src/sidepanel/components/BottomBar.tsx` (~L72–125, L378–400) |
| Level / overflow IA | `/Users/huchen/Projects/cmspark/chrome-extension/src/sidepanel/mode/mode-controller.ts` (`contextBarTabsForLevel`, `contextBarOverflowTabsForLevel`) |
| L2 abort + confirm | `/Users/huchen/Projects/cmspark/chrome-extension/src/sidepanel/components/SafetyStrip.tsx`, `MinimalConfirm.tsx` |
| Fleet show-on-pending | `/Users/huchen/Projects/cmspark/chrome-extension/src/sidepanel/components/FleetStrip.tsx` (~L39–44) |
| Confirm UX promises | `/Users/huchen/Projects/cmspark/docs/confirm-center-user-guide.md` |
| Packs entry docs | `/Users/huchen/Projects/cmspark/docs/mission-pack-usage.md` §1 |

---

## Bottom line

Redesign v2 correctly aims at strip thrift and Composition legibility. **Interaction risk is concentrated in the cut that removes BottomBar before a host + discoverable 装配 path exist, and in an underspecified FocusBand that can violate D10′ abort guarantees under confirm+fleet load.** Fix those in the draft, resequence PRs, and dual-review can proceed; aesthetic token work can wait.

**Verdict: MAJOR_REVISE** — not a product strategy reject; a shippability gate on IA migration mechanics.
