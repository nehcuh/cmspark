// Implement consensus R1–R5 for Windows ACP spawn / Mode C.
// SoT: docs/audit/reviews/acp-win-spawn-consensus-20260816-090554.md
// Do NOT expand to P2 residuals (R6–R14).

let meta = #{
    name: "acp-win-spawn-r1r5",
    description: "Implement multi-adv consensus R1-R5: Mode C honest L1/L0, wrapViaCmd no prompt, Windows paste includes task",
    when_to_use: "After acp-win-spawn consensus REJECT; implement R1-R5 only",
    phases: [
        #{ title: "Implement", detail: "R1-R5 code + regression tests" },
        #{ title: "Test", detail: "ACP win-spawn / open-local-terminal tests" },
        #{ title: "Verify", detail: "Read-only skeptic vs consensus R1-R5" },
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
        if type_of(o) == "string" { return fallback + ": " + o; }
        return fallback + " (success=false)";
    }
    let m = agent_output_map(r);
    if m == () { return fallback + " (missing map output)"; }
    if m.ok == false {
        let bits = fallback + " (ok=false)";
        if m.summary != () && type_of(m.summary) == "string" { bits += ": " + m.summary; }
        if m.blockers != () && type_of(m.blockers) == "array" {
            bits += " blockers=" + json_encode(m.blockers);
        }
        return bits;
    }
    fallback
}

fn hard_fail(r) {
    if r == () { return true; }
    if !r.success { return true; }
    let m = agent_output_map(r);
    if m == () { return false; }
    m.ok == false
}

let impl_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary", "blockers"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "blockers": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "r_done": #{ "type": "array", "maxItems": 8, "items": #{ "type": "string" } },
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
        "gates_passed": #{ "type": "array", "maxItems": 16, "items": #{ "type": "string" } },
        "gates_failed": #{ "type": "array", "maxItems": 16, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
    },
};

phase("Implement");

let impl_prompt = "";
impl_prompt += "Implement CMspark consensus R1-R5 ONLY. Repo: C:/Users/HuChen/Projects/cmspark.\n";
impl_prompt += "Work in the current workspace (no new branch). Use read_file/search_replace/write.\n\n";
impl_prompt += "READ FIRST (mandatory, do not implement from memory):\n";
impl_prompt += "- docs/audit/reviews/acp-win-spawn-consensus-20260816-090554.md\n";
impl_prompt += "- companion/src/acp/win-spawn.ts\n";
impl_prompt += "- companion/src/acp/open-local-terminal.ts\n";
impl_prompt += "- companion/src/acp/manager.ts (startCliBridge spawn + maybeOpenLocalTerminal only)\n";
impl_prompt += "- companion/src/acp/launch-presets.ts\n";
impl_prompt += "- companion/tests/acp-win-spawn.test.ts\n";
impl_prompt += "- companion/tests/acp-open-local-terminal.test.ts\n\n";
impl_prompt += "DO NOT regress: pickWindowsWhereHit, Claude/Pi unwrap, spawnAcpChild at both stdio sites, POSIX identity, no shell:true, open_local_terminal_snapshot gate.\n";
impl_prompt += "DO NOT implement P2 residuals R6-R14 unless a one-line helper is required by R1-R5.\n\n";

impl_prompt += "R3 wrapViaCmd + prompt (win-spawn.ts + CLI spawn):\n";
impl_prompt += "1) quoteCmdArg: cmd-correct — quote when space or metachar; escape quote as doubled \"\"; escape % as %%; do NOT use backslash-quote.\n";
impl_prompt += "2) wrapViaCmd: cmd /d /s /c with the ENTIRE cmdline wrapped in one extra pair of quotes (Node shell:true idiom).\n";
impl_prompt += "3) NEVER put user/page prompt through wrapViaCmd. Add a helper e.g. argvForCmdWrap(args) that DROPS -p/--print and the following non-flag value, and DROPS any arg that is long, has newlines, or contains &|<>^%!\". Keep short flags like --output-format text.\n";
impl_prompt += "4) resolveAcpSpawn / spawnAcpChild MUST use argvForCmdWrap when falling back to wrapViaCmd. Protocol path has no prompt in argv — still apply the filter (harmless).\n";
impl_prompt += "5) Export acpSpawnUsesCmdHost(spec) true when basename is cmd.exe / cmd.\n";
impl_prompt += "6) Tests: quoteCmdArg uses \"\" not \\\"; wrapViaCmd cmdline has outer quotes; wrapping with a huge/metachar prompt does NOT put that prompt in spec.args.\n\n";

impl_prompt += "R1 false L1 + R2 auto never L0 (open-local-terminal.ts):\n";
impl_prompt += "1) findWindowsTerminalExe must NEVER return bare \"wt.exe\". Must NEVER treat WindowsApps\\wt.exe as success (App Execution Alias / 0-byte file). Only a real PE (exists, isFile, size>0, path not under Microsoft\\WindowsApps) counts as wt.\n";
impl_prompt += "2) spawnDetachedWin: reject if child emits error OR exits within a short window (listen close/exit). 80ms-without-error is NOT success by itself.\n";
impl_prompt += "3) openWindowsWithPref auto: do NOT try alias wt first. Prefer visible start+powershell (cmd /c start ...). Only try wt if findWindowsTerminalExe found a real PE. If wt launch fails or exits immediately, fall through to start. If start also fails, THROW — do not return appLabel success.\n";
impl_prompt += "4) Windows branch of openLocalTerminalForAgent: only return level L1 / ok:true after openWindowsWithPref succeeds AND the agent command is NOT a cmd host. If launch throws, L0 (banner+paste) or ok:false with commandLine — never stamp opened/L1.\n";
impl_prompt += "5) Tests: findWindowsTerminalExe / a testable helper rejects WindowsApps and bare wt; build/open helpers do not claim L1 for cmd host.\n\n";

