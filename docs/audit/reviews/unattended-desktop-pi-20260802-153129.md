I have everything I need. All code anchors verified. Writing the review.

---

# Independent Review — Unattended Desktop (design + plan), M0 gate

**Scope:** docs-only review of design SoT + impl plan (implementation NOT started). Patch file `unattended-desktop-diff-20260802-153129.patch` verified current: HEAD still `c003ff9`, working-tree state matches (audit report + SafetyStrip one-liner). No staleness.

## Verified code-backed facts (spot-checks)

| Anchor | What I confirmed |
|---|---|
| `server.ts:1190-1194` | `forceConfirm` for host_computer is **unconditional** (`criticalApis = ["computer.coordinate_injection"]`) — god-mode / auto_approve only flip `skipConfirmation`, which is insufficient |
| `server.ts:1251-1252` | Dialog gate: `(!skipConfirmation \|\| forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip` — only the trust-skip var can bypass |
| `capability/enterprise-session-trust.ts:37-40` | `familyOfTool` returns non-null only for `shell_exec`/`netsec_port_scan` → `enterpriseSkip` can never skip host_computer |
| `server.ts:931` | `assertCoordinateAllowed` runs **before** the trust gate → F3/R5 ordering guaranteed |
| `server.ts:938-946, 3886-4026` | Global single-task invariant + estop preflight live in the **execute** path, not the L2 dialog → F8/R8 intact even when initial L2 is skipped |
| `executor.ts:1031-1047,1227` | Credential-context type/key hard-deny (A4.3) is executor-level, independent of initial L2 → payment/credential hard-deny preserved |
| `executor.ts:634-654` | reL2 silently auto-approves only when `isTrusted(...) && !reL2ShouldPrompt(...)`; unattended tasks create no G1 trust → mid-task `budget_exhausted` / `task_induced_dialog` / `uncrossverified_exceeded` will still **prompt** (safe, but underspecified in the docs — see nit 3) |
| `session-trust.ts` | `g1InitialSkipEligible` (thread-only, corpus⊆, budget/actions caps, !experimental, !modelEnabled) and `PROMPT_ALWAYS_TAGS` (danger / experimental_suggestion / foreground_yielded) match the design's "unchanged" claims |
| `security-arm.ts:14` | `SECURITY_ARM_CONFIRM_PHRASE = "我了解风险"` exists; plan reuses it correctly |
| `packs/types.ts:161-168` | `FORBIDDEN_PACK_KEYS` already covers `allow_all_schemes`/`auto_approve_dangerous`/etc.; the grant is memory-only (not a config key), so Pack cannot arm it structurally |
| `tool-definitions-catalog.json:1143` | `host_computer` description still claims "task-level confirmation dialog is ALWAYS shown … NEVER thread-trusted — every task asks" — needs updating in M3 (nit 4) |

## Answers to the 7 required questions

1. **Option B with F1–F15 acceptable?** Yes — proceed to M1. The security agent's REJECT is a legitimate risk position, but the product goal is the user's explicit hard requirement (U1/U2), and this review's job is not to relitigate it, only to ensure the design doesn't weaken it silently. It doesn't: F1–F15 are structural (verified above), the residual (OCR-blind payment UI) is documented as accepted residual in design §1.3/§4, and R1–R8 keep the boundary honest. Not a REJECT of the product goal.

2. **`open_within_app` blast-radius delta?** Correctly called out — design.md:167 states the unattended path has **no** corpus⊆ requirement and names `open_within_app` as its corpus policy, mandating ADR-021 to state the blast radius; plan freezes "Corpus: open_within_app for unattended only". The delta vs G1 (closed corpus ⊆ prior-approved) is real and explicit. This is the single largest widening and it is not hidden.

3. **Process-memory arm + 8h TTL vs JTBD?** Matches. Restart-clears follows ADR-017 session-trust precedent; 8h wall-clock bounds the grant; `status` exposes `expires_at`. Design §3.2 honestly splits persistent Layer A (cruise bools via dual-write) from memory-only Layer B (grant). Copy nit: the arm-checkbox "确认重启 Companion 后失效" is ambiguous since cruise bools persist (nit 5).

4. **Skip algebra safe?** Yes — **safe by construction**, not just by intent: `forceConfirm` is unconditional for host_computer, `enterpriseSkip` excludes it, so god/auto_approve/domain-whitelist alone can never skip. `hostComputerTrustSkip = g1 || unattended` (plan M1) is the only bypass, and M1 acceptance includes the "god/auto_approve alone still no CU skip" regression. R1 gate holds.

