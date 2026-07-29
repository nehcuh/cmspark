## Architecture Review: Capability Model Three-Axis Ontology

### 1. Executive Summary

The brief correctly identifies that CMspark's feature proliferation creates a "杂" (mixed/messy) surface that needs an organizing ontology. Its central thesis — that "中层" is a **composition plane**, not a surface depth — is the most important architectural correction proposed. All claims map accurately to shipped artifacts: architecture.md §1 topology, ADR-014 Pack-as-not-runtime, ADR-015/016 multi-agent + board, ADR-017/018 CU/Host, ADR-019 user-env. The three axes (Surface/Composition/Autonomy) are the right minimal decomposition: they separate *reach* from *assembly* from *execution mode*, which the four-layer-only narrative conflates. No contradictions with the Extension↔Companion topology or existing tool-loop runtime. Ready for ADR-020 promotion with nits only.

---

### 2. Answers to Q1–Q6

**Q1.** Three axes is the right minimal set. Trust/Channel is correctly treated as cross-cutting (§3 "Cross-cutting — Trust / Channel"). Trust is monotonic with Surface (L2 `forceConfirm` > L1 domain-gate > L0 read-only), and Channel is a binary gating mechanism (`community` vs `enterprise`). Elevating them to a fourth axis would create a 4D matrix with no additional analytical leverage — every capability already carries a Trust label; the label doesn't represent an independent dimension of capability *variety*.

**Q2.** Autonomy only. The brief's own preference (§4 note: "prefer Autonomy in ADR body") should be hardened into a firm decision. Board's shared state is an implementation detail of coordination, not a composition primitive. Dual-homing would blur the clean boundary between "how capabilities are assembled" (Composition) and "who runs them, for how long" (Autonomy).

**Q3.** Safe **iff** the team adopts a hard editorial rule: every occurrence of "中层" in README must be immediately qualified inline — e.g. "中层 = 组合面 (Skill/Knowledge/MCP/Pack 的装配)" — never bare "中层 Agent." A footnote alone is insufficient; readers skim prose, not footnotes. The §2 mapping table is the right mitigation. If this editorial discipline can't be committed to, prefer the three-axis phrasing as primary and relegate the four-layer narrative to a one-line historical aside.

**Q4.** No missing primitive. Obsidian export, NotebookLM, and Mermaid are product features (exporters/importers/renderers), not composition primitives — they don't participate in the "assemble capabilities onto a thread" workflow. The Composition axis (Skill / Knowledge / MCP / Pack / user-env) is exhaustive for the current capability model. If anything, the brief could more explicitly state that these product features live *outside* the capability model.

**Q5.** No blocking issues. The model is internally consistent and consistent with all shipped ADRs, architecture.md, the UI three-mode spec (L0/L1/L2 ↔ CapabilityLevel `chat/browser/computer`), and the code (`mode-controller.ts` `deriveCapabilityLevel`, `WORKER_HARD_DENY` in ADR-015, Pack `auto_approve_dangerous` prohibition in ADR-014). See nits below.

**Q6.** Prefer **(A)** — full three-axis table as primary. The current "核心/已交付/进阶" matrix is an inventory, not a mental model. A three-axis taxonomy teaches users and contributors *how to think about* CMspark's capabilities, which is higher-value than *what currently exists*. Keep the deliverable matrix as a secondary reference (appendix or "当前功能清单" section).

---

### 3. Agreement with §10 Proposed Decisions

| # | Decision | Verdict |
|---|----------|---------|
| 1 | Accept three-axis capability model as project ontology | **AGREE** |
| 2 | Accept owner four-layer story as user-facing narrative mapped to §2 | **AGREE** — with Q3 editorial rule (never bare "中层 Agent") |
| 3 | Reject "中层 Agent" as architecture term; use Composition plane | **STRONGLY AGREE** — this is the brief's most important correction |
| 4 | Accept Pack-first stacking + declaration checklist + governance metrics | **AGREE** — §6 anti-patterns are specific and actionable |
| 5 | Authorize doc updates in §9 | **AGREE** — with amendment below |

---

### 4. Blocking Issues

**None.**

---

### 5. Non-Blocking Nits

**N1. §6 checklist Surface field mixes axes with capabilities.**
The checklist field `Surface: L0 | L1 | L2 | host_read | host_write | host_app | shell | netsec | mcp` conflates the Surface axis values (L0/L1/L2) with specific L2 capability classes and a Composition primitive (mcp). Consider splitting: `Surface: L0 | L1 | L2` + a separate `L2 Classes: host_read | host_write | host_app | shell | netsec` field. MCP is already covered by the Compose field so listing it under Surface is redundant.

**N2. §8 GOAL mapping groups completed G13 with deferred goals.**
G13 ("保存对话为Skill") is marked "✅ 已实现" in GOAL.md. The brief's table header says "Map deferred goals onto axes," but G13 is complete. Either drop G13 from the mapping or add a "(completed)" annotation. G10–G12, G14 are correctly deferred.

**N3. §4 diagram under-represents Autonomy.**
Board appears only in a parenthetical footnote. Considering the normative claim that Board lives primarily under Autonomy, the diagram should explicitly show Board under the Autonomy bar (e.g., `Autonomy: single loop → workers → board`) rather than the current footnote-only treatment.

**N4. §6 anti-pattern #1: "New top-level Side Panel IA entry without Pack alternative."**
This is a good anti-pattern, but could be sharpened with a concrete example from the existing IA (e.g., "before adding a permanent toolbar button, ask: can this be a Pack + '更多' entry?").

**N5. §9 "docs/README.md" stale note scope.**
The brief correctly identifies the stale "拟议后续：UI 三模式 + Cockpit（019）" note. But the fix should also update the parenthetical "(019)" → "(ADR-019 user-env)" since 019 is now user-env-secrets, not UI, to prevent a second round of confusion.

---

### 6. Doc Plan (§9): ACCEPT with one amendment

The plan is reasonable and scoped. **Amend**: In README.md, treat the three-axis table as the primary capability view and the current deliverable matrix as secondary (per Q6 answer A). The README reorg should not be a mere "add an ontology section above" — it should *re-center* the capability presentation around the axes.

---

**VERDICT: APPROVE_WITH_NITS**
