# Outbound MCP P0d — automated preflight (2026-08-04)

| Field | Value |
|-------|--------|
| Operator | Grok Build (automated) |
| Host | Windows |
| Main tip | `42dc49b` (#117) · S42 #118 included |
| Companion | `node companion/dist/index.js start` (fresh build) |
| Full T1–T3 | **Not run** — needs human SSO task + Playwright control arm |

---

## 0. Environment checks

| # | Check | Result | Notes |
|---|--------|--------|-------|
| E1 | Companion port 23401 | **PASS** | Started for this session; was closed before |
| E2 | Extension Side Panel connected | **PASS** | health `runner:"wired"`; Client connected log |
| E3 | Outbound health | **PASS** | `{"status":"ok","runner":"wired","service":"outbound-mcp"}` |
| E3b | Health unauthenticated | **PASS** | GET health works without Bearer (by design) |
| E4–E6 | Grok MCP / doctor / new session | **SKIP** | Human / IDE |
| E7 | Playwright MCP control | **SKIP** | Human |
| E8 | Score sheet | Partial | this file |

---

## Automated probes (loopback HTTP + Bearer ws_secret)

| Probe | Expect | Result |
|-------|--------|--------|
| `cmspark__list_tabs` | ok + tabs | **PASS** — returned live tabs (github, x.com, …) |
| Forbidden `cmspark__shell_exec` | `PROFILE_FORBIDDEN` | **PASS** — `error_code: PROFILE_FORBIDDEN` |
| Forbidden `cmspark__evaluate` | `PROFILE_FORBIDDEN` | **PASS** — same |
| `get_page_text` without disclosure | `DISCLOSURE_REQUIRED` | **PASS** — `error_code: DISCLOSURE_REQUIRED` + zh text |
| `POST /disclosure` `acknowledge:true` | ok | **PASS** |
| `get_page_text` after disclosure | ok | **PASS** — returned text (len≈3735; not logged) |
| `navigate` → example.com | confirm or auto-approve | **PASS** ok — completed (likely domain auto-approve / trusted path; not a hang) |

**Profile violations (banned tool success): 0** in this probe set.

---

## S42 residual validation (quick)

| Claim | Evidence |
|-------|----------|
| Extension-only runner | `runner:"wired"` with extension connected |
| No hang on invoke | All probes returned HTTP ≤45s |
| Disclosure server-side | No-disclosure denied; accept then allow |

---

## L7 / P0d status

| Item | Status |
|------|--------|
| Automated preflight | **PASS** (environment viable) |
| T1 SSO vs Playwright | **NOT RUN** |
| T2 localhost | **NOT RUN** |
| T3 public | **NOT RUN** |
| **L7 verdict** | **INCONCLUSIVE** (preflight only — not a fail) |

---

## Blockers for full bake-off (human)

1. Configure Grok (or other) `mcp-outbound` + **new session** with tools mounted  
2. Pick non-sensitive or authorized SSO page for T1  
3. Playwright MCP clean profile control arm  
4. Fill score table in [P0d checklist](../../superpowers/plans/2026-08-04-outbound-mcp-p0d-bakeoff-checklist.md) §3  

---

## Next engineering (parallel)

- **Grant design draft**: [outbound-mcp-l4-grant-design-2026-08-04.md](../../decisions/outbound-mcp-l4-grant-design-2026-08-04.md)  
- Do **not** implement grant as product ship until P0d T1 PASS (ADR-022)

---

## Companion lifecycle note

Preflight started Companion via `node dist/index.js start` in a background session. Operator may stop it when done:

```powershell
# stop whatever holds :23401, or close the background agent job
```
