All files read. Verified code claims against source: `findUv` (python-runtime.ts:113-125) does `where`/`which` under bare `process.env` and returns `{ok:true, path:"uv"}` on bare-spawn success; `ensureIsolatedPythonEnv` does `uv.path || "uv"` re-resolution; `runCapture` has no env parameter; `buildSpawnPath` (transport.ts) has no WinGet entry and is MCP-stdio-only; brew strings live at qwen-vl-preflight.ts:435,534 and SettingsSlideout.tsx:1555; `uvPath` exists on `PythonRuntimeInfo` but only `uvAvailable` flows through preflight(:450,:626) 鈫?model-handlers(:268,:293,:741) 鈫?types(:579,:585) 鈫?useWebSocket(:812); tests cover only `sanitizePythonPackages`. All C1-C10 claims check out.

## Review answers

**1. W1-W12 sufficient without E/F-primary?** Yes. E (bundle) is correctly rejected (supply-chain/volume), and F-as-primary is the right rejection 鈥?for an optional accelerator (G9), auto-discovery + pin + copy is the smallest effective radius. F survives as the P1 escape hatch, which covers the "weird install" long tail. W1's order (P1 config 鈫?well-known probes 鈫?enriched-PATH `where` 鈫?fail-closed) covers both confirmed host layouts (WinGet package dir, `~/.local/bin` outside PATH). No gap that only E/F could fill.

**2. Absolute-pin enough for PATH hijack?** Yes for the stated threat class. Today's code re-resolves bare `"uv"` at exec time inside `ensureIsolatedPythonEnv` 鈥?an attacker prepending a fake dir to PATH between discovery and exec wins (TOCTOU). Pinning the discovered absolute path closes exactly that. Two hygiene nits: (a) Windows `where` checks the current directory first and can return a *relative* result (`uv.exe` from cwd) 鈥?T1 realpath would then pin the cwd file, so assert the `where` hit is absolute and passes the win32 `uv.exe` basename check before pinning; (b) `.cmd`/`.bat` shim results can't spawn without `shell:true` 鈥?`isUvExecutable`'s `uv.exe`-only rule rejects them, which is fine, but apply it to `where` output too. The pin cannot defend against a fake uv planted in user-writable well-known dirs (`~/.local/bin`, WinGet Packages) 鈥?but that's game-over territory anyway, outside the model.

**3. WinGet package-id scan safe?** Yes. Single-level readdir of `%LOCALAPPDATA%\Microsoft\WinGet\Packages`, `/^astral-sh\.uv_/i` filter, exists+isFile+basename, `--version` smoke 鈥?no recursion, no non-`uv.exe` execution; G5 satisfied and T6's "unrelated package dir ignored" test locks it. The Packages dir being user-writable adds no new surface beyond the `~/.local/bin` trust boundary W3 already probes. Prefer Links-dir when present (open Q2) 鈥?harmless either way.

**4. Forbid computer鈫抦cp correct?** Yes, and verified necessary: transport.ts imports `user-env` (`getUserEnvVars`) and logger, so importing it from computer would drag the G10-forbidden user-env merge into the computer path and invert the layer. Local candidate-list duplication is the right P0 call; P1 extraction into a neutral module is fine as long as it never imports user-env.

**5. P0/P1 split sound?** Yes. P0 is the coherent ship: discovery + pin + copy + surfacing. Config override and re-detect deferred (auto-first, per open Q3); MCP WinGet parity is orthogonal and safely deferred. Nothing in P1 is required for the false-negative fix or the security pin.

**6. T1-T7 implement W locks?** Mostly 鈥?G1鈥揋10 hold in the plan; gaps are nits:
- `runCapture` needs an optional `env` param for the enriched-PATH `where` (current signature `(bin, args, timeoutMs)` has none); T1 implies it, doesn't state it.
- T3's `buildInstallCommands` absolute-print requires adding `uvPath` to its opts 鈥?the two callers (qwen-vl-preflight.ts:448, model-handlers.ts:739) and a test case aren't listed.
- T5 "prefer server-driven hint string" is underspecified: T4 adds only `uvPath`, not the hint string 鈥?either T4 must emit `uvInstallHint` on the preflight payload or T5 must explicitly commit to `navigator.platform` fallback.
- model-handlers has *two* state builders (:268 preflight, :741 ensure-response); T4 mentions ensure responses (good), but T6 has no payload-level assertion.
- W6's "import 鍥炬鏌? acceptance has no T-task/T7 step; W9 has no cheap regression assert (uv absence doesn't flip `blocking`).
- `ensureIsolatedPythonEnv` re-runs `findUv()` 鈥?consistent, but double discovery per ensure; optionally accept an injected `uvPath`.

**7. What would REJECT start?** Nothing in the plan as written 鈥?all ten gates are explicitly satisfied (G1: T1 forbids bare name + T2 isAbsolute guard; G2: W5 spawn-env-only; G3: T3 winget; G4: T1 no-import; G5: prefix filter + test; G6/G9/G10: out-of-scope/untouched; G7: T2 fall-through; G8: T2 absolute exec). REJECT would only trigger on implementation drift: keeping the `{ok:true, path:"uv"}` branch, any computer鈫抦cp import, unscoped WinGet recursion, brew-only win32 copy, or wiring uv into canDownload/canEnable. Note the *current code* hits G1 today (`findUv` returns bare `"uv"`, `ensureIsolatedPythonEnv` spawns it) 鈥?this plan is precisely the gate-fix, and T1/T2/T6 extinguish it.

## Verdict rationale
Design SoT and plan are internally consistent, evidence-aligned, and gate-compliant. The nits above are all plan-completeness issues (explicit env param, `where`-output hygiene, buildInstallCommands signature/callers, server-driven hint wiring, payload-level tests) 鈥?none touches a rejection gate.

VERDICT: APPROVE_WITH_NITS
