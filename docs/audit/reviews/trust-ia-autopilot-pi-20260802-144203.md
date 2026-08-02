All required reading and code spot-checks complete. Verification summary follows.

## Findings

### Blocking
None. All eight rejection gates verified against real code:

- **R1 (expand allow_all_schemes to skip shell/CU/spawn)** — PASS. `server.ts:1180–1193` `capabilityForceConfirm` (shell_exec, netsec_port_scan, spawn_worker, ask_user, board_complete, host_cli) plus `hostComputerGated → computer.coordinate_injection` are never relaxed by `skipConfirmation` (`server.ts:1148`) or `allow_all_schemes` (L1 gate `server.ts:1889`). Enterprise skip is family-restricted to `shell_exec`/`netsec_port_scan` only (`enterprise-session-trust.ts:37–39`).
- **R2 (superseding autopilot enum as SoT)** — PASS. Plan P1 Task 4 derives tier as a pure function; bools stay SoT. `security.autopilot` key explicitly out of P1 scope (plan:104).
- **R3 (Pack arms trust flags)** — PASS. `packs/types.ts:161–167` FORBIDDEN_PACK_KEYS covers all three flags + `god_mode`; `validator.ts` `scanForbidden` rejects.
- **R4 (arm without phrase)** — PASS. `message-router.ts:228–243` gates any false→true via `findArmingSecurityFlags` + phrase; per-flag `security.flag_armed` with `flags[]` (`message-router.ts:273`).
- **R5 (God-mode primary name/copy)** — PASS. D1 + P0 Task 1 + P0-1 DoD; plan Task 1.6 freezes phrase/wire constants.
- **R6 (lying matrix)** — PASS. Design §5.3 shows host_computer/spawn "仍确认" across all tiers; P1-4 DoD matches.
- **R7 (server.ts algebra in P0/P1)** — PASS. File map marks `server.ts` ✗ for both phases; plan:99 "No companion server.ts skip algebra".
- **R8 (enterprise scope ∩)** — PASS. `server.ts:1200–1248` scope ∩ (netsec allowlist/task-auth, shell scope) precedes any enterpriseSkip; Task 5.4 greys enterprise tier for community (S5).

### Nits (non-blocking)
1. **Ambiguous mapping cell** — design §5.2 (`design:143`): 网页巡航 → enterprise `不变/false` is an "or". Plan doesn't pin whether selecting 网页巡航 leaves an already-true enterprise flag intact (recommend: touch only `auto_approve_dangerous`, show 自定义). Lock in plan.
2. **P1-A clear-all can silently undo phrase-confirmed manual flags** — design:147/252 mitigates with copy only. The design's own `armed_by_autopilot` (memory-only) recommendation would eliminate surprise; fine to defer but note it. Also strike "或 config 可选扩展" (design:147) to kill a scope-creep hook for a config-stored superseding record (tightens D6/R2).
3. **P0 placeholder risk** — plan:42 prefers same-PR; if PR1 (P0) lands alone, the primary 运行自主度 slot holds "将在下一批次提供". Acceptable only if PR2 is queued; make the coupling explicit in PR1 body.
4. **Typo** — plan:114 "On package arm" should read "On autopilot arm".
5. **D9 future-proofing** — when P2 adds an autonomy key, it must also be added to FORBIDDEN_PACK_KEYS; one line in the P2 ADR amend would harden this.
6. **Unrelated working-tree noise** — `audit-report-cmspark-2026-07-25.md` changes ride in the patch but belong to no trust-ia-autopilot commit; exclude from PR1/PR2.

## Must-answer 1–7

1. **D1–D12/S1–S5 consistent & sufficient without Scheme C?** Yes. Every lock maps to a verified server invariant; Scheme C rejection (§10) is coherent and the JTBD is carried by tier arming + matrix + phrase, not flag semantic pollution. §5.2 映射 cell ambiguity (nit 1) is the only internal wobble.
2. **P0+P1 deliver the JTBD; is P0 alone a false promise?** P1 delivers the long-run entry (arm flow, dual-write, chip, per-flag audit). P0 alone is explicitly NOT the JTBD (design §3) and its placeholder copy is honest — not a false promise, provided PR2 lands (nit 3). PR split (PR1 rename+IA+docs low-risk, PR2 arming+chip) is sound.
3. **Dual-write vs new key?** Safe. Bools as SoT means all existing consumers (server skip logic, CLI, audit reason chain `server.ts:1820/1974`) are untouched; extension derives tier from bools, companion stays authoritative → no Ext↔Companion skew by construction. Divergence shown as 自定义 (plan Task 5.5).
4. **Disarm P1-A?** Acceptable, documented power-user tradeoff (design:147/252) with warning copy; deliberately simple/testable. The silent un-do of phrase-confirmed manual flags is the cost — mitigate with the in-memory `armed_by_autopilot` if cheap (nit 2).
5. **Missing hard-floor tool family?** No. capabilityForceConfirm + hostComputerGated cover shell/netsec/spawn/ask_user/board_complete/host_cli/host_computer; MCP and analyze_image fetch gate are outside the flags' skip paths (`server.ts:2006`); evaluate critical APIs forced via `detectCriticalApis`. host_app auto-policy launch skip is pre-existing (WP3), not autopilot-added.
6. **Accidental forceConfirm/god-skip-shell touching?** Low risk — file map excludes server.ts in both phases; explicit out-of-scope lines; R6 gate requires tests if changed.
7. **REJECT triggers?** None hit. Every gate passed against actual code; nothing would stop me greenlighting implementation.

## ADR-020 checklist
- **Declaration present**: Yes — Surface n/a, L2-classes none, Compose none, Autonomy n/a, Trust = packaging of existing flags, Channel community|enterprise (design §6, plan §Capability).
- **Axes fit**: Correct — Autopilot framed as Trust packaging, not a 4th axis/autonomy runtime; no bare "中层 Agent" language.
- **Pack-first**: No new capability scenario (packaging of existing gates); the SafetyStrip chip is a status readout + disarm, not a new capability entry — no Pack alternative required.
- **Confirm dialects**: No new confirmation family; reuses config.set phrase step-up.
- **Trust monotonicity**: Verified — god-mode/auto_approve do not skip CU task L2 or shell/netsec forceConfirm (`server.ts:1168–1193`).
- **originWs**: No new `securityConfirmations.request` introduced; existing binds intact (`server.ts:1563,1948,2143,2703,4561`).
- **No new runtime**: Pure derive helpers only.
- **P1-1 watchlist**: Touches god-mode step-up deliberately, preserving the phrase gate (D7/R4) and hard floors.

VERDICT: APPROVE_WITH_NITS
