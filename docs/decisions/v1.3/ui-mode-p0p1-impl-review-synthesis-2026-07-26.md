# UI Mode P0+P1 Implementation — Dual Review Synthesis

> Date: 2026-07-26  
> Branch: `feat/ui-mode-p0`  
> Inputs:
> - Brief: `docs/decisions/v1.3/ui-mode-p0p1-impl-review-brief-2026-07-26.md`
> - Claude: `docs/audit/reviews/ui-mode-p0p1-impl-claude-20260726-153051.md`
> - Pi: `docs/audit/reviews/ui-mode-p0p1-impl-pi-20260726-153051.md`

---

## Verdict matrix

| Reviewer | Verdict |
|----------|---------|
| **Claude Code** | `APPROVE_WITH_FIXES` |
| **Pi** | `APPROVE_WITH_FIXES` |
| **Combined for product owner** | **双方均未给 APPROVE_IMPL — 不建议现在「确认 OK」**；先改 must-fix 后再请人确认 |

Neither rejected the ontology or the Cockpit surface split. Both say shippable after bounded fixes (hours, not redesign).

---

## Consensus: keep (OK as designed)

1. **P0 ModeController** — L0/L1/L2 highest-wins, pin floor, 30s hysteresis, tests solid  
2. **Badge / toast / BottomBar split** — correct  
3. **Cockpit dual-track shell + ConfirmElevated** (preview/whitelist/nonce core)  
4. **SafetyStrip mandatory abort + MinimalConfirm** content-split  
5. **Close Cockpit ≠ stop task**; reopen + Panel abort  
6. **Background auto-open** on host_* confirm + `computer.task.event` started/paused (D16 path)  
7. Dual stores via WS broadcast — acceptable for P1 (with hydrate caveats)

---

## Must-fix before human confirmation

Merged from both reviews, ordered by severity:

| # | Fix | Claude | Pi | Notes |
|---|-----|--------|-----|-------|
| 1 | **Cockpit hydrate `computerTask` (+ pending confirms) on open** | **Must** (safety) | — (Pi less emphasized) | Mid-task open → empty dock / no abort until next event |
| 2 | **Panel L2 send gate (D12′)** | **Must** hard-gate while task running | Soft OK for P1 / interstitial P2 | Disagreement: Claude harder |
| 3 | **Confirm focus trigger in background**, not Cockpit self-focus | **Must** (architecture) | — | Move off CockpitApp |
| 4 | **Cockpit nonce anti-paste = Panel parity** (keydown/context/drop) | — (nit on allow without nonce) | **Must** | Copy Panel handlers |
| 5 | **Panel full SecurityConfirmationDialog 60s timeout** (D14 L0/L1) | — | **Must** | Cockpit has timeout; Panel full dialog doesn’t |
| 6 | **`openOrFocusCockpit` mutex** against double `windows.create` | Important (race) | **Must** | In-flight promise |
| 7 | **L2 trust checkboxes** (session/thread) in ConfirmElevated **or document regression** | **Must decide** | P2 OK | Don’t silent-lose host_computer session trust |
| 8 | Document **SW death** orphan/duplicate window | Important | Doc must | storage.session / getAll later |

### Recommended merge bar for “双方 OK”

Treat as **blocking** for your confirmation gate:

1. Cockpit hydrate computer task on boot  
2. Panel hard-gate send while L2 + task `running`/`paused` (Claude bar)  
3. Cockpit nonce paste hardening (Pi bar)  
4. openOrFocus mutex  
5. Background-driven confirm focus  
6. Either port trust checkboxes to ConfirmElevated **or** explicit known-limitation in DESIGN/spec  

Panel full-dialog timeout (L1) is also D14 — include if you want strict D14.

---

## Disagreement

| Topic | Claude | Pi | Suggestion |
|-------|--------|-----|------------|
| D12′ Panel send | Must hard-gate | Visual hint OK for P1 | **Hard-gate** for safety bar |
| Dual-store hydrate | Ship blocker if no task snapshot | Acceptable | **Hydrate** — cheap safety |
| Nonce paste | Secondary | Must | **Do it** — copy Panel |
| Session trust missing in L2 | Must decide / document | P2 | **Document or port** before merge |

---

## Suggested next sequence

1. Implement must-fix #1–6 on `feat/ui-mode-p0`  
2. Re-run Claude + Pi **delta review** (fixes only)  
3. If both → `APPROVE_IMPL` (or APPROVE_WITH_FIXES with zero blockers), then **your product confirmation**  
4. Then merge / PR  

---

## Bottom line for product owner

| Question | Answer |
|----------|--------|
| 双方是否确认实现 OK？ | **否** — 双方均为 `APPROVE_WITH_FIXES` |
| 方向是否正确？ | **是** — 三模式 + Cockpit 分面被认可 |
| 你现在该确认吗？ | **建议先不确认**；改完 must-fix 并再过一轮评审后再确认 |

Full reviews:

- `docs/audit/reviews/ui-mode-p0p1-impl-claude-20260726-153051.md`
- `docs/audit/reviews/ui-mode-p0p1-impl-pi-20260726-153051.md`

---

## Must-fix implementation (2026-07-26 follow-up)

Commit on `feat/ui-mode-p0` (see `git log`): implements merged must-fix bar.

| # | Fix | Status |
|---|-----|--------|
| 1 | Cockpit hydrate `computerTask` + pending confirms via SW mirror + `cockpit.hydrate` | Done |
| 2 | Panel hard-gate `chat.send` while L2 task running/paused | Done |
| 3 | Cockpit nonce anti-paste parity (keydown/context/drop) | Done |
| 4 | `openOrFocusCockpit` in-flight mutex | Done |
| 5 | Confirm focus background-driven (removed Cockpit self-focus) | Done |
| 6 | ConfirmElevated session/thread trust checkboxes | Done |
| 7 | Panel full dialog 60s auto-deny (D14) | Done |
| 8 | MinimalConfirm disables Allow when nonce required | Done |
| 9 | Document SW-death window id limitation | Done (DESIGN + module comment) |

**Next:** delta re-review by Claude + Pi on this fix commit only, then product owner confirmation.
