# Raw adversary outputs — windows-uv-python-chain

## Lane: platform

Recommended: D — hybrid (buildSpawnPath-enriched where/which + well-known absolute probes + platform install copy + surface uvPath)

Smallest effective blast radius: fix false-negative discovery on Windows GUI/daemon PATH without packaging uv (E) or forcing manual config (F primary). B alone misses WinGet Packages; C alone misses PATH-present installs and MCP parity. Implement D: absolute-first probes (incl. WinGet + ~/.local/bin), then where/which with process-local enriched PATH, always exec absolute uvPath, platform-specific install strings, expose uvPath in preflight/UI. F remains optional escape hatch. Severity overall: high for Windows daemon reliability, medium for copy/UX.

### Confirmed problems
- **high** `P1`: findUv only uses where/which + bare spawn(process.env); daemon/tray/GUI with stripped or Machine-only PATH false-negative misses installed uv — companion/src/computer/python-runtime.ts:66-72 runCapture uses env: process.env; :117-126 findUv = where/which uv then spawn("uv",["--version"]) with no well-known path probes
- **high** `P2`: PATH hardening exists for MCP stdio only; Qwen Python/uv resolution does not reuse it — companion/src/mcp/transport.ts:23-36,37-140 buildSpawnPath documents GUI/Task Scheduler stripped PATH; companion/src/computer/python-runtime.ts findUv/ensureIsolatedPythonEnv never call buildSpawnPath
- **high** `P3`: buildSpawnPath Windows candidates omit WinGet Packages (confirmed local uv install layout) — companion/src/mcp/transport.ts:57-90 lists APPDATA/npm, ProgramFiles/nodejs, fnm, Volta, Python Scripts, scoop/shims, chocolatey/bin — no Microsoft/WinGet/Packages or WinGet Links
- **medium** `P4`: findUv may return non-absolute path "uv"; ensureIsolatedPythonEnv re-spawns via ambient PATH — companion/src/computer/python-runtime.ts:123-124 return { ok:true, path:"uv" }; :243-255 uvBin = uv.path || "uv" then runCapture(uvBin, ...)
- **medium** `P5`: uvPath is resolved internally but never exposed in preflight/state/UI (only uvAvailable boolean) — python-runtime.ts:58,161 uvPath on PythonRuntimeInfo; qwen-vl-preflight.ts:89,626 only uvAvailable; model-handlers.ts:268 uvAvailable only; chrome-extension useWebSocket.ts:812 + SettingsSlideout.tsx:1553-1555 boolean only
- **medium** `P6`: UI/preflight install copy hardcodes brew install uv on all platforms including Windows — qwen-vl-preflight.ts:435,534 brew install uv; SettingsSlideout.tsx:1555 未检测到 uv（可选：brew install uv）; contrast model-state-messages.ts:133 Mac brew vs Windows python.org for Python itself
- **medium** `P7`: No automated tests for findUv / ensureIsolatedPythonEnv PATH discovery; only sanitizePythonPackages covered — companion/tests/computer-python-runtime.test.ts:1-23 only sanitizePythonPackages; mcp.test.ts:241-286 covers buildSpawnPath Windows but not python-runtime findUv

### Rejected
- ~~A — docs/copy only~~ — Fixes brew-on-Windows messaging but leaves false-negative uv discovery under stripped/Machine PATH and non-PATH installs (.local/bin, WinGet package dirs); does not meet absolute-exec preference
- ~~B alone — reuse buildSpawnPath in findUv spawn env only~~ — Does not include WinGet Packages layout (P3); still allows bare path "uv" (P4); incomplete vs confirmed install paths
- ~~E — bundle uv binary in cmspark package~~ — High blast radius (signing, supply-chain, update, package size) without necessity once absolute discovery + PATH probe exist; no product requirement for offline uv
- ~~F as primary — require user absolute uv path in config~~ — Valid escape hatch but wrong primary UX: user already has WinGet uv; manual config increases friction and support load; auto-discovery should cover common layouts first
- ~~Silently mutate Machine/User PATH registry permanently~~ — Hard constraint: no silent permanent PATH/registry mutation; discovery must be process-local and reversible

