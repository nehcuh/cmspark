# Final dual review: Unattended desktop M3 (integration + docs + full stack)

**Stage:** M3 — complete M0–M3 deliverable before merge claim  
**Date:** 2026-08-02  
**Batch id:** `unattended-desktop-m3`  
**Repo:** `/Users/huchen/Projects/cmspark`

## Required reading

1. Design SoT: `docs/superpowers/specs/2026-08-02-unattended-desktop-design.md`  
2. Impl plan: `docs/superpowers/plans/2026-08-02-unattended-desktop-impl.md`  
3. ADR-021: `docs/adr/021-unattended-desktop-session.md`  
4. Manual checklist: `docs/superpowers/plans/2026-08-02-unattended-desktop-manual-checklist.md`  
5. Code (full feature):  
   - `companion/src/computer/unattended-grant.ts`  
   - `companion/src/server.ts` (hostComputerTrustSkip OR)  
   - `companion/src/message-router.ts` (arm/disarm/status)  
   - extension autopilot-tier / SettingsSlideout / StatusRail / useWebSocket / background  
6. Tests: `computer-unattended-grant.test.ts`, extension suite green  

## Product premise

```text
Unattended long-run: after phrase arm, host_computer initial L2 skipped for
coordinateAllowed apps; session process memory; 8h TTL; PROMPT_ALWAYS stays;
god/auto_approve alone never skip CU; Pack cannot arm.
```

## Capability declaration

```text
Surface: L2 | L2-classes: host_computer | Compose: none | Autonomy: single
Trust: unattended session grant + autopilot packaging | Channel: community|enterprise
```

## Must verify

1. M1+M2 gates still hold (skip algebra, phrase, chip priority)  
2. Docs honest: CU guide §5.1, confirm-center, mission-pack, ADR-017/020 carve  
3. Tests cover T3-1/2/9 + PROMPT_ALWAYS  
4. Manual checklist exists (WeChat true device optional for APPROVE if automated green + checklist documented)  
5. No Scheme C; estop not weakened  

## Rejection gates

| # | Gate |
|---|------|
| R1 | allow_all_schemes alone skips CU |
| R2 | PROMPT_ALWAYS silenced |
| R3 | Pack can arm |
| R4 | Grant disk-persisted |
| R5 | Docs claim zero residual risk |
| R6 | CI red (companion or extension tests) |
| R7 | Matrix/UI claims type still previewed under unattended |

## Output

Findings + VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT
