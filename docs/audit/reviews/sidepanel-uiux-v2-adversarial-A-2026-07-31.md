# Adversarial UX/Product Critique — Side Panel UI/UX Redesign v2

| Field | Value |
|-------|--------|
| Doc under review | `docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md` |
| Critic role | Independent adversarial UX/product (stress-test, not rubber-stamp) |
| Date | 2026-07-31 |
| Comparators | ADR-020 (accepted), three-mode redesign 2026-07-26 (D1–D16), `docs/DESIGN.md`, `chrome-extension/src/sidepanel/App.tsx` |

---

## Verdict: MAJOR_REVISE

Direction is right: collapse strip stack, make Composition legible as「装配」, keep Surface L0/L1/L2 + content-split confirm, no new runtime. **Do not implement as written.** Ontology slip (Board inside Composition plane), height-budget self-contradiction, BottomBar migration under-specified against a ~1k-line panel host, and acceptance criteria that claim more than they measure would ship a quieter shell with broken discoverability and ADR-020 narrative debt.

Not **BLOCK**: no fourth axis, no「中层 Agent」product fork, D10′ content-split preserved, L1 expand remains user-only. Fix the issues below, then dual-review again.

---

## Blocking issues (must fix)

### B1. Board is Autonomy — not a section of「装配」(Composition)

**Evidence**

- Spec §4.5 lists **Board** as section 6 of **装配 Drawer (Composition plane)** with Skills / Knowledge / Packs / MCP.
- ADR-020 Axis C: *「Board 仅归属 Autonomy（协调状态，不是 Skill/MCP 式组合原语）」*; Axis B enumerates Skill · Knowledge · MCP · user-env · Pack · modules — **Board is not Composition**.
- Spec §0/§2.1 claim hard ADR-020 fidelity and forbid bare「中层 Agent」; stuffing Autonomy into a Composition-branded drawer reintroduces the *same* mental-model error under a prettier label: “everything secondary lives in 装配.”

**Why blocking**

This is not copy nit. Implementers will wire Board next to Pack/MCP, docs will say「组合能力」, and the next feature will ask “why not put spawn / fleet config in 装配 too?” Ontology wash.

**Required fix**

- Remove Board from the Composition drawer section list.
- Place Board under Autonomy chrome: FocusBand FleetStrip expand, StatusRail when multi-worker active, and/or Cockpit — consistent with Q4 default and ADR-015/016.
- If a single entry point is required for discovery when idle, use `/board` + ⋯ only, labeled **编排 / 自主度**, never under 装配.

### B2. FocusBand stacking vs ≥55% ChatStream — acceptance is gamed

**Evidence**

- §4.1 / P7: ChatStream ≥55% viewport height at L0 is an **acceptance metric**.
- §4.3 allows simultaneous FocusBand rows: L1 ContextStrip (36px) + Confirm (~56px); separately L2 task (~48px) + multi-worker Fleet (~40px). Rule only bans “Context + **full fleet**,” not Context + Confirm or Confirm + Fleet.
- §5.5 wireframe explicitly stacks **two** FocusBand rows (tab + evaluate confirm).
- §8 v2-P0 Accept measures only: *「L0: ChatStream height ≥55% … at 640px」* — the empty chrome path, not the worst product path.

**Back-of-envelope at 640px panel height** `[assumed]`

| Stack | Approx chrome | Chat ratio |
|-------|---------------|------------|
| L0 idle (StatusRail 48 + Composer+chips ~110) | ~158 | ~75% — easy |
| L1 + pending confirm (48+36+56+110) | ~250 | ~61% |
| L2 task + confirm + fleet + composer (48+56+48+40+120) | ~312 | **~51% — fails 55%** |

**Required fix**

- Define a **single FocusBand slot** with strict priority (e.g. Confirm > L2 Safety > Fleet summary > L1 Context), max **one** primary row + optional 1-line secondary, or hard max height (e.g. 56–64px) with overflow into Cockpit/popover.
- Acceptance must include **worst-case** heights: L1+confirm, L2+confirm, multi-worker+confirm — not only L0 idle.
- Either drop absolute 55% for non-L0 or lower chrome caps so the number is real.

### B3. BottomBar retirement has no migration map for the actual host

**Evidence**

- Spec K2/§4.1: retire permanent BottomBar tab strip; chips + `/` + 装配 drawer.
- Code: `BottomBar.tsx` is not “tabs only” — it hosts panel openers, overflow「更多」, Skills/Know/Packs/Board/MCP/Apps bodies, `cmspark:open-context-panel` listeners, and data loaders (`pack.list`, `modules.list`, …). `App.tsx` vertical order is Header → ContextStrip → SafetyStrip → ChatView → FleetStrip → **BottomBar** → InputArea.
- Slash meta today (`META_PANEL_SLASH` in `App.tsx`) only opens **packs / board / mcp** — not skills, knowledge, history, tabs, apps. Spec claims “`/` parity” and “≤2 clicks to MCP/Pack” without inventorying current gaps.
- §13 mentions soft-deprecate behind flag; **§12 PR plan has no flag, no dual-path, no panel-host extraction PR**.

