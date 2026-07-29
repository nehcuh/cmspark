let meta = #{
    name: "windows-download-platform-with-gates",
    description: "Windows download UX + platform tool filtering: design gate then P0/P1 with Claude+Pi dual review at each milestone",
    when_to_use: "After plan 2026-07-29-windows-download-platform-tools; ship with dual external gates",
    phases: [
        #{ title: "Prep", detail: "Inventory plan + code touchpoints + base commit" },
        #{ title: "Gate0-Design-Review", detail: "Claude + Pi dual review of the design plan" },
        #{ title: "Gate0-Design-Fix", detail: "Apply Gate0 must_fix to plan (if any)" },
        #{ title: "P0-Impl", detail: "Filter + early-reject osascript_eval + tests" },
        #{ title: "Gate1-P0-Review", detail: "Claude + Pi dual review of P0 code" },
        #{ title: "Gate1-P0-Fix", detail: "Apply Gate1 must_fix" },
        #{ title: "P1-Spike-Note", detail: "chrome.downloads vs CDP spike note (no full P1 without approve)" },
        #{ title: "Gate2-Spike-Review", detail: "Claude + Pi review spike decision" },
        #{ title: "Ship-Note", detail: "Write gate summary + residual risks" },
    ],
};

let prep_schema = #{
    "type": "object",
    "required": ["plan_ok", "base_commit", "touchpoints", "summary"],
    "properties": #{
        "plan_ok": #{ "type": "boolean" },
        "base_commit": #{ "type": "string" },
        "touchpoints": #{ "type": "array", "maxItems": 25, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "p0_ready": #{ "type": "boolean" },
    },
};

let impl_schema = #{
    "type": "object",
    "required": ["changed_files", "summary", "tests_run", "done"],
    "properties": #{
        "changed_files": #{ "type": "array", "maxItems": 40, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "tests_run": #{ "type": "string" },
        "done": #{ "type": "boolean" },
        "blocked": #{ "type": "string" },
    },
};

let dual_schema = #{
    "type": "object",
    "required": ["both_approve", "claude_verdict", "pi_verdict", "claude_path", "pi_path", "verdict_json", "exit_code"],
    "properties": #{
        "both_approve": #{ "type": "boolean" },
        "claude_verdict": #{ "type": "string" },
        "pi_verdict": #{ "type": "string" },
        "claude_path": #{ "type": "string" },
        "pi_path": #{ "type": "string" },
        "verdict_json": #{ "type": "string" },
        "exit_code": #{ "type": "number" },
        "raw_tail": #{ "type": "string" },
        "must_fix": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
    },
};

let ship_schema = #{
    "type": "object",
    "required": ["ship_note_path", "tests_ok", "summary"],
    "properties": #{
        "ship_note_path": #{ "type": "string" },
        "tests_ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "remaining": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
    },
};

// Guard args
let wt = if args == () { () } else { args.worktree };
if wt == () {
    pause("verification", "Pass args.worktree = absolute path to cmspark worktree (main or feature branch worktree)");
}

let plan = wt + "/docs/superpowers/plans/2026-07-29-windows-download-platform-tools.md";
let dual_script = wt + "/scripts/dual-external-review.sh";

// ---------- Prep ----------
phase("Prep");
let prep_p = "";
prep_p += "WORKTREE=" + wt + " is the ONLY git root you may edit.\n";
prep_p += "Plan (required): " + plan + "\n";
prep_p += "1) Read the plan fully. Confirm Status marks P0 implementation-ready and P1 provisional.\n";
prep_p += "2) Inventory touchpoints with grep/read (do NOT implement):\n";
prep_p += "   companion/src/bridge/tool-definitions.ts getToolDefinitions/getAllToolDefinitions\n";
prep_p += "   companion/src/llm/adapter.ts Rule 8 + tools assembly\n";
prep_p += "   companion/src/server.ts L2_GATE_TOOLS + createToolExecutor + executeCompanionTool osascript_eval\n";
prep_p += "   companion/src/message-router.ts osascript_eval case\n";
prep_p += "   companion/tests/integration/security-gates.test.ts M3' osascript\n";
prep_p += "   chrome-extension browser-bridge download stub (P1 later)\n";
prep_p += "3) base_commit = git rev-parse HEAD. plan_ok=true if plan file exists and P0 section is concrete.\n";
prep_p += "4) p0_ready=true only if plan says P0 implementation-ready.\n";
prep_p += "5) Return plan_ok, base_commit, touchpoints, summary, p0_ready. No product code changes.\n";
let prep = agent(prep_p, #{
    label: "prep-plan",
    capability_mode: "all",
    output_schema: prep_schema,
});
let base_commit = "HEAD";
if prep != () && prep.success && prep.output != () && prep.output.base_commit != () {
    base_commit = prep.output.base_commit;
}
let prep_json = if prep != () && prep.success { json_encode(prep.output) } else { "{}" };
log("Prep done base=" + base_commit);

