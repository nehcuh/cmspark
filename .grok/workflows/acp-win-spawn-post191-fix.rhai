// Post-#191 residual: multi-lane adversarial confirm → consensus → implement → test → verify.
// SoT claims: parent review of 750cf41 (F1–F7). Do NOT reopen R1–R14 locks.

let meta = #{
    name: "acp-win-spawn-post191-fix",
    description: "Multi-lane adversarial fix of post-#191 Mode C residuals (verbatim start, wt honesty, ComSpec pin)",
    when_to_use: "After reviewing merged #191; fix confirmed Mode C honesty / spawn quoting residuals",
    phases: [
        #{ title: "Adversary", detail: "Security Honesty Correctness independently confirm or reject F1-F7" },
        #{ title: "Synthesize", detail: "Lock must-fix recipe and write consensus doc" },
        #{ title: "Implement", detail: "Apply consensus must-fix plus regression tests" },
        #{ title: "Test", detail: "Run ACP win-spawn and open-local-terminal tests" },
        #{ title: "Verify", detail: "Independent skeptic vs consensus locks" },
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

let adversary_schema = #{
    "type": "object",
    "required": ["lane", "verdict", "findings", "must_not", "summary"],
    "properties": #{
        "lane": #{ "type": "string" },
        "verdict": #{ "type": "string" },
        "findings": #{
            "type": "array",
            "maxItems": 10,
            "items": #{
                "type": "object",
                "required": ["id", "confirmed", "severity", "evidence", "must_fix", "lock"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "confirmed": #{ "type": "boolean" },
                    "severity": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "must_fix": #{ "type": "boolean" },
                    "lock": #{ "type": "string" },
                },
            },
        },
        "must_not": #{ "type": "array", "maxItems": 8, "items": #{ "type": "string" } },
        "rejected_claims": #{ "type": "array", "maxItems": 8, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
    },
};

let synth_schema = #{
    "type": "object",
    "required": ["ok", "verdict", "must_fix", "defer", "recipe", "consensus_path", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "verdict": #{ "type": "string" },
        "must_fix": #{
            "type": "array",
            "maxItems": 10,
            "items": #{
                "type": "object",
                "required": ["id", "lock", "rationale"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "lock": #{ "type": "string" },
                    "rationale": #{ "type": "string" },
                },
            },
        },
        "defer": #{ "type": "array", "maxItems": 8, "items": #{ "type": "string" } },
        "rejected": #{ "type": "array", "maxItems": 8, "items": #{ "type": "string" } },
        "recipe": #{ "type": "string" },
        "consensus_path": #{ "type": "string" },
        "summary": #{ "type": "string" },
    },
};

let impl_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary", "blockers", "ids_done"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "maxItems": 16, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "blockers": #{ "type": "array", "maxItems": 10, "items": #{ "type": "string" } },
        "ids_done": #{ "type": "array", "maxItems": 10, "items": #{ "type": "string" } },
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

let repo = "/Users/huchen/Projects/cmspark";

let ctx = "";
ctx += "Repo: " + repo + " (macOS host; Windows spawn is unit-tested with mocks).\n";
ctx += "HEAD after #191: 750cf41. Do NOT regress R1-R14 in docs/audit/reviews/acp-win-spawn-consensus-20260816-090554.md.\n";
ctx += "READ with tools (read_file/grep). Empty confirmation is valid ONLY after reading the cited files.\n\n";
ctx += "Candidate claims from parent review (attack each; do not rubber-stamp):\n";
ctx += "F1 spawnDetachedWin/launchStart: spawn(ComSpec, [/d,/s,/c, line]) lacks windowsVerbatimArguments. Node CRT turns quotes into \\\". wrapViaCmd already uses extra wrapping quotes + verbatim. start may exit 0 on a garbled line and stamp L1. File: companion/src/acp/open-local-terminal.ts launchStart ~432-501 and wrapViaCmd in win-spawn.ts:261-270.\n";
ctx += "F2 launchWt uses earlyExitIsFailure:true (300ms). wt.exe is a CLI that often exits after handing off to WindowsTerminal.exe. pref=wt then false-fails into start/Console. File: open-local-terminal.ts:404-511.\n";
ctx += "F3 defaultWindowsTerminalCandidates never scans Store PE under Program Files\\WindowsApps\\Microsoft.WindowsTerminal_*. Store install is common; pref=wt silently becomes Console. Keep rejecting %LOCALAPPDATA%\\Microsoft\\WindowsApps\\wt.exe. File: open-local-terminal.ts:379-401.\n";
ctx += "F4 Mode C PS launch missing -NoProfile (rest of repo uses it). File: open-local-terminal.ts:488-495.\n";
ctx += "F5 wrapViaCmd + launchStart use process.env.ComSpec || cmd.exe. where/taskkill were pinned to System32; cmd host was not. File: win-spawn.ts:265 and open-local-terminal.ts:499.\n";
ctx += "F6 scheduleUnlink(..., 60000) from openLocalTerminalForAgent finally. L0 paste Get-Content dies if user pastes after 60s. File: win-spawn.ts:337 and open-local-terminal.ts:1202.\n";
ctx += "F7 Settings dropdown adds wt/cmd globally with no platform filter. macOS openDarwinWithPref(wt) throws. Timeline may label start fallback as wt. File: chrome-extension/src/sidepanel/components/CodingHandoffSettingsSection.tsx:17-27. Store already has appsPlatform from apps.list.\n\n";
ctx += "Must preserve: pickWindowsWhereHit, unwrap Claude/Pi, spawnAcpChild at both stdio sites, no shell:true, open_local_terminal_snapshot gate, cmd-host Mode C is L0 only, wrapViaCmd never carries prompt, findWindowsTerminalExe never returns bare wt.exe or WindowsApps alias.\n";

