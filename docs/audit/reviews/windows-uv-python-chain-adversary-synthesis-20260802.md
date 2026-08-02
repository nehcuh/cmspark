# CMspark Windows uv/Python PATH Chain — Adversarial Synthesis

**Scope:** Qwen3-VL experimental layer — `findUv` / isolated-env discovery only.  
**Evidence base:** file:line reads of `python-runtime.ts`, `transport.ts`, `qwen-vl-preflight.ts`, `model-handlers.ts`, `SettingsSlideout.tsx`, tests.  
**Consensus scheme:** **D (hybrid)** — absolute well-known probes + process-local PATH aid + platform install copy + surface `uvPath`. No security veto.

---

## 1 Consensus (all lanes)

| ID | Claim | Severity | Evidence |
|----|--------|----------|----------|
| C1 | `findUv` only uses `where`/`which` + bare `uv` under `process.env` → false-negative under GUI/daemon/Machine-only PATH | high | `python-runtime.ts:66-72,117-125` |
| C2 | MCP `buildSpawnPath` hardens PATH for stdio only; computer never reuses it | high | `transport.ts:23-36,37-140,152`; zero computer imports |
| C3 | `buildSpawnPath` omits WinGet Packages (confirmed host layout) | high | `transport.ts:57-90` — no `Microsoft/WinGet` |
| C4 | Success may return path `"uv"`; `ensureIsolatedPythonEnv` re-spawns bare name → PATH-hijack class | high (security) / medium (others) | `:123-124`, `:243-255` |
| C5 | `uvPath` exists on `PythonRuntimeInfo` but preflight/handlers/UI only pass `uvAvailable` | medium | `python-runtime.ts:58,161`; preflight `:89,626`; handlers `:268`; types `:579-585` |
| C6 | Install copy hardcodes `brew install uv` on all platforms incl. Windows | medium–high product | preflight `:435,:534`; Settings `:1555` vs OS-aware Python at `model-state-messages.ts:129-134` |
| C7 | No tests for `findUv` / absolute pin; only `sanitizePythonPackages` | medium | `computer-python-runtime.test.ts:1-23` |
| C8 | `USER_ENV_DENYLIST` already blocks PATH/PYTHONPATH; do not open that for this fix | low (keep) | `user-env.ts:68-91`; ADR-019 CU 子进程 不做 secret inject |
| C9 | Prefer scheme **D**; reject A/B alone, E primary, F primary, silent PATH registry mutation | — | all four lanes |
| C10 | Layering: do **not** `computer → mcp/transport` import; share via extract/inject | — | compat + security |

**Security veto power:** relative/`uv` execution after discovery is **must-not**. Absolute pin is non-negotiable. Scheme D accepted.

---

## 2 Scheme scoreboard

| Scheme | Platform | Security | Product | Compat | Verdict |
|--------|----------|----------|---------|--------|---------|
| **A** docs/copy only | reject | reject (no integrity fix) | reject (false-neg remains) | reject | **REJECT** — subset of D only |
| **B** buildSpawnPath env only | reject (no WinGet) | reject (still bare `uv`) | reject (no copy/uvPath) | reject (layering if computer→mcp) | **REJECT** alone |
| **C** absolute probes only | partial | ok-ish | partial | reject alone (misses PATH-only installs) | **REJECT** alone |
| **D** hybrid B+C + copy + uvPath | **accept** | **accept** | **accept** | **accept** | **LOCK** |
| **E** bundle uv | reject blast | reject supply-chain | reject | reject | **REJECT** |
| **F** manual config primary | reject UX | ok escape hatch only | reject primary | ok as P1 hatch | **REJECT** as primary; optional P1 |
| Silent Machine/User PATH write | veto all | veto | veto | veto | **REJECT** |

---

## 3 Locked law (W1–W12)

| ID | Lock | Rationale |
|----|------|-----------|
| **W1** | Discovery order: optional absolute config override (P1) → well-known absolute probes → `where`/`which` under process-local enriched PATH → fail closed `uvAvailable:false` | Covers WinGet/.local + PATH-present installs without permanent mutation |
| **W2** | After any success, store and spawn **absolute** `uvPath` (`realpath` when possible); **never** keep bare `"uv"` as canonical when absolute known | Closes PATH hijack on `ensureIsolatedPythonEnv` |
| **W3** | Win32 probes (existsSync + isFile + basename `uv.exe`): `%LOCALAPPDATA%\Microsoft\WinGet\Packages\astral-sh.uv_*\uv.exe` (package-id scoped, not full tree); `%USERPROFILE%\.local\bin\uv.exe`; scoop shims; chocolatey\bin; cargo `.cargo\bin` | Matches confirmed host; security forbids broad Packages scan |
| **W4** | Unix probes: `~/.local/bin/uv`, `/opt/homebrew/bin/uv`, `/usr/local/bin/uv` + existing `which` | No unix regression |
| **W5** | Enriched PATH is **per-lookup spawn env only**; never write Machine/User PATH/registry | Hard constraint all lanes |
| **W6** | Do not import `mcp/transport` from computer; extract shared helper or local probe list in `python-runtime` (optionally later shared util for MCP WinGet) | Layer inversion veto (compat) |
| **W7** | Platform install copy: win32 `winget install --id astral-sh.uv -e` (scoop secondary); darwin `brew install uv`; linux official/curl installer — **never brew-only on win32** | Fixes trust-breaking UI |
| **W8** | Surface absolute `uvPath` through QwenVlPreflight + `computer.model.state` + extension model/preflight types when `uvAvailable` | Operator debug; boolean insufficient |
| **W9** | uv remains optional (`blocking:false`); isolated vs system Python semantics unchanged; no auto pip on system Python | Product + ADR-020 Surface tooling only |
| **W10** | Keep `USER_ENV_DENYLIST` PATH/PYTHONPATH out of python-runtime merges | ADR-019 / security |
| **W11** | Prefer absolute candidates over ambient PATH order for **execution** (probe list first) | Hostile PATH with fake `uv` earlier loses |
| **W12** | ADR-020: runtime tooling for existing experimental Surface only — no new autonomy axis, pack arm, or auto_approve keys | Scope discipline |

