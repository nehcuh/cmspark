# M2 Review — Unattended desktop (Chrome extension)

## Process verification
- Patch file matches working tree (`git status` confirms all 7 extension files + companion/server/router/packs changed; patch header = HEAD `c003ff9`).
- Reproduced test runs locally: **companion 17/17 pass** (incl. new `computer-unattended-grant.test.ts`); **chrome-extension suite has 1 failing test**.

## Acceptance (T2-1…T2-6) — verified in code
| ID | Result | Evidence |
|----|--------|----------|
| T2-1 | ✅ | `unattended` radio + 值守 matrix column (`SettingsSlideout.tsx:702`, `autopilot-tier.ts` `AUTOPILOT_CONSEQUENCE_ROWS` adds unattended col) |
| T2-2 | ✅ | Dual checkboxes (`:846`,`:854`) + phrase; **server-side** phrase re-check via `armUnattended` → `isValidSecurityArmPhrase` (`unattended-grant.ts:104`) — not just client copy |
| T2-3 | ✅ | `trustStatusChip(_, true)` → `值守中 · 桌面`; hydrate via `security.unattended.status` in `requestInitialSidePanelData` |
| T2-4 | ✅ | Disarm sends `security.unattended.disarm { clear_cruise: true }` + `disarmAllFlags()` (`SettingsSlideout.tsx:458-466`, `StatusRail.tsx`, `SafetyStrip.tsx`) |
| T2-5 | ✅ | Non-unattended arm path sends `security.unattended.disarm` + `SET_UNATTENDED_STATUS armed:false` (`:430-433`) |
| T2-6 | ✅ | Protocol copy `仍不含桌面` (`:699`); advanced gate copy `不跳过 … 桌面操控` (`:1103`); `:306` CU 不含 |

## Rejection gates
- **R1 (zero-risk claim)** — clean. Copy says 急停/硬拒仍有效, 危险 re-L2 仍确认, 键入不再逐字预览, 重启失效, 本会话. No over-promise.
- **R2 (arm without phrase)** — clean. Both UI gate and companion `armUnattended` gate.
- **R3 (chip priority)** — correct: unattended takes priority over cruise (design §2.2).
- **R4 (pack can arm)** — `FORBIDDEN_PACK_KEYS` adds `unattended*` keys (`packs/types.ts`); arm is a WS message type, not a pack-executable tool.

## Trust-monotonicity / ADR-020 axis checks
- Global bools (`allow_all_schemes`/`auto_approve_*`) **still never** set `hostComputerTrustSkip` (server.ts:1321 gate unchanged); only the phrase-gated process grant or G1 do.
- Skip floors enforced: live `assertCoordinateAllowed` (`:938`), non-experimental, `modelEnabled===false`, credential latch (session path), budget/actions ≤ caps, 8h wall-clock TTL, process-memory only.
- Mid-task PROMPT_ALWAYS / executor hard-denies (A4.3 credential context, A4 payment/captcha) untouched — skip only mints the initial token.
- originWs: no new confirmation family added; host_computer L2 still binds originWs (`:1632`). No regression.

## Blocking findings

**B1 — CI-red: `chrome-extension/tests/sidepanel-state.test.ts` not updated (file:line `chrome-extension/tests/sidepanel-state.test.ts:151-161`).**
`requestInitialSidePanelData` now sends a 7th message `{ type: "security.unattended.status" }` (`useWebSocket.ts:47-49`), but the lock-step test still `deepStrictEqual`s exactly 6 messages. Reproduced: `cd chrome-extension && npm test` → `✖ initial side panel sync … (sidepanel-state.test.js:136)` fail 1. CI runs this suite as a hard gate (`ci.yml:83-90`, whose own comment says drift must be caught "not silently"). The M2 diff updated `autopilot-tier.test.ts` but missed this existing suite — the milestone ships a red extension test gate. This is an incomplete fix of the "tests in scope" requirement.

**B2 — ADR-020 capability declaration missing from the review prompt.**
Per `dual-review-capability-checklist.md`, this diff adds a gate (host_computer initial-L2 skip) and a primary UI entry point (无人值守 radio/arm) — the required `Surface/L2-classes/Compose/Autonomy/Trust/Channel` block is absent from the implementer prompt (substance is covered by ADR-021, but the declaration itself is checklist-mandatory for gates/UI additions).

## Non-blocking defects

**N1 — Always-true optimistic arm state** (`SettingsSlideout.tsx:387`): `armed: resp?.armed === true || true` evaluates to `true` unconditionally. The background forwards the message and replies `{ ok: true }` without the companion's result (`background/index.ts:945-946`), so `resp.armed` never exists; on a disconnected/unpaired WS the arm silently no-ops while the chip claims `值守中 · 桌面` (follow-up `security.unattended.status` is dropped too, so no reconciliation). Should be `resp?.armed === true` and rely on the WS status broadcast (which reconciles on a live connection). Companion `{type:"error"}` replies to this message are also not routed to `autopilotMsg` (`useWebSocket.ts:971` routes only computer.model/apps errors).

**N2 — No-session branch skips the credential-latch floor** (`server.ts:1071-1084`): when `host_computer` runs without a sessionId, `credentialLatched: false` is hardcoded, so ADR-021's "非 credential latch" floor isn't evaluated. Executor-time hard-denies (A4.3) still apply, but the designed OCR latch is absent on this path — worth a follow-up comment/test.

## Overall
The M2 feature itself is well-built: honest copy, server-side phrase gate, correct chip priority, pack arm blocked, trust-monotonicity preserved, and companion gate has real unit tests. But the milestone ships a **failing extension test suite** against the CI hard gate (B1), which is a concrete blocking defect, plus the checklist-required ADR-020 declaration is absent (B2).

VERDICT: REJECT
