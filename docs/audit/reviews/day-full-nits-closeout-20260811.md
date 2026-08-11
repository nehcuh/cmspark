# Day full dual-review nits closeout

**Date:** 2026-08-11  
**Branch:** `fix/c10-godfile-split-a`  
**Source verdict:** `day-20260810-11-full-verdict-20260811-095748.json` (Claude APPROVE / Pi APPROVE_WITH_NITS)

## Nits closed

| Nit | Fix |
|-----|-----|
| image-fetch confirm lacks `originWs` | `image-fetch-admission.ts` passes `{ originWs: ws }` (P1-2 align with L2/URL/MCP) |
| tabUrlCache server-only | New `ws/tab-url-cache.ts`; lifecycle/tool-forward/companion-dispatch consume shared SoT |
| C9 lockstep regex false positives | Brace-scoped `extractValidatorKeys` + extra unit test |
| hot-path `require()` shell/netsec | Static imports of `normalizeShellCwd` / `normalizeNetsecPorts` in `server.ts` |
| image unit gaps (god-mode / cookie trust) | Unit tests for three-flag still confirms + cookie trust does not auto-approve |

## Tests `[executed]`

- image-fetch-admission (incl. originWs + god-mode + cookie trust)
- tab-url-cache
- ws-router-validator-lockstep (4 tests)
- security-gates 63
- computer-unattended-grant + worker-hard-deny

## Residual (none intentional)

All day-full dual-review nits listed by Claude/Pi for production code are addressed.
