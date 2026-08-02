I have full context. The design SoT, plan, adversary synthesis, parent Trust-IA spec, ADR-017/020, and the actual `session-trust.ts` + `server.ts` gate algebra are all consistent. Let me deliver the verdict.

---

# Dual external re-review — Unattended desktop (design + plan) — M0 gate

**Reviewer**: Independent senior (Claude)  
**Stage**: M0 docs only — no implementation diff (the only diff in the patch file is the unrelated audit-report + a 2-line SafetyStrip tweak; **not** the unattended-desktop code)  
**Repo verification**: `git status` confirms `docs/superpowers/specs/2026-08-02-unattended-desktop-design.md`, `docs/superpowers/plans/2026-08-02-unattended-desktop-impl.md`, and `unattended-desktop-adversary-synthesis-20260802.md` are the untracked artifacts under review.

---

## 1. Findings

### Blocking
None.

### Nits (non-blocking, do not gate M1)

**N1 — Matrix red-line not visible in §3.5 (design SoT).**  
`docs/superpowers/specs/2026-08-02-unattended-desktop-design.md:90` (§3.3 step 2) promises the consequence matrix contains the red-line sentence 「键入内容执行前不再逐字确认」. But the rendered matrix at `design.md:104-115` (§3.5) only shows `host_computer initial L2 → 跳过†` with a `† 仅 coordinateAllowed；预算耗尽仍断` footnote. The "type content not char-previewed" honesty line is buried in ceremony prose, not visible in the matrix table the user actually reads at arm time. **Fix**: add a matrix row or annotation so the red-line is visible at arm time, satisfying R7's "type-no-preview honesty" gate visibly.

**N2 — Rejection-gate ID drift between prompt and plan.**  
Prompt defines R1–R8 (8 gates). `plans/2026-08-02-unattended-desktop-impl.md:193-200` defines R1–R7 (7 gates) with **R6 = Estop weakened** and **R7 = Matrix lies** — missing the prompt's R6 ("No ADR-017/020/Trust-IA D4 amendment before M1") as a named gate. M0 Exit text covers it implicitly. **Fix**: add ADR-amendment as an explicit rejection gate so the plan and dual-prompt speak the same language.

**N3 — Pack-forbid language is weasel-worded.**  
`plans/2026-08-02-unattended-desktop-impl.md:75` says `companion/src/packs/types.ts | Forbid any future key if needed`. "If needed" is ambiguous. F9/C8/R3 are mandatory, not conditional. **Fix**: "Add `unattended*` and `armed*` keys to `FORBIDDEN_PACK_KEYS` unconditionally" (mirrors Trust-IA D9).

**N4 — Process-vs-thread arm naming could mislead.**  
Adversary synthesis §4 (row 5) resolved: arm is process-memory, but execute-time audit still prefers `thread:` key. `g1InitialSkipEligible` in `companion/src/computer/session-trust.ts:75-77` only allows initial-skip for `thread:` keys. The plan's `unattendedInitialSkipEligible` predicate (`impl.md:80-102`) takes `armed` but not `trustKey` — meaning unattended is **not** thread-bound. That is intentional (process-wide grant), but the design should footnote that `g1` requires `thread:` while `unattended` does **not**, otherwise a reader may assume parity. **Fix**: one-line footnote in design §5.2.

**N5 — Hourly rate cap not tightened under arm.**  
Design F7 (`design.md:129`) and plan OQ (`impl.md:220`) leave session rate at 30/60s v1. Server.ts:948-955 enforces this *before* the L2 dialog; under unattended zero-initial-L2 it becomes the *only* pre-task throttle. Acceptable for v1, but worth a tracked OQ for tightening when armed (more strict, never less).

**N6 — Audit reason consumer not named.**  
Plan adds audit reason `unattended_session_grant` (good — distinct from `god_mode`/`session_trust_corpus_subset` already in `server.ts:1819-1824`). But no M1/M3 task verifies the audit consumer/dashboard renders the new reason. **Fix**: add a test assertion that the reason string is in the enumerated audit set.