### Locks
- LOCK: findUv discovery order: optional config absolute override → well-known absolute probes (win32: WinGet Packages scan for uv.exe, %USERPROFILE%\.local\bin\uv.exe, scoop shims, chocolatey, cargo bin; unix: ~/.local/bin, homebrew, cargo) → where/which under enriched PATH → fail closed uvAvailable:false
- LOCK: After success always persist and spawn absolute uv path (realpath when possible); never keep bare "uv" as canonical path when absolute is known
- LOCK: runCapture/spawn for uv and isolated env creation must use the discovered absolute path, not rely on ambient PATH for the binary name
- LOCK: Enriched PATH for discovery only (process-local); do not permanently write Machine/User PATH or registry unless user-initiated
- LOCK: Platform-specific install copy: win32 winget/scoop (not brew); darwin brew; linux official installer; applied in qwen-vl-preflight + SettingsSlideout
- LOCK: Surface uvPath (absolute string|undefined) through QwenVlPreflight + computer.model.state + extension model state for operator debug
- LOCK: Keep isolatedPythonBin/pip: win32 Scripts\python.exe|pip.exe vs unix bin/python3|pip; keep system mode python/py on win32 and python3/python on unix
- LOCK: ADR-020: runtime tooling for existing experimental Surface only — no new autonomy axis or silent global env mutation
- MUST NOT: Must not permanently mutate Machine PATH or user registry for uv without explicit user action
- MUST NOT: Must not execute bare/relative "uv" when an absolute path was already discovered
- MUST NOT: Must not show brew install uv as the only/primary hint on win32
- MUST NOT: Must not change isolated-vs-system Python product semantics or auto-run pip against system Python
- MUST NOT: Must not regress unix which/homebrew discovery path for findUv
- MUST NOT: Must not bundle uv binary as default fix without separate product decision
- MUST NOT: Must not invent WinGet paths without existsSync probe (versioned package dirs move)
- MUST NOT: Must not treat PATH prepend as a substitute for absolute execution of uv after discovery

