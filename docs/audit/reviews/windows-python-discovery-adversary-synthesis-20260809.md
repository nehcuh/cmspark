# Windows Python Discovery Cascade — Adversarial Synthesis

**Scope:** Extend S35 `findUv` (Scheme D, landed) to full **base Python** discovery for Qwen3-VL / computer `python-runtime`.
**Evidence:** `[inspected]` `companion/src/computer/python-runtime.ts` (probePythonBin 429-432; listWellKnownUvCandidates 189-240; resolvePythonRuntime 454-519; ensureIsolatedPythonEnv 586-621; validatePythonExecutable 749-776; processLocalLookupPath 247-330; uvInstallHint 336-339), `qwen-vl-preflight.ts` (dead findPython 133-147; resolve 368-371; readinessSummary 612), `qwen-vl-download.ts` 228-236, `model-state-messages.ts` 129-135, `model-switch-logic.ts` 132-138, `computer-python-runtime.test.ts` (findUv only).
**Consensus scheme:** **D Full hybrid cascade** (platform + security + product + compat).
**Manager role:** DETECT + seed CMspark isolated venv — **not** G deep-run-inside-conda.
**Keep:** findUv S35 absolute pin; no silent install; no brew-only on win32; isolated|system semantics.
**pi_ready:** true

## 1 Consensus

| ID | Claim | Severity |
|----|--------|----------|
| C1 | probePythonBin bare spawn only; no well-known Python list | high |
| C2 | resolve system/isolated-missing = config + PATH bare names; no managers/well-known | high |
| C3 | ensureIsolated without uv cannot use off-PATH base | high |
| C4 | PATH enrichment only for findUv; Python probes miss GUI PATH holes | high |
| C5 | No WindowsApps denylist; no version filter | high/med |
| C6 | python-missing UX lacks winget (asymmetric vs uvInstallHint) | medium |
| C7 | download system candidates still bare python/py | high |
| C8 | tests lock findUv only | medium |
| C9 | Prefer D; reject A/B/C alone, E, F, G | — |
| C10 | Absolute pin; no silent install/PATH write; no computer→mcp; managers=seed | — |

**Security veto:** bare/relative interpreter after absolute known; Store stub ok; silent install; activate scripts; unbounded disk scan.

## 2 Scheme scoreboard

| Scheme | Verdict |
|--------|---------|
| A copy only | REJECT alone (install_ux layer of D) |
| B well-known only | REJECT alone |
| C managers only | REJECT alone |
| **D full hybrid** | **LOCK** |
| E bundle CPython | REJECT |
| F silent winget/choco | REJECT (hard veto) |
| G conda first-class runtime | REJECT P0; base-seed under D OK |

## 3 Locked cascade

1. Config `computer.pythonPath` absolute + validate
2. Isolated `DATA_DIR/python-env` if exists (isolated **run** only)
3. Well-known absolute bases (python.org/WinGet/Scoop/Anaconda; exclude WindowsApps; bounded)
4. Manager base roots readonly (no activate)
5. Process-local enriched PATH + `py -0p`/`-3` → pin absolute
6. Gates: Store reject + min version + basename allowlist
7. Absolute pin for all execution
8. findUv S35 orthogonal accelerator only
9. User `ensureIsolated`: absolute uv preferred else absolute base `-m venv`
10. Missing → winget + python.org + pick path; never silent install

## 4 Locked law (PY1–PY16)

- **PY1** Absolute pin only after discovery
- **PY2** isolated|system; no isolated→system silent fallback
- **PY3** findUv S35 intact; uv optional
- **PY4** Order: config → isolated-run → well-known → managers → PATH
- **PY5** Bounded allowlisted FS probes only
- **PY6** WindowsApps fail closed
- **PY7** Version ≥ min (P0 default 3.10)
- **PY8** Managers detect+seed only (not G)
- **PY9** No permanent PATH/registry mutation
- **PY10** No silent install / system pip
- **PY11** No computer→mcp import; inject deps
- **PY12** validate + Store + version; pick_python_path hatch
- **PY13** pythonInstallHint: win32 winget+python.org; never brew-only
- **PY14** Progressive CTA create-env vs install-Python
- **PY15** ensure argv0 absolute; Scripts vs bin lock-step
- **PY16** No user-env PATH merge into discovery

## 5 Phased path

**P0 ship:** discovery cascade + copy + create base + tests.
**P1 optional:** re-detect, manager UI, uv python install consent, min-version raise, CN mirrors.

## 6 Rejection gates

G1 bare python after absolute · G2 Store stub ok · G3 silent install/PATH write · G4 activate/G runtime · G5 unbounded scan · G6 findUv/brew-only regress · G7 mcp import · G8 isolated PATH fallback · G9 auto system pip · G10 auto-ensure on preflight · G11 bundle CPython · G12 user-env PATH merge

## 7 File map (P0)

`python-runtime.ts`, `qwen-vl-preflight.ts`, `qwen-vl-download.ts`, `model-state-messages.ts`, `model-handlers.ts`, `model-switch-logic.ts`, `SettingsSlideout.tsx`, `computer-python-runtime.test.ts`, design SoT under `docs/superpowers/specs/`.

## 8 Open questions

1. Min Python 3.10 vs 3.11+?
2. uv python install without host Python (P1 confirm)?
3. Manager UI vs silent seed?
4. WinGet allowlist breadth?
5. conda envs/* depth?
6. winget package id pin vs rolling?

**Explicit:** keep S35 findUv; extend probePython/base selection; absolute pin; no silent install; no brew-only; managers = capability detect + isolated seed only.