// ---------- Gate0: design dual review ----------
phase("Gate0-Design-Review");
let body0 = "";
body0 += "# Dual review Gate0 — design plan (Windows download + platform tools)\n";
body0 += "Worktree: " + wt + "\n";
body0 += "Plan: docs/superpowers/plans/2026-07-29-windows-download-platform-tools.md\n";
body0 += "Prep: " + prep_json + "\n";
body0 += "This is a **design/plan review** (not a code-diff ship review).\n";
body0 += "Verify against REAL code + the plan document:\n";
body0 += "1) P0: hide osascript_eval off-darwin + early-reject before L2 matches host_app gating pattern\n";
body0 += "2) getAllToolDefinitions vs filtered getToolDefinitions for pack validator\n";
body0 += "3) M3' security-gates test fork on non-darwin CI\n";
body0 += "4) P1 correctly provisional: chrome.downloads primary, spike gate, text|selector, TAB_LEASE, path sandbox\n";
body0 += "5) PR graph realistic; no over-claim of CDP under tab debugger\n";
body0 += "6) ADR-020 declaration; no new confirmation dialect without justification\n";
body0 += "7) Security: no domain whitelist for osascript; path allowlist for downloads\n";
body0 += "Approve P0 for implementation if sound; P1 may be APPROVE_WITH_NITS if provisional.\n";
body0 += "REJECT only if P0 would be wrong/unsafe to implement as written.\n";
body0 += "End with EXACTLY one line: VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";

let g0p = "";
g0p += "Run dual external Claude+Pi review for Gate0 (design plan). Do not invent verdicts.\n";
g0p += "1) Write a prompt file (Windows OK: use " + wt + "/docs/audit/reviews/_tmp-win-dl-g0-prompt.md OR /tmp if bash) containing:\n-----BEGIN-----\n" + body0 + "\n-----END-----\n";
g0p += "2) Prefer: cd " + wt + " && bash scripts/dual-external-review.sh win-dl-g0 <prompt-file> " + base_commit + "\n";
g0p += "   If claude CLI missing: still run pi -p independently; for Claude slot use a thorough independent review written to docs/audit/reviews/win-dl-g0-claude-<ts>.md with VERDICT line, AND document CLAUDE_CLI_MISSING=true in notes. Do not fake both as the same process.\n";
g0p += "3) Read newest docs/audit/reviews/win-dl-g0-verdict-*.json if present; else synthesize verdict json from the two review files.\n";
g0p += "4) Return both_approve (true if BOTH are APPROVE or APPROVE_WITH_NITS), verdicts, paths, exit_code, must_fix list, raw_tail.\n";
let g0 = agent(g0p, #{
    label: "gate0-dual-design",
    capability_mode: "all",
    output_schema: dual_schema,
});
if g0 == () || !g0.success || g0.output == () {
    await_user("verification", "Gate0 dual review failed to run (infra: claude/pi/bash). Fix CLIs then /workflow resume.");
}
let g0_out = g0.output;
log("Gate0 claude=" + g0_out.claude_verdict + " pi=" + g0_out.pi_verdict + " both=" + g0_out.both_approve.to_string());

