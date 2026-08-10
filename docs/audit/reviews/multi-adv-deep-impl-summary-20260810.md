# Multi-adv deep Wave 0–2 implementation summary

**Date:** 2026-08-10  
**Worktree:** `/Users/huchen/Projects/cmspark-wt-multi-adv-deep`  
**Branch:** `fix/multi-adv-deep-wave012`  
**Base tip:** `5c64604`  
**Source findings:** [`multi-adversarial-project-deep-20260810.md`](./multi-adversarial-project-deep-20260810.md)

## Commits

| Wave | Commit | Message |
|------|--------|---------|
| 0 | `f8ce33a` | `fix(ux,docs): multi-adv Wave0 honesty (estop toast, matrix, pack phrase, SoT)` |
| 1 | `dbd3999` | `fix(security): multi-adv Wave1 dual-write, worker deny, shell/netsec bind` |
| 2 | *(this wave)* | `fix(structure): multi-adv Wave2 WS lockstep, surface map, changelog` |

## Finding status

| ID | Status | Evidence |
|----|--------|----------|
| **C1** | **DONE** | `unattended-grant.ts`: `captureCruiseSnapshot` / `restoreCruiseFromSnapshot` / TTL `expireGrantIfNeeded` + handler. `message-router` arm captures then dual-writes; disarm **always** restores. Tests: C1 suite in `computer-unattended-grant.test.ts` `[executed]` |
| **C2** | **DONE** | `SafetyStrip.tsx` + `CockpitApp.tsx`: abortAcked ∧ unattended →「任务已停 · 值守仍开 · 点解除」+ disarm `[inspected]` |
| **C3** | **DONE** | Cockpit permanent strip when `unattended.armed` && !confirm; emptyGuide copy `[inspected]` |
| **C4** | **DONE** | `autopilot-tier.ts` split navigate vs evaluate rows + footnotes; SettingsSlideout hints `[inspected]` |
| **C5** | **DONE** | `pack-engine.applyPack` requires phrase when cruise flags write; PacksPanel phrase UI/copy; tests phrase reject `[executed]` |
| **C6** | **DONE** | `isToolAllowed` re-HARD_DENY; `thread.update` rejects null + filters deny tools. `worker-hard-deny-runtime.test.ts` `[executed]` |
| **C7** | **DONE** | `normalizeShellCwd`; server pre-L2 + execute path; preview command+cwd; binding tests `[executed]` |
| **C8** | **DONE** | Export `COMMON_PORTS` + `normalizeNetsecPorts`; pre-L2 + execute; binding tests `[executed]` |
| **C9** | **DONE** | `tests/ws-router-validator-lockstep.test.ts` router ⊆ validators + core types `[executed]` |
| **C10** | **PARTIAL** | FREEZE comments on `createToolExecutor` / `message-router` only — full god-file split **DEFERRED** (explicit task scope) |
| **C11** | **DONE** | `surface-by-tool.ts` + `mode-controller` derives L1/L2 sets (shell/netsec/scroll_to/upload_file/…) `[inspected]` |
| **C12** | **DONE** | security-gates no `force_confirm \|\| Array.isArray` false-green; assert confirm arrived + critical_apis shape `[executed]` |
| **C13** | **DONE** | SUPERSEDED banners on Aug-02 unattended + Trust IA designs `[inspected]` |
| **C14** | **DONE** | `docs/mcp.md` default `require_grant=true`; Bearer `cmg_…` `[inspected]` |
| **C15** | **DONE** | CU guide §3 / ADR-017 D2·D9 / host-and-apps / architecture — AppsPanel `computer.set_enabled` 0.5.0 `[inspected]` |
| **C16** | **DONE** | ADR-021 residual windowLevel hard; unit isUnattendedArmed condition for reL2 silence `[executed]`/`[inspected]` |

## DEFERRED (with justification)

| Item | Why |
|------|-----|
| **C10 full split** | Task: pragmatic freeze only; 7k LOC rewrite out of wave |
| **WS full SW lockstep** | C9 covers router ⊆ validators; extension SW case table not fully mirrored in CI |
| **thread.update integration test via message-router** | Unit covers isToolAllowed + filter logic; full router integration optional |
| **Pack list `has_trust` vs modules-only phrase UX** | Client prompts on any `has_trust`; server only when cruise flags — conservative client OK |
| **Windows eTLD / page-sanitizer / whisper multi-arch** | P2 nits outside Wave 0–2 list |

## Tests run `[executed]`

```
companion: tsc -p tsconfig.test.json
node --test \
  computer-unattended-grant · worker-hard-deny-runtime · capability-shell-netsec \
  ws-router-validator-lockstep · packs-engine
→ 74 pass / 0 fail

node --test integration/security-gates.test.js
→ 63 pass / 0 fail
```

## Key files touched

### Wave 0
- `chrome-extension/.../SafetyStrip.tsx`, `CockpitApp.tsx`, `autopilot-tier.ts`, `SettingsSlideout.tsx`, `PacksPanel.tsx`
- `companion/src/packs/pack-engine.ts`, `message-router.ts`
- Docs: mcp, CU guide, ADR-017/021, architecture, host-and-apps, Aug-02 SUPERSEDED banners

### Wave 1
- `companion/src/computer/unattended-grant.ts`, `message-router.ts`, `threads/thread-manager.ts`, `server.ts`, `capability/shell.ts`, `netsec/scan.ts`, `security-policy.ts`
- Tests: unattended, worker, shell/netsec binding, security-gates

### Wave 2
- `chrome-extension/.../mode/surface-by-tool.ts`, `mode-controller.ts`
- `companion/tests/ws-router-validator-lockstep.test.ts`
- FREEZE comments; `CHANGELOG.md` Unreleased; `run-esbuild-bundle.mjs` native esbuild spawn

## Residual product notes

- Default 值守 still forceConfirms evaluate (honest matrix).
- Dual-write restore depends on process-memory snapshot + registered handler; companion restart still clears grant; durable flags restored only if expire/disarm ran in-process.
- Pack Trust ≠ 无人值守 arm (documented + phrase).
