# Dual Review — multi-adv deep Wave 0–2 (`fix/multi-adv-deep-wave012`)

Verified against the live worktree (git log confirms commits f8ce33a → dbd3999 → 4ea1758 on top of `5c64604`; patch file matches current tree). Ran the relevant test suites and compared against base.

## Finding-by-finding verification (code-level)

**C1 — cruise snapshot lifecycle: DONE.** `captureCruiseSnapshot` runs in `message-router.ts:3234` *before* the dual-write `saveConfig`; failed arm discards the snapshot (3246–3247); disarm handler at 3267–3292 *always* calls `restoreCruiseFromSnapshot()` (clear_cruise now a no-op); TTL path `expireGrantIfNeeded` + `expireRestoreDone` restores exactly once. No other `disarmUnattended` callers bypass it. Tests pass (3 C1 cases + TTL-once). Restart residual (durable flags sticky after process restart) is honestly documented in the impl summary/ADR — outside the task's stated C1 scope.

**C5 — pack Trust phrase gate: DONE.** `applyPack` (pack-engine.ts:1617–1627) checks `packTrustWritesCruiseFlags(trustToApply)` *before* `applyUserPackTrust`, returns `trust_phrase_required`, clears the journal. Both router paths (`pack.apply` 2712, save+apply 2831) pass `confirmation_phrase`; the spawn path uses `allowTrust:false` (server.ts:3407) so it cannot write Trust. Schema/config parity with `security-arm.ts` confirmed. Test rejects missing phrase, passes with phrase.

**C6 — worker isolation: DONE.** `isToolAllowed` (thread-manager.ts:854–876) re-enforces `WORKER_HARD_DENY` for `agent_role==="worker"` at runtime — and the executor hard-gates every non-outbound tool through `isToolAllowed` (server.ts:820). `thread.update` rejects `tool_whitelist:null` and filters HARD_DENY tools; `agent_role` is not in the updatable key set. Tests cover elevated-whitelist, null-whitelist, and per-tool denial.

**C7/C8 — shell cwd / netsec ports bind: DONE.** Pre-L2 normalization in `createToolExecutor` (server.ts:744–758) runs before the confirm preview (1087–1097, now shows `cwd=` / `ports=`) and before `issueTokenFor` (2348). Execute re-normalizes idempotently and uses only the token-bound value (`params.cwd`, server.ts:3888). `normalizeNetsecPorts([])` → COMMON_PORTS copy closes the empty-ports expansion. Binding-equality tests pass. Schema (`z.array(...)`) makes the scalar-ports corner unreachable. `originWs: ws` binding preserved on the pending-confirmation path (server.ts:2988).

**C2/C3/C4 — honesty UX: DONE.** SafetyStrip + CockpitApp show 「任务已停 · 值守仍开 · 点解除」 on abortAcked∧armed with a 解除 action; Cockpit has a permanent 值守 strip when armed with no pending confirms and rewrites the empty-desk copy. The matrix splits 导航 L2 (跳过) from evaluate/osascript (仍确认††) with footnotes matching the three-flag algebra; SettingsSlideout hints aligned.

**C9 — WS lockstep: DONE.** Test runs (146 router cases, 153 validator keys; core types individually asserted) and is auto-discovered by `scripts/run-tests.mjs` in CI. `settings.test` allowlist entry verified as a real alias case (message-router.ts:382–383).

**C10–C16:** FREEZE comments on both god-files with DEFERRED documented; `SURFACE_BY_TOOL` drives mode-controller (incl. shell_exec/netsec/scroll_to/upload_file); security-gates false-green removed (only comments reference `force_confirm` now); SUPERSEDED banners on both Aug-02 design docs; `docs/mcp.md` require_grant=true default with `cmg_…` bearer; CU guide/ADR-017/architecture match the real AppsPanel `computer.set_enabled` toggle; ADR-021 documents windowLevel=hard re-L2 silence + evaluate-under-default-值守.

## Tests

- New/updated suites: 46 pass (C1/C16, C6, C7/C8, C9) + 91 pass (C5 + C12) — all green.
- Full suite: 2629 pass / 14 fail / 20 skip. I re-ran the 14 failures on base `5c64604` in a worktree: **identical 14 failures in computer-executor/computer-uia-watch** — pre-existing, not branch regressions.
- `tsc -p tsconfig.test.json` clean; esbuild 0.28.1 ships a native Mach-O at `bin/esbuild`, so the packaging spawn fix is correct.

## ADR-020 checklist

Declaration present and accurate (Surface: L2 honesty/bind/isolation, no new L2 tools; Composition: pack phrase gate; Autonomy: unattended lifecycle; Trust: restore+step-up; Channel: Side Panel+Companion). Axes fit; no "中层 Agent" framing; phrase reuses the existing Settings confirm dialect (no new family); trust monotonicity holds (gates strengthened, not loosened); originWs intact; no new runtime.

## Nits (non-blocking)

1. **C1 restart residual** — durable `auto_approve_*`/`allow_all_schemes` remain at dual-write values if the companion restarts while armed (grant is process-memory). Documented, but a boot-time "grant not armed → restore/sweep" check would fully close the original dual-clock class.
2. **`security.unattended.disarm` with no snapshot clears all three flags** — handler(null) forces them false even when the grant was never armed this process. All current UI disarms intend this, and it's fail-closed, but a raw API disarm as a routine reset could clobber intentionally-set flags; guard on `grant existed || snapshot existed`.
3. **C9 test is heuristic** (regex extraction can false-positive on validator keys); core types are asserted individually so it's a reasonable smoke — a registry SoT remains the eventual fix.
4. **PacksPanel client phrase prompts on any `has_trust` pack** even when the server only requires it for cruise-flag writes (modules-only trust) — conservative, documented.
5. **14 pre-existing failures** in computer-executor/computer-uia-watch (identical on base) are outside this branch but should be tracked as a separate debt item.

All five REJECT-gate findings (C1, C5, C6, C7, C8) are complete, server-side enforced, and not bypassable on tested paths.

VERDICT: APPROVE_WITH_NITS
