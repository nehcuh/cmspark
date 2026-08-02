I have enough context to deliver the verdict. Let me compile my findings.

---

## Findings — `unattended-desktop-m1` (companion grant)

I read the design SoT, ADR-021, the ADR-020 checklist, `unattended-grant.ts`, the new test file, and the diff regions in `server.ts`/`message-router.ts`/`session-trust.ts`/`packs/types.ts`. I ran the new test file (`17/17 pass`), G1 tests (`10/10 pass`), policy/session-trust/executor regression tests (`142/142 pass`), and `tsc --noEmit` (clean). The patch file `unattended-desktop-m1-diff-20260802-154236.patch` matches `git diff` — not stale.

### M1 acceptance — all verified `[executed]`

| ID | Result |
|----|--------|
| T1-1 unarmed → no skip | ✅ `unattended-grant.test.ts:38` |
| T1-2 !coord → no skip | ✅ `:42` (pure predicate) |
| T1-3/4/5 experimental/modelEnabled/latch → no skip | ✅ `:46/50/54` |
| T1-6 armed+coord+caps → skip | ✅ `:58`, `:137` |
| T1-8 bad phrase rejects | ✅ `:82` |
| T1-10 disarm clears | ✅ `:103`, `resetUnattendedGrantForTests` |
| T1-11 audit reason distinct | ✅ `server.ts:924, 1012, 1041, 1091, 1888` |
| G1 path intact | ✅ 142 regression tests pass |
| R1 allow_all_schemes alone doesn't arm | ✅ skip only via `g1…` ∨ `evaluateUnattended…`; neither reads global bools |

### Rejection gates — all hold `[inspected]`

- **R1** — `hostComputerTrustSkip` is set only by `g1InitialSkipEligible` or `evaluateUnattendedHostComputerSkip` (`server.ts:998-1010, 1031-1050, 1080-1099`). Neither consults `allow_all_schemes`/`auto_approve_*`. `arm` does dual-write cruise bools (`message-router.ts:2109-2117`) but CU skip is gated solely by the grant.
- **R2** — algebra `(!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip` at `server.ts:1321` is unchanged. `PROMPT_ALWAYS_TAGS` / `reL2ShouldPrompt` untouched in diff.
- **R3** — grant is `let grant: InternalGrant | null = null` in module scope, mutated only by `armUnattended()`. `FORBIDDEN_PACK_KEYS` now includes `unattended`/`unattended_computer`/`unattended_desktop` (`packs/types.ts:165-172`).
- **R4** — no serialization; `resetUnattendedGrantForTests` confirms process-memory semantics.
- **R5** — `armUnattended` requires `isValidSecurityArmPhrase`; bad-phrase test passes.
- **R6** — `hostComputerTrustSkip` is set only inside `if (hostComputerGated)`; non-CU tools never see it; `forceConfirm` flow unchanged.

### ADR-020 capability checklist

- **Surface / Compose / Autonomy / Trust / Channel declaration**: NOT in the implementer prompt body, but the design SoT §7 carries a full declaration (`L2 host_computer / none / single / session grant / community+enterprise`). The change does add a gate (`hostComputerTrustSkip` via `evaluateUnattendedHostComputerSkip`), which by the checklist would normally be blocking. Since the declaration is in the locked SoT referenced from the prompt and the gate is a sibling-of-G1 trust packaging (not a new tool / no new agent runtime / no new primary UI in M1), I treat this as a process nit, not blocking.

### Nits (non-blocking)

1. **No message-router wire-handler unit tests.** Pure predicate is well-covered; the dual-write side effects in `message-router.ts:2093-2145` (arm with `include_protocol:false` must preserve existing `allow_all_schemes`; disarm without `clear_cruise` must preserve cruise bools) aren't tested. Naturally fits M2/M3.
2. **`credentialLatched: false` hardcoded** in the no-sessionId branch (`server.ts:1085`). Defensible — no session record exists — but worth a one-line comment so future readers don't read it as a floor gap.
3. **Arm audit lacks peer/origin info.** `security.unattended_armed` logs `armed_at`/`expires_at`/caps but not which ws armed. For a process-global grant, adding originWs/peer to the audit at `message-router.ts:2118` would help forensics.
4. **Audit reason fallback** at `server.ts:1889` is `(hostComputerTrustSkipReason || "session_trust_corpus_subset")` — if reason is ever null while skip is true, this silently mis-attributes an unattended grant to G1. Unreachable today (both paths set the reason) but `|| "unknown_skip"` would surface bugs instead of masking them.
5. **No regression test for new `FORBIDDEN_PACK_KEYS`.** Pre-existing gap — `packs-validator.test.ts` doesn't assert any forbidden key is rejected. Good moment to add one for `unattended*`.
6. **Audit-report rewrite bundled in scope.** `audit-report-cmspark-2026-07-25.md` has ~427 lines changed in this M1 companion-only PR. Not a code issue; flag for scope discipline.
7. **SafetyStrip.tsx fix** (`title="…">{…":` → `title={"…"}`) — confirms main has broken JSX on HEAD; the fix is correct and necessary, but it should land in its own commit so the unattended-desktop M1 PR isn't carrying an unrelated UI bugfix.

No incomplete fixes, no security regressions, no wrong file:line, no over-claiming. Implementation faithfully matches ADR-021 §1–§7 and the design SoT §5.1–§5.2.

Nits listed above are non-blocking.

VERDICT: APPROVE_WITH_NITS
