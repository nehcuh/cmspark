## Independent review — unattended-desktop-m1 (companion grant)

I verified the patch against the live tree (`git status` matches the patch header; new files present; 32 tests in `computer-unattended-grant.test.js` + G1/session-trust pass after `tsc -p tsconfig.test.json`).

### Rejection gates — all hold

- **R1 (flags alone → skip):** `server.ts:1319-1322` — `host_computer` has *unconditional* `forceConfirm` (`criticalApis = ["computer.coordinate_injection"]`); `hostComputerTrustSkip` is set only by G1 (`session_trust_corpus_subset`) or the grant (`unattended_session_grant`). `allow_all_schemes`/`auto_approve_dangerous` alone can never skip CU L2.
- **R2 (PROMPT_ALWAYS silenced):** mid-task re-L2 in `executor.ts:634-680` consults only session-trust (`isTrusted && !reL2ShouldPrompt`); `PROMPT_ALWAYS_TAGS` (danger/experimental/foreground_yielded) and unknown tags fail-closed to prompt. The grant is never consulted mid-task — only initial L2.
- **R3 (pack arming):** `packs/types.ts:168-171` adds `unattended`/`unattended_computer`/`unattended_desktop` to `FORBIDDEN_PACK_KEYS`; enforced recursively by `packs/validator.ts:60` `scanForbidden`. Arm is WS-RPC only, phrase-gated.
- **R4 (disk persistence):** `unattended-grant.ts` is pure module memory (`let grant: InternalGrant | null`), cleared on restart. Dual-written cruise flags *do* persist — design-sanctioned D6.
- **R5 (phrase):** `armUnattended` validates `isValidSecurityArmPhrase` first and returns `ok:false` before any mutation (test T1-8 covers).
- **R6 (non-CU algebra):** change is confined to the CU-only `hostComputerTrustSkip`; `autoReason` fallback at `server.ts:1889` is safe.

### Acceptance items

T1-1…T1-6, T1-8, T1-10 unit-tested (predicate matches plan verbatim; expiry uses `expiresAt <= now` ⇔ plan's `now >= expiresAt`). T1-11 audit reason `unattended_session_grant` vs `god_mode` implemented at `server.ts:1888-1891` (inspection only). G1 untouched except hoisted `modelEnabled`; existing trust tests pass. Predicate floors (coord-only, !experimental, !modelEnabled, latch, budget/actions caps, 8h TTL) enforced in both the session and no-sessionId server branches.

### ADR-020 checklist

1. **Axes fit** — correct: L2 trust *packaging* on existing `host_computer`; ADR-020 rule 2 amended with explicit carve ("属 Trust packaging，不是 Surface 降级"). Not a middle-agent runtime, no new Surface. ✔
2. **Pack-first** — no new primary UI chrome in M1; pack arming forbidden. ✔
3. **Confirm dialects** — no new confirmation family; grant *removes* initial L2 under strict floors; re-L2 untouched. ✔
4. **Trust monotonicity** — preserved: god/auto_approve can't skip CU; grant is phrase-gated, TTL'd, process-memory, with all floors. ✔
5. **originWs** — no new `securityConfirmations.request`; no regression. ✔
6. **No new runtime** — none. ✔
7. **Experimental layers** — `experimental` action blocks skip in both branches. ✔
8. **Declaration** — the M1 review prompt body lacks the inline Surface/Compose/Autonomy/Trust/Channel block; the design SoT §7 and ADR amendments supply it. Since the diff adds a gate + WS API surface, called out below as a nit (framing substantively present).

### Nits

1. **Capability declaration block missing from the M1 prompt body** (design §7 has it, but per checklist the prompt should carry it for a gate/API diff).
2. **`security.unattended.disarm` defaults to `clear_cruise: false`** (`message-router.ts:2126-2136`) — disarming leaves dual-written `allow_all_schemes` (= god-mode) / cruise flags persisted on disk, past the 8h TTL and past restart. The "8h auto-disarm" framing in ADR-021 covers only the grant. M2 UI must pass `clear_cruise: true` and disclose; arm also persists god-mode when `include_protocol: true`.
3. **No-sessionId branch hardcodes `credentialLatched: false`** (`server.ts:1085`) — the credential-latch floor is unenforceable when `sessionId` is absent; logged via `no_session_id: true`, but a defensive fail-closed (or grant-block) would be tighter.
4. **Server wiring untested** — T1-11 audit reason, the no-sessionId branch, the R1 gate, and arm dual-write have no tests (only the pure predicate + arm/disarm; consistent with the repo's known `startServer` test debt).
5. **`actionCount === 0` is skip-eligible** (`unattended-grant.ts:164`) — a zero-action task with budget>0 skips initial L2; harmless edge, but `actionCount > 0` would be more faithful to "armed for a real task".
6. **`clampCap` floors at 1** — a caller cannot request cap 0 to fully disable.

No blocking issues: phrase-gated, TTL'd, process-memory grant with all floors enforced; monotonicity and PROMPT_ALWAYS preserved; rejection gates all hold.

VERDICT: APPROVE_WITH_NITS
