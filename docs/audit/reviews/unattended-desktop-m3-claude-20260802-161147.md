## Independent Senior Code Review — Unattended Desktop M3

**Reviewer:** independent (Claude)  
**Repo state verified:** `git status` matches patch; companion tests 2166/0 fail; extension tests 391/0 fail.

### Capability declaration (ADR-020 checklist)
The prompt includes a proper declaration (`Surface: L2 | L2-classes: host_computer | Compose: none | Autonomy: single | Trust: unattended session grant + autopilot packaging | Channel: community|enterprise`). Axes fit (Trust packaging, not new Surface/Composition); no Pack-first violation; no new runtime; experimental layers (modelEnabled) correctly block skip; originWs N/A (handlers mutate process state, no `securityConfirmations.request`).

### Rejection gates — all verified clean
- **R1** `allow_all_schemes` alone skips CU: **does not fire**. `hostComputerTrustSkip` is set ONLY by `g1InitialSkipEligible` (server.ts:1011) or `evaluateUnattendedHostComputerSkip` (server.ts:1040, 1090). god_mode feeds `skipConfirmation`/`autoReason` but is gated by `forceConfirm` (host_computer is critical-class) at server.ts:1321.
- **R2** PROMPT_ALWAYS silenced: **does not fire**. `reL2ShouldPrompt` (session-trust.ts:151) unchanged; called from executor.ts:654 mid-task — independent of the initial-skip grant.
- **R3** Pack can arm: **does not fire**. `unattended`/`unattended_computer`/`unattended_desktop` added to `FORBIDDEN_PACK_KEYS` (packs/types.ts:169-171).
- **R4** Grant disk-persisted: **does not fire**. `let grant: InternalGrant | null = null` (unattended-grant.ts:39); only cruise bools persist; restart clears grant.
- **R5** Zero-residual claim: **does not fire**. ADR-021 §7 and design §3.3/§9 explicitly note accepted residual (OCR-invisible payment UIs).
- **R6** CI red: **does not fire**. companion 2166 pass / 0 fail; extension 391 pass / 0 fail.
- **R7** Matrix lies about type preview: **does not fire**. Matrix row "host_computer 初始 L2 / unattended: 跳过‡" with footnote "键入内容执行前不再逐字预览" — honest.

### Must-verify
1. Skip algebra OR, phrase gate, chip priority — all hold (server.ts:1321, unattended-grant.ts:93-121, autopilot-tier.ts).
2. Docs honest: CU guide §5.1 added; ADR-017 D3/D4, ADR-020 Axis A rule 2, mission-pack, confirm-center all carry the carve-out with cross-links to ADR-021.
3. Tests cover T3-1/2/9 (computer-unattended-grant.test.ts:174-220) + PROMPT_ALWAYS spirit (test file:223-233).
4. Manual checklist exists (docs/superpowers/plans/2026-08-02-unattended-desktop-manual-checklist.md).
5. No Scheme C; estop path untouched.

### Non-blocking nits
- **N1** `chrome-extension/src/sidepanel/components/SafetyStrip.tsx:202` — chip `title` is hardcoded ("运行自主度已武装…"); when `unattendedArmed`, the label is "值守中 · 桌面" but the title doesn't mention 桌面值守. StatusRail.tsx:216-220 already does this correctly with a ternary — port the same pattern.
- **N2** `companion/src/computer/unattended-grant.ts:113` — `logger.warn("security.unattended_armed", …)` uses `warn` for an expected user-initiated arm; other arm paths use `info`. May cause false positives in log-based alerting.
- **N3** `companion/src/computer/unattended-grant.ts:164` — `actionCount >= 0` permits 0-action tasks to be skip-eligible. Benign in practice (host_computer always carries actions), but the looser-than-G1 lower bound is worth a comment.
- **N4** `companion/tests/computer-unattended-grant.test.ts:191` — "T3-2 non-coord app denied at predicate" only tests the pure predicate; in server.ts wiring, `coordinateAllowed: true` is guaranteed by `assertCoordinateAllowed` throwing upstream. The contract is correct; the test name slightly overstates what's verified at the integration boundary.
- **N5** `audit-report-cmspark-2026-07-25.md` — large retroactive rewrite (427 lines) bundled with the feature; not a code-risk but worth noting it's a doc reshape riding the same diff.

VERDICT: APPROVE_WITH_NITS
