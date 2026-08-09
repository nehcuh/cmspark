// P0 implementation: Windows Python discovery cascade (post Pi APPROVE_WITH_NITS)
// Gate: design SoT + plan + Pi verdict must be APPROVE*
//
// Robustness: when agent success=false, host often sets output to a plain
// string (error text), not the output_schema map. Never read .ok / .blockers /
// .summary without type_of(x) == "map" first.

let meta = #{
    name: "windows-python-discovery-impl",
    description: "Implement P0 Windows Python discovery cascade (findPythonBase, Store/version gates, pythonInstallHint, progressive CTA, tests)",
    when_to_use: "After Pi APPROVE* on windows-python-discovery design; implement P0 only",
    phases: [
        #{ title: "Implement", detail: "T1-T13 code per plan + Pi nits N1-N10" },
        #{ title: "Test", detail: "Run computer-python-runtime tests" },
        #{ title: "Self-check", detail: "Verify PY locks and G gates against diff" },
    ],
};

fn agent_output_map(r) {
    if r == () { return (); }
    if !r.success { return (); }
    let o = r.output;
    if o == () { return (); }
    if type_of(o) != "map" { return (); }
    o
}

fn agent_fail_reason(r, fallback) {
    if r == () { return fallback + " (null agent result)"; }
    if !r.success {
        let o = r.output;
        if o == () { return fallback + " (success=false, empty output)"; }
        if type_of(o) == "string" { return fallback + ": " + o; }
        if type_of(o) == "map" {
            let bits = fallback;
            if o.summary != () && type_of(o.summary) == "string" {
                bits += ": " + o.summary;
            }
            if o.blockers != () && type_of(o.blockers) == "array" {
                bits += " blockers=" + json_encode(o.blockers);
            }
            return bits;
        }
        return fallback + " (success=false, output type=" + type_of(o) + ")";
    }
    let m = agent_output_map(r);
    if m == () {
        let o = r.output;
        if type_of(o) == "string" { return fallback + ": " + o; }
        return fallback + " (missing map output)";
    }
    if m.ok != true {
        let bits = fallback + " (ok!=true)";
        if m.summary != () && type_of(m.summary) == "string" {
            bits += ": " + m.summary;
        }
        if m.blockers != () && type_of(m.blockers) == "array" {
            bits += " blockers=" + json_encode(m.blockers);
        }
        return bits;
    }
    fallback
}

fn agent_ok(r) {
    let m = agent_output_map(r);
    if m == () { return false; }
    m.ok == true
}

fn agent_summary(r) {
    let m = agent_output_map(r);
    if m == () { return ""; }
    if m.summary != () && type_of(m.summary) == "string" { return m.summary; }
    ""
}

let impl_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary", "blockers"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "maxItems": 24, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "blockers": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "notes": #{ "type": "string" },
    },
};

let test_schema = #{
    "type": "object",
    "required": ["ok", "command", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "command": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "failures": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
    },
};

let check_schema = #{
    "type": "object",
    "required": ["ok", "gates_passed", "gates_failed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "gates_passed": #{ "type": "array", "maxItems": 24, "items": #{ "type": "string" } },
        "gates_failed": #{ "type": "array", "maxItems": 24, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
    },
};

phase("Implement");

let impl_prompt = "";
impl_prompt += "You implement CMspark P0: Windows Python discovery cascade (base Python, not redoing findUv).\n";
impl_prompt += "Repo: C:/Users/HuChen/Projects/cmspark. Work on current workspace.\n\n";
impl_prompt += "READ FIRST (mandatory):\n";
impl_prompt += "- docs/superpowers/specs/2026-08-09-windows-python-discovery-design.md (cascade, PY1-PY16, G1-G12)\n";
impl_prompt += "- docs/superpowers/plans/2026-08-09-windows-python-discovery-impl.md (T1-T13 + §1.1 Pi nits)\n";
impl_prompt += "- docs/audit/reviews/windows-python-discovery-adversary-synthesis-20260809.md\n";
impl_prompt += "- docs/audit/reviews/windows-python-discovery-verdict-20260809.json (must be APPROVE*)\n";
impl_prompt += "- docs/audit/reviews/windows-python-discovery-pi-protocol-20260809.md (nits N1-N10)\n\n";
impl_prompt += "IMPLEMENT exactly (Scheme D):\n";
impl_prompt += "T1 MIN_PYTHON_VERSION 3.10, types PythonBaseHit/FindPythonBaseOpts, parsePythonVersion, isWindowsStorePythonStub, version gate\n";
impl_prompt += "T2 listWellKnownPythonCandidates (python.org Local/PF, WinGet Python.Python.3.*, Scoop, Anaconda/Miniconda roots; NEVER WindowsApps; bounded readdir)\n";
impl_prompt += "T3 listManagerPythonCandidates (pyenv-win versions/*, conda root seed only; no activate)\n";
impl_prompt += "T4 harden probePythonBin + validatePythonExecutable (absolute pin, Store dual-check, version)\n";
impl_prompt += "T5 findPythonBase cascade: config → isolated → well-known → managers → enriched PATH/py launcher\n";
impl_prompt += "T6 resolvePythonRuntime wires findPythonBase; isolated-missing OMITs pythonPath; expose basePythonAvailable for CTA (N1)\n";
impl_prompt += "T7 ensureIsolatedPythonEnv: no-uv uses findPythonBase absolute base; REWRITE injectable short-circuit (N3)\n";
impl_prompt += "T8 pythonInstallHint(platform): win32 winget+python.org never brew-only\n";
impl_prompt += "T9 qwen-vl-download: absolute candidates only; no bare python/py as final argv0\n";
impl_prompt += "T10 qwen-vl-preflight: delete dead findPython; progressive readiness; surface pythonInstallHint + basePythonAvailable\n";
impl_prompt += "T11 model-state-messages / model-handlers / SettingsSlideout / model-switch-logic progressive CTA + copy\n";
impl_prompt += "T12 tests PY-T1..T17 + N2 extras (config priority, manager, py-launcher, download absolute)\n";
impl_prompt += "DO NOT: change findUv order; mutate PATH/registry; silent install; import mcp/transport; conda first-class runtime;\n";
impl_prompt += "  auto-ensure on preflight; system silent pip; user-env PATH merge; bundle CPython.\n";
impl_prompt += "Use search_replace/write. Minimal focused changes. Keep S35 findUv tests green.\n";
impl_prompt += "ok=true only if compile-ready. List files_changed. If already implemented, verify and report without rewrite.\n";

