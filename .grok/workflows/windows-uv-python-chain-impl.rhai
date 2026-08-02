// P0 implementation: Windows uv/Python chain (post Pi APPROVE_WITH_NITS)
// Gate: design SoT + plan + Pi verdict must be APPROVE*
//
// Robustness: when agent success=false, host often sets output to a plain
// string (error text), not the output_schema map. Never read .ok / .blockers /
// .summary without type_of(x) == "map" first — Rhai throws
// "Unknown property 'blockers' - a getter is not registered for type 'string'".

let meta = #{
    name: "windows-uv-python-chain-impl",
    description: "Implement P0 Windows-aware uv discovery, absolute pin, platform copy, uvPath surface, tests",
    when_to_use: "After Pi APPROVE* on windows-uv-python-chain design; implement P0 only",
    phases: [
        #{ title: "Implement", detail: "T1-T5 code changes per plan + Pi nits" },
        #{ title: "Test", detail: "Run computer-python-runtime tests and targeted suite" },
        #{ title: "Self-check", detail: "Verify W locks and G gates against diff" },
    ],
};

// --- safe accessors for agent results (map vs string error body) ---

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
            // schema-shaped failure body
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
        "files_changed": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "blockers": #{ "type": "array", "maxItems": 10, "items": #{ "type": "string" } },
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
        "gates_passed": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "gates_failed": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
    },
};

phase("Implement");

let impl_prompt = "";
impl_prompt += "You implement CMspark P0: Windows uv/Python discovery chain.\n";
impl_prompt += "Repo: C:/Users/HuChen/Projects/cmspark. Work on current workspace (or worktree if already checked out).\n\n";
impl_prompt += "READ FIRST (mandatory):\n";
impl_prompt += "- docs/superpowers/specs/2026-08-02-windows-uv-python-chain-design.md (W1-W12, G1-G10)\n";
impl_prompt += "- docs/superpowers/plans/2026-08-02-windows-uv-python-chain-impl.md (T1-T7 + §7 Pi nits N1-N7)\n";
impl_prompt += "- docs/audit/reviews/windows-uv-python-chain-adversary-synthesis-20260802.md\n";
impl_prompt += "- docs/audit/reviews/windows-uv-python-chain-verdict-20260802.json (must be APPROVE*)\n\n";
impl_prompt += "IMPLEMENT exactly:\n";
impl_prompt += "T1 findUv rewrite in companion/src/computer/python-runtime.ts:\n";
impl_prompt += "  - isUvExecutable, listWellKnownUvCandidates (W3/W4), processLocalLookupPath (no mcp/transport import)\n";
impl_prompt += "  - runCapture optional env (Pi N1)\n";
impl_prompt += "  - discovery order W1; absolute pin W2; where hits must be absolute+basename uv.exe (N2)\n";
impl_prompt += "  - NEVER return path:'uv' when ok\n";
impl_prompt += "T2 ensureIsolatedPythonEnv only absolute uvPath\n";
impl_prompt += "T3 uvInstallHint(platform) + buildInstallCommands uvPath (N3)\n";
impl_prompt += "T4 qwen-vl-preflight: platform copy, uvPath, uvInstallHint on payload (N4)\n";
impl_prompt += "T5 model-handlers BOTH state paths pass uvPath (N5); extension types/useWebSocket/SettingsSlideout\n";
impl_prompt += "T6 tests in computer-python-runtime.test.ts per plan + N6\n";
impl_prompt += "Do NOT: mutate PATH registry, bundle uv, import mcp/transport from computer, change canDownload gates, system pip auto-install.\n";
impl_prompt += "Use search_replace/write tools. Keep changes minimal and focused.\n";
impl_prompt += "After edits, list files_changed. ok=true only if you believe compile-ready.\n";
impl_prompt += "If already implemented in tree, verify + report files_changed and ok=true without rewriting.\n";

let impl = agent(impl_prompt, #{
    label: "impl:p0",
    capability_mode: "read-write",
    output_schema: impl_schema,
});

if !agent_ok(impl) {
    pause("verification", agent_fail_reason(impl, "Implement agent failed or ok=false"));
}

log("Implement done: " + agent_summary(impl));

phase("Test");

let test_prompt = "";
test_prompt += "Run unit tests for the Windows uv/Python chain P0 changes in C:/Users/HuChen/Projects/cmspark.\n";
test_prompt += "Preferred on Windows:\n";
test_prompt += "  cd companion; npx tsc -p tsconfig.test.json; node --test .test-dist/tests/computer-python-runtime.test.js\n";
test_prompt += "On Unix the package npm test script with find may work.\n";
test_prompt += "Inspect package.json test scripts if needed. Fix failures if clearly caused by P0 and small.\n";
test_prompt += "Report ok=true only if computer-python-runtime tests pass.\n";
test_prompt += "Include command used and failure list if any.\n";

let test_r = agent(test_prompt, #{
    label: "test:p0",
    capability_mode: "execute",
    output_schema: test_schema,
});

if !agent_ok(test_r) {
    pause("verification", agent_fail_reason(test_r, "Tests failed — fix and resume, or abort"));
}

log("Tests: " + agent_summary(test_r));

phase("Self-check");

let check_prompt = "";
check_prompt += "Self-check P0 Windows uv chain against design locks. Repo: C:/Users/HuChen/Projects/cmspark.\n";
check_prompt += "Use git diff and read_file/grep. Verify:\n";
check_prompt += "G1: findUv never returns bare 'uv' when ok; ensureIsolatedPythonEnv absolute only\n";
check_prompt += "G2: no registry PATH writes\n";
check_prompt += "G3: win32 install strings contain winget not brew-only\n";
check_prompt += "G4: no computer import of mcp/transport\n";
check_prompt += "G5: WinGet scan package-id scoped only\n";
check_prompt += "G7: isolated/system semantics unchanged\n";
check_prompt += "G9: uv not blocking canDownload\n";
check_prompt += "G10: no user-env PATH merge into python-runtime\n";
check_prompt += "W8: uvPath surfaced in preflight/handlers/extension\n";
check_prompt += "Pi N1-N6 addressed.\n";
check_prompt += "ok=true only if all gates pass. List gates_passed and gates_failed.\n";

let chk = agent(check_prompt, #{
    label: "selfcheck:gates",
    capability_mode: "read-only",
    output_schema: check_schema,
});

if !agent_ok(chk) {
    pause("verification", agent_fail_reason(chk, "Self-check failed gates — fix and resume"));
}

// complete() payloads: only pass maps (or empty maps) — never raw string error bodies
let impl_out = agent_output_map(impl);
let test_out = agent_output_map(test_r);
let chk_out = agent_output_map(chk);

complete(#{
    summary: "P0 Windows uv/Python chain implemented and self-checked",
    implement: impl_out,
    tests: test_out,
    self_check: chk_out,
});