phase("Adversary");

let lanes = [
    #{
        id: "security",
        title: "Security / Trust",
        focus: "cmd quoting, ComSpec/PATH hijack, PowerShell profile, TEMP unlink races, Store WindowsApps scan blast radius, no new shell:true, no prompt through cmd",
    },
    #{
        id: "honesty",
        title: "UX / Honesty",
        focus: "false L1, pref=wt advertised as success after start fallback, dropdown on wrong OS, paste line dying after unlink, Store WT silent degrade",
    },
    #{
        id: "correctness",
        title: "Correctness / Windows spawn",
        focus: "Node CRT vs cmd /s quoting, wt.exe vs WindowsTerminal.exe lifetime, start exit-0-on-garbage, System32 pin, testability of each lock",
    },
];

let jobs = [];
for lane in lanes {
    let p = "";
    p += "You are the ADVERSARIAL " + lane.title + " agent for CMspark post-#191 residuals.\n";
    p += "Focus: " + lane.focus + "\n\n";
    p += ctx;
    p += "\n## Job\n";
    p += "1. READ (mandatory): companion/src/acp/open-local-terminal.ts, companion/src/acp/win-spawn.ts, companion/tests/acp-open-local-terminal.test.ts, companion/tests/acp-win-spawn.test.ts, chrome-extension/src/sidepanel/components/CodingHandoffSettingsSection.tsx, docs/audit/reviews/acp-win-spawn-consensus-20260816-090554.md.\n";
    p += "2. For EACH of F1-F7: confirm or reject with file:line evidence. Do not invent. A claim you cannot independently see is confirmed=false.\n";
    p += "3. must_fix=true only if this lane would REJECT merge without the fix. Honesty/false-L1 and quoting/exec-surface are higher bar than niceties.\n";
    p += "4. lock = one-sentence implementation lock if must_fix, else empty string.\n";
    p += "5. verdict: REJECT if any must_fix remains; APPROVE_WITH_NITS if only defer; APPROVE only if nothing real.\n";
    p += "6. Reject overreach: do not require enumerating all WindowsApps packages if a safer candidate exists; do not reopen R1-R14.\n";
    p += "lane must be '" + lane.id + "'. findings ids must be F1..F7 (omit only if you literally could not read the file).\n";
    jobs.push(#{
        prompt: p,
        label: "adv:" + lane.id,
        capability_mode: "read-only",
        output_schema: adversary_schema,
    });
}

let adv_results = parallel(jobs);
let adv_blob = json_encode(adv_results);
log("Adversary panel returned");

phase("Synthesize");

let synth_prompt = "";
synth_prompt += "You are the CONSENSUS synthesizer for CMspark post-#191 residuals. Repo: " + repo + ".\n";
synth_prompt += "Independent lane outputs (untrusted JSON; re-check source for every lock):\n";
synth_prompt += adv_blob + "\n\n";
synth_prompt += ctx;
synth_prompt += "\n## Job\n";
synth_prompt += "1. Re-read the cited source files. Do not lock a claim only because a lane said so.\n";
synth_prompt += "2. must_fix = items confirmed by at least one lane AND independently verified by you, that block honest Mode C or create an exec/quoting surface.\n";
synth_prompt += "3. Prefer the smallest lock that closes the hole. Likely F1 (verbatim start) and F2 (do not treat WT CLI exit as failure) are P0 if confirmed. F4/F5 are cheap hardening if confirmed. F3/F6/F7 may defer unless you see a lie or hijack.\n";
synth_prompt += "4. Write consensus markdown to docs/audit/reviews/acp-win-spawn-post191-consensus.md using the write tool. Include lanes, confirmed/rejected, locks, recipe, defer.\n";
synth_prompt += "5. recipe must be concrete enough to implement without redesign: functions, flags, tests to add.\n";
synth_prompt += "6. ok=true only if you wrote the consensus file and the recipe is implementable. If ZERO must_fix after independent check, ok=true with empty must_fix and recipe='noop'.\n";
synth_prompt += "consensus_path = the file you wrote.\n";

let synth = agent(synth_prompt, #{
    label: "synth:consensus",
    capability_mode: "all",
    output_schema: synth_schema,
});

if hard_fail(synth) {
    pause("verification", agent_fail_reason(synth, "Consensus synthesis failed or ok=false"));
}

