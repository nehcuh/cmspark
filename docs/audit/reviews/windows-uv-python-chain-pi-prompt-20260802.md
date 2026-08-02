# Pi review: Windows uv/Python chain design + plan (pre-implementation)

**Stage:** Design SoT + implementation plan — **implementation has NOT started**  
**Date:** 2026-08-02  
**Repo:** CMspark (`cmspark`)  
**Batch id:** `windows-uv-python-chain`

## Required reading (in order)

1. **Design SoT (primary)**  
   `docs/superpowers/specs/2026-08-02-windows-uv-python-chain-design.md`  
   Focus: §0–2 problem/goals, §3 scheme D lock, §4 W1–W12, §5 algorithm, §7 rejection gates G1–G10, §10 PR plan.

2. **Implementation plan**  
   `docs/superpowers/plans/2026-08-02-windows-uv-python-chain-impl.md`  
   Focus: T1–T7, file map, DoD, stop gates, out of scope.

3. **Internal adversary synthesis**  
   `docs/audit/reviews/windows-uv-python-chain-adversary-synthesis-20260802.md`

4. **Code spot-check (mandatory — plan vs reality)**  
   - `companion/src/computer/python-runtime.ts` — `findUv`, `runCapture`, `ensureIsolatedPythonEnv`, `buildInstallCommands`  
   - `companion/src/mcp/transport.ts` — `buildSpawnPath` (MCP-only today; confirm no computer import)  
   - `companion/src/computer/qwen-vl-preflight.ts` — brew strings, `uvAvailable`  
   - `companion/src/computer/model-handlers.ts` — state fields  
   - `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` — brew install uv  
   - `companion/tests/computer-python-runtime.test.ts`  
   - ADR-019 user-env denylist / CU subprocess note; ADR-020 capability axes  

## Product premise (must not be weakened)

```text
Problem: Companion reports uv missing on Windows when user PATH / WinGet /
  ~/.local/bin has uv; install copy says "brew install uv".
LOCKED solution (Scheme D):
  - Well-known absolute probes (WinGet package-id scoped, .local, scoop, choco, cargo, homebrew)
  - Process-local PATH enrichment for where/which only (no permanent PATH mutation)
  - Always pin absolute uvPath for execution; never bare "uv" after success
  - Platform install copy; surface uvPath in preflight/UI
  - uv remains optional; no computer→mcp/transport import; no user-env PATH merge
  - P0 only; config override / bundle / MCP WinGet are P1 or rejected
```

## Capability declaration (ADR-020)

```text
Surface:      existing Qwen3-VL experimental layer tooling
L2-classes:   none new
Compose:      none
Autonomy:     n/a
Trust:        no new arm / pack keys
Channel:      community
```

## Your job

Independent **platform + security + product** review of **design + plan** (docs only; git may only show docs). Spot-check real code so the plan is implementable and locks match `python-runtime.ts` / preflight / Settings.

### Must answer

1. Are W1–W12 internally consistent and sufficient to fix the Windows false-negative **without** Scheme E/F-primary?  
2. Does absolute-pin (W2/W11) adequately address PATH-hijack from bare `"uv"`? Any residual gap?  
3. Is WinGet package-id scoped scan (W3) safe enough, or too broad / too narrow?  
4. Is forbidding computer→mcp import (W6) correct, or should P0 extract shared util immediately?  
5. Is the P0/P1 split sound (auto discovery first; config override later)?  
6. Do T1–T7 in the plan actually implement W1–W12, or is something missing (tests, UI, ensureIsolatedPythonEnv)?  
7. What would make you **REJECT** starting implementation?

### Rejection gates (any fail → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | Plan allows returning/executing bare `"uv"` after successful discovery |
| R2 | Plan permanently mutates Machine/User PATH or registry without user action |
| R3 | Win32 primary install copy remains brew-only |
| R4 | Plan has computer import `mcp/transport` |
| R5 | Broad recursive scan of entire WinGet Packages without package-id filter |
| R6 | Bundles uv as default without packaging ADR |
| R7 | Changes isolated-vs-system semantics or auto-pip on system Python |
| R8 | PATH-prepend substitutes for absolute exec after discovery |
| R9 | Missing uv blocks canDownload/canEnable |
| R10 | Merges user-env PATH/PYTHONPATH into python-runtime |

## Output format

- Findings with severity (blocking / nit), file path references for code spot-check.  
- Explicit answers to must-answer 1–7.  
- Final line **exactly** one of:

```text
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
