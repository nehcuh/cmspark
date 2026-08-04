# Dual-review synthesis: CMspark as MCP Server strategy

**Date:** 2026-08-03  
**Batch:** `cmspark-mcp-server-strategy`  
**Verdict JSON:** `docs/audit/reviews/cmspark-mcp-server-strategy-verdict-20260803-150011.json`

| Reviewer | Verdict | Artifact |
|----------|---------|----------|
| Claude | **APPROVE_WITH_NITS** | `docs/audit/reviews/cmspark-mcp-server-strategy-claude-20260803-150011.md` |
| Pi | **APPROVE_WITH_NITS** | `docs/audit/reviews/cmspark-mcp-server-strategy-pi-20260803-150011.md` |
| Combined | **both_ok=true** | exit 0 |

**Primary SoT reviewed:** `docs/decisions/cmspark-as-mcp-server-adversary-synthesis-2026-08-03.md`

---

## Consensus

1. **No R1–R7 rejection gate fires.** Strategy direction is sound.
2. **Preferred option: A** (decision brief + Phase 0 bake-off); B/C remain fail→pivot; D only if T1 fails logged-in irreplaceability.
3. **ADR-020 fit:** Outbound MCP = Composition export of L1; not a new runtime; not 中层 Agent.
4. **Repo-truth checks pass:** Companion is MCP **client only** today; `ws_secret` authenticates Extension↔Companion, **not** MCP callers.

---

## Nits to fold (union of Claude + Pi)

| ID | Topic | Severity for brief | Severity for Phase 0 code |
|----|--------|--------------------|---------------------------|
| **L3+** | Page-text / screenshot outbound = data exfil; default-deny or per-session disclosure (not just cookies/L2 ban) | Must fold into brief | Gate |
| **L4+** | Loopback/stdio ≠ auth; spell grant mechanism (token / signed grant / per-client secret) separate from per-op risk | Must fold | Phase 1 ship gate OK for spike; no confirm-skip in Phase 0 |
| **L8→deliverable** | IDE-driven confirm must not require Side Panel focus (tray / global / focus) | Principle in brief | **Code gate** |
| **L9 (new)** | Dual-entry tab lease / session-bind (reuse ADR-015); conflict default Side Panel wins | Must add lock | **Before interactive Phase 0 tasks** |
| **originWs** | Façade must bind `{ originWs }` on every confirm request (P1-2) | Security section of brief | Code gate |
| **Metrics** | Numeric Phase 0 thresholds (completion rate, confirm burden, timeout actionability) | Fold into protocol | — |
| **Market names** | Add browser-use, BrowserMCP as named C-class; stars directional | Brief refresh | — |
| **Namespace** | Prefer `cmspark__*` tool names vs bare collision with Playwright | Lock or L5 amend | Code |
| **CWS / install** | Explicit non-goal of v0 (don't assume install solved) | Brief | — |
| **ADR slot** | Reserve next ADR (e.g. 022) when converting brief | When writing ADR | — |

---

## Phase gating (agreed)

| Stage | Allowed after dual-review? |
|-------|----------------------------|
| Decision brief with L1–L9 + nits folded | **Yes** |
| Phase 0 experiment design (T1–T3 + metrics) | **Yes** |
| Phase 0 **code** (stdio façade, interactive tools) | Only after **L8 deliverable + L9 lease + originWs + content disclosure** specified |
| Product ship / default-on / CWS claim | **No** — after Phase 0 pass + grant model (Phase 1) |

---

## Recommended next step

1. Author decision brief (or ADR draft) folding nits above into locks.  
2. Freeze Phase 0 protocol with numeric pass/fail.  
3. Do **not** start façade implementation until L8/L9/originWs/content-disclosure are written as DoD.

## Follow-through

- **Decision SoT (2026-08-04):** [ADR-022](../adr/022-outbound-mcp-server.md) — Accepted; brief retained as process.  
- **Brief (historical):** [cmspark-as-mcp-server-brief-2026-08-03.md](cmspark-as-mcp-server-brief-2026-08-03.md) — L1–L9 folded into ADR.  
- **Backlog:** [optimization-plan-post-adr-020.md](../optimization-plan-post-adr-020.md) §C row「Outbound MCP Server」.  
- Implementation: P0c façade skeleton present; live bridge / L8 / L9 / bake-off still open.

---

*Both external reviewers APPROVE_WITH_NITS · 2026-08-03.*
