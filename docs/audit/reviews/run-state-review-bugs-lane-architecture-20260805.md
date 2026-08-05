# Architecture Lane (ADR-020 adversarial)

**Repo:** `/Users/huchen/Projects/cmspark`  
**Branch:** `fix/run-state-review-bugs`  
**Diff:** `docs/audit/reviews/run-state-review-bugs-diff-20260805-090257.patch`  
**Lane:** Architecture (Surface × Composition × Autonomy × Trust × Channel)  
**Date:** 2026-08-05  
**Evidence:** `[inspected]` patch + live sources (`server.ts`, `executor.ts`, `fleet.ts`, `thread-busy.ts`, UI call sites, `autopilot-tier.ts` product matrix outside diff)

---

## Capability declaration check

| Axis | Declared | Verified against diff | Fit |
|------|----------|------------------------|-----|
| **Surface** | no new L2 tools | No new tool names, no new CU/Host/shell surfaces; changes are gate algebra + fleet snapshot field + pure UI predicates | **OK** |
| **L2-classes** | none new; restores critical forceConfirm floors | Removes `browserScriptTool && skipConfirmation` waiver; `forceConfirm = criticalApis.length > 0 && !userFullAutonomy` only | **OK — monotonic restore** |
| **Compose** | fleet snapshot field `open_intents_by_run` | Additive `FleetSnapshot` field; count keyed by host `orchestrator_run_id`; not a Pack/Skill/MCP primitive | **OK — Autonomy UI signal, not Composition** |
| **Autonomy** | full-autonomy cruise still elevates under three flags only | Cookie early gate + forceConfirm + computer reL2 cruise short-circuit all require `auto_approve_dangerous ∧ auto_approve_enterprise_tools ∧ allow_all_schemes` | **OK** |
| **Trust** | monotonic restore of M3' domain≠content; danger re-L2 always HITL | Domain whitelist / god-mode alone / auto_approve alone no longer waive critical evaluate/osascript; cruise reL2 cannot skip `danger_detected` / `experimental_suggestion` | **OK in code; product matrix lag (F4)** |
| **Channel** | community | No enterprise module, no capability_profile change | **OK** |

**Axis language:** Diff does not invent a fourth runtime, a Board fork, or a parallel confirm dialect. RunBusy remains presentation of Autonomy state (ADR-015/016 + SoT §2.1), not a new Surface level.

---

## Verdict (one screen)

This batch is a **Trust + Autonomy honesty repair**, not a capability expansion.

1. **Trust floors restored** to M3' / security-design §6.2 spirit: domain trust ≠ page-content trust; single-flag god-mode / auto_approve no longer free-pass critical JS-in-tab.
2. **Full-autonomy cruise remains the only explicit residual-risk elevating package** (three flags), with a hard carve-out for content-sensitive computer re-L2 tags.
3. **Compose surface is minimal**: one additive fleet field + pure client resolver to kill cross-run sticky RunBusy — correct placement under Autonomy UI, not Composition.

Architecture **approves** the shape. Residual debt is **duplicated RunBusy builders**, **stale comments/tests headers**, and **product-matrix copy outside this diff** that still over-claims cruise silence on danger re-L2 / critical-under-single-flag. None of those invert the restored floors if code ships as-is.

**Status:** **WATCH** (docs/product packaging drift, not gate algebra)

**Recommendation:** **APPROVE_WITH_NITS**

**VERDICT: APPROVE_WITH_NITS**

---

## Findings

### F1 — Trust inversion residual: **closed in gate algebra; open in packaging**
**Severity:** Medium (product honesty / Trust packaging) · **Architecture gate:** CLEAR for code  
**Where:**

- Restored: `companion/src/server.ts` ~1470–1472  
  `forceConfirm = criticalApis.length > 0 && !userFullAutonomy`
