# Synthesis: CMspark as external coding-agent browser surface (MCP)

**Date:** 2026-08-03  
**Stage:** Product strategy + architecture direction — **no implementation**  
**Status:** Internal multi-path adversarial complete → dual-review **APPROVE_WITH_NITS** → direction locked in [cmspark-as-mcp-server-brief-2026-08-03.md](cmspark-as-mcp-server-brief-2026-08-03.md)  
**Related:** [ADR-020](../adr/020-capability-model-three-axes.md) · [mcp.md](../mcp.md) · [architecture.md §8](../architecture.md) (Companion today is **MCP client only**)

---

## 0. One-sentence thesis under review

> Do **not** ship a generic “better Browser MCP.” If we expose outward at all, ship a **rentable, refuseable, auditable L1 browser surface** for coding agents — complementary to Playwright (stateless automation) and Chrome DevTools MCP (debug loop) — and **only expand tool surface after a Phase 0 experiment proves logged-in-session irreplaceability**.

---

## 1. Capability declaration (ADR-020)

```text
Surface:      L1 (export path); L2 MUST NOT be in default outbound profile
L2-classes:   (none exported by default) — host_computer | host_read | host_write | host_app | shell | netsec forbidden in default MCP
Compose:      mcp-server (outbound façade) + optional skill (adoption) + optional pack (scenarios)
Autonomy:     single (outbound); multi-worker/board remain Side Panel / internal unless separately designed
Trust:        existing domain confirm + L2 confirm + pairing; MUST add MCP-caller / grant model (not designed yet)
Channel:      community default; enterprise modules never in default outbound set
```

**Axis placement:** Outbound MCP is **Composition export of Surface L1**, not a new runtime, not “中层 Agent.”

---

## 2. Problem / JTBD

| Actor | JTBD |
|-------|------|
| Coding agent user (Claude Code, Cursor, Grok Build, Kimi…) | Drive **real logged-in Chrome** (SSO, cookies, open tabs) to verify UI, read internal docs, click preview — without re-login in a clean Playwright profile |
| CMspark product | Expand distribution without abandoning Side Panel Agent; avoid becoming a dumb tool-only brand |
| Security-conscious user | Keep **refuse / audit / domain gates**; no silent god-mode via IDE |

---

## 3. Market map (public signals, 2026-08)

| Archetype | Examples | Scale (approx.) | Path |
|-----------|----------|-----------------|------|
| A. Headless / clean automation | Playwright MCP (Microsoft) | ~35k⭐ | Fresh browser, a11y snapshots, E2E |
| B. Official debug surface | Chrome DevTools MCP (Google) | ~48k⭐ | Performance, network, inspect for coding agents |
| C. Real daily Chrome + extension | Browser MCP (~100k CWS users), hangwin/mcp-chrome (~12k⭐), AgentDesk browser-tools (~7k⭐) | Mature | Inherit login + fingerprint |
| D. Cloud stealth browser | Human Browser etc. | Commercial MCP | Anti-bot / remote profile |

**Implication:** Category C is **not empty**. Commodity “list_tabs / click / screenshot” has no #2 slot. Differentiation must be **Trust + HITL + scenario Pack**, not tool count.

---

## 4. Three adversarial paths (internal)

### Path A — Advocate

- MCP is the USB-C for coding agents; Skill alone cannot drive CDP.
- CMspark already has L1 tools, pairing (`ws_secret`), domain whitelist, confirm center, tab lease, audit — missing is **server façade** (today Companion is MCP **client** only).
- Logged-in real Chrome is the only JTBD A/B do not own cleanly.
- Moat candidates: trust monotonicity (ADR-020), Cockpit/HITL, Pack composition, optional enterprise (never default outbound).

### Path B — Skeptic

- C-class commoditized; DevTools MCP eats “coding feedback loop”; Playwright eats CI/E2E.
- Security research: extension + local MCP bridge = high-privilege channel (native messaging / pipe hijack, multi-client coexistence).
- `ws_secret` trusts Extension↔Companion, **not** arbitrary MCP clients (Claude process / poisoned skill).
- Product self-cannibalization: outbound dumb plane vs Side Panel agent fighting same tabs.
- Install friction (sideload + daemon + pair + MCP JSON) loses to `npx` + Web Store.
- Screenshot/page content into cloud LLM = data exfil vs “local privacy” marketing.

### Path C — Implementer

- If ship: **Trust contract export**, not tool dump.
- Phase 0: 6–8 low-risk tools, stdio MCP, tray+panel confirm, bake-off vs Playwright on logged-in task.
- Profiles: `coding-agent-readonly` | `coding-agent-interact` | never default-export L2/cookies/shell.
- Single tool registry → both internal + MCP schemas.
- Tab lease / session bind so Side Panel and MCP clients do not thrash.
- Complementary positioning sentence (locked for review):

  > Playwright = stateless automation · DevTools MCP = debug loop · CMspark = controlled operations on **already-logged-in** browser.