**N7 — Enterprise B′ type-preview mode deferred.** Acknowledged in nit list; not blocking.

---

## 2. Answers to must-answer questions

1. **Option B acceptable with F1–F15?** **Yes.** Product owner lock (U1/U2) stands; security REJECT is documented honestly in §1.3 + §4 "Accepted residual"; F1–F15 are mandatory floors bound to M1 acceptance tests. Skip is OR-composed with `g1` and gated by an independent `armed` state that no config bool can set.

2. **`open_within_app` blast-radius delta vs G1 called out?** **Yes.** `design.md:167` (§5.2) explicitly states "不含 corpus ⊆（open_within_app — 与 G1 分列，ADR 必写 blast radius）". Adversary synthesis §2 row 2 reinforces. ADR-021 M0 task #1 must name this — verify at M1.

3. **Process-memory arm + 8h TTL match JTBD without config persist?** **Yes.** U3 locks process memory; F2 + F14 lock 8h wall clock; F15 explicitly preserves unattended across G1's 30m idle (otherwise JTBD dies). Existing `ComputerSessionTrust` is already a process-singleton (`session-trust.ts:419-424`); new `unattended-grant.ts` follows the same pattern. Restart = re-arm (acceptance 金句 #3).

4. **Skip algebra safe (`g1 || unattended`) without letting god/auto_approve alone skip?** **Yes.** Verified against `server.ts:994-1007` (current `g1InitialSkipEligible` call site) and `session-trust.ts:83-106` (pure predicate). The plan composes at the boolean `hostComputerTrustSkip`, not inside `g1InitialSkipEligible`, so `g1` stays pure. `unattendedInitialSkipEligible` requires `armed === true` (predicate line 93), which is settable **only** via `security.unattended.arm` RPC with phrase — never by `auto_approve_dangerous` / `allow_all_schemes`. M1 acceptance test "god/auto_approve alone still no CU skip" (`impl.md:139`) explicitly verifies. R1 satisfied.

5. **M0 ADR amendments sufficient before M1 code?** **Yes.** `impl.md:46-50` M0 Tasks #1–3 cover: new ADR-021, patch ADR-017 D3/D4 + ADR-020 Axis A rule 2 + Trust IA D4 footnote + ADR-010 reaffirm + `computer-use-user-guide.md` §5 + confirm-center/mission-pack lockstep. M0 Exit gate requires Pi+Claude APPROVE before M1.

6. **Workflow gates adequate for user mandate?** **Yes.** M0 dual → M1 Pi → M2 Pi → M3 dual. `impl.md:54` "Pi+Claude APPROVE / APPROVE_WITH_NITS. Freeze any remaining OQs in ADR-021." `impl.md:183` "Pi + Claude dual-review on full diff. Both APPROVE* → merge / ship claim." User's "Pi at each important node" mandate is honored at M1/M2; dual bookends at M0/M3.

