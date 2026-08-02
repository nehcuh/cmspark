## Final Dual Review — unattended-desktop-m3

### Patch freshness
`git diff` stat matches the patch header exactly (20 files, +803/−253); live `server.ts` hunks match the patch content. Patch is current, not stale. I also read the live source (not just the patch) for all security-critical files.

### Rejection gates (all clear)

| Gate | Result | Evidence |
|---|---|---|
| R1 allow_all_schemes alone skips CU | **PASS** | `host_computer` gets unconditional `forceConfirm` (`criticalApis = ["computer.coordinate_injection"]`, server.ts:1300-1306); `hostComputerTrustSkip` is set **only** by G1 or `unattended_session_grant` (server.ts:1011/1040/1090). `unattendedInitialSkipEligible` (unattended-grant.ts:154-174) never reads config bools. T3-9 test asserts god-only flags never arm. |
| R2 PROMPT_ALWAYS silenced | **PASS** | Executor reL2 path + `PROMPT_ALWAYS_TAGS` untouched (session-trust.ts:117-151); unattended grant only gates **initial** L2. Test asserts `reL2ShouldPrompt` still true for danger/experimental/foreground. |
| R3 Pack can arm | **PASS** | `FORBIDDEN_PACK_KEYS` adds `unattended*` (packs/types.ts:165-172), enforced in `packs/validator.ts:60`; grant is phrase-gated RPC only — no config/pack path exists. |
| R4 Grant disk-persisted | **PASS** | Module-level `let grant: InternalGrant | null` (unattended-grant.ts:41) — process memory, restart clears, lazy TTL clear. Only cruise bools dual-written to config (config SoT, intended). |
| R5 Docs zero-residual-risk | **PASS** | CU guide §5.1 "诚实风险…OCR 可能漏检部分支付 UI——自负后果"; SoT/ADR-021 declare accepted residual. |
| R6 CI red | **PASS** | Companion: 2186 tests, 2166 pass, **0 fail** (20 skip). Extension: **391 pass, 0 fail**. Both suites exit 0. |
| R7 Matrix/UI lies about type preview | **PASS** | Matrix honestly shows 值守 row "键入内容执行前不再逐字预览" + re-L2 rows 仍确认; red-line disclosure present in arm dialog. |

### Must-verify
- **M1+M2 gates hold**: skip algebra is a clean `g1 || unattended` OR with distinguishable audit reason `unattended_session_grant` (server.ts:1888-1890); phrase validated server-side via `isValidSecurityArmPhrase`; chip priority unattended > cruise (`trustStatusChip`); switching to another tier issues `security.unattended.disarm` (SettingsSlideout.tsx:413).
- **Docs honest**: CU guide §5.1 G1-vs-值守 table, confirm-center, mission-pack, ADR-017 D3/D4, ADR-020 Axis-A rule 2 carve, Trust IA D4 footnote all lockstep.
- **Tests T3-1/2/9 + PROMPT_ALWAYS**: covered at unit level (computer-unattended-grant.test.ts) — T3-1 first-shot, T3-2 non-coord, T3-9 god-only, plus reL2 PROMPT_ALWAYS assertions.
- **Manual checklist**: exists with 6-step WeChat true-device protocol + signature block; automated green + documented checklist satisfies the stated APPROVE condition.
- **No Scheme C / estop**: no spawn/ask_user/board/MCP critical skip added; estop code untouched (no diff in darwin-estop/executor).

### ADR-020 capability checklist
Declaration present and correct (Surface L2 / host_computer / Compose none / Autonomy single / Trust unattended grant + autopilot packaging / community|enterprise). Axis fit: Trust packaging on existing tools, not a new Surface/composition. No "中层 Agent" language. No new confirm dialect (reuses phrase+checkbox). Trust monotonicity preserved (R1). No new `securityConfirmations.request` → originWs N/A. No new runtime. Experimental/modelEnabled floors gate silent skip (F13). Pack-first check: new primary chrome exists (unattended tier), but this mirrors the previously-approved autopilot Trust-tier shape and packs are deliberately excluded for safety — acceptable, not a violation.

### Nits (non-blocking)
1. **No wiring/integration test for the server OR composition** — the M3 plan listed "mock/sim first host_computer under arm → no confirmation request", but only the pure predicate + arm module are tested; `hostComputerTrustSkip` composition and the `unattended_session_grant` audit reason (server.ts:1018-1100, 1888) have no automated regression. The most security-sensitive wiring in this diff is review-only.
2. **Arm without protocol does not clear a pre-existing `allow_all_schemes`** (message-router.ts:2109-2113) — matrix footnote "† 勾选「同时协议解锁」才放行非 http(s)" and the "默认关" checkbox can misrepresent state when protocol was previously armed; the chip shows only "值守中 · 桌面" and hides the active protocol unlock. Consider force-clearing on unattended arm unless `include_protocol`, or surfacing a combined chip.
3. **No-sessionId path hardcodes `credentialLatched: false`** (server.ts:1078) — unavoidable without a session record, but the credential-latch floor is unenforceable on that path; also `hasCredentialLatch` doc comment says "fail-closed null" while the implementation is fail-open for missing records (session-trust.ts:246-249) — comment/code mismatch.
4. **Arm status is a direct RPC reply, not broadcast** — chip freshness for other peers (tray/CLI arm) depends on reconnect/pull; design §3.4's "急停 toast：任务已停 · 值守仍开" copy isn't implemented verbatim anywhere.
5. **Dual-write arm emits a single `security.unattended.arm_ok` event** without per-flag `security.flag_armed` audits for the two cruise bools — slightly coarser audit than the config.set path.

No blocking issues. Rejection gates R1–R7 all hold; CI green on both suites; capability declaration present and consistent with implementation.

VERDICT: APPROVE_WITH_NITS