### Tests
- With process.env.PATH stripped to System32 (or /usr/bin:/bin), findUv still returns ok when uv.exe/uv exists at a well-known probed absolute path
- Win32: synthetic LOCALAPPDATA/Microsoft/WinGet/Packages/*/uv.exe probe is found without requiring that dir on PATH
- When uv found, returned path is absolute and ensureIsolatedPythonEnv spawns that absolute path (mock spawn argv[0])
- findUv never returns path:"uv" when where output or probe yields an absolute filesystem path
- unix: which/PATH discovery still works; no win32-only code path breaks darwin/linux
- buildInstallCommands / preflight nextSteps / Settings copy: win32 does not emit brew install uv; emits winget or platform-appropriate hint
- preflight/state payload includes uvPath when uvAvailable true (absolute)
- isolatedPythonBin on win32 remains .../python-env/Scripts/python.exe (unit invariant)
- Regression: sanitizePythonPackages allowlist behavior unchanged

---

## Lane: security

Recommended: D — Hybrid absolute discovery + process-local PATH aid + platform install copy + surface uvPath

Security-preferred design: discover via well-known absolute candidates (tight WinGet package-id filter, .local/bin, scoop/cargo/homebrew) plus where/which with optional process-local PATH augmentation borrowed from buildSpawnPath ideas—not full MCP PATH reorder as sole trust. After any hit, pin realpath absolute and only spawn that. Platform install strings (winget install astral-sh.uv / scoop / brew / curl) fix P4. Expose uvPath in preflight (P5). Optional absolute config override (F) is a small additive escape hatch, not a substitute. Reject E unless product later makes uv mandatory. Severity overall high due to relative-uv RCE class if PATH is hostile; not critical because action is user-gated settings ensure/install and packages are allowlisted—but the binary hijack is the dominant risk.

### Confirmed problems
- **high** `P1-path-only-findUv`: findUv discovers uv only via where/which and bare spawn on process.env.PATH; no absolute well-known probes, so Machine-only or stripped PATH (GUI/daemon) misses installed uv (e.g. WinGet User PATH or ~/.local/bin not on PATH). — companion/src/computer/python-runtime.ts:72 spawn env:process.env; :117-125 findUv uses where|which then runCapture("uv",["--version"]); no WinGet/.local/scoop probes. companion/src/mcp/transport.ts:37-139 buildSpawnPath hardens MCP only and is not imported by python-runtime.
- **high** `P2-relative-uv-exec`: Successful bare-spawn discovery returns path "uv" (relative). ensureIsolatedPythonEnv re-spawns that name under process.env, enabling PATH first-hit hijack (malicious uv.exe) when user creates isolated env / installs deps — user-context code execution. — companion/src/computer/python-runtime.ts:123-124 returns {ok:true,path:"uv"}; :241-255 uvBin = uv.path || "uv" then runCapture(uvBin, ["venv"|"pip","install",...]); runCapture always inherits process.env PATH at spawn time (:72).
- **medium** `P3-buildSpawnPath-not-reused`: MCP buildSpawnPath already prepends ~/.local/bin, Scoop, Chocolatey, Python Scripts for stdio children, but Qwen Python/uv chain never reuses it; even reuse alone would not cover WinGet Packages package dirs. — companion/src/mcp/transport.ts:54 path.join(homedir,".local","bin"); :86-90 scoop/chocolatey; no Microsoft/WinGet/Packages. createTransport sets env.PATH=buildSpawnPath() at :152. grep: zero WinGet/uv.exe in companion/src outside python-runtime findUv.
- **low** `P4-brew-only-install-copy`: When uv is missing, Settings UI and preflight tell all platforms to brew install uv, including Windows — wrong install path and confuses integrity of guidance. — chrome-extension/src/sidepanel/components/SettingsSlideout.tsx:1553-1555 brew install uv; companion/src/computer/qwen-vl-preflight.ts:433-435 and :532-534 same string. Contrast platform-aware Python install in companion/src/computer/model-state-messages.ts:129-134.
- **medium** `P5-uvPath-not-surfaced`: Runtime may set uvPath on PythonRuntimeInfo, but preflight/handlers/UI only expose uvAvailable boolean — operators cannot verify which binary was trusted. — companion/src/computer/python-runtime.ts:58 uvPath?: string and :161/... spread uvPath; companion/src/computer/qwen-vl-preflight.ts:89 uvAvailable only, :626 passes runtime.uvAvailable; companion/src/computer/model-handlers.ts:268 uvAvailable only.
- **medium** `P6-no-findUv-tests`: No unit tests assert absolute-path pinning, stripped-PATH discovery, or PATH-hijack resistance for findUv/ensureIsolatedPythonEnv; only package sanitize is covered. — companion/tests/computer-python-runtime.test.ts imports only sanitizePythonPackages (lines 1-23). companion/tests/mcp.test.ts covers buildSpawnPath Windows npm/fnm/Volta/Scoop (:241-286) not python-runtime findUv.
- **low** `P7-user-env-path-denied`: user-env cannot inject PATH (denylist) — not an open injection path today; any future merge of user_env into python-runtime must keep PATH/PYTHONPATH denied. — companion/src/user-env.ts:69-91 USER_ENV_DENYLIST includes PATH, PYTHONPATH, PYTHONHOME, LD_*/DYLD_*, NODE_PATH. python-runtime runCapture does not call getUserEnvVars().

### Rejected
- ~~A) Docs/copy only~~ — Does not fix PATH-blind discovery or relative-uv execution integrity; only reduces wrong brew install guidance. Acceptable as a D sub-task, not a security fix.
- ~~B) Reuse buildSpawnPath in findUv spawn env only~~ — Still first-match PATH order; still allows path:"uv"; still misses WinGet Packages absolute layout; prepending many dirs expands trust surface without absolute pin after discovery.
- ~~E) Bundle uv inside cmspark package~~ — Large blast radius (binary update, signature, multi-arch, legal/supply-chain) for optional experimental-layer tooling; ADR-020 runtime tooling should not ship a second package manager without strong necessity. Prefer discover+pin of user-installed uv.
- ~~F) Manual absolute uv path config alone~~ — Good escape hatch (mirror validatePythonExecutable) but fails default UX for WinGet users; still need auto-discovery. Do not make config the only recovery.
- ~~Broad recursive scan of LOCALAPPDATA/Microsoft/WinGet/Packages~~ — Executes or trusts arbitrary package trees under Packages (symlink/TOCTOU, wrong package IDs). Probe only known package-id prefix dirs (e.g. astral-sh.uv_*) for basename uv.exe + isFile/realpath + optional --version.
- ~~Silently mutate Machine/User PATH registry~~ — Hard constraint: permanent env mutation is user-initiated only; daemon must not rewrite global PATH to 'fix' detection.