- Removed inversion path: prior `!(browserScriptTool && skipConfirmation)` let domain whitelist / god-mode / global toggle auto-mint tokens for critical `fetch`/`eval`/Worker/…
- Tests realigned: `security-gates.test.ts` god-mode-alone / domain-whitelist / auto_approve-alone → still forceConfirm; three-flag cruise → waive + `full_autonomy_cruise` audit
- Computer: `executor.ts` reL2 checks `FORCE_INTERACTIVE_DANGEROUS` **before** cruise short-circuit; new unit locks cruise ⇏ auto-approve `danger_detected`

**Architecture read:** This **re-establishes Trust monotonicity** relative to Surface L1 evaluate: deeper content risk (critical APIs) is not silently inherited from weaker domain/scheme flags. Full cruise is an intentional **user-elected residual-risk package** (Axis C Autonomy × Trust packaging), not a silent L0→L1 downgrade. Matches ADR-020 Axis A “god-mode must not silently skip critical CU-class risk” spirit for JS-in-tab; three-flag waive is the documented product exception.

**Residual inversion (not introduced here, still true under cruise):**

- Under three flags, `capabilityForceConfirm` tools (`shell_exec`, `spawn_worker`, `ask_user`, `board_complete`, `skill_install`, `host_cli`, …) lose forceConfirm; L2 block is skipped when `skipConfirmation` is true and tokens are **auto-minted** (~2179). Handlers still require tokens (LLM cannot self-approve via `user_confirmed`) — good — but **HITL is gone**. That is product-full-open, not a regression of this fix; comments that still say “real HITL / god-mode never skips” without the cruise exception are drift (F3).

**Ask:** Ship note + Settings/matrix follow-up (F4). Do not re-open browserScriptTool waiver.

---

### F2 — Duplicated RunBusy builders (blast-radius smell)
**Severity:** Medium-Low (Autonomy UI correctness drift risk)  
**Where:**

| Site | Builds lockCount run-filter | Uses `resolveOpenIntentsForRun` | Notes |
|------|----------------------------|----------------------------------|-------|
| `App.tsx` InputArea ~335–356 | yes | yes | composer gate |
| `ChatView.tsx` ~96–119 | yes | yes | §6 banner / intent-only |
| `RunBusyChip.tsx` ~43–67 | yes | yes | always-on chip |
| `ChatView.tsx` fleetProcessingLabel ~126 | n/a | **no** — still `open_intent_count` process-wide | status suffix only |
| `FleetStrip.tsx` | process-wide | process-wide | fleet-wide chrome — OK |

**What this fix did right:** Extracted `resolveOpenIntentsForRun` (no global fallback when `runId` known) and applied it at the three busy-predicate sites. Unit tests lock no-fallback.

**What remains:** The **lockCount / anyHoldingTabs / llmActive / workerBusy** assembly is still copy-pasted thrice. Next SoT tweak (e.g. run-scoped `lock_count` from companion, stamp parent locks differently) will miss one call site → composer vs chip vs §6 banner desync — same class of bug this batch fixed for intents.

**Ask (nit, non-blocking):** One pure helper, e.g. `buildRunBusyInput({ fleet, workers, runId, activeId, threadBusyById, llmActiveRaw }) → RunBusyInput`, used by all three consumers. Keep FleetStrip/fleet labels process-wide by design.

---

### F3 — Comment / code drift
**Severity:** Low–Medium (reviewer trap / future re-break)  
**Where:**

1. **`security-gates.test.ts` section header ~737–743** still claims product 2026-08:  
   “when skipConfirmation is already true … evaluate/osascript_eval NO LONGER forceConfirm on critical APIs”  
   while the **tests themselves** now assert the opposite for god-mode alone. Header is a landmine for the next engineer.

2. **`server.ts` ~1452** still narrates `spawn_worker / ask_user / board_complete: real HITL` next to algebra that waives forceConfirm under cruise. Accurate for “LLM cannot self-approve”; inaccurate for “always human.”

3. **`server.ts` ~1113** “dialog is critical-class: shown on every task, god-mode included (forceConfirm below)” — true for god-mode **alone** after this fix; false under three-flag cruise (forceConfirm false + skipConfirmation true → auto-token path).