let impl = agent(impl_prompt, #{
    label: "impl:p0",
    capability_mode: "all",
    output_schema: impl_schema,
});

if !agent_ok(impl) {
    pause("verification", agent_fail_reason(impl, "Implement agent failed or ok=false"));
}

log("Implement done: " + agent_summary(impl));

phase("Test");

let test_prompt = "";
test_prompt += "Run unit tests for Windows Python discovery P0 in C:/Users/HuChen/Projects/cmspark.\n";
test_prompt += "Preferred Windows (nvm node):\n";
test_prompt += "  $env:Path = 'C:/Users/HuChen/AppData/Local/nvm/v24.18.0;' + $env:Path\n";
test_prompt += "  cd companion; npx tsc -p tsconfig.test.json; node --test .test-dist/tests/computer-python-runtime.test.js\n";
test_prompt += "Or npm --prefix companion test if script targets this file.\n";
test_prompt += "If failures are clearly from P0 and small, fix them.\n";
test_prompt += "ok=true only if computer-python-runtime tests pass (findUv + new Python discovery).\n";
test_prompt += "Report command and failures if any.\n";

let test_r = agent(test_prompt, #{
    label: "test:p0",
    capability_mode: "all",
    output_schema: test_schema,
});

if !agent_ok(test_r) {
    pause("verification", agent_fail_reason(test_r, "Tests failed — fix and resume, or abort"));
}

log("Tests: " + agent_summary(test_r));

phase("Self-check");

let check_prompt = "";
check_prompt += "Self-check P0 Windows Python discovery against design locks. Repo: C:/Users/HuChen/Projects/cmspark.\n";
check_prompt += "Use git diff and read_file/grep. Verify:\n";
check_prompt += "G1: never bare python/py/python3 as canonical argv0 after absolute known\n";
check_prompt += "G2: WindowsApps Store stub rejected (path + probe pin)\n";
check_prompt += "G3: no silent install; no permanent PATH/registry write\n";
check_prompt += "G4: no conda activate / first-class runtime\n";
check_prompt += "G5: bounded allowlist readdir only\n";
check_prompt += "G6: findUv S35 still absolute pin; win32 no brew-only uv OR python install copy\n";
check_prompt += "G7: no computer import mcp/transport\n";
check_prompt += "G8: isolated does not silent PATH fallback for run/download\n";
check_prompt += "G9: no auto system pip\n";
check_prompt += "G10: no auto-ensure on every preflight\n";
check_prompt += "G11: no bundled CPython\n";
check_prompt += "G12: no user-env PATH merge into discovery\n";
check_prompt += "PY14: progressive CTA / basePythonAvailable or equivalent\n";
check_prompt += "PY13: pythonInstallHint win32 has winget\n";
check_prompt += "Pi nits N1-N10 addressed or documented residual.\n";
check_prompt += "ok=true only if all gates pass. List gates_passed and gates_failed.\n";

let chk = agent(check_prompt, #{
    label: "selfcheck:gates",
    capability_mode: "read-only",
    output_schema: check_schema,
});

if !agent_ok(chk) {
    pause("verification", agent_fail_reason(chk, "Self-check failed gates — fix and resume"));
}

let impl_out = agent_output_map(impl);
let test_out = agent_output_map(test_r);
let chk_out = agent_output_map(chk);

complete(#{
    summary: "P0 Windows Python discovery cascade implemented and self-checked",
    implement: impl_out,
    tests: test_out,
    self_check: chk_out,
});