### Locks
- LOCK: After discovery, spawn only absolute uv paths (reject relative names like "uv" for ensureIsolatedPythonEnv / install).
- LOCK: Before exec: fs.existsSync + isFile (or symlink→realpath target) + optional uv --version smoke; prefer fs.realpathSync for the stored uvPath.
- LOCK: Discovery order: optional config absolute override → well-known absolute candidates (win: WinGet astral-sh.uv_*\uv.exe tight filter, %USERPROFILE%\.local\bin\uv.exe, scoop shims, cargo bin; unix: ~/.local/bin/uv, /opt/homebrew/bin/uv, /usr/local/bin/uv) → where/which (lookup only) with optional augmented PATH.
- LOCK: Do not permanently write Machine or User PATH registry; PATH augmentation is process-local for lookup only.
- LOCK: Do not recursively execute from entire WinGet Packages tree; package-id-scoped existence probe only.
- LOCK: Keep USER_ENV_DENYLIST PATH/PYTHONPATH out of python-runtime spawn env merges.
- LOCK: Surface absolute uvPath in preflight/state for audit (boolean uvAvailable alone is insufficient).
- LOCK: Platform install copy: winget/scoop/pipx/curl per OS; never brew-only on win32.
- LOCK: Preserve isolated vs system Python mode semantics; uv preference only for env create/pip install.
- LOCK: Do not regress unix which path or existing sanitizePythonPackages allowlist.
- MUST NOT: Return or execute path:"uv" after a successful discovery.
- MUST NOT: Silently mutate system/user PATH registries or require admin elevation for detection.
- MUST NOT: Trust first PATH entry without converting to absolute path for subsequent spawns.
- MUST NOT: Scan/execute arbitrary files under WinGet Packages or user-writable dirs without basename+package-id filters.
- MUST NOT: Bundle or download uv as part of this change without separate supply-chain design.
- MUST NOT: Allow user-env or WS client to set relative uv command names.
- MUST NOT: Change canDownload/canEnable product rules beyond reporting true uv availability.
- MUST NOT: Introduce new Autonomy axis (ADR-020): this is Surface runtime tooling only.

### Tests
- Stripped PATH (e.g. only System32 /usr/bin:/bin) + well-known absolute uv.exe present → findUv.ok && path.isAbsolute(path).
- findUv never returns non-absolute path when ok:true.
- ensureIsolatedPythonEnv spawns the absolute uvPath (mock spawn) when discovery succeeds.
- Fake uv earlier on PATH loses if well-known absolute candidate exists (prefer absolute candidates over PATH order for execution).
- WinGet-style probe: only astral-sh.uv_* package dirs yield candidates; unrelated package dirs with uv.exe name are ignored.
- macOS/Linux: ~/.local/bin/uv and homebrew paths still discovered; which path still works when PATH has real uv.
- Preflight/state includes uvPath when available; UI install hint is platform-specific (no brew string on win32).
- sanitizePythonPackages regression: flags/URLs/paths still stripped.
- No test or code path writes to registry PATH as side effect of findUv.
- Optional config absolute uv override: non-absolute rejected; missing file rejected (mirror validatePythonExecutable).

---

## Lane: product

Recommended: D — B+C hybrid discover + platform install copy + surface uvPath

Product priority is ending false-negative readiness and brew-only Windows copy with minimal blast radius. Implement well-known absolute probes (WinGet/local/scoop/choco/cargo + ~/.local/bin) first, optionally augment findUv spawn env with buildSpawnPath (helps PATH tools without registry writes), pass uvPath through preflight→handlers→Settings, and replace brew-only strings with OS-aware Chinese install + conditional restart guidance. Reject A-alone, B-alone, E primary, F primary. Severity of live Windows false-negative + wrong install CTA is high for experimental-layer onboarding trust.