**Why blocking**

Killing the tab row without extracting panel host = either (a) dead panels mid-PR, or (b) chips that open nothing, or (c) a giant PR that rewrites BottomBar in place while claiming “shell only.” Three-mode D5 already demoted packs/board/mcp to overflow + `/`; v2 goes further without a replace-before-remove plan.

**Required fix**

Add an explicit migration sequence **before** “no permanent BottomBar” acceptance:

1. Extract `ContextPanelHost` (panel registry + open API) from BottomBar.
2. Achieve real `/` parity matrix (every former primary + overflow id).
3. Ship chips → same open API.
4. Then remove tab strip (optional flag one release).
5. Only then mount 装配 drawer as browsing shell over the same host.

PR2 must not be “delete BottomBar”; it must be “host extract + strip remove.”

---

## Major issues

### M1. Three-mode D1–D16 “locked” claim soft-reopens D5 implementation without a decision ID

- Three-mode §4 **fixed vertical order** includes permanent **ContextBar** (mode-split 2–3 entries). P0 acceptance literally required mode-filtered BottomBar, not its absence.
- v2 §2.2: *“does not reopen those product forks”* while K2 retires the permanent tab strip entirely.
- Spirit of D5 (command-first + mode-split) is compatible; **implementation contract** is not.

**Fix:** Add **K2′ / D5′** (or amend note): “ContextBar permanent tabs → mode-aware chips ≤3 + `/` + 装配; D5 intent preserved.” Reference three-mode §4 as superseded for chrome only. Dual-review should treat this as an intentional IA delta, not silent scope creep.

### M2. L2 Composer chips reintroduce power chrome three-mode removed from Panel

- §4.4 L2 chips: **确认台 · Abort link**.
- Three-mode §4: L2 ContextBar **minimal / hidden**; abort lives on SafetyStrip (D10′); Cockpit is conductor (D12′).
- Abort beside composer (near Send) risks **P1.3 / §1.3 “destructive never next to Send”** and duplicates SafetyStrip.

**Fix:** L2 chips empty or single「确认台」opener; Abort only in FocusBand Safety row (mandatory, large hit target). No second Abort in dock.

### M3. `alert()` acceptance overclaims; hygiene scope is incoherent

- §6.1 / §8 / §14: offline uses banner; *“Zero `alert()` in extension UI paths.”*
- Code: offline path in `App.tsx` DisconnectedBanner retry uses `alert()`; **many more** remain (`NotebooklmImporterPanel`, `BottomBar` skill folder, `ThreadList` title, log path copy, etc.).
- v2-P0 deliver only kills offline `alert()` — success metric claims zero everywhere.

**Fix:** Split metrics:

- P0: no `alert()` on **connection/offline/reconnect** paths.
- P1+: replace remaining `alert()` with toast/banner grammar (inventory table).
- Do not claim zero-global until inventory is closed.

### M4. Modal / overlay hierarchy still undefined after adding 装配

- §0 pain: secondary panels “slide under” chat without clear modal hierarchy.
- v2 adds 装配 drawer but does not specify z-index / focus trap order vs SettingsSlideout, SkillCraft, NotebookLM importer, McpServerForm, LogBar, Thread popover, slash popover, Fleet expand.
- §6.2 Esc “priority stack” is named but not ordered.

**Fix:** One table: layer name → open triggers → exclusivity (single vs stack) → Esc closes which → focus return. Rule: only one full-height overlay at a time; slash popover subordinate to drawer.

### M5. 装配 drawer is over-stuffed for 320px; Q1 default may erase chat

- Six accordion/tabs (Skills…Board) in 320px; bottom sheet default (Q1) covers ChatStream — the surface P7 tried to protect.
- Apps + user-env lumped (§4.5 §5) — different trust stories (Host apps vs secrets ADR-019).
- Packs omit **modules** / `capability_profile` (code `modules.list` with packs) — enterprise path invisible.
- Craft lives in ⋯ **and** Skills section — OK if documented; else double IA.

**Fix:**

- Cap drawer to Composition only: Skills · Knowledge · Packs(+modules) · MCP · user-env; Apps as Host subsection or Cockpit-heavy.
- Prefer **height-capped bottom sheet** (~45–50% panel) or right overlay with dimmed chat still partially visible; document first-run discoverability of `/装配`.
- Resolve Q1 in-doc before PR4; do not leave implementer default as product decision.