5. **M0 ADR amendments sufficient?** Structurally sufficient: M1 is gated on M0 APPROVE, and M0 tasks 1–3 mandate ADR-021 + ADR-017 D3/D4 + ADR-020 Axis A rule 2 + Trust IA D4 + ADR-010 + guide §5. Nit: the plan's named rejection-gate table (R1–R7, lines 193-200) omits "no ADR amendment before M1" as a named gate (it's only implicit in M0 Exit) — align with the prompt's R1–R8.

6. **Workflow gates adequate?** Yes — M0 dual → M1 Pi → M2 Pi → M3 dual, no skip, REJECT reopens the gate; `scripts/dual-external-review.sh` exists. Minor: M1/M2 exit says "both OK if Pi APPROVE*" — if the dual script runs both agents, honoring only Pi lets a Claude REJECT be overridden at a security-sensitive node (nit 7).

7. **What forces REJECT at M1?** Any of R1–R8 materializing in code; dropping `credentialLatched`/`experimental`/`modelEnabled` from the implemented predicate; persisting the grant to disk; making the grant pack-writable or the arm RPC phrase-less; audit reason not distinguishing `unattended_session_grant` from `god_mode` (F10); ADR-021 written to reopen Scheme C or weaken PROMPT_ALWAYS; estop preflight or credential hard-deny regressed.

## Rejection gates R1–R8 (prompt) — all pass at the doc level

R1 ✓ (verified by construction) · R2 ✓ (F4 + §5.3) · R3 ✓ (memory-only grant, FORBIDDEN_PACK_KEYS, RPC-only arm) · R4 ✓ (F2, plan M1 explicitly memory-only) · R5 ✓ (F3 + server ordering) · R6 ✓ (M0 tasks 1–3) · R7 ✓ (matrix honest, residual documented) · R8 ✓ (estop/hard-deny outside the dialog path).

## Nits (non-blocking)

1. Plan rejection-gate table vs prompt's R1–R8: add "no ADR-017/020/Trust-IA D4 amendment before M1" as a named gate (`plans/2026-08-02-unattended-desktop-impl.md` §Rejection gates).
2. `packs/types.ts` row says "Forbid any future key **if needed**" — make unconditional (add `unattended*`/`armed*` to FORBIDDEN_PACK_KEYS), mirroring Trust-IA D9.
3. Mid-task re-L2 under unattended is underspecified: executor reL2 (`executor.ts:634-654`) will prompt on `budget_exhausted`/`task_induced_dialog`/`uncrossverified_exceeded` because unattended tasks create no G1 trust. Safe default, but freeze the answer in ADR-021 so long runs don't silently stall.
4. `tool-definitions-catalog.json:1143` description ("ALWAYS shown … every task asks") becomes false when armed — add the tool-description rewrite to M3 docs lockstep.
5. Arm checkbox "确认重启 Companion 后失效" is ambiguous — Layer A cruise bools persist across restart; clarify "桌面值守重启后失效".
6. F7 keeps 30/60s over an 8h TTL (~14.4k injection ops/session) — record the residual in ADR-021; note B′ enterprise type-preview mode as future work.
7. M1/M2 "both OK if Pi APPROVE*" — if the dual script runs both, honor both verdicts (or state Pi is the binding gate per user mandate).
8. Credential-latch wiring for unattended: predicate takes `credentialLatched`, but the plan doesn't specify the data flow from executor `markCredentialSurfaceSeen` into the unattended grant — M1 acceptance mentions "latch → no skip" but not the source.

## ADR-020 capability checklist

- **Declaration present**: prompt + design §7 + plan all carry the full Surface/L2-classes/Compose/Autonomy/Trust/Channel block. ✓
- **Axes fit**: this is a Trust gate on existing L2 Surface + single Autonomy — no new Surface, no new runtime, no Composition change. No bare "中层 Agent" language anywhere. ✓
- **Pack-first**: N/A — not a scenario-assembly feature; the tier extends the existing 运行自主度 radio and reuses SafetyStrip chrome (no new primary entry point). Not a blocking challenge.
- **Trust monotonicity**: god/auto_approve still cannot skip CU (verified by construction); the new skip is an explicitly designed + tested gate (M1 units + M3 integration) — exactly the checklist's carve-out. The `open_within_app` corpus widening is the monotonicity tension and it is named, scoped to `coordinateAllowed` apps, and mandated into ADR-021. ✓
- **originWs**: no new `securityConfirmations.request` family; the feature removes confirms on the skip path, and the arm RPC is phrase-gated like existing arm paths. No regression. ✓
- **Experimental layers**: predicate excludes `experimental` and `modelEnabled` (F13). ✓

## Diff hygiene

Patch not stale (HEAD unchanged, working tree matches). The `SafetyStrip.tsx` change in the diff is a genuine one-line JSX fix (removed corrupted `{ 仍为真源">{">` string; new attribute is valid JSX). The audit-report rewrite is docs-only and outside this M0 scope; nothing in the design depends on it.

VERDICT: APPROVE_WITH_NITS
