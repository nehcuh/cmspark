# Brief: CMspark as outbound browser surface for coding agents (MCP)

| Field | Value |
|-------|--------|
| Date | 2026-08-03 |
| Status | **DIRECTION LOCKED** — dual-review Claude+Pi both **APPROVE_WITH_NITS** (nits folded below); **no implementation** until Phase 0 DoD met |
| Authors | Grok (multi-path adversary) + Claude/Pi dual-review |
| Related | [ADR-020](../adr/020-capability-model-three-axes.md) · [mcp.md](../mcp.md) · architecture §8 (Companion = MCP **client** today) · [ADR-015](../adr/015-multi-agent-orchestrator-tab-lock.md) tab lease |
| Process | [adversary synthesis](cmspark-as-mcp-server-adversary-synthesis-2026-08-03.md) · [dual-review synthesis](cmspark-as-mcp-server-dual-review-synthesis-2026-08-03.md) · artifacts `docs/audit/reviews/cmspark-mcp-server-strategy-*20260803-150011*` |
| Non-goals (v0) | Full tool catalog dump; default L2/cookies/shell/netsec; cloud multi-tenant browser SaaS; Skill-only “browser service”; CWS install parity as Phase 0 deliverable |

---

## 0. Why this document

CMspark has a stable L1 browser Agent (Extension + Companion + trust gates). A natural next product question:

> Can we expose that surface to **external** coding agents (Claude Code, Cursor, Grok Build, Kimi, …) via Skill and/or MCP?

Market already has Playwright MCP, Chrome DevTools MCP, and real-Chrome extension MCPs (Browser MCP, mcp-chrome, AgentDesk, …). This brief **locks direction** for later optimization — not a ship plan.

---

## 1. One-sentence positioning

> **Do not** ship a generic “better Browser MCP.”  
> If we outward-export at all: a **rentable, refuseable, auditable L1 browser surface** for coding agents — complementary to Playwright (stateless automation) and Chrome DevTools MCP (debug loop) — proven only after Phase 0 shows **logged-in-session irreplaceability**.

**Product primary narrative remains** Side Panel Agent. Outbound MCP is **Composition export**, not a second product identity.

---

## 2. Capability declaration (ADR-020)

```text
Surface:      L1 (outbound export); L2 NEVER in default outbound profile
L2-classes:   (none by default) — host_* / shell / netsec forbidden in default set
Compose:      mcp-server (outbound façade) + optional skill (adoption) + optional pack (scenarios)
Autonomy:     single for outbound; multi-worker/board stay internal unless separately designed
Trust:        domain confirm + L2 confirm + pairing; MCP-caller grant REQUIRED before product ship
Channel:      community default; enterprise modules out of default outbound set
```

| Axis | Placement |
|------|-----------|
| **Composition** | Outbound MCP = export of existing tools under a profile |
| **Surface** | L1 only by default (narrower than internal L1: no cookies/evaluate unless later grant) |
| **Autonomy** | Not a new orchestrator; no silent fan-out |
| **Forbidden language** | Not “中层 Agent” / not a new runtime |

---

## 3. Market posture (directional)

| Archetype | Role vs us |
|-----------|------------|
| **A Playwright MCP** | Stateless / CI / a11y — **do not compete** |
| **B Chrome DevTools MCP** | Coding debug loop (perf, network, inspect) — **complement** |
| **C Real Chrome + extension** (Browser MCP, mcp-chrome, AgentDesk, browser-use class) | Contested — we win only on **Trust + HITL + Pack + audit**, not tool count |
| **D Cloud stealth browser** | Different threat (anti-bot) — out of scope |

C-class is **not empty**. Commodity click/screenshot has no durable #2 slot.

---

## 4. Locked decisions (L1–L9)

Nits from dual-review (2026-08-03) are **folded in**.

| ID | Lock |
|----|------|
| **L1** | No all-in generic Browser MCP without Phase 0 falsification of logged-in irreplaceability. |
| **L2** | Primary narrative stays **Side Panel Agent**; outbound is Composition export only. |
| **L3** | Default outbound profile = **curated L1 subset**. Forbidden by default: cookies, evaluate, L2 (host/CU), shell, netsec. |
| **L3+** | Tools that return **page text / screenshots / DOM snapshots** to a third-party LLM are **data-exfil**. Default-deny or require **per-session / per-task disclosure** before enable. Privacy marketing must not claim “local only” while these tools stream to cloud models. |
| **L4** | **MCP caller is untrusted.** Ops gated by **risk of the operation**, never by “came from MCP.” |
| **L4+** | **Loopback / stdio / parent PID ≠ authentication.** Grant model (per-caller token, signed grant, or user-pasted client secret — TBD in design) is a **Phase 1 ship gate**. Phase 0 may not implement confirm-skip. |
| **L5** | **Skill = adoption only** (when/how/which tools). Capability body = MCP (or equivalent tool protocol). Prefer outbound tool namespace **`cmspark__*`** to avoid collision with Playwright MCP. |
| **L6** | CI / headless is Playwright’s field — do not position CMspark there. |
| **L7** | Phase 0 success criterion: on **logged-in / SSO** tasks, CMspark is sole viable or clearly superior; public/localhost clean tasks may lose to Playwright. |
| **L8** | Confirm UX is product. For any outbound **code** path: each call needing confirm MUST surface allow/deny **without requiring Side Panel focus** (tray notification, global affordance, or forced focus). Side Panel–only confirm is **insufficient** for IDE-driven agents. |
| **L9** | **Dual-entry tab lease** mandatory for interactive outbound profiles: reuse ADR-015 tab lease; concurrent Side Panel + MCP must not thrash the same tab. Conflict default: **Side Panel wins**, MCP queues with disclosure. Required before Phase 0 **interactive** tasks (else bake-off metrics invalid). |

