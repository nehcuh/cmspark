# Pi review: Windows Python discovery cascade design + plan (pre-implementation)

**Stage:** Design SoT + implementation plan — **implementation has NOT started**  
**Date:** 2026-08-09  
**Repo:** CMspark (`cmspark`)  
**Batch id:** `windows-python-discovery`

## Required reading (in order)

1. **Design SoT (primary)**  
   `docs/superpowers/specs/2026-08-09-windows-python-discovery-design.md`  
   Focus: §0–2 problem/goals, §3 scheme D lock, §4 locked cascade, §5 PY1–PY16, §6 API/algorithm, §7 UX, rejection gates if present, relation to S35.

2. **Implementation plan**  
   `docs/superpowers/plans/2026-08-09-windows-python-discovery-impl.md`  
   Focus: T0–T13, file map, tests PY-T1–T17, stop gates, out of scope.

3. **Internal adversary synthesis**  
   `docs/audit/reviews/windows-python-discovery-adversary-synthesis-20260809.md`

4. **Raw adversary lanes (optional depth)**  
   `docs/audit/reviews/windows-python-discovery-adversary-raw-20260809.md`

5. **Predecessor SoT (must stay green)**  
   `docs/superpowers/specs/2026-08-02-windows-uv-python-chain-design.md` — findUv W1–W12

6. **Code spot-check (mandatory — plan vs reality)**  
   - `companion/src/computer/python-runtime.ts` — `findUv`, `probePythonBin`, `resolvePythonRuntime`, `ensureIsolatedPythonEnv`, `validatePythonExecutable`, `uvInstallHint`, `processLocalLookupPath`  
   - `companion/src/computer/qwen-vl-preflight.ts` — local `findPython`, readiness  
   - `companion/src/computer/qwen-vl-download.ts` — system python candidates  
   - `companion/src/computer/model-state-messages.ts` — `python-missing` copy  
   - `companion/src/computer/model-handlers.ts` — ensure / pick path  
   - `companion/tests/computer-python-runtime.test.ts`  
   - ADR-019 user-env denylist; ADR-020 capability axes  

## Product premise (must not be weakened)

```text
Problem: After S35 findUv, base Python discovery is still bare spawn / PATH-only.
  Windows GUI Companion false-negatives for python.org / WinGet / Scoop /
  pyenv-win / conda roots; Store stubs not rejected; install copy lacks winget.
LOCKED solution (Scheme D full hybrid cascade):
  - config absolute pin → isolated run bin → well-known absolute bases
    → manager readonly seeds → enriched PATH / py launcher
  - Gates: WindowsApps fail-closed + min Python 3.10 + absolute pin
  - Managers = detect+seed for CMspark isolated venv ONLY (not conda runtime)
  - pythonInstallHint: win32 winget + python.org; never brew-only
  - Progressive CTA: create-env vs install-Python
  - No silent install; no permanent PATH write; no computer→mcp;
    no user-env PATH merge; keep findUv S35 green
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

Independent **platform + security + product** review of **design + plan** (docs primarily). Spot-check real code so the plan is implementable and locks match current `python-runtime.ts` / preflight / download / Settings surfaces.

### Must answer

1. Are PY1–PY16 + locked cascade internally consistent and sufficient to fix Windows **base Python** false-negatives **without** Scheme E/F/G-primary?  
2. Does absolute-pin (PY1/PY15) + Store denylist (PY6) adequately close PATH/stub hijack? Residual gaps?  
3. Is manager-as-seed-only (PY8) the right product boundary vs deep conda runtime (G)?  
4. Is cascade order (config → isolated → well-known → managers → PATH/py) correct, or should managers precede well-known / vice versa?  
5. Is min Python **3.10** acceptable for P0, or must plan pin 3.11+ for torch?  
6. Do T1–T13 + PY-T1–T17 actually implement PY1–PY16, or is something missing (download bare py, preflight dead code, UI CTA)?  
7. Does the plan risk regressing S35 findUv (W1–W12)?  
8. What would make you **REJECT** starting implementation?

### Rejection gates (any fail → VERDICT: REJECT)

| # | Gate |
|---|------|
| G1 | Plan allows returning/executing bare `"python"`/`"py"`/`"python3"` after absolute known |
| G2 | Plan accepts WindowsApps Store stub as success without real backend |
| G3 | Plan silent-installs Python/uv or writes Machine/User PATH/registry without user action |
| G4 | Plan makes conda/mamba first-class Qwen runtime (activate / run-inside-env) as P0 |
| G5 | Unbounded recursive disk scan for python.exe |
| G6 | Regresses findUv absolute pin or win32 brew-only uv install copy |
| G7 | computer imports `mcp/transport` |
| G8 | isolated mode silently falls back to system PATH for download/infer |
| G9 | Auto pip into system Python without explicit system-mode user intent |
| G10 | Auto `ensureIsolated` on every preflight without user action |
| G11 | Bundles CPython as default without packaging ADR |
| G12 | Merges user-env PATH/PYTHONPATH/PYTHONHOME into discovery/spawn |

## Output format

- Findings with severity (blocking / nit), file path references for code spot-check.  
- Explicit answers to must-answer 1–8.  
- Final line **exactly** one of:

```text
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
