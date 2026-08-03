# Dual external re-review: CMspark as MCP Server for external coding agents (strategy)

**Stage:** Product strategy + multi-path adversarial synthesis — **implementation has NOT started**  
**Date:** 2026-08-03  
**Repo:** `/Users/huchen/Projects/cmspark`  
**Batch id:** `cmspark-mcp-server-strategy`

## Required reading (in order)

1. **Primary SoT (adversary synthesis)**  
   `docs/decisions/cmspark-as-mcp-server-adversary-synthesis-2026-08-03.md`  
   Focus: §0 thesis, §1 capability declaration, §3 market map, §4 three paths, §6 locks L1–L8, §7 Phase 0, §8 blind spots, §9 options A–D.

2. **Capability ontology**  
   `docs/adr/020-capability-model-three-axes.md`  
   Focus: Composition vs Surface; “MCP is not 中层 Agent”; Pack-first; trust monotonicity.

3. **Current MCP posture (client only)**  
   `docs/mcp.md` (intro + role)  
   `docs/architecture.md` §8 MCP — Companion as **MCP client/aggregator**, not server.

4. **Trust / confirm surfaces (spot-check for realism of locks)**  
   - `docs/confirm-center-user-guide.md` (skim confirm UX)  
   - `companion/src/ws-auth.ts` (pairing / `ws_secret` — confirm it does **not** auth MCP callers)  
   - `companion/src/mcp/` (client-only modules; no outbound server today)  
   - Optional: `docs/adr/021-unattended-desktop-session.md` only if you challenge L8 / unattended grants for IDE agents

5. **Do NOT treat as SoT**  
   Chat transcripts; this prompt’s paraphrases lose to the synthesis file.

## Product premise (must not be weakened without REJECT-level argument)

```text
Question: Should CMspark expose the browser plugin as a service for external
  coding agents (Grok Build, Claude Code, Kimi, Cursor, …) via Skill and/or MCP?

Internal multi-path conclusion (under review):
  - Skill alone is insufficient (adoption layer only)
  - Generic “Browser MCP clone” is the wrong product
  - If anything: Composition export of curated L1 with Trust/HITL/audit
  - Complementary to Playwright MCP + Chrome DevTools MCP
  - Phase 0 bake-off required before any ship
  - Default never export L2 / cookies / shell / netsec
  - MCP caller is untrusted until explicit grant model exists
```

## Capability declaration (from synthesis — challenge if wrong)

```text
Surface:      L1 (export); L2 not in default outbound profile
L2-classes:   (none by default)
Compose:      mcp-server (outbound) + optional skill + optional pack
Autonomy:     single for outbound unless separately designed
Trust:        domain + L2 confirm + pairing; MCP-caller grant NOT YET DESIGNED
Channel:      community default; enterprise modules out of default set
```

## Your job

Independent **product strategy + security threat + ADR-020 fit + market realism** review of the **synthesis document**.  
There is **no implementation diff** — git may only show new docs under `docs/decisions/` and this prompt.  
Use tools to verify claims about **current** repo (MCP client-only, ws-auth scope, tool surface existence).

### Must answer

1. Is the four-archetype market map (Playwright / DevTools MCP / real-Chrome extension MCP / cloud stealth) good enough to set strategy, or fatally wrong?  
2. Are locks **L1–L8** coherent with ADR-020? Any missing **blocking** lock?  
3. Preferred option among **A/B/C/D** (§9)? If not A, why?  
4. Is “MCP caller untrusted + grant model TBD” an acceptable Phase 0 risk, or **block until designed**?  
5. Confirm UX for IDE-driven calls (user not looking at Side Panel): is L8 sufficient, or is tray/global confirm a **Phase 0 gate**?  
6. Data-exfil (screenshots/page text → third-party LLM): does synthesis under-treat disclosure / default deny?  
7. Self-cannibalization of Side Panel Agent: does dual-entry lease need to be a **lock** before Phase 0 code?  
8. What would make you **REJECT** writing even a decision brief / Phase 0 spike?

### Rejection gates (any fail → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | Synthesis recommends shipping full L2 / shell / cookies / evaluate in **default** outbound MCP |
| R2 | Treats outbound MCP as a new Agent runtime / “中层 Agent” instead of Composition export of L1 |
| R3 | Claims `ws_secret` pairing already authenticates external MCP clients (false) |
| R4 | All-in generic Browser MCP product without Phase 0 or without complementary positioning vs Playwright/DevTools |
| R5 | Ignores multi-client / malicious MCP client threat (treats localhost as trusted) |
| R6 | Skill-only path presented as sufficient to “serve external agents” with real browser control |
| R7 | Material contradiction with ADR-020 trust monotonicity (deeper surface inherits looser L0) without explicit ADR amend plan |

### Non-blocking nits (→ APPROVE_WITH_NITS)

- Market star counts / user counts as approximate; want more named competitors  
- Phase 0 task table needs pass/fail metrics numeric thresholds  
- Prefer Option B or C as **parallel hedge**, not instead of A  
- Suggest ADR number / doc filename conventions  
- Install/distribution (CWS) called strategic but not locked  
- Wording polish, Chinese/English mix  

### Output format

1. **Findings** — blocking vs nits (cite synthesis § or repo file:line when claiming code falsehood)  
2. **Explicit answers** to Must answer 1–8  
3. **ADR-020 checklist** result (axes fit, pack-first, no new runtime, trust)  
4. **Recommended option** A/B/C/D (or hybrid) and whether Phase 0 may start after nits fold  
5. Final line **exactly** one of:

```text
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```

---

## Reviewer reminder

- Design/strategy review: **do not require a code diff**.  
- Do require repo spot-checks that ground security claims.  
- End with the machine-readable VERDICT line on its own.