---

## 4 Phased path

### P0 — Detection + absolute pin + copy + surface (ship)

**Scope**
1. Rewrite `findUv`: absolute probes (W3/W4) → `where`/`which` with process-local PATH enrichment (reuse *ideas* from `buildSpawnPath`, not computer→mcp import) → optional bare probe only if result can be resolved to absolute via `where` output; else fail.
2. `ensureIsolatedPythonEnv` / install spawns only absolute `uvPath` when ok.
3. Platform install helper; replace brew strings in `qwen-vl-preflight` + `SettingsSlideout`.
4. Pass `uvPath` preflight → handlers → extension types/UI (monospace truncate middle).
5. Unit tests: stripped PATH + fixture probes; never non-absolute when ok; win32 no brew string; sanitize regression.

**Acceptance**
- Stripped PATH + fixture WinGet/`~/.local` → `findUv.ok && path.isAbsolute`
- `ok:true` never returns `"uv"` alone
- ensureIsolatedPythonEnv mock spawn argv0 absolute
- win32 missing-uv strings contain winget, not brew
- preflight/state include `uvPath` when available
- unix which/homebrew still works
- `sanitizePythonPackages` unchanged

### P1 — Optional (follow-up; not blocking pi)

- `computer.uvPath` absolute config override (mirror `validatePythonExecutable`; reject relative)
- Settings “重新检测环境” without full Companion restart
- Extract shared PATH/probe util; add WinGet to MCP `buildSpawnPath` for `uvx` parity
- Measure real tray/daemon `process.env.PATH` on host (open Q)

---

## 5 Rejection gates (any fail → REJECT implementation start)

1. **G1** Design returns or executes bare `"uv"` after successful discovery  
2. **G2** Permanently mutates Machine/User PATH or registry without explicit user action  
3. **G3** Win32 primary install copy is brew-only / shows brew as only hint  
4. **G4** computer imports `mcp/transport` (layer inversion)  
5. **G5** Broad recursive scan/execute under entire WinGet Packages without package-id filter  
6. **G6** Bundles uv binary as default (E) without separate packaging ADR  
7. **G7** Changes isolated-vs-system product semantics or auto-runs pip on system Python  
8. **G8** PATH-prepend used as substitute for absolute exec after discovery  
9. **G9** Makes missing uv block `canDownload`/`canEnable`  
10. **G10** Merges user-env PATH/PYTHONPATH into python-runtime spawn  

---

## 6 File map (P0)

| Path | Change |
|------|--------|
| `companion/src/computer/python-runtime.ts` | findUv probes + absolute pin; ensureIsolatedPythonEnv absolute spawn; optional install hint helper |
| `companion/src/computer/qwen-vl-preflight.ts` | platform uv copy; `uvPath` on preflight payload |
| `companion/src/computer/model-handlers.ts` | passthrough `uvPath` in state |
| `chrome-extension/src/sidepanel/types.ts` | `uvPath?: string` on model + preflight |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | accept `uvPath` in state merge |
| `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` | platform copy + show path when present |
| `companion/tests/computer-python-runtime.test.ts` | findUv / absolute / platform copy invariants |
| *(optional same PR)* shared util e.g. `companion/src/path-env.ts` | only if extracting PATH candidates without computer→mcp |

**Out of scope P0:** model weights, torch CUDA, locate accuracy, MCP server config UI, bundling uv, permanent PATH mutation.

---

## 7 Open questions (defer; do not block pi)

1. Does Explorer-launched `cmspark-agent.exe` daemon inherit full User PATH, or only Machine? (affects how often C1 fires without probes — probes still mandatory)  
2. WinGet Links dir vs versioned `Packages/astral-sh.uv_*` — prefer both: Links if present, else package-id scan  
3. Ship `computer.uvPath` override in same PR (P1) or pure auto-discovery first? **Recommend: auto first (P0), override P1**  
4. Extract shared PATH helper for MCP WinGet in same PR? **Recommend: computer-local P0; shared extract optional P1**  
5. Cargo `.cargo\bin\uv.exe` in well-known list? **Yes, low cost**  
6. Should `buildInstallCommands` print quoted absolute uv for copy-paste when PATH still broken in user terminals? **Nice-to-have P0 if cheap**

---

## Design justification (D)

- **A** fixes copy only → leaves false-negative readiness on Windows daemon.  
- **B** alone misses confirmed WinGet Packages and bare-name exec.  
- **C** alone misses PATH-only legitimate installs.  
- **E/F primary** disproportionate friction/blast for optional accelerator.  
- **D** is smallest effective radius: process-local discovery + absolute pin + honest platform copy + operator-visible `uvPath`, aligned with ADR-019/020 and security absolute-exec law.

**pi_ready = true** — no unresolved security vs product conflict; security absolute-pin and product platform-copy both embedded in D/P0.