I have what I need. The diff is docs-only (audit-report-cmspark-2026-07-25.md touched); the trust-ia-autopilot spec/plan/adversary-synthesis are new untracked files. I cross-checked the design locks against `server.ts` skip algebra, `security-arm.ts`, `packs/types.ts`, ADR-010/020, and the live SettingsSlideout copy.

---

## Findings

### Blocking (file:line)

None. All eight rejection gates R1–R8 hold.

### Code-reality spot-check (passed)

| Claim | Code anchor | Result |
|-------|-------------|--------|
| Pack cannot arm trust flags | `companion/src/packs/types.ts:161-168` (`FORBIDDEN_PACK_KEYS` already lists `auto_approve_dangerous`, `allow_all_schemes`, `auto_approve_enterprise_tools`, `god_mode`) | ✓ R3 already enforced at SoT |
| Phrase step-up on false→true | `companion/src/security-arm.ts:14-46` (`SECURITY_ARM_CONFIRM_PHRASE = "我了解风险"`, `findArmingSecurityFlags` transition-gated) | ✓ R4 enforced at companion |
| God/auto-approve **do not** skip shell/CU/spawn forceConfirm | `companion/src/server.ts:1148-1180` (`skipConfirmation` only web L2; `forceConfirm` unconditional for critical_apis / CU task / shell_exec / netsec; `enterpriseSkip` only via Plan A/B + scope ∩ at 1232-1248) | ✓ R1/R6/R7 algebra unchanged by plan |
| Ext→Companion flag-write path exists | `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx:137-241` (`sendSecurityFlagConfig(partial, phrase?)` already per-flag) | ✓ P1 Task 5 implementable without wire change |
| Matrix honesty for shell/netsec | `docs/mission-pack-usage.md:181` ("God-mode / 自动批准危险操作 单独仍不会跳过 shell/netsec") | ✓ design §5.3 matrix matches existing law |
| Trust monotonicity / Pack can't relax globals | `docs/adr/020-capability-model-three-axes.md:53,74,99` | ✓ D4/D5/D9/S1 align |

### Nits (non-blocking)

- **N1 — Transient multi-flag arm window.** Plan Task 5 step 2 allows sequential per-flag `sendSecurityFlagConfig`. Between call 1 and call N the bool state is partial and the 徽章 will flicker between tiers. Recommend implementer document this or wrap in a single UX transaction. (design §5.2 / plan §Task 5)
- **N2 — `host_cli` / `host_app` not enumerated in §5.3 matrix.** server.ts:1198 `familyOfTool` puts these in the enterprise skip family; the matrix only shows "shell / netsec". Power users may want explicit row. (design §5.3)
- **N3 — `capability_profile` read path undecided.** Plan Task 5 step 4 hedges ("read from config if exposed; else show warning"). Fine for P1, but lock the read source before code. (plan §Task 5)
- **N4 — ADR-020 amend timing.** Design §6 declares capability; ADR-020 itself has no "Autopilot = Trust packaging" note yet. Plan defers to "P2 backlog only". Acceptable but the one-paragraph amend could ride P1 to forestall future "is this a 4th axis?" debate. (plan §P2)
- **N5 — Disarm P1-A power-user surprise.** Clearing all three flags when user only armed via tier is the locked simplification (§5.2 fn); the `armed_by_autopilot: string[]` alternative is mentioned but not committed. Copy warning covers it. (design §9)
- **N6 — `God-mode` sunset period unspecified.** "旧称 God-mode" / "曾用名" retained without removal milestone. (design §9 / plan Task 1)
- **N7 — Status chip host.** SafetyStrip vs FocusBand not pinned. (design §5.5 / plan Task 6)
- **N8 — P1-7 regression test.** "既有 god-only 用户升级后不会自动 enterprise skip" relies on the no-algebra-change invariant; only manual/e2e prescribed. A companion-side schema/behavior regression test would be cheap insurance. (plan §Task 8)

---

## Must-answer

1. **D1–D12 / S1–S5 consistent and sufficient without Scheme C?** Yes. D1 rename + D2 single main path + D3 matrix + D4 hard floors + D6 dual-write + D7 phrase step-up + D11 Trust-packaging form a closed contract. Scheme C is permanently rejected (§10); the JTBD is met by tier→bool mapping (§5.2) over existing keys, not by polluting `allow_all_schemes` semantics.
2. **P0+P1 vs P0 alone, PR split sound?** P0 alone is honestly labeled "cannot deliver JTBD" (§7); it's the IA/rename/docs slice. P1 is the actual arming JTBD. Split is sound; same-PR option preserved if dual-review permits.
3. **Dual-write safe vs new `autopilot` key?** Yes — companion stays flag-authoritative, no schema migration, no SoT skew (single source = three bools), upgrade-safe (D10). Ext derive fn is pure (plan Task 4 bijection tests).
4. **Disarm P1-A risk?** Acceptable. Deliberate simplification, copy warns, advanced area remains the escape hatch for power users.
5. **Missing hard-floor tool family?** No. D4 covers host_computer task L2 / spawn_worker / ask_user / board_complete / MCP critical / evaluate critical_api / cookie / workspace / pack whitelist / netsec allowlist. `host_cli`/`host_app` travel via enterprise scope-∩ family — not a regression.
6. **Risk of touching forceConfirm/god-skip-shell by accident?** Low. P0/P1 out-of-scope sections explicitly forbid; R7 gate backs it; plan file map marks `companion/src/server.ts` as ✗ for both phases.
7. **What would force REJECT?** None of R1–R8 currently trip. The only thing that would change my verdict post-impl: an implementer silently adding a `security.autopilot` enum *as SoT* (R2) or reusing tier-arm to relax shell/CU forceConfirm (R1).

## ADR-020 capability checklist

- Declaration present in design §6 and plan §"Capability declaration" ✓
- Axes fit: Autopilot correctly classified as **Trust packaging**, not 4th axis / not Autonomy runtime (D11) ✓
- Pack-first: N/A — UI reorganization of existing gates, not a new scenario ✓
- Confirm dialects: no new dialect; reuses existing phrase step-up (`SECURITY_ARM_CONFIRM_PHRASE`) ✓
- Trust monotonicity: D4 hard floors + S1 preserve CU task L2 / spawn / shell forceConfirm ✓
- originWs: not affected (no new `securityConfirmations.request`) ✓
- No new runtime ✓
- Experimental layers: none introduced ✓

P1 watchlist (P1-1 god step-up / P1-2 originWs / P1-3 evaluate / P1-4 shell structure): only P1-1 is in scope and is *preserved* by D7 + plan R4 — no regression.

---

Nits only — no blocking issues, no rejection gate tripped, code reality matches the plan's "no `server.ts` algebra change" invariant.

VERDICT: APPROVE_WITH_NITS