### Confirmed problems
- **high** `P1`: findUv false-negatives when Companion process PATH lacks uv (tray/daemon/Machine-only) even if User PATH/WinGet has uv; interactive shell can still find it. — companion/src/computer/python-runtime.ts:117-126 findUv uses only where/which + bare uv; runCapture at :66-72 spawns with env: process.env only — no buildSpawnPath, no absolute well-known probes.
- **high** `P2`: User-facing Chinese copy always recommends brew install uv, including on Windows — trust-breaking and non-actionable. — companion/src/computer/qwen-vl-preflight.ts:433-435 nextSteps; :532-534 requirements id=uv detail 'brew install uv'; chrome-extension/src/sidepanel/components/SettingsSlideout.tsx:1553-1555 '未检测到 uv（可选：brew install uv）'.
- **medium** `P3`: uvPath is resolved in runtime info but never exposed in preflight/state/UI, so readiness cannot show where uv was found or help debug false negatives. — python-runtime.ts:58,161 sets uvPath; qwen-vl-preflight.ts:88-89,626 only uvAvailable; model-handlers.ts:268 passthrough uvAvailable only; types.ts:579-585 no uvPath field.
- **medium** `P4`: MCP buildSpawnPath already hardens GUI-stripped PATH (incl. ~/.local/bin, Scoop) but Python uv discovery does not reuse it; buildSpawnPath also omits WinGet Packages. — companion/src/mcp/transport.ts:37-139 buildSpawnPath candidates; no WinGet Packages scan; findUv never imports/uses buildSpawnPath (python-runtime.ts:117-126).
- **medium** `P5`: Discovery may return bare name 'uv' and install/exec commands use bare uv, weakening absolute-path preference and PATH-hijack resistance. — python-runtime.ts:124 returns path:'uv'; :243-244 uvBin=uv.path||'uv'; buildInstallCommands :318-321 always emits 'uv venv' / 'uv pip install' not absolute path.
- **medium** `P6`: No per-OS uv install commands; restart Companion guidance exists for Python-missing but not for uv PATH install recovery. — brew-only strings in preflight/Settings (P2); model-switch-logic.ts:136 restarts for python-missing OS-aware install; no analogous uv restart/install branch in SettingsSlideout.tsx:1547-1555.
- **medium** `P7`: No product/runtime tests for findUv, platform install copy, or uvPath surfacing — only sanitizePythonPackages covered. — companion/tests/computer-python-runtime.test.ts:1-23 sanitize only; mcp.test.ts:241-286 covers buildSpawnPath Windows, not findUv.

### Rejected
- ~~A — docs/copy only~~ — Fixes brew-only trust issue but leaves false-negative readiness cards when uv is installed off Machine PATH; users still see 未检测到 and avoid or mis-install.
- ~~B — buildSpawnPath spawn env only~~ — Partial: helps ~/.local/bin/scoop if dirs exist, but confirmed WinGet Packages path is absent from buildSpawnPath candidates; still PATH-first, no uvPath product surface, brew copy unchanged.
- ~~E — bundle uv inside cmspark package~~ — Disproportionate blast radius for optional accelerator: multi-arch binaries, signing, updates, AV false positives, package size; not justified while absolute-path discovery fixes the local false negative.
- ~~F — manual absolute uv path config as primary~~ — High friction power-user flow; correct as optional escape hatch later, wrong as first-line product fix when auto well-known probes can work.
- ~~C alone without product copy/uvPath surface~~ — Detection-only still leaves brew-only Windows copy and opaque readiness (no path shown); product lane requires copy + cards to close the loop.

### Locks
- LOCK: Platform-specific Chinese install hints on all uv-missing surfaces (preflight nextSteps, requirements[id=uv].detail, SettingsSlideout Python line) — never brew-only on win32/linux.
- LOCK: When uvAvailable, surface uvPath in preflight + computer.model.state + Settings (monospace, truncate middle if long) for trust/debug.
- LOCK: After discovery prefer absolute uv path for execution (ensureIsolatedPythonEnv); avoid leaving only bare 'uv' when absolute known.
- LOCK: uv remains optional non-blocking (requirements.blocking false); isolated vs system Python modes unchanged.
- LOCK: Recommend 重启 Companion only when install was PATH-only and re-probe still fails; not when absolute probe succeeds without restart.
- LOCK: Windows install primary copy: winget install --id astral-sh.uv -e; macOS: brew install uv; Linux: official installer (not brew-only).
- LOCK: Keep unix which path working; Windows adds probes without regressing macOS/Linux detection.
- MUST NOT: Do not silently mutate Machine PATH, User PATH, or registry for uv.
- MUST NOT: Do not show brew install uv on Windows or Linux readiness/install copy.
- MUST NOT: Do not treat missing uv as blocking canDownload/canEnable.
- MUST NOT: Do not introduce a new ADR-020 autonomy axis; this is runtime tooling for existing experimental Surface only.
- MUST NOT: Do not make bundling uv the default delivery path without separate packaging/signing ADR.
- MUST NOT: Do not require manual uv path config as the only recovery path.