// ---------- Gate0 fix plan ----------
phase("Gate0-Design-Fix");
let g0_must = [];
if g0_out.must_fix != () {
    g0_must = g0_out.must_fix;
}
if g0_out.both_approve != true || g0_must.len() > 0 {
    let fix0_p = "";
    fix0_p += "WORKTREE=" + wt + ". Revise the design plan ONLY (no product code).\n";
    fix0_p += "Plan path: " + plan + "\n";
    fix0_p += "both_approve=" + g0_out.both_approve.to_string() + " must_fix=" + json_encode(g0_must) + "\n";
    fix0_p += "Read reviews: " + g0_out.claude_path + " and " + g0_out.pi_path + "\n";
    fix0_p += "Apply blockers fully; nits that affect P0 correctness. Commit plan if changed.\n";
    fix0_p += "done=true when plan updated. Return changed_files, summary, tests_run=n/a, done.\n";
    let fix0 = agent(fix0_p, #{
        label: "gate0-plan-fix",
        capability_mode: "all",
        output_schema: impl_schema,
    });
    let _f0 = fix0;
    if g0_out.both_approve != true {
        let body0b = "";
        body0b += "# Dual review Gate0-recheck — design plan\n";
        body0b += "Previous not dual-approved. Claim fixes for: " + json_encode(g0_must) + "\n";
        body0b += "Re-read plan and code. End with VERDICT line.\n";
        let g0bp = "";
        g0bp += "Re-run dual external after Gate0 plan fix.\n";
        g0bp += "1) Write prompt with:\n-----BEGIN-----\n" + body0b + "\n-----END-----\n";
        g0bp += "2) bash scripts/dual-external-review.sh win-dl-g0b <prompt> " + base_commit + " (or pi+claude independent files)\n";
        g0bp += "3) Return dual_schema from newest win-dl-g0b verdicts.\n";
        let g0b = agent(g0bp, #{
            label: "gate0-recheck-dual",
            capability_mode: "all",
            output_schema: dual_schema,
        });
        if g0b == () || !g0b.success || g0b.output == () || g0b.output.both_approve != true {
            await_user("verification", "Gate0 design still not dual-approved after fix. Inspect docs/audit/reviews/win-dl-g0* then resume or stop.");
        } else {
            g0_out = g0b.output;
            log("Gate0 recheck both_approve=true");
        }
    }
} else {
    log("Gate0 clean approve — skip plan fix");
}

// Hard gate: never implement P0 without dual approve
if g0_out.both_approve != true {
    await_user("verification", "REFUSING P0-Impl: Gate0 both_approve is false. Do not implement until design dual-approved.");
}

// ---------- P0 Implement ----------
phase("P0-Impl");
let p0_p = "";
p0_p += "WORKTREE=" + wt + " ONLY. Implement plan P0 / PR-1 ONLY (no browser_download / no extension downloads yet).\n";
p0_p += "Plan: " + plan + " (P0 section). Prep: " + prep_json + "\n";
p0_p += "Gate0 approved: claude=" + g0_out.claude_verdict + " pi=" + g0_out.pi_verdict + "\n";
p0_p += "MUST implement:\n";
p0_p += "A) getAllToolDefinitions() unfiltered full table; getToolDefinitions(platform?) filters osascript_eval when platform!==darwin\n";
p0_p += "B) Adapter uses filtered definitions; pack validator / getToolDefinition use full catalog\n";
p0_p += "C) createToolExecutor: early-reject osascript_eval off-darwin BEFORE L2 confirmation UI (mirror host_app pattern)\n";
p0_p += "D) message-router osascript case: platform check first line\n";
p0_p += "E) executeCompanionTool keep defense-in-depth platform check; preserve macos-only recoverable error substring\n";
p0_p += "F) Pure helper shouldL2GateOsascript(platform) or equivalent for tests\n";
p0_p += "G) Tests: filter by injected platform; early-reject no confirmation on non-darwin; M3' security-gates platform fork; classifyError recoverable\n";
p0_p += "H) PR-2 hygiene optional same commit or separate: browse.md + Rule 8 platform branch (no osascript on win32 narrative)\n";
p0_p += "Run companion unit/integration tests relevant (security-gates, bridge, tool schemas). Prefer npm test with patterns if full suite slow.\n";
p0_p += "Commit when green: fix(companion): hide osascript_eval off-darwin and early-reject before L2\n";
p0_p += "Do NOT push. Return changed_files, summary, tests_run, done=true only if tests green.\n";
let p0 = agent(p0_p, #{
    label: "p0-impl",
    capability_mode: "all",
    output_schema: impl_schema,
});
let p0_json = if p0 != () && p0.success { json_encode(p0.output) } else { "{\"done\":false,\"summary\":\"p0 agent failed\"}" };
log("P0 impl complete");

// ---------- Gate1: P0 code dual review ----------
phase("Gate1-P0-Review");
let body1 = "";
body1 += "# Dual review Gate1 — P0 code (osascript platform filter + early-reject)\n";
body1 += "Worktree: " + wt + "\n";
body1 += "Base commit for diff: " + base_commit + "\n";
body1 += "Claim: " + p0_json + "\n";
body1 += "Plan: docs/superpowers/plans/2026-07-29-windows-download-platform-tools.md §P0\n";
body1 += "Verify on REAL code/diff (not claims):\n";
body1 += "1) non-darwin LLM tool list lacks osascript_eval; darwin still has it\n";
body1 += "2) Early reject before security.confirmation.request on non-darwin (no L2 dialog waste)\n";
body1 += "3) getAllToolDefinitions still includes osascript for pack validator\n";
body1 += "4) M3' / security-gates tests pass on this platform (fork if needed)\n";
body1 += "5) Error remains classifyError recoverable (macos-only substring)\n";
body1 += "6) No accidental browser_download / downloads permission in this PR\n";
body1 += "7) ADR-020: Surface L0/L1 filter only; no new L2 dialect\n";
body1 += "End with EXACTLY: VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";