### M6. Missing states matrix is promised then empty

- §5.3 demands default·hover·active·disabled·loading·empty·error for chrome components — **no filled matrix**.
- Three-mode §6 already listed Loading / Empty / Error / Offline / Confirm / Follow-up queue — v2 does not carry them into shell components.
- Gaps vs real product:

| State | Spec coverage |
|-------|----------------|
| Streaming / tool-running | Thin (ToolCard denser) — no StatusRail “busy” |
| Offline + pending confirm | Unspecified (disable send vs allow deny?) |
| Reconnecting | Tooltip only |
| First-run / unpaired (`.paired`) | Not in empty state |
| L2 send hard-gate (D12′) | Placeholder only; no disabled Send visual |
| Confirm timeout (D14) | Not in FocusBand grammar |
| Pin mode (D3) | Buried in ⋯ menu only |
| Multi-worker + L1 tab context | Q4 open; collision with B2 |
| SW death / orphan Cockpit | Out of scope silence — OK if explicit |
| Enterprise modules disabled | Not in Packs section |

**Fix:** Fill §5.3 for StatusRail, FocusBand, ComposerDock, MinimalConfirm at minimum; add a “states” subsection under §6 with offline×confirm and L2 hard-gate.

### M7. Visual system incomplete and conflicts DESIGN.md

- §5.2 radius **6/8/12 only**; DESIGN.md radius table is **4/6/8**, while Composer already uses `radiusLg` 12 — SoT conflict.
- DESIGN.md Connection Status still documents Material `#4CAF50/#FF9800/#F44336`; v2 migrates — good, but **must patch DESIGN.md in PR1**, not “later P2.”
- Token roles miss existing semantics: `userBubbleBg`, `assistantBubbleBg`, `modeBrowserBg`, risk helpers, accent soft — implementers will invent hex again.
- Dark tokens listed for “Cockpit/L2 strip” while K6 defers Panel dark — OK, but StatusRail at L2 LIVE on light panel + dark Safety is two visual systems; say how ModeBadge LIVE reads on light StatusRail.

**Fix:** One SoT pass: either extend DESIGN.md radius to include 12 and drop 4, or keep 4 for icons; list full semantic roles v2 will touch; PR1 acceptance includes DESIGN.md connection section rewrite.

### M8. PR plan realism / ordering

| Issue | Detail |
|-------|--------|
| P0 = PR1+2+3 in 1–1.5 wk | Optimistic given App.tsx monolith + BottomBar host extract |
| PR2 deps PR1 only | Host extract should be its own PR; chips without host = half-ship |
| PR3 parallel to PR2 | FocusBand merge independent OK, but P0 accept needs both |
| PR5 visual deps only PR1 | Can polish bubbles while chips/drawer thrash layout — waste |
| PR4 装配 after PR2 | Correct only if PR2 extracted host |
| No rollback / flag | §13 flag not in §12 |
| No test plan | No unit for open-panel parity; no measure script for 55% height |
| Cockpit PR6 last | Fine, but “no regression content-split” in P0 needs manual checklist |

**Fix:** Reorder: PR1 StatusRail+tokens+offline → PR2 **PanelHost extract** (BottomBar still present) → PR3 chips + `/` parity + flag to hide tab strip → PR4 FocusBand → PR5 drawer → PR6 visual → PR7 Cockpit. Timebox P0 to PR1–3 with honest 2–3 wk if host extract is real.

### M9. Research / toolchain section dilutes the product doc

- §1.1 is meta (Grok `$design`, OMX, Brad Frost talks). Fine in appendix; weak as §1 of a shipping IA spec.
- Risks dual-review energy spent on philosophy tables (P1–P7) that mostly restate three-mode + ADR-020.

**Fix:** Move §1.1–1.2 to appendix; open with pain audit (§3) + locked constraints (§2).

---

## Minor / nits

1. **§4.1 “three zones” then lists A–D four zones** — rename “four zones” or fold chips into ChatStream footer.
2. **§4.2 Menu dumps Craft / export / NB / logs / pin** — discoverability still uneven; no IA for which stay ⋯ vs `/`.
3. **§4.4 “Hist”** is not Composition; fine on chips, but don’t later drag History into 装配.
4. **§5.4 empty shortcuts “总结本页”** may imply L1 browser action from L0 empty — clarify “paste/summarize selection as text” vs tool call (ADR-020 L0: no CDP tools).
5. **Cmd+K (Q2)** conflicts with Chrome/OS in some locales; default Yes is risky — prefer `/` only until tested.
6. **§7 “合盖耗电”** out-of-scope one-liner is good; ensure no new WS heartbeat from StatusRail polish.
7. **Emoji residual** — §0 complains; §5.4 empty state still Chinese-only (good) but auto-skill toast in App still uses 🤖 — out of P0 scope if called out.
8. **Success “3 users 10-min first-run”** — no task script (find Pack, allow confirm, open Cockpit).
9. **§2.1 UI mapping “L2 Required conductor”** — matches D8/D12′; good. Panel “Safety chip + abort + minimal confirm” must stay when drawer open (drawer must not cover Abort).
10. **Copy「确认台」** — aligned with DESIGN.md / user guide; keep single brand (spec does).
11. **Fleet “only multi-agent active”** — matches current FleetStrip intent; ensure idle hide remains acceptance.
12. **Pin in ⋯ only** — three-mode D3 pin is power-user; consider long-press mode badge (future), not P0.

