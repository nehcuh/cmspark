# Dual / Pi milestone review: Unattended desktop M2 (extension UX)

**Stage:** M2 implementation — Chrome extension  
**Date:** 2026-08-02  
**Batch id:** `unattended-desktop-m2`  
**Depends on:** M1 companion grant (APPROVE_WITH_NITS)

## Diff focus

1. `chrome-extension/src/sidepanel/components/autopilot-tier.ts` — unattended tier, matrix column, `trustStatusChip`
2. `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` — 无人值守 radio, dual checkbox, phrase → `security.unattended.arm`
3. `chrome-extension/src/sidepanel/components/StatusRail.tsx` / `SafetyStrip.tsx` — 值守中 · 桌面 chip + disarm
4. `chrome-extension/src/sidepanel/store/agentStore.tsx` — `unattended` state
5. `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` — status hydrate
6. `chrome-extension/src/background/index.ts` — forward arm/disarm/status
7. `chrome-extension/tests/autopilot-tier.test.ts`

## M2 acceptance

| ID | Expect |
|----|--------|
| T2-1 | 运行自主度 has 无人值守 radio + matrix 值守 column |
| T2-2 | Arm unattended requires two checkboxes + phrase |
| T2-3 | Chip shows 值守中 · 桌面 when grant armed |
| T2-4 | Disarm clears unattended + cruise flags |
| T2-5 | Switching to browser arm disarms unattended grant |
| T2-6 | Protocol unlock advanced copy still 不含桌面 |

## Rejection gates

| # | Gate |
|---|------|
| R1 | UI claims zero-risk unattended |
| R2 | Arm unattended without phrase |
| R3 | Chip only shows cruise when unattended armed (priority wrong) |
| R4 | Pack path can arm (should not exist in ext) |

## Output

Findings + VERDICT line APPROVE | APPROVE_WITH_NITS | REJECT