let g1p = "";
g1p += "Run dual external Claude+Pi review for Gate1 P0 code. Do not invent verdicts.\n";
g1p += "1) Write prompt file with:\n-----BEGIN-----\n" + body1 + "\n-----END-----\n";
g1p += "2) cd " + wt + " && bash scripts/dual-external-review.sh win-dl-g1 <prompt-file> " + base_commit + "\n";
g1p += "   Fallback if claude missing: independent pi + independent thorough review files under docs/audit/reviews/win-dl-g1-*.md\n";
g1p += "3) Return dual_schema + must_fix from newest win-dl-g1-verdict or synthesized files.\n";
let g1 = agent(g1p, #{
    label: "gate1-dual-p0",
    capability_mode: "all",
    output_schema: dual_schema,
});
if g1 == () || !g1.success || g1.output == () {
    await_user("verification", "Gate1 dual review failed (infra). Fix then resume.");
}
let g1_out = g1.output;
log("Gate1 claude=" + g1_out.claude_verdict + " pi=" + g1_out.pi_verdict);

// ---------- Gate1 fix ----------
phase("Gate1-P0-Fix");
let g1_must = [];
if g1_out.must_fix != () {
    g1_must = g1_out.must_fix;
}
if g1_out.both_approve != true || g1_must.len() > 0 {
    let fix1_p = "";
    fix1_p += "WORKTREE=" + wt + ". Apply Gate1 dual-review findings for P0 only.\n";
    fix1_p += "both_approve=" + g1_out.both_approve.to_string() + " must_fix=" + json_encode(g1_must) + "\n";
    fix1_p += "Read: " + g1_out.claude_path + " and " + g1_out.pi_path + "\n";
    fix1_p += "Fix blockers fully; security/correctness nits. Re-run tests. Commit. done=true if green.\n";
    let fix1 = agent(fix1_p, #{
        label: "gate1-p0-fix",
        capability_mode: "all",
        output_schema: impl_schema,
    });
    let _f1 = fix1;
    if g1_out.both_approve != true {
        let body1b = "";
        body1b += "# Dual review Gate1-recheck P0\n";
        body1b += "Previous REJECT. Fixes claimed for: " + json_encode(g1_must) + "\n";
        body1b += "Re-verify filter + early-reject + tests. End VERDICT line.\n";
        let g1bp = "";
        g1bp += "Re-run dual external after Gate1 fix.\n";
        g1bp += "1) Write prompt:\n-----BEGIN-----\n" + body1b + "\n-----END-----\n";
        g1bp += "2) bash scripts/dual-external-review.sh win-dl-g1b <prompt> " + base_commit + "\n";
        g1bp += "3) Return dual_schema.\n";
        let g1b = agent(g1bp, #{
            label: "gate1-recheck-dual",
            capability_mode: "all",
            output_schema: dual_schema,
        });
        if g1b == () || !g1b.success || g1b.output == () || g1b.output.both_approve != true {
            await_user("verification", "Gate1 P0 still not dual-approved. Inspect docs/audit/reviews/win-dl-g1* then resume or stop.");
        } else {
            g1_out = g1b.output;
            log("Gate1 recheck both_approve=true");
        }
    }
} else {
    log("Gate1 clean approve — skip fix");
}

if g1_out.both_approve != true {
    await_user("verification", "REFUSING further phases: Gate1 both_approve is false.");
}

// ---------- P1 spike note only (no full P1 impl in this workflow) ----------
phase("P1-Spike-Note");
let spike_p = "";
spike_p += "WORKTREE=" + wt + ". Create a SHORT transport spike note for P1 — do NOT implement browser_download fully.\n";
spike_p += "Write: " + wt + "/docs/audit/reviews/win-dl-p1-spike-checklist.md\n";
spike_p += "Contents: checklist S1-S4 from the plan (chrome.downloads primary, CDP secondary, permissions, restore behavior).\n";
spike_p += "Mark each item: not_run | pass | fail | blocked — based on code reading + any quick local experiment if safe.\n";
spike_p += "Recommend: proceed_with_downloads_primary | retest_cdp | block_p1.\n";
spike_p += "Return changed_files, summary, tests_run, done=true if file written.\n";
let spike = agent(spike_p, #{
    label: "p1-spike-note",
    capability_mode: "all",
    output_schema: impl_schema,
});
let spike_json = if spike != () && spike.success { json_encode(spike.output) } else { "{}" };
log("Spike note phase complete");

