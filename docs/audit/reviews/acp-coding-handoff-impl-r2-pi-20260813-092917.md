I've inspected the actual code on `feat/coding-handoff` (HEAD 518ed97), run the relevant tests, and traced the security gates end-to-end.

## Findings

### Verify-1 — No free-exec terminal button ✅
`CodingTaskPackageModal.tsx:113-127` `doOpenTerminal` only calls `copyTextToClipboard` and flashes "请打开终端粘贴". No `spawn`/`open`/`iTerm`/`osascript` anywhere in the Phase A path. The `ctaOpenTerminal` copy was correctly renamed "在终端打开" → "复制任务包" to stop implying a terminal launch.

### Verify-2 — Catalog lockstep ✅
All 6 ACP tools exist in both `companion-tools.ts:35-40` (COMPANION_TOOLS) and `tool-definitions-catalog.json:1176-1268`. `tests/tool-catalog-lockstep.test.ts` passes (10/10 tests green, including the lockstep suite).

### Verify-3 — sanitizeAcpConfig hard-lock ✅
`acp/types.ts:89-91` now hardcodes `profile = "review_readonly"`, `allow_write = false`, `allow_exec = false` at the config boundary, ignoring hand-edited `policy.profile`/`allow_write`. Config load sanitizes via `config.ts:604-605`. Test asserts `allow_write === false` (`acp-handback-workspace.test.ts:91`).

### Verify-4 — ADR-020 中层 Agent language ✅
`copy.ts` and both components use "编程助手 / 本机终端编程助手 / 外部 Agent" — no "中层 Agent". The only occurrence is `pack.yaml:32` `"不是中层 Agent / 第二 runtime"` (explicit negation with inline qualification), which is the compliant usage per ADR-020 line 34.

### Verify-5 — Security gates ✅
- **Workers HARD_DENY all acp_***: `orchestrator/constants.ts:25-30`, enforced at three layers — `spawn.ts:46` (allowlist), `message-router.ts:1559` (dispatch filter), and `thread-manager.ts:923-940` (runtime re-check incl. elevated whitelist).
- **propose/start require security_token**: `l2-admission.ts:63-64` (L2_GATE_TOOLS) + `companion-dispatch.ts:241-254, 283-295` validate `security_token`; `acp_propose_session` also hard-rejects `agent_role === "worker"` (line 257-259).
- **Never skipped under god-mode/cruise**: `l2-admission.ts:784-819` — `acpForceConfirm` forces `forceConfirm=true` and the waiver branch is gated by `!acpForceConfirm`; `familyOfTool` returns null for acp so `enterpriseSkip` can't bypass it either.
- **Token binding non-empty**: `security-policy.ts:97-100` binds `acp_propose|agent|goal` and `acp_start|session_id`.
- **Untrusted handback + taint**: `handback.ts` frames/neutralizes delimiter breakout; `taint.ts` marks thread, cleared on next real user message (`adapter.ts:306-307`); taint forces L2 on host_cli/host_app/shell_exec/evaluate/osascript (`l2-admission.ts:750-761`).

## Nits (non-blocking)

1. **No test for the B1 admission fix** — the critical "never skip ACP HITL under god-mode/cruise" behavior (`acpForceConfirm` in `l2-admission.ts:784-819`) has no unit test; only the binding + sanitize paths are covered.
2. **Dead copy keys** — `copiedAndTerminal` and `terminalFailed` (`copy.ts:47,50`) are now unreferenced after the terminal-open removal; several other Phase B keys (spawn/session/error strings) are forward-declared but unused.
3. **Redundant copy buttons** — the modal shows two near-identical CTAs ("复制任务包" secondary vs "复制编程任务包" primary), and `doOpenTerminal` (`CodingTaskPackageModal.tsx:113`) doesn't gate on `pkg.hasWorkspace` while `doCopy` does — inconsistent UX.
4. **Type drift** — `AcpPolicyProfile` still declares `"propose_diff"`/`"agent_default"` (`acp/types.ts:4`) though both are now unreachable after the hard-lock.

VERDICT: APPROVE_WITH_NITS