### Tests
- findUv returns ok+absolute path when uv exists only under well-known locations (e.g. ~/.local/bin, simulated WinGet Packages) even if process.env.PATH is Machine-only System32.
- findUv still succeeds via which/where when uv is only on PATH (unix regression).
- On win32, missing-uv user strings must not contain 'brew install uv'; must contain winget (or documented Windows alternative).
- On darwin, missing-uv strings may contain brew install uv.
- QwenVlPreflight / statePayload include uvPath iff uvAvailable true (and omit or empty when false).
- ensureIsolatedPythonEnv invokes absolute discovered uvPath when available (not bare name if absolute was found).
- uv requirement card remains blocking:false; canDownload not gated solely on uvAvailable.
- computer-python-runtime tests cover findUv + buildInstallCommands platform copy; not only sanitizePythonPackages.

---

## Lane: compat

Recommended: D — Hybrid: hardened PATH + absolute well-known probes + platform install copy + surface uvPath

Severity high: Explorer tray/daemon miss of User-PATH WinGet uv breaks preferred isolated-env path; brew-only copy misguides Windows. D minimizes radius vs bundling (E). Reuse of PATH hardening ideas from mcp/transport is correct only via shared extraction/injection, not computer→mcp. Absolute path after discovery satisfies anti-hijack constraint. A alone is insufficient; B alone misses WinGet; F is optional override on top of D. ADR-020: tooling under existing experimental Surface. ADR-019: per-spawn PATH only, no CU secret-env expansion.

### Confirmed problems
- **high** `P1`: findUv only uses process.env PATH via where/which and bare uv; GUI/daemon launches can miss User-PATH-only uv installs — companion/src/computer/python-runtime.ts:72 spawn env:process.env; :117-125 findUv where|which then bare uv --version — no PATH harden, no absolute probes
- **high** `P2`: PATH hardening exists only for MCP stdio spawn; computer/python-runtime never reuses it — companion/src/mcp/transport.ts:24-36 docs GUI/TaskScheduler stripped PATH; :37-139 buildSpawnPath; :152 env.PATH=buildSpawnPath() only in createTransport. Grep: no computer import of buildSpawnPath
- **high** `P3`: buildSpawnPath includes ~/.local/bin and Scoop/choco but not WinGet Packages uv layout confirmed on this host — companion/src/mcp/transport.ts:54 ~/.local/bin; :86-90 scoop/chocolatey; no Microsoft/WinGet/Packages candidate. Host fact: uv under LOCALAPPDATA/Microsoft/WinGet/Packages/astral-sh.uv_... and also %USERPROFILE%/.local/bin/uv.exe not on User PATH
- **medium** `P4`: findUv may return bare path 'uv' instead of absolute executable, re-exposing PATH lookup at install time — companion/src/computer/python-runtime.ts:123-124 return { ok:true, path:'uv' }; :243-255 uvBin = uv.path || 'uv' for venv/pip under same process.env
- **medium** `P5`: uvPath is resolved in PythonRuntimeInfo but not exposed on preflight/UI state (only uvAvailable boolean) — python-runtime.ts:58 uvPath?; :161/:171 set uvPath; qwen-vl-preflight.ts:88-89 only uvAvailable; :626-627 pass-through; chrome-extension sidepanel types.ts:579-586 no uvPath field
- **medium** `P6`: User-facing copy always says brew install uv including on Windows — qwen-vl-preflight.ts:435,:534; SettingsSlideout.tsx:1555 — all hardcoded brew install uv with no process.platform branch
- **medium** `P7`: No unit tests for findUv/PATH discovery; only sanitizePythonPackages covered in computer-python-runtime tests — companion/tests/computer-python-runtime.test.ts:1-23 only sanitizePythonPackages; mcp.test.ts:212-311 covers buildSpawnPath Windows/macOS locations
- **low** `P8`: ADR-019 explicitly does not inject user-env into Computer Use subprocesses; PATH fix must not be conflated with secret-env expansion — docs/adr/019-user-env-secrets.md:229-236 §6.3 table lists Computer Use 子进程 as 明确不做 for user-env; MCP PATH harden is §6.2 only