---

## What is strong

1. **Correct problem framing (§0, §3)** — strip stack + BottomBar landfill + Material residue is code-true (`App.tsx` order; residual `alert`/Material in DESIGN.md).
2. **Hard non-goals and K1** — refuses fourth axis, thread rewrite, full App rewrite, Panel full dark in P0; protects shipped three-mode product forks at the *ontology* level even when chrome changes.
3. **Composition naming「装配」** — directly answers ADR-020 “中层 Agent” failure mode; alternatives table correctly rejects Pack-as-Surface and confirm-back-to-modal.
4. **Content-split preserved** — Cockpit remains 确认台; Panel MinimalConfirm in FocusBand; D10′ not reopened.
5. **Command-first direction** — extends D5/S1 instead of inventing a sixth bottom icon row.
6. **Quiet Agent Shell thesis** — consistent with DESIGN.md quiet-professional; token migration of connection colors is overdue and concrete.
7. **Phased acceptance skeleton** — measurable ChatStream ratio (if fixed per B2), no permanent tab row, copy ban on「中层 Agent」are the right *kinds* of checks.
8. **Offline / recovery grammar intent (P5)** — right product instinct; needs scoped delivery (M3).

---

## Concrete rewrite suggestions (section IDs)

| Section | Rewrite action |
|---------|----------------|
| **§1** | Demote toolchain to Appendix A; lead with constraints + pain. |
| **§2.2** | Add explicit **D5′ / K2′**: permanent ContextBar tabs superseded by chips + `/` + drawer; list what stays locked (D1–D4, D9′–D16). |
| **§4.1** | Four zones; add **max chrome budget** table (px) per level + multi-agent. |
| **§4.3** | **Single-slot FocusBand** priority enum; delete dual-row wireframe or mark as invalid; max height hard cap. |
| **§4.4** | L2 chips: drop Abort; empty or 确认台 only. Document chip → `openPanel(id)` API. |
| **§4.5** | Composition-only sections; **remove Board**; split Apps vs user-env; add Packs+modules; axis label footer: “挂到当前线程 / Surface — 非更深层 Agent.” |
| **§4.5b (new)** | Autonomy entry points: FleetStrip / `/board` / Cockpit — not 装配. |
| **§5.2–5.3** | Sync radius/type with DESIGN.md; full token role list; **fill** states matrix for 4 shell components. |
| **§5.5** | Redraw L1+confirm as **one** FocusBand row (tab chip collapsed when confirm active, or confirm replaces context). |
| **§6.1** | Add offline×confirm, L2 hard-gate Send, first-run unpaired, confirm timeout. |
| **§6.2** | Ordered Esc stack table. |
| **§6.4 (new)** | Overlay exclusivity + z-index. |
| **§8** | Worst-case height accepts; `alert()` scoped; `/` parity checklist (tabs, skills, knowledge, history, packs, board, mcp, apps). |
| **§11** | Close Q1/Q4 with defaults that respect B1/B2; re-open only if user research contradicts. |
| **§12** | Insert **PanelHost extract PR**; flag for tab-strip removal; tests; reorder visual after IA stable; honest calendar. |
| **§13** | “Don’t cover Abort with drawer”; “Don’t put Board under 装配.” |
| **§14** | Align metrics with scoped P0; first-run script 3 tasks. |

### Minimal “unblock implement” checklist

- [ ] Board out of 装配; Autonomy placement written  
- [ ] FocusBand single-slot + worst-case height accept  
- [ ] BottomBar → PanelHost migration sequence in §12  
- [ ] `/` parity matrix (current code gaps closed on paper)  
- [ ] `alert()` metric scoped  
- [ ] D5′ recorded as intentional lock update  
- [ ] DESIGN.md connection Material hex deleted in same PR as tokens  
- [ ] Esc/overlay stack table  

Until then: **MAJOR_REVISE** — strong shell concept, unsafe to code as the source of truth.

---

*Critic evidence levels: code paths and ADR quotes `[inspected]`; height arithmetic `[assumed]` from stated px caps; no user study run.*
