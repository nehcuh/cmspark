I have enough evidence to render a verdict. The prior M2 was REJECT on B1 (test drift). Let me confirm B1 is fixed and run final verification.

Tests pass 391/391. The prior blocking issue (test drift in `sidepanel-state.test.ts`) is fixed — expected array updated to 7 messages including `security.unattended.status`. All M2 acceptance criteria verified.

## Independent Senior Code Review — `unattended-desktop-m2-r2`

### Capability declaration (ADR-020 checklist)

Implementer prompt body lacks the Surface/Compose/Autonomy/Trust/Channel block. Per checklist this would normally be **blocking** since the diff adds primary Side Panel UI (radio + dual checkboxes + chip + disarm wiring). However, ADR-021 is the in-tree SoT and explicitly declares the axes (Surface=L2 host_computer, Composition=none, Autonomy=single, Trust=phrase+matrix+TTL, Channel=community); ADR-017 D3/D4, ADR-020 Axis A rule 2, and Trust IA D4 are all updated in-tree. Treating as **nit**, consistent with prior M1/M2 reviews.

### M2 acceptance verification (executed)

| ID | Status | Evidence |
|----|--------|----------|
| T2-1 | ✅ | `autopilot-tier.ts:14` adds `"unattended"` to `AutopilotArmPick`; matrix `unattended` column at `autopilot-tier.ts:166`; radio in `SettingsSlideout.tsx` diff line ~679 |
| T2-2 | ✅ | `SettingsSlideout.tsx:355-363` — phrase check at line 355 is the FIRST gate, then `unattendedAckDesktop && unattendedAckSession` at 360; companion `armUnattended` re-validates phrase (`unattended-grant.ts:94`) |
| T2-3 | ✅ | `autopilot-tier.ts:79` — `if (unattendedArmed) return "值守中 · 桌面"` priority over cruise |
| T2-4 | ✅ | `SettingsSlideout.tsx:441` (`clear_cruise:true`) + `StatusRail.tsx:167` + `SafetyStrip.tsx:69` all dispatch disarm; companion `message-router.ts:2124-2139` (per patch) clears both |
| T2-5 | ✅ | `SettingsSlideout.tsx:413` — non-unattended branch sends `security.unattended.disarm` before arming cruise |
| T2-6 | ✅ | `SettingsSlideout.tsx` — full_protocol hint: "上者 + 非 http(s)；仍不含桌面" |

### Rejection gates

| # | Tripped? | Evidence |
|---|----------|---------|
| R1 | No | Warning copy: "键入内容将在执行前**不再**逐字预览"; `UNATTENDED_MATRIX_FOOTNOTES` discloses scope; ADR-021 §7 acknowledges OCR-blind residual |
| R2 | No | `SettingsSlideout.tsx:355` — phrase check at line 355 runs before ack check at 359 |
| R3 | No | `autopilot-tier.ts:79` — unattended branch returns first |
| R4 | No | `packs/types.ts` adds `unattended`/`unattended_computer`/`unattended_desktop` to `FORBIDDEN_PACK_KEYS` |

### Trust monotonicity (executed)

- `hostComputerTrustSkip` set ONLY by `g1InitialSkipEligible` OR `evaluateUnattendedHostComputerSkip` (`server.ts:1031,1073`); `auto_approve_*` / `allow_all_schemes` alone never set it
- Unattended requires `coordinateAllowed=true` (assertCoordinateAllowed passed earlier) and `modelEnabled !== true` and `!credentialLatched` and budget/actions ≤ caps
- Process-memory only; companion restart clears (`unattended-grant.ts:39`)
- 8h hard TTL enforced in `isUnattendedArmed`/`getUnattendedStatus`

### B1 (prior REJECT) verification — FIXED

`sidepanel-state.test.ts:154-162` now lists 7 messages including `{ type: "security.unattended.status" }`; comment at line 150-151 updated to "7 messages". `npm --prefix chrome-extension test`: **391/391 pass**.

### Non-blocking nits

1. **Redundant disarm wiring**: `SafetyStrip.tsx:69-70` and `StatusRail.tsx:166-167` send BOTH `security.unattended.disarm{clear_cruise:true}` AND `config.set(disarmAllFlags())`. The first already clears cruise server-side (`message-router.ts` disarm branch with `clear_cruise:true`). Harmless but noisy; companion writes config twice.
2. **No client TTL poll**: 8h grant expiry isn't tracked client-side. If the grant expires mid-session, chip stays "值守中 · 桌面" until next `security.unattended.status` hydrate (settings open or reconnect). Companion remains SoT so not security-critical, but a `setInterval`/visibility poll would tighten UX.
3. **Audit report refresh bundled**: `audit-report-cmspark-2026-07-25.md` (+427/−...) is mixed into the M2 patch. Per [[thematic_commits_preference]] this should be a separate commit.
4. **Ack checkboxes not reset post-arm/disarm**: `handleAutopilotArmConfirm` (line 399-405) and `handleAutopilotDisarm` (line 451-454) clear phrase/confirm but not `unattendedAckDesktop/Session/IncludeProtocol`. They ARE reset on settings open (line 106-108). Re-entering arm dialog within the same session keeps prior ticks. Likely intentional but worth flagging.
5. **Unused `cruiseChipLabel` deprecation alias**: kept for backwards compat (`autopilot-tier.ts:86`) but no remaining call sites after the diff. Either drop or keep for external consumers — current state is a `@deprecated` stub.

VERDICT: APPROVE_WITH_NITS
