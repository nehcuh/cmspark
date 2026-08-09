# Pi protocol review — Windows Python discovery cascade (design+plan)

**Batch:** `windows-python-discovery`  
**Date:** 2026-08-09  
**Stage:** design SoT + impl plan (pre-implementation)  
**Reviewer channel:** Independent read-only agent under Pi external-review protocol  
**Note:** Host `pi -p` CLI twice drifted to unrelated topics (bridge / architecture backlog); protocol re-run with scoped read-only agent produced this verdict. Mis-routed outputs archived as `windows-python-discovery-pi-20260809-095312.md` and `windows-python-discovery-pi-r2-20260809-095956.md` (do not use for gate).

**Artifacts reviewed `[inspected]`:**
- `docs/superpowers/specs/2026-08-09-windows-python-discovery-design.md`
- `docs/superpowers/plans/2026-08-09-windows-python-discovery-impl.md`
- `docs/audit/reviews/windows-python-discovery-adversary-synthesis-20260809.md`
- `companion/src/computer/python-runtime.ts`
- `companion/src/computer/qwen-vl-preflight.ts`
- `companion/src/computer/qwen-vl-download.ts`
- `companion/src/computer/model-state-messages.ts`
- `companion/tests/computer-python-runtime.test.ts`
- Predecessor: `docs/superpowers/specs/2026-08-02-windows-uv-python-chain-design.md`

---

## Findings

### Blocking
**None.** Scheme D + PY1–PY16 + G1–G12 coherent, consistent with S35, implementable without E/F/G-primary.

### Nits (fold into P0 — see plan §1.1)

| ID | Summary |
|----|---------|
| N1 | Progressive CTA / preflight readiness needs `basePythonAvailable` (or equiv) so install UX cannot fire when seed base exists |
| N2 | Add tests: config priority, manager seed, py-launcher, download absolute argv0 |
| N3 | Rewrite ensureIsolated short-circuit for injectable absolute base (PY-T13) |
| N4 | Clarify Anaconda root ownership well-known vs manager |
| N5 | Custom roots → pick/config hatch only (ok for P0) |
| N6 | Store denylist on candidate path **and** probe pin |
| N7 | buildInstallCommands bare is UX-only (not G1) |
| N8 | Delete dead `findPython` |
| N10 | Protect findUv order via PY-T17 |

---

## Answers 1–8 (summary)

1. **PY1–16 sufficient without E/F/G-primary?** Yes. D hybrid minimal complete set.  
2. **Absolute pin + Store residual gaps?** Acceptable; hatch covers custom roots.  
3. **Manager-as-seed-only?** Correct for P0; deep conda needs ADR / hits G4.  
4. **Cascade order?** Correct (config → isolated → well-known → managers → PATH/py).  
5. **Min 3.10?** OK for P0; raise later if torch requires.  
6. **Plan implements locks?** Mostly yes; N1–N3 thin spots folded.  
7. **findUv regression risk?** Low–medium, controlled by PY-T17 + no-order-change.  
8. **Force REJECT?** Any G1–G12 design violation, scheme pivot E/F/G, B3 collapse, no injectable tests.

---

## Gate checklist G1–G12

All **PASS** at design/plan level (pre-code deficits C1–C8 are the licensed fix surface).

---

## nits_summary

- Wire PY14 with explicit preflight signal (`basePythonAvailable`)  
- Extend tests: config / manager / py-launcher / download absolute  
- Rewrite ensure deps short-circuit for PY-T13  
- Clarify anaconda ownership; dual Store denylist  
- Protect findUv via no-order-change + PY-T17  

---

VERDICT: APPROVE_WITH_NITS
