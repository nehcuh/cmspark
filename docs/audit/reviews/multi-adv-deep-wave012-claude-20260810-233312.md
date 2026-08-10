C4 matrix verified: evaluate is in `capabilityForceConfirm`, waived only under three-flag `userFullAutonomy`. Default 值守 dual-writes only `auto_approve_dangerous + auto_approve_enterprise_tools` (not `allow_all_schemes`), so evaluate still confirms — exactly what the matrix shows.

I've now verified all 16 findings. Summary:

| ID | Status | Verification |
|----|--------|--------------|
| C1 | ✅ | `captureCruiseSnapshot` pre-arm; `disarmUnattended` always calls `restoreCruiseFromSnapshot`; TTL `expireGrantIfNeeded` restores once |
| C2 | ✅ | SafetyStrip.tsx:91-118,212-219; CockpitApp.tsx:222-228 show 「任务已停 · 值守仍开 · 点解除」 |
| C3 | ✅ | CockpitApp.tsx:212-220 permanent strip when `unattended.armed && !confirm`; emptyGuide copy |
| C4 | ✅ | autopilot-tier.ts: separate rows for navigate vs evaluate; evaluate = "仍确认††" under unattended |
| C5 | ✅ | pack-engine.ts:47-55 + 1617-1628 server-side phrase gate; PacksPanel.tsx client-side guard |
| C6 | ✅ | WORKER_HARD_DENY set; thread-manager.ts:854-889 isToolAllowed re-enforces; message-router.ts:1788-1807 thread.update rejects null + filters |
| C7 | ✅ | normalizeShellCwd at shell.ts:201; server.ts:749-754 (pre-L2) + 3858-3867 (execute); preview shows cwd |
| C8 | ✅ | normalizeNetsecPorts at scan.ts:20; server.ts:755-761 (pre-L2) + 3920-3925 (execute); COMMON_PORTS exported |
| C9 | ✅ | ws-router-validator-lockstep.test.ts: router ⊆ validators ∪ ALLOWLIST; 3 tests pass |
| C10 | ✅(PARTIAL/OK) | FREEZE comments on server.ts:648 + message-router.ts:2; full split DEFERRED with justification |
| C11 | ✅ | surface-by-tool.ts single source; mode-controller.ts derives BROWSER_TOOL_NAMES + COMPUTER_CLASS_TOOLS |
| C12 | ✅ | security-gates.test.ts:770-784 asserts confirmation arrived + critical_apis is array (no force_confirm \|\| false-green) |
| C13 | ✅ | SUPERSEDED banners on both Aug-02 specs |
| C14 | ✅ | mcp.md:249-250 require_grant=true default + cmg_… grant |
| C15 | ✅ | ADR-017 D2/D9 + CU guide + architecture reference computer.set_enabled + AppsPanel |
| C16 | ✅ | ADR-021 §7 documents windowLevel=hard + evaluate under default 值守 residuals |

Tests run [executed]: 74/74 wave1/2 + 63/63 security-gates pass.

ADR-020 capability checks:
- Surface L2 declaration matches diff scope (no new L2 tools; just cwd/ports binding + worker re-enforce)
- Composition Pack Trust phrase gate only (no new gate family)
- Autonomy unattended dual-write lifecycle only
- Trust monotonicity preserved (three-flag cruise remains sole waive path for evaluate; pack Trust requires phrase)
- originWs: no new securityConfirmations.request calls introduced without originWs
- No new runtime/agent framework

Minor non-blocking nits:
- `run-esbuild-bundle.mjs` packaging change is real (native esbuild spawn) — pre-existing local fix promoted to commit; fine
- C9 lockstep test uses regex extraction (best-effort); could miss dynamically-constructed case labels, but covers CORE_REQUIRED + dotted types
- Worker `thread.update` null check is only in message-router, not in `tm.update` itself — defense-in-depth via isToolAllowed covers this
- C1 restore depends on process-memory snapshot; companion restart after arm still leaves durable cruise stuck (documented in impl summary residuals)

VERDICT: APPROVE_WITH_NITS
