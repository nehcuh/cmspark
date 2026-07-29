# Synthesis: Capability Model three axes — dual review lock

| Field | Value |
|-------|--------|
| Date | 2026-07-29 |
| Brief | [capability-model-three-axes-brief-2026-07-29.md](capability-model-three-axes-brief-2026-07-29.md) |
| Claude | [capability-model-ontology-claude-20260729-162716.md](../audit/reviews/capability-model-ontology-claude-20260729-162716.md) → **APPROVE_WITH_NITS** |
| Pi | [capability-model-ontology-pi-20260729-162716.md](../audit/reviews/capability-model-ontology-pi-20260729-162716.md) → **APPROVE_WITH_NITS** |
| Verdict JSON | [capability-model-ontology-verdict-20260729-162716.json](../audit/reviews/capability-model-ontology-verdict-20260729-162716.json) |
| Outcome | **ADR-020** normative; docs reorg authorized |

---

## Consensus (both agree)

1. **Three axes** (Surface / Composition / Autonomy) are the right minimal ontology.
2. **Trust / Channel** stay cross-cutting labels — **not** a fourth axis (monotonic with Surface / binary SKU).
3. **Mission Board** single-homes under **Autonomy** (not Composition).
4. Reject bare architecture term **「中层 Agent」**; use **组合面 / Composition plane**.
5. **Pack-first** stacking + PR declaration checklist + governance metrics.
6. Obsidian / NotebookLM / Mermaid = **product features**, outside Composition primitives.
7. No blocking issues; promote to ADR-020; authorize README / architecture / GOAL / DESIGN / CONTRIBUTING / docs nav updates.

## Q3 editorial rule (both)

README may keep owner narrative 主体→浅→中→深 **only if** every 「中层」 is **inline-qualified** (组合面 / Skill·Knowledge·MCP·Pack), never bare 「中层 Agent」. Footnotes alone are insufficient.

## Q6 README — resolved hybrid (Claude B + Pi A)

| Reviewer | Preference |
|----------|------------|
| Claude | (B) deliverable matrix primary; short ontology above |
| Pi | (A) three-axis primary; matrix secondary |

**Lock:** README opens with a **short** ontology (product positioning + one diagram + mapping table), then a **deliverable matrix regrouped by Surface** (L0 / L1 / Composition / L2 / Autonomy / Ops). Users get concrete “what can I do” without pure abstraction-first IA; contributors still learn the axes first.

## Nits folded into ADR-020

| Nit | Source | Resolution |
|-----|--------|------------|
| L0 = no CDP tool calls (page text may be user-attached data) | Claude | ADR Axis A L0 row |
| Linux pending → ADR-018 Decision 6 | Claude | cross-link |
| Datayes = L0 baseline; L1 when browser tools fire | Claude | scenario table |
| Checklist split Surface vs L2 classes | Both | § declaration |
| session-trust anchored to ADR-017 | Claude | cross-cutting |
| CapabilityLevel alias | Claude | explicit |
| Governance metric baseline | Claude | architecture §1.3 message families as seed |
| Board out of Composition diagram | Both | diagram |
| G13 not deferred | Pi | GOAL mapping only deferred G10–G12, G14 |
| Anti-pattern example 「更多」 | Pi | checklist |
| docs/README stale 拟议 019 | Both | fix nav table + ADR-020 row |

---

*End of synthesis — ADR-020 is the normative source of truth.*
