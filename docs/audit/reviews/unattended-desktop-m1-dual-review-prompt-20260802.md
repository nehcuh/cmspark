# Dual / Pi milestone review: Unattended desktop M1 (companion grant)

**Stage:** M1 implementation — companion only  
**Date:** 2026-08-02  
**Batch id:** `unattended-desktop-m1`  
**Design:** `docs/superpowers/specs/2026-08-02-unattended-desktop-design.md`  
**Plan:** `docs/superpowers/plans/2026-08-02-unattended-desktop-impl.md` M1  
**ADR:** `docs/adr/021-unattended-desktop-session.md`

## Diff focus (mandatory read)

1. `companion/src/computer/unattended-grant.ts` — grant store, pure predicate, arm/disarm  
2. `companion/src/server.ts` — `hostComputerTrustSkip = g1 || unattended`; audit reasons  
3. `companion/src/message-router.ts` — `security.unattended.{arm,disarm,status}` + dual-write cruise flags  
4. `companion/src/computer/session-trust.ts` — `hasCredentialLatch`  
5. `companion/src/packs/types.ts` — FORBIDDEN keys  
6. `companion/tests/computer-unattended-grant.test.ts`

## M1 acceptance (must verify)

| ID | Expect |
|----|--------|
| T1-1 | Unarmed → no skip |
| T1-2 | !coord → no skip (predicate) |
| T1-3/4/5 | experimental / modelEnabled / latch → no skip |
| T1-6 | armed+coord+caps → skip eligible |
| T1-8 | bad phrase rejects |
| T1-10 | disarm / restart (process memory) clears |
| T1-11 | Audit reason `unattended_session_grant` distinct from god_mode |
| G1 | Existing G1 path not broken |
| R1 | allow_all_schemes alone does not set unattended grant |

## Rejection gates

| # | Gate |
|---|------|
| R1 | allow_all_schemes / auto_approve alone sets hostComputerTrustSkip without grant |
| R2 | PROMPT_ALWAYS path changed / silenced |
| R3 | Pack can arm grant via config keys |
| R4 | Grant persists on disk |
| R5 | Phrase not required on arm |
| R6 | forceConfirm algebra broken for non-CU tools |

## Output

Findings + ADR-020 checklist. End with:

```text
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