---

## 5. Current integration posture (as-is)

```text
TODAY:
  [External MCP servers] --client--> Companion --LLM--> tools --WS--> Extension/CDP
  User primary entry: Side Panel

C-CLASS MARKET:
  [Claude/Cursor] --MCP client--> light MCP server --> Extension --> real Chrome
  User primary entry: IDE agent

PROPOSED FLIP (under review):
  [Claude/Cursor] --MCP--> Companion façade --> same security stack --> Extension
  Side Panel LLM path remains concurrent → requires lease / grant rules
```

| Asset | Outbound implication |
|-------|----------------------|
| MCP client stack | Transport skill transferable; **server is new work** |
| WS + `ws_secret` | Does not equal MCP caller auth |
| L2 / whitelist / Cockpit | Differentiator **and** friction |
| Tab lease / multi-worker | Reuse for dual-entry contention |
| Pack / Skill / Knowledge | Scenario layer competitors rarely ship |
| Heavy Companion | Install path heavier than Browser MCP |

---

## 6. Locked recommendations (proposal — dual-review may amend)

| # | Lock | Rationale |
|---|------|-----------|
| L1 | **No all-in generic Browser MCP** without Phase 0 falsification | Commodity risk |
| L2 | **Primary narrative stays Side Panel Agent**; outbound is Composition export | ADR-020, brand |
| L3 | **Default outbound = L1 subset only**; cookies / evaluate / L2 / shell / netsec **out** | Trust + exfil |
| L4 | **MCP caller is untrusted** until grant; ops gated by risk, not “came from MCP” | Threat model |
| L5 | **Skill = adoption only**; capability body = MCP (or equivalent tool protocol) | Interop |
| L6 | **CI/headless is Playwright’s field** — do not compete there | Positioning |
| L7 | Phase 0 success = logged-in task **impossible or much worse** on Playwright; public localhost may lose to Playwright | Experiment design |
| L8 | Confirm UX (tray/global) is **product**, not afterthought | HITL when user stares at IDE |

### Explicit non-goals (v0)

- Exposing full internal tool catalog via MCP  
- Default-export Computer Use / Host / shell / netsec  
- Replacing Side Panel as primary product  
- Cloud multi-tenant “browser SaaS”  
- Claiming privacy while shipping unrestricted screenshots to third-party LLMs without disclosure  

---

## 7. Phase 0 experiment protocol (proposed)

| Task | Expectation |
|------|-------------|
| T1 Internal/SSO page already open or logged-in | CMspark should win or sole viable |
| T2 localhost PR preview, clean state OK | Playwright may win — acceptable |
| T3 Public marketing page scrape | Playwright may win — acceptable |

**Pass criteria (draft):** T1 completion rate/time + user confirm burden documented; confirm-timeout errors actionable; no cookie tools in surface; audit line per tool call.

**Fail → pivot:** read-only observability MCP only, or vertical Pack API (e.g. AppSec page check), not general automation façade.

---

## 8. Blind spots called out (must not be forgotten)

1. Malicious / multi MCP clients; confirmation fatigue → blanket allow  
2. Cloud context exfil (screenshots, page text)  
3. Dual-agent tab fights; Companion restart / SW sleep / stdio parent death  
4. Store distribution vs sideload  
5. Brand dilution (“just another browser MCP”)  
6. Enterprise compliance for OA/mail automation  
7. Tool naming collisions with Playwright MCP in same client  
8. Registry dual-write debt  

---

## 9. Decision options for dual-review

| Option | Meaning |
|--------|---------|
| **A — Proceed to decision brief + Phase 0** | Write full brief, run bake-off, no product ship yet |
| **B — Observability-only MCP** | console/network/DOM/screenshot read-only; interact stays Side Panel |
| **C — Vertical only** | e.g. AppSec Pack-shaped API, no general browser MCP |
| **D — Do not outward-MCP now** | Invest in Side Panel + install UX; reassess after store/onboarding |

**Internal synthesis preference:** **Option A** with locks L1–L8; reject jumping to full C-class clone.

---

## 10. What dual-review is asked to judge

1. Is market reading (A/B/C/D archetypes) accurate enough to set strategy?  
2. Are locks L1–L8 sufficient / over-constrained / missing a blocker?  
3. Is Option A the right next step vs B/C/D?  
4. Any **REJECT-level** strategic or security gap before writing ADR/brief or coding?  
5. ADR-020 fit: Composition export of L1 without new runtime?

---

*End of internal adversary synthesis — 2026-08-03.*