### Security hand-off (code DoD when façade exists)

- Every `securityConfirmations.request` from the outbound façade **must** bind `{ originWs: <mcp-bound socket or synthetic origin> }` (P1-2 / originWs discipline).  
- Audit: one structured line per outbound tool call (caller id, tool, domain, confirm outcome).  
- Phase 0 stdio-only; **not** default-on for any install.

---

## 5. Options (decision freeze)

| Option | Meaning | Status |
|--------|---------|--------|
| **A** | Decision brief + Phase 0 bake-off; no product ship | **SELECTED** |
| **B** | Observability-only MCP (console/network/DOM/screenshot read paths) | Phase 0 **fail → pivot** |
| **C** | Vertical only (e.g. AppSec Pack-shaped API) | Phase 0 fail alternate pivot |
| **D** | No outward MCP for now | Only if T1 fails logged-in irreplaceability or trust DoD cannot be met |

---

## 6. Phase 0 experiment protocol

### Tasks

| ID | Task | Expectation |
|----|------|-------------|
| T1 | Internal / SSO page already logged-in in **user** Chrome | CMspark should win or be sole viable |
| T2 | localhost PR preview, clean state OK | Playwright may win — acceptable |
| T3 | Public marketing page | Playwright may win — acceptable |

### Pass / fail metrics (numeric — dual-review N5)

Record for T1 (primary):

| Metric | Draft threshold (tune in spike plan) |
|--------|--------------------------------------|
| Task completion rate | ≥ 80% within time box without manual browser surgery |
| Median confirm count | Documented; timeouts must return **actionable** MCP errors (not hang) |
| Confirm resolution without Side Panel focus | If tray/global path exists: ≥ 90% of needed confirms resolved &lt; 45s without user opening Side Panel; if path absent, Phase 0 **only** measures fail-closed timeouts (confirm-burden metric void) |
| Audit completeness | 100% of tool calls leave an audit line |
| Profile violations | Zero calls to forbidden tools (cookies/evaluate/L2/shell/netsec) |

**Fail →** pivot to Option B or C; do not expand tool surface.

**Non-sensitive pages only** for bake-off unless disclosure is explicit (L3+).

---

## 7. Phased roadmap (optimization backlog — not current sprint)

| Phase | Deliverable | Gate |
|-------|-------------|------|
| **P0a Docs** | This brief (done) + optional ADR-022 when implementing | Dual-review already passed |
| **P0b Protocol** | Spike plan with tool whitelist (6–8), metrics sheet, disclosure copy | Locks L1–L9 |
| **P0c Spike code** | stdio MCP façade; readonly-first; tray/global confirm path; tab lease; originWs | DoD: L8, L9, L3+, originWs |
| **P0d Bake-off** | T1–T3 vs Playwright MCP | L7 metrics |
| **P1** | Grant model (L4+); interact profile; install docs; still not default-on | Dual-review |
| **P2+** | Pack scenarios; optional observability expansion; CWS/distribution only after trust story holds | Separate dual-review |

**Install / CWS:** explicit **non-goal of v0** — do not assume sideload friction is solved in Phase 0.

---

## 8. Explicit non-goals (v0)

1. Exposing the full internal tool catalog via MCP  
2. Default-export Computer Use / Host / shell / netsec / cookies / evaluate  
3. Replacing Side Panel as primary product  
4. Cloud multi-tenant “browser as SaaS”  
5. Claiming local privacy while unrestricted screenshots/page text go to third-party LLMs  
6. Skill-only path as “browser service for external agents”  
7. Competing on CI/headless E2E with Playwright  

---

## 9. Blind spots (keep on every design review)

1. Malicious / multi MCP clients; confirmation fatigue → blanket allow  
2. Cloud context exfil (page text, screenshots)  
3. Dual-agent tab fights without L9  
4. Companion restart / Extension SW sleep / stdio parent death  
5. Store distribution vs sideload friction  
6. Brand dilution (“just another browser MCP”)  
7. Enterprise compliance (OA / mail automation)  
8. Tool naming collisions — mitigate with `cmspark__*`  
9. Single tool registry → generate internal + MCP schemas (no dual-write)  

---

## 10. Repo truth (as of 2026-08-03)

| Claim | Status |
|-------|--------|
| Companion is MCP **client** only | True (`companion/src/mcp/` client/manager/aggregator/transport) |
| `ws_secret` authenticates Extension↔Companion | True — **does not** auth MCP callers |
| Tab lease exists (ADR-015) | True — **reuse** for L9, do not invent parallel lock |
| Confirm center is Side Panel / Cockpit centric today | True — L8 is a **gap** for IDE agents |

---

## 11. Next actions when we pick this up

1. Write Phase 0 spike plan (tool list + metrics sheet + disclosure UX).  
2. Optionally open **ADR-022** (outbound MCP server) when code is authorized.  
3. Implement only after P0c DoD checklist green.  
4. Keep this brief as **SoT** until ADR supersedes.

---

## 12. Change log

| Date | Change |
|------|--------|
| 2026-08-03 | Internal multi-path adversary (Advocate / Skeptic / Implementer) |
| 2026-08-03 | Dual-review Claude + Pi **APPROVE_WITH_NITS** → nits folded as L3+/L4+/L8 deliverable/L9/originWs/metrics/`cmspark__*` |
| 2026-08-03 | Brief status **DIRECTION LOCKED** for optimization backlog |

---

*End of brief. Linked from optimization-plan Composition track.*
