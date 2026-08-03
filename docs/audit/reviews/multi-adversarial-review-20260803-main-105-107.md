# Multi-Adversarial Code Review — main (#105 + #106 + #107)

**Date**: 2026-08-03  
**Range**: `6f3a210^..dd3b1dd` (production: companion/chrome-extension + ADR)  
**Tip after pull**: `dd3b1dd` (#107) + local handoff commits rebased  
**Method**: 4 independent adversarial lanes in parallel (Security / Correctness / Architecture / Compat)  
**Orchestrator**: Grok Build · omx-code-review style synthesis (not deep-diagnosis fix loop)

## Lane verdicts

| Lane | Status | Recommendation |
|------|--------|----------------|
| Security | WATCH | **REQUEST_CHANGES** |
| Correctness | WATCH | **REQUEST_CHANGES** |
| Architecture | WATCH | **COMMENT** |
| Compat/Platform | WATCH | **REQUEST_CHANGES** |

## Final synthesis

| Field | Value |
|-------|--------|
| **Architectural status** | WATCH |
| **Final recommendation** | **REQUEST_CHANGES** |
| **Merge-ready?** | No — fix P0 honesty + config state bugs first; core skip algebra is otherwise sound |

### Deterministic merge gate
- Architect ≠ BLOCK, but Security + Correctness + Compat all REQUEST_CHANGES → final **REQUEST_CHANGES**
- Core invariant holds: global cruise/god bools alone do **not** skip `host_computer` initial L2; grant is process-memory + phrase; `host_cli` always forceConfirm

---

## P0 — must address (HIGH, multi-lane)

### 1. Unattended arm: UI honesty + durable dual-write
- **Lanes**: Security F1/F2/F4, Architecture F1/F3
- **Evidence** `[inspected]`:
  - UI: `SettingsSlideout.tsx:841` — “不会写入长期配置”
  - Server: `message-router.ts:2106-2116` always `saveConfig` `auto_approve_dangerous` + `auto_approve_enterprise_tools`
  - Dual-ack checkboxes only client-side (`SettingsSlideout.tsx:360`); server only checks phrase `我了解风险`
  - Protocol sticky: arm with `include_protocol:false` does **not** clear existing `allow_all_schemes`
- **Risk**: Session-only consent → residual full web + enterprise cruise after restart; enterprise L2 skip piggybacks “desktop only” arm
- **Fix direction**:
  1. Server require `ack_desktop` + `ack_session` (or `user_gesture`)
  2. Either stop dual-write on arm, or rewrite copy to name durable flags + default `clear_cruise` on disarm
  3. Atomic target vector: `allow_all_schemes = include_protocol` exactly (clear when false)

### 2. `ensure_python_env` persists mode before success
- **Lanes**: Correctness F1
- **Evidence** `[inspected]`: `model-handlers.ts:705` `setComputerModelFields({ pythonMode: "isolated" })` before `ensureIsolatedPythonEnv`
- **Risk**: Failed env create traps user on broken isolated mode; download/preflight blocked
- **Fix**: Persist only on `result.ok`, or roll back previous mode

### 3. Platform UX safety (Windows/macOS)
- **Lanes**: Compat F1/F2/F3
- **Evidence** `[inspected]`:
  - `python-runtime.ts:runCapture` missing `windowsHide: true` (console flash)
  - `buildInstallCommands` quoted absolute path breaks PowerShell with spaces
  - `model-state-messages.ts` hardcodes Ctrl+Alt+End (Windows) on macOS (real: ⌃⌥⌘⇧E)
- **Fix**: windowsHide on computer spawns; PowerShell `& 'path'` templates; platform estop string from server

---

## P1 — should fix soon (MEDIUM)

| ID | Source | Summary |
|----|--------|---------|
| C-F2 | Correctness | `value_regex` docs claim full-string; `RegExp#test` unanchored |
| C-F3 | Correctness | Settings disarm optimistically clears UI without companion ack |
| S-F3 | Security | Disarm/TTL does not abort in-flight `host_computer` / tokens |
| A-F2 | Architecture | Three Trust mechanisms sold as one Autopilot ladder (ADR-020 tension) |
| C-F4 | Correctness | Positional `value_regex` not validated at manifest ingest |
| P-F4–F8 | Compat | Unix `~`/python3 copy; host_cli GNU flags; CJK charset; MAX_PATH |

---

## What is solid (do not regress)

- Unattended pure gate: coordinateAllowed + phrase + process grant + TTL + `modelEnabled` blocks skip
- Pack forbid list for unattended / auto_approve keys
- `host_cli`: no free-args, `shell:false`, L2 forceConfirm, env scrub, binding
- #107 `findUv` absolute pin, WinGet package-id scope, never bare `"uv"`, server-driven install hints
- Python package allowlist + companion-owned isolation

---

## Suggested fix batches

1. **Trust honesty (security)**: arm acks + dual-write policy + matrix/client/server reconcile + disarm abort CU  
2. **Python state machine**: ensure_python_env transactional mode  
3. **Platform polish**: windowsHide + PS install snippets + estop copy  
4. **CLI contract**: full-string regex + positional validation  

---

## Artifacts

- Lane reports: `/tmp/cmspark-review/lane-{security,correctness,architecture,compat}.md`
- Diff used: `/tmp/cmspark-review/code.diff` (56 production files, ~6k LOC Δ)

## Evidence tags

- Pull + rebase conflict resolution: `[executed]`
- Spot-check of HIGH findings vs source: `[inspected]`
- End-to-end arm/disarm on live Companion: `[assumed]` (not run in this session)

---

## Follow-up implementation (2026-08-03 S36 fix)

Landed on main worktree after REQUEST_CHANGES:

| Item | Fix |
|------|-----|
| P0 Trust acks | `ack_desktop` + `ack_session` required server-side on `security.unattended.arm` |
| P0 dual-write honesty | UI copy names durable cruise; `allow_all_schemes = include_protocol` exact vector |
| P0 disarm | no optimistic `armed:false`; companion status SoT; `flipAllComputerTaskAborts` on disarm |
| P0 ensure_python_env | persist `pythonMode:isolated` only on success |
| P0 platform | `windowsHide` on computer spawns; PowerShell `& 'path'`; dual-OS estop copy |
| P1 CLI | full-string `value_regex`; positional regex validated at ingest |

Tests: companion focused suite + computer-task-abort integration + extension model-switch green.

### Remaining P1 batch (same day)

| Item | Fix |
|------|-----|
| P-F4 Settings paths | no `~`/python3-only copy; server absolute path + platform-neutral Python wording |
| P-F5 host_cli flags | AppsPanel + cli-manifest: GNU `--flag` honesty (no slash-flags) |
| P-F6 PATH fallback | `defaultCliPathFallback` win32 SystemRoot vs Unix |
| P-F7 CJK charset | `CLI_SAFE_VALUE` uses `\p{L}\p{N}` |
| P-F8 MAX_PATH | `longPathFailureHint` on ensureIsolatedPythonEnv fail (win32) |
| S-F3 residual | purge `host_computer` issued tokens on disarm |
| Correctness F7 | `scheduleUnattendedExpireClear` client TTL chip |
| A-F2 light | matrix footnote: three orthogonal Trust mechanisms |
