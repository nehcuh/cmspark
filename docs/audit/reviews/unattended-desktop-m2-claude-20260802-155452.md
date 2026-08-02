I have enough evidence to render a verdict. Let me document findings.

## Independent Senior Code Review — `unattended-desktop-m2`

### Capability declaration (ADR-020 checklist)

The implementer prompt body omits the Surface/Compose/Autonomy/Trust/Channel block. The change **does** add primary Side Panel UI (radio + dual checkboxes + chip + disarm wiring), which per the checklist ("blocking when tools/gates/primary UI are added") would normally be a blocking callout. However, ADR-021 is referenced and is the SoT for the capability carve, and ADR-017/020/Trust-IA are all updated in-tree to declare the axes (Surface=L2 host_computer, Composition=none, Autonomy=single, Trust=phrase+matrix+TTL, Channel=community). Treating as a **nit**, not blocking, because the capability context is fully reviewable in the referenced docs.

### M2 acceptance verification (executed / inspected)

| ID | Status | Evidence |
|----|--------|----------|
| T2-1 | ✅ | `autopilot-tier.ts:14` adds `"unattended"` to `AutopilotArmPick`; matrix has `unattended` column (`autopilot-tier.ts:166`); radio rendered in `SettingsSlideout.tsx` diff line ~692 |
| T2-2 | ✅ | `SettingsSlideout.tsx:355-363` — phrase check AND `unattendedAckDesktop && unattendedAckSession` both run before `sendMessage`; companion `armUnattended` re-validates phrase (`unattended-grant.ts:94`) |
| T2-3 | ✅ | `autopilot-tier.ts:79` — `if (unattendedArmed) return "值守中 · 桌面"` has priority over cruise |
| T2-4 | ✅ | `SettingsSlideout.tsx:455-467` + `StatusRail.tsx` + `SafetyStrip.tsx` all send `security.unattended.disarm` (clear_cruise=true) AND apply `disarmAllFlags()`; companion `message-router.ts:2124-2139` clears both |
| T2-5 | ✅ | `SettingsSlideout.tsx:429-434` — non-unattended branch sends `security.unattended.disarm` before arming cruise |
| T2-6 | ✅ | full_protocol hint changed to "上者 + 非 http(s)；仍不含桌面" |

### Rejection gates

| # | Tripped? | Notes |
|---|----------|-------|
| R1 | No | Warning copy explicitly says "键入内容将在执行前不再逐字预览"; ADR-021 §7 acknowledges OCR-blind residual; no zero-risk language |
| R2 | No | Phrase check at line 355 is the FIRST gate, before ack check |
| R3 | No | Unattended takes priority at `autopilot-tier.ts:79` |
| R4 | No | `packs/types.ts` adds `unattended`/`unattended_computer`/`unattended_desktop` to `FORBIDDEN_PACK_KEYS` |

### Trust monotonicity (executed)

- `hostComputerTrustSkip` is set ONLY by `g1InitialSkipEligible` OR `evaluateUnattendedHostComputerSkip` (`server.ts:1011,1040,1090`) — never by `auto_approve_*` / `allow_all_schemes` alone
- Unattended grant requires `coordinateAllowed=true` (assertCoordinateAllowed passed earlier in the same `try` block at `server.ts:938`)
- Process-memory only; companion restart clears (`unattended-grant.ts:39` `let grant: InternalGrant | null = null`)

### Blocking issue (REJECT)

**B1 — Failing CI test (test drift not updated).** `chrome-extension/tests/sidepanel-state.test.ts:146-169` explicitly tracks the exact list of initial-sync messages and contains the comment *"Keep these in lock-step — a new initial-sync message means updating this expected array. The CI extension `npm test` step now catches such drift."* The M2 diff added `sendMessage({ type: "security.unattended.status" })` to `requestInitialSidePanelData` (`useWebSocket.ts:44` of diff) but did NOT update the `expected` array at `sidepanel-state.test.ts:154-161`.

Verified by running `npm --prefix chrome-extension test`:

```
✖ initial side panel sync requests threads, skills, knowledge, config, and mcp servers exactly once per connection
  + { type: 'security.unattended.status' }   ← actual has 7 msgs, expected has 6
ℹ fail 1
```

CI's `npm test` is a hard gate per audit C3. The implementer left a tripwire and tripped it. Fix is one line:

```diff
   { type: "mcp.list" },
   { type: "user_env.list" },
+  { type: "security.unattended.status" },
 ]
```

### Non-blocking nits (for the follow-up)

1. `SettingsSlideout.tsx:387` — `armed: resp?.armed === true || true` always evaluates to `true`; misleading. The success path already implies armed=true (error branch returns early). Drop `|| true` or use `resp?.armed !== false`.
2. `SettingsSlideout.tsx:393-401` optimistic `SET_CONFIG` may set `auto_approve_dangerous/enterprise_tools=true` even when the server's `saveConfig` fails; rely on the existing `config.get` reconciliation (already sent) and drop the optimistic dispatch, or roll back on callback error.
3. `SafetyStrip.tsx`/`StatusRail.tsx` `disarmCruise` sends BOTH `security.unattended.disarm` (with `clear_cruise:true`) AND `config.set(disarmAllFlags())` — the second is redundant when the first succeeds. Harmless but noisy.
4. Client-side chip has no TTL poll — if the 8h grant expires mid-session, chip stays "值守中 · 桌面" until next `security.unattended.status` hydrate. Companion is SoT so not security-critical, but a `setInterval`/visibility re-arm call would tighten UX.
5. `audit-report-cmspark-2026-07-25.md` large doc refresh bundled into M2 diff — should ideally be a separate thematic commit (per [[thematic_commits_preference]]).

VERDICT: REJECT
