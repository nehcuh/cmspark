# UI Three-Mode Redesign — Dual Review Synthesis

> Date: 2026-07-26  
> Inputs:
> - Brief: `docs/decisions/v1.3/ui-three-mode-redesign-brief-2026-07-26.md`
> - Claude Code: `docs/audit/reviews/ui-three-mode-redesign-claude-20260726-142607.md`
> - Pi: `docs/audit/reviews/ui-three-mode-redesign-pi-20260726-142607.md`

---

## Verdict matrix

| Reviewer | Verdict |
|----------|---------|
| Claude Code | **APPROVE_WITH_CHANGES** |
| Pi | **APPROVE_WITH_CHANGES** |
| Combined | **Ontology OK · surface/safety rules need rework before §2 lock** |

Neither rejected the L0/L1/L2 model. Both reject several surface-strictness and safety details as written.

---

## Consensus: keep

1. **L0 聊 / L1 网页 Agent / L2 Computer Use** ontology — maps to real code seams (`host_computer` pipeline, ComputerTaskBar, confirm branches).
2. **No fourth mode yet** (MCP / multi-agent are transports, not user modes).
3. **Progressive escalation on one thread** (with hysteresis on de-escalation).
4. **L2 → Cockpit extension window**; Companion native later.
5. **L1 default stays in Side Panel**.
6. **Phased ship**: P0 mode awareness without new window → P1 L2 cockpit → P2 polish / L1 expand.

---

## Consensus: must-change before implementation

| # | Change | Claude | Pi |
|---|--------|--------|-----|
| 1 | **L1→Cockpit auto-promote by N steps: REJECT** — user-initiated「展开工作区」only | ✓ | ✓ (strongest) |
| 2 | **TaskChip abort is mandatory**, not optional secondary | ✓ | ✓ |
| 3 | **Panel must keep minimal confirm during L2** (tool/risk/allow/deny/details) — not confirm-only-on-cockpit | ✓ content-split | ✓ chip + focus + timeout |
| 4 | **Dual-input: no parallel task send** — L2 时 Cockpit 主指挥；Panel 降级为 follow-up queue 或仅闲聊 | ✓ | ✓ |
| 5 | **De-escalation hysteresis** — not per-message yo-yo; quiescence timer or pin release | ✓ | ✓ (debounce) |
| 6 | **Persistent mode badge** + transition announcement | (implied) | ✓ required |
| 7 | **Define L2 “task end”** explicitly before ModeController | ✓ | — |
| 8 | **Tray-initiated L2 surface init** specified | ✓ | — |
| 9 | **Cockpit close while running**: managed warning (Pi); panel re-open affordance (Claude) | partial | ✓ |

---

## Disagreement / nuance

| Topic | Claude | Pi | Suggested resolution |
|-------|--------|-----|----------------------|
| Dual skin (full dark L2) | Keep, with semantic tokens + ≤200ms, pin-dark for L0 | **Defer full dark** to v2; v1 semi-chrome (badge + tint) | **P0/P1: badge+tint; P2: full dual-skin after tokens** |
| Confirm strategy | Content-split: panel 4-line always; cockpit heavy preview/nonce | Full confirm can move to cockpit **if** chip alert + focus + 60s auto-deny | Prefer **Claude content-split** as safer baseline; add Pi timeout |
| Dual-renderer spike | 1-week MV3 shared-state spike **before** IA | Implicit in P1 | Do light spike as P0.5 or start of P1 |
| L1 cockpit light skin | Still in later phase | Later | After P1 proves L2 window |

---

## Recommended decision amendments (for next design pass)

Amend locked decisions:

- **D9'**: L1 promote = **user only** (remove auto step/screenshot heuristics from v1).
- **D10'**: L2 panel = TaskChip + **mandatory abort** + **minimal confirm strip** (not chip-only).
- **D12'**: L2 input ownership = Cockpit conductor; Panel = queued follow-up or non-task chat.
- **D13 new**: Mode badge always visible; escalate toast; de-escalate with hysteresis.
- **D14 new**: Confirm timeout policy (e.g. 60s auto-deny + toast) when surface unfocused.
- **D6'**: Dual-skin full dark **P2**; P0–P1 mode signal via badge/tint.

---

## Agreed phasing

**P0 (~1–2 wk)** — no new window  
`CapabilityLevel` + `ModeController` + header mode badge + BottomBar mode-split + transition toast. ComputerTaskBar stays in-panel.

**P1 (~2–3 wk)** — L2 cockpit only  
`chrome.windows` Cockpit; relocate ComputerTaskBar + heavy confirm; Panel TaskChip + abort + minimal confirm; input ownership rules; tray L2 init.

**P2** — L1 expand button, dual-skin tokens, hysteresis polish, queue UX, close-warning.

**P3+** — Companion native HUD, SVG icons, MCP-as-mode if data justifies.

---

## Bottom line for product owner

- **OK to proceed with three-mode ontology and progressive escalation.**
- **Not OK to freeze D9/D10/D12 as previously written** — both reviewers flag safety/focus/input races.
- Next design step: apply amendments above, then continue §2 (Panel IA for L0/L1) with revised constraints.