impl_prompt += "R4 Mode C must not L1-exec cmd.exe /c ... $task:\n";
impl_prompt += "1) After resolveAcpSpawn(command, []), if acpSpawnUsesCmdHost(spec), do NOT generate L1 script that is & cmd /d /s /c agent.cmd $task.\n";
impl_prompt += "2) That case is L0 only: banner + paste line (with prompt file). Optionally still open a console via start, but level must be L0 not L1.\n";
impl_prompt += "3) L1 PS1 may only invoke an unwrapped PE or node+script (spec.command is NOT cmd.exe).\n\n";

impl_prompt += "R5 Windows paste must include the task:\n";
impl_prompt += "1) Extend buildWindowsCommandLine(cwd, command, opts?) so when promptFile is set, the paste line cds and runs the agent WITH the file contents (PowerShell Get-Content -LiteralPath + & agent). Quote via windowsQuotePath / quotePowerShellLiteral. No raw interpolation of file body.\n";
impl_prompt += "2) openLocalTerminalForAgent win32 pasteLine MUST pass promptFile when present.\n";
impl_prompt += "3) L0 PS1 Write-Host paste must include the prompt-file invocation, not just the bare exe.\n";
impl_prompt += "4) Tests: buildWindowsCommandLine with promptFile mentions Get-Content and the file path; without promptFile stays cd /d && command.\n\n";

impl_prompt += "Keep existing POSIX Mode C behavior unchanged.\n";
impl_prompt += "ok=true only if R1-R5 are implemented and tests compile-ready. List files_changed and r_done like [\"R1\",\"R2\",\"R3\",\"R4\",\"R5\"].\n";

let impl = agent(impl_prompt, #{
    label: "impl:r1r5",
    capability_mode: "all",
    output_schema: impl_schema,
});

if hard_fail(impl) {
    pause("verification", agent_fail_reason(impl, "Implement R1-R5 failed or ok=false"));
}

log("Implement done");

phase("Test");

let test_prompt = "";
test_prompt += "Run ACP Windows spawn / Mode C unit tests in C:/Users/HuChen/Projects/cmspark.\n";
test_prompt += "Use companion local tsc (not repo-root npx tsc):\n";
test_prompt += "  companion\\node_modules\\.bin\\tsc.cmd -p companion\\tsconfig.test.json --pretty false\n";
test_prompt += "Then:\n";
test_prompt += "  node --test companion\\.test-dist\\tests\\acp-win-spawn.test.js companion\\.test-dist\\tests\\acp-open-local-terminal.test.js companion\\.test-dist\\tests\\acp-discover.test.js\n";
test_prompt += "If tests fail due to R1-R5, FIX them (same files only) and re-run.\n";
test_prompt += "ok=true only if those three test files pass (pre-existing acp-agent-env Windows fails are out of scope).\n";
test_prompt += "Report command and any failures.\n";

let test_r = agent(test_prompt, #{
    label: "test:acp-win",
    capability_mode: "all",
    output_schema: test_schema,
});

if hard_fail(test_r) {
    pause("verification", agent_fail_reason(test_r, "ACP Windows tests failed"));
}

log("Tests done");

phase("Verify");

let check_prompt = "";
check_prompt += "Adversarial read-only verify that consensus R1-R5 are actually fixed. Repo: C:/Users/HuChen/Projects/cmspark.\n";
check_prompt += "Read the CURRENT source (not memory). Cite file:line.\n";
check_prompt += "READ: companion/src/acp/win-spawn.ts, open-local-terminal.ts, manager.ts spawn site, tests acp-win-spawn + acp-open-local-terminal, consensus doc.\n";
check_prompt += "Gates (ok=true only if ALL pass):\n";
check_prompt += "R1: findWindowsTerminalExe never returns bare wt.exe; WindowsApps alias / 0-byte not treated as wt; L1 not stamped after 80ms-only.\n";
check_prompt += "R2: auto can reach L0 or failed (not opened) when launch is not observed; wt alias cannot force L1.\n";
check_prompt += "R3: wrapViaCmd never includes a long/metachar/newline prompt; Claude -p payload stripped on cmd wrap; quoteCmdArg uses doubled quotes not backslash-quote.\n";
check_prompt += "R4: Mode C L1 does not do & cmd /d /s /c ... $task; cmd-host spec is L0 only.\n";
check_prompt += "R5: Windows pasteLine / buildWindowsCommandLine with promptFile includes Get-Content or equivalent file-based task, not only cd && exe.\n";
check_prompt += "Also confirm no regression: spawnAcpChild still used in protocol-session and startCliBridge; no shell:true.\n";
check_prompt += "gates_passed / gates_failed must use ids R1..R5 (and REGRESS if needed).\n";

let chk = agent(check_prompt, #{
    label: "verify:r1r5",
    capability_mode: "read-only",
    output_schema: check_schema,
});

if hard_fail(chk) {
    pause("verification", agent_fail_reason(chk, "R1-R5 verify failed"));
}

complete(#{
    summary: "R1-R5 implemented, tested, and verified against consensus",
    implement: agent_output_map(impl),
    tests: agent_output_map(test_r),
    verify: agent_output_map(chk),
});