7. **What would force REJECT starting M1?**
   - M0 dual review (this gate) returns REJECT — **not present**.
   - R1: plan lets `allow_all_schemes` / `auto_approve` set `hostComputerTrustSkip` — **not present** (algebra verified).
   - R2: plan silences PROMPT_ALWAYS for mid-task re-L2 — **not present** (design §5.3 explicitly defers to `reL2ShouldPrompt`; `session-trust.ts:117-121` `PROMPT_ALWAYS_TAGS` covers `danger_detected` / `experimental_suggestion` / `foreground_yielded`).
   - R3: Pack can arm — **not present** (F9 + R3 + plan `packs/types.ts` forbid; nit N3 tightens language).
   - R4: Grant persists across restart in v1 — **not present** (process-memory singleton; F2 explicit).
   - R5: Non-coordinateAllowed apps eligible — **not present** (predicate line 95 `coordinateAllowed !== true → false`; F3 mandates per-task re-check).
   - R6: No ADR amendment before M1 — **not present** (M0 Tasks #1–3 are gated by M0 Exit).
   - R7: Matrix lies / omits type-no-preview honesty — **partial**: type-no-preview red-line exists in §3.3 prose but not the §3.5 matrix table (nit N1, non-blocking).
   - R8: Estop / hard-deny payment weakened — **not present** (F5 + F8 + F12 explicitly preserve; §3.5 支付/凭据 → 硬拒绝).

---

## 3. ADR-020 capability checklist

| Check | Result |
|-------|--------|
| Surface/Compose/Autonomy/Trust/Channel declaration present? | **Yes** — `design.md:191-198` and `impl.md:16-23`. Both declarations match. |
| Axes fit (L2 host_computer on Surface, not Composition)? | **Yes** — host_computer is L2-class; Compose=none; no "中层 Agent" language. |
| Pack-first (no new primary Side Panel chrome)? | **Yes** — tier radio inside existing autopilot control + chip on existing SafetyStrip. |
| Confirm dialects (no new confirmation family)? | **Yes** — reuses `SECURITY_ARM_CONFIRM_PHRASE` + `SecurityConfirmationManager`; new `security.unattended.{arm,disarm,status}` is config-style RPC, not a confirm family. |
| Trust monotonicity (deeper Surface not inheriting looser L0; god/auto_approve not silently skipping CU)? | **Yes with explicit designed+tested carve-out** — the carve-out is the entire point of this design; predicate is pure + unit-testable + audit-distinct + gated by armed state no bool can set. Matches checklist rule 4 "unless explicitly designed + tested". |
| originWs binding not regressed? | **Yes** — initial-L2 skip path bypasses confirm request entirely (no new `request(`); mid-task re-L2 inherits existing originWs handling. |
| No new runtime? | **Yes** — same tool-loop; `unattended-grant.ts` is a state module, not an agent runtime. |
| Experimental layers (TinyClick etc.) not silently success-critical? | **Yes** — F13 preserves `modelEnabled` / `action.experimental` blocks; predicate line 96-97 rejects. |

P1 watchlist scan:
- **P1-1 god-mode step-up**: this PR adds `armed` grant but does NOT touch `config.set` / `allow_all_schemes` / `auto_approve_*` semantics. Dual-write on arm uses existing config paths. ✓
- **P1-2 originWs**: M1 diff (future) must verify host_computer skip path keeps `originWs` on any new `request(`; the design itself adds no new request site. ✓
- **P1-3 evaluate integrity**: untouched. ✓
- **P1-4 shell structure**: untouched (shell stays enterprise + forceConfirm). ✓

---

## 4. Verdict

All eight rejection gates (R1–R8) pass. F1–F15 mandatory compensating floors are present and bound to M1 acceptance criteria. ADR-020 capability declaration is correct and consistent across design + plan. Trust monotonicity is preserved via OR-composition with an independent `armed` state. Workflow gates honor the user's "Pi at each important node + dual bookends" mandate. Seven non-blocking nits (matrix visibility, gate-ID drift, pack-forbid language, thread/process naming, hourly cap OQ, audit consumer test, B′ deferral) should be folded before M1 code starts but do not block M0 approval.

Nits (non-blocking):
- N1 `design.md:104-115` — type-no-preview red-line not in matrix table, only in §3.3 ceremony prose
- N2 `impl.md:193-200` — plan R1-R7 vs prompt R1-R8; missing ADR-amendment as named gate
- N3 `impl.md:75` — "Forbid any future key if needed" → unconditional FORBIDDEN_PACK_KEYS add
- N4 `design.md:158-167` — footnote that `g1` requires `thread:` but `unattended` does not
- N5 `design.md:129` / `impl.md:220` — hourly cap OQ tracked for armed-mode tightening
- N6 `impl.md:130-139` — add audit-reason enumeration test for `unattended_session_grant`
- N7 B′ enterprise type-preview mode deferred (acknowledged)

VERDICT: APPROVE_WITH_NITS
