All checks complete. Here is my review.

---

# Dual / Pi milestone review — Unattended desktop M2 (extension UX), r2

**Batch:** `unattended-desktop-m2-r2` · **Base:** HEAD `c003ff9`

## Process / staleness verification
- Patch file matches the live working tree: `git diff HEAD` lists the same 17 files as the patch header; the `server.ts`, `SettingsSlideout.tsx`, `autopilot-tier.ts` hunks reproduce exactly; untracked core files (`unattended-grant.ts`, its test, ADR-021) read identically. Patch is current.
- Tests executed locally: **extension 391/391 pass** (incl. `sidepanel-state.test.ts` now expecting the 7th `security.unattended.status` message — the r1 blocker B1 is genuinely fixed, not just asserted); **companion 2162 pass / 0 fail** (incl. new `computer-unattended-grant.test.ts`, 20 skipped platform tests).

## Acceptance (verified in code)
| ID | Result | Evidence |
|----|--------|----------|
| T2-1 | ✅ | `unattended` radio (`SettingsSlideout.tsx:701-704`) + 值守 matrix column (`autopilot-tier.ts` `AUTOPILOT_CONSEQUENCE_ROWS`) |
| T2-2 | ✅ | Dual checkboxes (`:823-842`) + phrase; **server-side** re-gate in `armUnattended` → `isValidSecurityArmPhrase` (`unattended-grant.ts:104`). Phrase literal matches across layers: extension `GODMODE_CONFIRM_PHRASE` = `我了解风险` = companion `SECURITY_ARM_CONFIRM_PHRASE` |
| T2-3 | ✅ | `trustStatusChip(_, true)` → `值守中 · 桌面`; hydrated via initial status request + WS relay (background `handleCompanionMessage` relays companion replies back to sidepanel `useWebSocket` → `SET_UNATTENDED_STATUS`) |
| T2-4 | ✅ | Disarm clears grant (`security.unattended.disarm { clear_cruise:true }` → `disarmUnattended()` + flag clear) + `disarmAllFlags()` — in Settings, StatusRail, SafetyStrip |
| T2-5 | ✅ | Non-unattended arm path sends `security.unattended.disarm` + `SET_UNATTENDED_STATUS armed:false` (`SettingsSlideout.tsx:430-433`) |
| T2-6 | ✅ | `full_protocol` hint `仍不含桌面` (`:682`); advanced gate copy `不跳过 … 桌面操控` (`:1086`); protocol message `不含 shell/CU/spawn forceConfirm` (`:306`) |

## Rejection gates — none tripped
- **R1** no zero-risk claim: red disclosure "键入内容将在执行前**不再**逐字预览"; 急停/硬拒 仍有效; matrix + footnotes disclose scope; ADR-021 §7 accepts OCR-blind residual.
- **R2** arm without phrase: blocked in UI (phrase check `:355` precedes ack check `:359`) and re-validated companion-side.
- **R3** chip priority: `trustStatusChip` returns `值守中 · 桌面` first, cruise only when not armed — correct priority.
- **R4** pack path: `FORBIDDEN_PACK_KEYS` adds `unattended` / `unattended_computer` / `unattended_desktop`; arm is a WS message type, not a pack tool.

## ADR-020 / trust-monotonicity checks (executed)
- `hostComputerTrustSkip` set **only** by `g1InitialSkipEligible` or `evaluateUnattendedHostComputerSkip`; `auto_approve_*` / `allow_all_schemes` alone never set it (`server.ts:1321` gate unchanged).
- Skip floors enforced: live `assertCoordinateAllowed` (throws → `failC`, so the hardcoded `coordinateAllowed: true` in the no-session branch is safe), non-experimental, `modelEnabled===false`, credential latch (session path), budget/actions ≤ 30 caps, 8h wall-clock TTL, process-memory only (restart clears).
- Mid-task re-L2 untouched: `executor.ts` `reL2()`/`reL2ShouldPrompt`/`PROMPT_ALWAYS_TAGS` never consult the grant — danger/experimental/foreground-yielded still prompt.
- No new confirmation family → no originWs regression; no new runtime (grant, not agent); multi-agent worker hard-deny retained (ADR-017 D7 unchanged).
- r1's always-true optimistic arm (`resp?.armed === true || true`) is **removed** — arm now relies on the WS status broadcast and reconciles via follow-up `security.unattended.status`. N1 fixed.

## Nits (non-blocking)
1. **includeProtocol corner mismatch** (`message-router.ts:2108-2114`): arming 无人值守 with 同时协议解锁 unchecked does **not** clear a pre-existing `allow_all_schemes=true` (intentional "do not force-clear"), yet the matrix shows 默认阻断† for non-http(s). In the full_protocol→unattended switch, non-http(s) stays auto-approved while the matrix implies blocked. Suggest either force-clearing on arm or a matrix footnote covering the retained state.
2. **Redundant disarm double-write** (`SafetyStrip.tsx:69-70`, `StatusRail.tsx:166-167`): sends both `security.unattended.disarm{clear_cruise:true}` (already clears flags server-side) and `config.set(disarmAllFlags())` — companion config written twice; harmless.
3. **No client TTL poll**: 8h expiry not tracked client-side — chip may show 值守中 · 桌面 until next status hydrate (settings open / reconnect). Companion is SoT and the skip gate checks expiry server-side, so no security impact.
4. **Ack checkboxes not reset** after arm/disarm within the same open session (reset only on settings open) — prior ticks persist on re-entry; likely intentional.
5. **Unrelated files bundled**: `audit-report-cmspark-2026-07-25.md` (+427/−…) and ADR-017/020/design-spec touch-ups ride in the M2 diff — commit-hygiene nit.
6. **Capability declaration (B2 from r1)**: the implementer prompt still lacks the mechanical `Surface/L2-classes/Compose/Autonomy/Trust/Channel` block, which the checklist marks blocking for gate+UI additions. I am **not** treating it as blocking here: ADR-021 (accepted, in-batch, referenced by the prompt) is the formal declaration in substance — Trust (phrase-gated process grant, floors, 8h TTL, monotonicity carve recorded in ADR-020 rule 2), Surface (host_computer initial L2 only), Composition (pack/craft/import forbidden), Autonomy (worker hard-deny retained) — and all five checklist reviewer checks pass. Recommend emitting the mechanical block in future prompts, but this is a process nit in round 2, not a quality defect.

No blocking findings; the r1 red-test blocker is fixed and both suites are green.

VERDICT: APPROVE_WITH_NITS