4. **Positive:** Inline comments at the forceConfirm block and executor reL2 were rewritten to match M3' + cruise carve-out — good.

**Ask:** Rewrite the M3' test-file banner in the same PR or immediate follow-up; one-line cruise exception on spawn/HITL comments.

---

### F4 — Incomplete product matrix alignment (autopilot-tier **not** in this diff)
**Severity:** Medium (Trust packaging honesty) · **Scope:** flag only  
**Where (outside patch):**

- `chrome-extension/src/sidepanel/components/autopilot-tier.ts`  
  - Row **「host_computer 危险/实验/让出 re-L2」** · protocol column: **「跳过·高风险」** — **false** after this fix (and after reL2ShouldPrompt / FORCE_INTERACTIVE).  
  - Footnote **§**: “三旗全开时 … L2/critical/ cookie … 不再二次确认” — over-broad; **danger/experimental re-L2 still HITL**.  
  - Row **「网页 evaluate / 导航 L2」** · browser/full: blanket **「跳过」** — under restored M3', **critical** evaluate still confirms unless three-flag cruise; non-critical skips under auto_approve.
- `SettingsSlideout.tsx` unattended toast (~412): “三旗全开时 evaluate/shell/spawn/cookie/**桌面 re-L2** 等不再二次确认” — same over-claim for danger-class re-L2.

**Architecture issue:** Code and product matrix are now **out of lock-step**. Users who armed full_protocol believing “no mid-task desktop re-L2 ever” will see confirms (safer than matrix). Users who armed **browser-only** cruise may think whitelist/auto_approve “broke” when critical evaluate returns (C5 class UX shock). ADR-020 Trust packaging requires **honest labels**.

**Ask:** Follow-up (can be tiny): matrix cells + footnote § + toast. Not a merge BLOCK for gate restore — **do not** “fix” honesty by re-waiving danger tags.

---

### F5 — Fleet schema versioning
**Severity:** Low (evolution risk; dual-version handled)  
**Where:** `fleet.ts` `open_intents_by_run: Record<string, number>` required on companion; optional on extension `types.ts`; wire filter in `useWebSocket.ts`.

**Architecture read:**

- No `schema_version` on `fleet.status` (pre-existing pattern for this WS type).
- Additive field + client sanitize + run-scoped fail-open to **0 intents** (prefer false-negative busy over sticky false-positive) is **correct** for SoT §2.1 priority.
- Dual-version matrix: new extension + old companion → intent-only RunBusy under-count when `runId` set; new companion + old extension → sticky bug remains until extension ships. Classic additive community Channel evolution — no hard break.

**Edge:** Hosts with open/claimed intents but **empty** `orchestrator_run_id` inflate `open_intent_count` only, not the map. Run-scoped viewers ignore them. Acceptable for multi-run isolation; board-before-spawn remains process-wide when viewer also has no run id.

**Ask:** Optional future `fleet.schema_version` or capability bit if more breaking fleet fields land; not required for this single additive map. Ship extension+companion together when practical.

---

### F6 — Structural simplification that matters for blast radius
**Severity:** Low (debt, not defect)

| Opportunity | Why blast radius | Priority |
|-------------|------------------|----------|
| **`buildRunBusyInput` single pure builder** (F2) | Prevents next partial fix desyncing composer/chip/banner | **High nit** |
| **Shared `isUserFullAutonomyCruise(sec)`** used by cookie gate (~860), forceConfirm (~1461), executor reL2 (~648) | Three independent three-flag checks will diverge (already two modules) | Medium |
| **Cruise reL2: rely on `reL2ShouldPrompt` only** (drop parallel `FORCE_INTERACTIVE_DANGEROUS` Set) | Dual sets already overlap on danger/experimental; PROMPT_ALWAYS also covers `foreground_yielded`. Today both layers agree; future tag could be added to one set only | Medium (keep dual until exhaustiveness test owns both) |
| **Do not** invent fleet schema_version for this field alone | Over-engineering; additive optional is enough | Skip |

No recommendation to collapse forceConfirm + enterpriseSkip + hostComputerTrustSkip into one mega-policy object in this batch — blast radius too high for a bugfix PR.

---

## Hunt checklist (requested)

| Hunt item | Result |
|-----------|--------|
| Trust inversion residual | **Gate algebra fixed** (M3' floors + danger re-L2). Residual: cruise still elevates spawn/shell/skill token auto-mint; **product matrix over-claims** silence (F1, F4). |
| Duplicated RunBusy builders | **Still triple-built** after partial extract (F2). |
| Comment / code drift | **Test header + HITL comments** stale (F3). |
| Fleet schema versioning | **Additive, no version field**; dual-version safe with intentional under-count (F5). |
| Product matrix / autopilot-tier | **Not in diff; misaligned** on danger re-L2 + critical evaluate under single-flag (F4). |

---

## What is solid

1. **Single forceConfirm predicate** — removes special case for browser scripts under domain skip; one elevation path (three-flag cruise).
2. **Danger re-L2 ordered before cruise** — content-sensitive / uncalibrated gates cannot be silent under full-open (P0-C / TinyClick G4 preserved under Autonomy elevation).
3. **Run-scoped intents without global fallback when `runId` known** — correct SoT §2.1 anti-sticky choice; pure helper unit-tested.
4. **No new Surface L2 tool, no Pack write of global auto_approve, no second agent runtime** — ADR-020 discipline held.
5. **Tests moved with product** for M3' restore rather than leaving green-but-wrong “god-mode auto-approves fetch” expectations.

---

## Capability axes (this tip) — piece map

| Piece | Surface | Composition | Autonomy | Trust | Channel |
|-------|---------|-------------|----------|-------|---------|
| `open_intents_by_run` | — | — | Board/fleet signal for RunBusy | honesty of busy UI | community |
| `resolveOpenIntentsForRun` | — | — | pure predicate | fail-open not sticky | community |
| forceConfirm algebra | L1 evaluate / L2 capability tools | — | three-flag cruise elevates | M3' restore | community |
| reL2 cruise + forceInteractive | L2 host_computer | — | mid-task Autonomy UX | danger always HITL | community |

---

## Recommendation detail

| Option | When |
|--------|------|
| **REQUEST_CHANGES** | Only if merge policy requires **product matrix + Settings toast** to match danger re-L2 before any full_protocol ship marketing — not required to land gate restore. |
| **APPROVE_WITH_NITS** (this lane) | Ship Trust floors + RunBusy intent scoping; track F2 helper extract, F3 header rewrite, F4 matrix follow-up as HANDOFF. |
| **APPROVE** | If product explicitly accepts temporary matrix over-claim until a dedicated copy PR — not preferred; Prefer WATCH + nits. |

**Architecture lane pick:** **APPROVE_WITH_NITS** + **WATCH**.

### Merge blockers for *architecture*

- **None hard.**  
- Soft: F4 copy if release notes claim “full cruise silences all desktop re-L2.”  
- Soft: F2 before the next RunBusy SoT change.

### Non-findings (explicit pass)

- No new L2 tool surface or L2-class capability module.  
- No Pack / MCP / skill_install boundary change.  
- No Autonomy “中层 Agent” or second tool-loop.  
- Channel remains community; enterprise forceConfirm still requires enterpriseSkip **or** full cruise.  
- Computer initial L2 under unattended grant (ADR-021) path not regressed by this reL2 ordering change.

---

## Suggested residual HANDOFF

1. Rewrite `security-gates.test.ts` M3' banner to “single-flag forceConfirm; three-flag cruise waives.”  
2. Extract `buildRunBusyInput` / shared `isUserFullAutonomyCruise`.  
3. Align `AUTOPILOT_CONSEQUENCE_ROWS` + footnote § + Settings toast with danger/experimental always-HITL and critical-evaluate under non-cruise.  
4. Release note: god-mode-alone / domain-whitelist alone will re-prompt critical evaluate; ship companion+extension together for intent RunBusy.

---

**VERDICT: APPROVE_WITH_NITS**