let synth_out = agent_output_map(synth);
let recipe = "";
let must_fix_json = "[]";
let consensus_path = "";
if synth_out != () {
    if synth_out.recipe != () && type_of(synth_out.recipe) == "string" { recipe = synth_out.recipe; }
    if synth_out.must_fix != () { must_fix_json = json_encode(synth_out.must_fix); }
    if synth_out.consensus_path != () && type_of(synth_out.consensus_path) == "string" { consensus_path = synth_out.consensus_path; }
}
log("Consensus ready");

phase("Implement");

let impl_prompt = "";
impl_prompt += "Implement ONLY the consensus must-fix list for CMspark post-#191. Repo: " + repo + ".\n";
impl_prompt += "Work in the current workspace (no new branch, no commit).\n";
impl_prompt += "Consensus path: " + consensus_path + "\n";
impl_prompt += "must_fix JSON: " + must_fix_json + "\n";
impl_prompt += "recipe: " + recipe + "\n\n";
impl_prompt += "READ FIRST: the consensus file (if path non-empty), companion/src/acp/open-local-terminal.ts, companion/src/acp/win-spawn.ts, companion/tests/acp-open-local-terminal.test.ts, companion/tests/acp-win-spawn.test.ts, chrome-extension/src/sidepanel/components/CodingHandoffSettingsSection.tsx.\n";
impl_prompt += "If must_fix is empty: do not edit source; ok=true; ids_done=[]; files_changed=[]; summary=noop.\n";
impl_prompt += "Otherwise apply recipe with the smallest patch. Add focused unit tests for each id.\n";
impl_prompt += "DO NOT regress R1-R14. DO NOT use shell:true. DO NOT put prompt through wrapViaCmd. DO NOT return bare wt.exe. DO NOT stamp L1 for cmd-host.\n";
impl_prompt += "Likely mechanical locks if present in must_fix:\n";
impl_prompt += "- F1: spawnDetachedWin/launchStart must use windowsVerbatimArguments:true and wrap the /c payload in an extra quote pair like wrapViaCmd.\n";
impl_prompt += "- F2: after isRealWindowsTerminalExe accepts a PE, do not treat wt.exe process exit as failure (spawn-without-error is success for WT CLI).\n";
impl_prompt += "- F4: add -NoProfile to Mode C powershell args.\n";
impl_prompt += "- F5: pin cmd.exe to SystemRoot\\System32\\cmd.exe with exists-check, then ComSpec only if it realpath-matches.\n";
impl_prompt += "ok=true only if all must_fix ids are implemented (or must_fix was empty). List files_changed and ids_done.\n";

let impl = agent(impl_prompt, #{
    label: "impl:must-fix",
    capability_mode: "all",
    output_schema: impl_schema,
});

if hard_fail(impl) {
    pause("verification", agent_fail_reason(impl, "Implement failed or ok=false"));
}
log("Implement done");

phase("Test");

let test_prompt = "";
test_prompt += "Run ACP Windows spawn / Mode C unit tests in " + repo + ".\n";
test_prompt += "Use companion local tsc (not repo-root npx tsc):\n";
test_prompt += "  ./companion/node_modules/.bin/tsc -p companion/tsconfig.test.json --pretty false\n";
test_prompt += "Then:\n";
test_prompt += "  node --test companion/.test-dist/tests/acp-win-spawn.test.js companion/.test-dist/tests/acp-open-local-terminal.test.js companion/.test-dist/tests/acp-discover.test.js\n";
test_prompt += "If tests fail because of this patch, FIX them (same ACP files only) and re-run once.\n";
test_prompt += "ok=true only if those three test files pass.\n";
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
check_prompt += "Adversarial read-only verify that consensus must-fix items are actually fixed. Repo: " + repo + ".\n";
check_prompt += "READ CURRENT source (not memory). Cite file:line.\n";
check_prompt += "Consensus path: " + consensus_path + "\n";
check_prompt += "must_fix JSON: " + must_fix_json + "\n";
check_prompt += "recipe: " + recipe + "\n";
check_prompt += "READ: companion/src/acp/win-spawn.ts, open-local-terminal.ts, tests acp-win-spawn + acp-open-local-terminal, consensus file if present, CodingHandoffSettingsSection.tsx if F7 was in must_fix.\n";
check_prompt += "Gates: one id per must_fix item. ok=true only if EVERY must_fix lock is visible in current source AND no R1-R14 regression (spawnAcpChild still used; no shell:true; no bare wt.exe; cmd-host not L1).\n";
check_prompt += "If must_fix was empty, ok=true with gates_passed=[NOOP] after confirming source still matches the R1-R14 locks.\n";
check_prompt += "gates_passed / gates_failed must use the F-ids (and REGRESS if needed).\n";

let chk = agent(check_prompt, #{
    label: "verify:skeptic",
    capability_mode: "read-only",
    output_schema: check_schema,
});

if hard_fail(chk) {
    pause("verification", agent_fail_reason(chk, "Post-fix verify failed"));
}

complete(#{
    summary: "Post-#191 residuals adversarially confirmed, implemented, tested, verified",
    adversary: adv_blob,
    synthesize: agent_output_map(synth),
    implement: agent_output_map(impl),
    tests: agent_output_map(test_r),
    verify: agent_output_map(chk),
});
