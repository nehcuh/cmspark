## Eval gate card — web-act-loop-wave1-20260821

**Blast tier**: T2 (L1 CDP locator + prompt + classifyError; Trust freeze: click not L2)
**Capability declaration** (ADR-020):
  Surface L1 CDP / L2-classes none new / Compose none / Autonomy single / Trust finder-in-extension IIFE, click ∉ L2_GATE_TOOLS / Channel community

### Machine (must pass first)
- [x] chrome-extension WAVE-1 locator+type-fallback: 17/17 (`tsc -p tsconfig.test.json` + node --test)
- [x] chrome-extension full `npm test`: 789/789 (pre last nits; WAVE-1 subset re-run after fold)
- [x] companion `npx tsc -p tsconfig.test.json` exit 0
- [x] companion compiled wave1 + budget: 15/15
- [x] companion `tsc --noEmit` exit 0
- [x] Outcome DoD 1–20 covered by unit tests and/or `[inspected]` wiring (DoD 16 evaluate probe is inspection + code; no live Chrome dead-world e2e)
- [x] No forbidden tools/paths; click not in L2_GATE_TOOLS

### Trajectory
- [x] Diff scope = W1/W3′/W4/W5 (no W2 snapshot)
- [x] Win32 REJECT folded (attach typing + test compile + linux Rule 12/12b + scroll CU hop)

### Judges（确认序：对抗 → Pi；本批用户指定 Claude+Kimi 双路作 Pi）
- [x] locator adversary APPROVE_WITH_NITS — `web-act-loop-impl-adversary-locator-20260821.md`
- [x] budget adversary APPROVE_WITH_NITS — `web-act-loop-impl-adversary-budget-20260821.md`
- [x] win32 adversary REJECT then rereview APPROVE_WITH_NITS — `*-win32-20260821.md` / `*-win32-rereview-20260821.md`
- [x] Claude dual APPROVE_WITH_NITS — `web-act-loop-impl-claude-20260821.md`
- [x] Kimi dual APPROVE_WITH_NITS — `web-act-loop-impl-kimi-20260821.md`
- [x] Cheap nits folded: TYPE_UNSUPPORTED_EDITOR no longer suggests evaluate; Rule 9b/9c linux-gated
- [ ] Residual nits filed: DoD 16 live evaluate probe test; `budgets.delete` on thread delete; pinned-tab origin for shell_exec

### Blast
- [x] T2: dual APPROVE* required; **not** auto-merge
- [x] residual: file-backed script heuristic; genuine-null evaluate labeled empty_completion; no win32 VM replay

### Verdict
- MACHINE: PASS (targeted suites; not full companion `npm test` wall-clock this turn after last nits)
- ADVERSARY: APPROVE_WITH_NITS (all three lanes; win32 after fold)
- PI_REREVIEW: APPROVE_WITH_NITS (Claude + Kimi)
- MERGE: NO — reason: T2 requires PR/CI; packaged app unpatched; implementer must not self-merge; full companion suite not re-run after last two prompt nits