### Rejected
- ~~A — docs/copy only~~ — Does not fix findUv under daemon/tray process.env; leaves installed uv undiscoverable. Copy-only is a subset of D, not a standalone fix.
- ~~B — reuse buildSpawnPath in findUv spawn env only~~ — Incomplete: no WinGet Packages probe; if implemented as computer→mcp/transport import, wrong ownership/layering; still allows bare-name resolution without absolute preference.
- ~~C — absolute probes only (no hardened which/PATH)~~ — Misses legitimate installs only present via User PATH or non-listed layouts; must combine with which/where under hardened PATH.
- ~~E — bundle uv inside cmspark package~~ — High blast radius (binary size, code-sign, update channel, platform triples) without evidence that discovery/probe hybrid fails; violates prefer-smaller-radius.
- ~~F — manual config absolute uv path only~~ — Acceptable escape hatch but fails zero-config for standard WinGet/.local installs; not primary discovery. Pair with D, do not ship alone.
- ~~computer imports buildSpawnPath from mcp/transport~~ — Creates computer→mcp dependency (currently zero); MCP owns transport/secrets merge. Extract shared util or inject PATH builder; keep mcp as consumer.
- ~~Silently mutate Machine PATH or HKLM/HKCU permanently~~ — Hard constraint: no silent permanent PATH/registry mutation; prefer per-spawn env + absolute path after discovery.
- ~~New pack arm keys / new ADR-020 autonomy axis for uv~~ — uv is runtime tooling for existing experimental Surface; not composition pack arm or autonomy escalation.

### Locks
- LOCK: Prefer absolute uvPath after discovery; spawn ensureIsolatedPythonEnv/install with absolute binary when known
- LOCK: Extract shared PATH/probe helper (or inject getHardenedPath); do not import mcp/transport from computer
- LOCK: findUv discovery order: optional config override → absolute well-known candidates (WinGet scan, ~/.local/bin, scoop, choco, cargo, homebrew) → where/which under per-spawn hardened PATH
- LOCK: Platform-specific install copy: win32 winget (or official Windows install), darwin brew, linux non-brew default
- LOCK: Surface uvPath on preflight/state when available; keep uvAvailable boolean for existing UI
- LOCK: Keep isolated vs system Python mode semantics unchanged
- LOCK: PATH hardening is per-spawn env only; do not permanently mutate companion process.env.PATH or Machine PATH
- LOCK: Inject env/pathCandidates/probe for unit testability without real WinGet install
- LOCK: Regression: darwin/linux which + homebrew/usr/local/.local still find uv when present
- LOCK: ADR-019: PATH discovery ≠ user_env secret inject into CU; do not expand secret merge into python-runtime without ADR change
- MUST NOT: Silently write Machine PATH, User PATH registry, or install uv without user action
- MUST NOT: computer/src import mcp/transport (layer inversion)
- MUST NOT: Return bare 'uv' when an absolute path was verified
- MUST NOT: Bundle uv binary without separate packaging ADR and size/sign plan
- MUST NOT: Add pack.yaml / arm / auto_approve keys for uv
- MUST NOT: Change isolated mode to silently fall back to system pythonPath for dep probes (existing intentional omit)
- MUST NOT: Treat brew install uv as cross-platform string
- MUST NOT: Claim full ADR-019 CU user_env inject as part of this PATH fix

### Tests
- findUv with process.env.PATH stripped to System32|/usr/bin still discovers fixture absolute uv under well-known candidate dir
- Windows: probe path under LOCALAPPDATA/Microsoft/WinGet/Packages/astral-sh.uv_*/uv.exe when fixture present
- Windows: ~/.local/bin/uv.exe fixture found even if not on PATH
- macOS/Linux: which path + /opt/homebrew/bin|/usr/local/bin|~/.local/bin regression still passes
- When absolute found, returned path is absolute and path.isAbsolute true; never sole bare 'uv'
- uvAvailable false and ok false when no candidates exist
- ensureIsolatedPythonEnv uses resolved absolute uvPath in spawn argv0 when set
- buildSpawnPath / MCP createTransport PATH merge tests still pass after any extract
- No test mutates real Machine PATH; inject env only
- Platform install hint helper: win32 string must not contain 'brew install uv' alone
- sanitizePythonPackages allowlist tests remain green (no regression)

---

