# Independent adversary review — Outbound MCP P0c (dispatcher + gate)

You are an **independent adversarial reviewer**, NOT the implementer.  
Do not rubber-stamp. Inspect real code with Read/Grep/Bash.

## Capability declaration (ADR-020)

```text
Surface:      L1 (export curated outbound)
L2-classes:   (none by default)
Compose:      outbound-mcp-server (ADR-022)
Autonomy:     single
Trust:        domain + L2 + originWs discipline + disclosure session; no grant skip; Bearer ws_secret
Channel:      community
```

## Scope

Git range: `origin/main...HEAD` (or attached diff). Focus:

- `companion/src/outbound-mcp/**`
- `companion/src/server.ts` (loopback HTTP + ensureOutboundToolRunnerWired)
- `companion/tests/outbound-mcp*.test.ts`
- `docs/adr/022-outbound-mcp-server.md`, P0c gate plan, mcp.md outbound section

## Machine evidence (already run — re-verify if you wish)

- `npm`/tsc + `node --test` outbound-mcp-facade + outbound-mcp-companion-http → **18/18 pass** claimed

## DoD to attack (M1–M7 + dispatcher)

| ID | Claim | Attack angle |
|----|-------|--------------|
| M1 | tools/list only allowlist | Can meta tools or HTTP expand surface? |
| M2 | Forbidden tools never dispatch | shell/cookies/host via HTTP body? |
| M3 | disclosure_accepted caller bool ignored | forge Bearer + skip disclosure? |
| M4 | Real dispatch path | Can invoke without Extension? SSRF/open relay? |
| M5 | Audit lines | Missing on fail paths? |
| M6 | synthetic origin | Does confirm path bind origin for outbound? Or only Extension WS? |
| M7 | not default-on | Does `start`/`daemon` auto-start mcp-outbound or open unauth HTTP? |
| Auth | Bearer = ws_secret | timingSafeEqual? token leak in logs? non-loopback bind? |
| HTTP | 127.0.0.1 only | If port exposed, blast radius? |
| Dual process | stdio + companion disclosure dual-write | Race: local accept, companion reject / vice versa? |

## Three layers (required)

1. **Outcome** — Does code meet ADR-022 L3/L3+/L4/L4+ and P0c claims?  
2. **Trajectory** — Scope creep? L2 export? god-mode skip?  
3. **Component** — file:line for every finding  

## Explicit non-goals (do not REJECT for these alone)

- L8 tray confirm not implemented yet (documented open)  
- L9 tab lease not implemented yet  
- Live e2e bake-off not run  

Do REJECT if these are claimed complete without evidence.

## Output format

1. Executive summary (3–6 bullets)  
2. Blocking issues (file:line) if any  
3. Nits (file:line)  
4. Residual risk for production bake-off  
5. **Final line exactly one of:**

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