// ---------- Gate2 spike review ----------
phase("Gate2-Spike-Review");
let body2 = "";
body2 += "# Dual review Gate2 — P1 transport spike decision (not full P1 ship)\n";
body2 += "Worktree: " + wt + "\n";
body2 += "Spike claim: " + spike_json + "\n";
body2 += "Read plan P1 §1.0 + docs/audit/reviews/win-dl-p1-spike-checklist.md\n";
body2 += "Approve if decision (downloads primary vs CDP) is justified and next PR scope is clear.\n";
body2 += "REJECT if spike claims without evidence or scopes full P1 without path sandbox/TAB_LEASE/text.\n";
body2 += "End VERDICT line.\n";
let g2p = "";
g2p += "Run dual external Claude+Pi for Gate2 spike decision.\n";
g2p += "1) Write prompt:\n-----BEGIN-----\n" + body2 + "\n-----END-----\n";
g2p += "2) bash scripts/dual-external-review.sh win-dl-g2 <prompt> " + base_commit + " (or independent pi+claude files)\n";
g2p += "3) Return dual_schema + must_fix.\n";
let g2 = agent(g2p, #{
    label: "gate2-dual-spike",
    capability_mode: "all",
    output_schema: dual_schema,
});
if g2 == () || !g2.success || g2.output == () {
    await_user("verification", "Gate2 dual review failed (infra). Fix then resume.");
}
let g2_out = g2.output;
log("Gate2 claude=" + g2_out.claude_verdict + " pi=" + g2_out.pi_verdict);

if g2_out.both_approve != true {
    await_user("verification", "Gate2 spike not dual-approved. Full P1 implementation is blocked until spike gate passes.");
}

// ---------- Ship note ----------
phase("Ship-Note");
let ver_p = "";
ver_p += "WORKTREE=" + wt + ". Write ship/status note for this gated run.\n";
ver_p += "Path: " + wt + "/docs/audit/reviews/win-dl-platform-ship-note.md\n";
ver_p += "Include: Gate0/1/2 verdicts, what shipped (P0?), residual P1 work, residual risks, how to re-run dual-external-review.\n";
ver_p += "Re-run a quick companion test subset for P0 if code changed. tests_ok=true only if green.\n";
ver_p += "Return ship_note_path, tests_ok, summary, remaining.\n";
let ver = agent(ver_p, #{
    label: "ship-note",
    capability_mode: "all",
    output_schema: ship_schema,
});

let ship_path = wt + "/docs/audit/reviews/win-dl-platform-ship-note.md";
let tests_ok = false;
let summary = "verify incomplete";
if ver != () && ver.success && ver.output != () {
    if ver.output.ship_note_path != () { ship_path = ver.output.ship_note_path; }
    if ver.output.tests_ok == true { tests_ok = true; }
    if ver.output.summary != () { summary = ver.output.summary; }
}

let report = "";
report += "# Windows download platform tools — gated workflow result\n\n";
report += "- worktree: " + wt + "\n";
report += "- Gate0 design: " + g0_out.claude_verdict + " / " + g0_out.pi_verdict + " both=" + g0_out.both_approve.to_string() + "\n";
report += "- Gate1 P0: " + g1_out.claude_verdict + " / " + g1_out.pi_verdict + " both=" + g1_out.both_approve.to_string() + "\n";
report += "- Gate2 spike: " + g2_out.claude_verdict + " / " + g2_out.pi_verdict + " both=" + g2_out.both_approve.to_string() + "\n";
report += "- tests_ok: " + tests_ok.to_string() + "\n";
report += "- ship_note: " + ship_path + "\n";
report += "- summary: " + summary + "\n";
let report_path = write_scratch_file("win-dl-platform-workflow-report.md", report);

complete(#{
    summary: summary,
    worktree: wt,
    ship_note: ship_path,
    tests_ok: tests_ok,
    gate0_claude: g0_out.claude_verdict,
    gate0_pi: g0_out.pi_verdict,
    gate1_claude: g1_out.claude_verdict,
    gate1_pi: g1_out.pi_verdict,
    gate2_claude: g2_out.claude_verdict,
    gate2_pi: g2_out.pi_verdict,
    report: report_path,
});
