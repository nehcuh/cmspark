let meta = #{
    name: "user-env-with-gates",
    description: "ADR-019 user env/secrets: implement with Claude+Pi dual review at each gate",
    when_to_use: "After ADR-019 confirmed; ship user-env companion+UI with dual external reviews",
    phases: [
        #{ title: "Prep", detail: "Commit ADR-019; inventory touchpoints" },
        #{ title: "PR1-Impl", detail: "Companion user-env + shell/MCP inject + tests" },
        #{ title: "Gate1-Review", detail: "Claude + Pi dual review PR1" },
        #{ title: "Gate1-Fix", detail: "Apply Gate1 must_fix" },
        #{ title: "PR2-Impl", detail: "Extension Settings UI + WS types" },
        #{ title: "Gate2-Review", detail: "Claude + Pi final ship review" },
        #{ title: "Gate2-Fix", detail: "Apply Gate2 blockers" },
        #{ title: "Verify", detail: "Full tests + ship note" },
    ],
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

let prep_schema = #{
    "type": "object",
    "required": ["adr_ok", "base_commit", "touchpoints", "summary"],
    "properties": #{
        "adr_ok": #{ "type": "boolean" },
        "base_commit": #{ "type": "string" },
        "touchpoints": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
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
    pause("verification", "Pass args.worktree = absolute path to feat/user-env-secrets worktree (e.g. /Users/huchen/Projects/cmspark-wt-user-env)");
}

let root = wt;
let adr = wt + "/docs/adr/019-user-env-secrets.md";

// ---------- Prep ----------
phase("Prep");
let prep_p = "";
prep_p += "WORKTREE=" + wt + " is the ONLY git root you may edit.\n";
prep_p += "ADR-019 is at " + adr + " (status 已确认). Read it fully, especially §4–§9 and §12.1 P0 fixes R1–R7.\n";
prep_p += "1) git add docs/adr/019-user-env-secrets.md and commit if untracked (message: docs(adr): ADR-019 user env secrets confirmed).\n";
prep_p += "2) Inventory touchpoints with grep/read: companion/src/capability/shell.ts, mcp/transport.ts, message-router.ts, server.ts redact/ws, io.ts, config.ts DATA_DIR, chrome-extension SettingsSlideout, background message types.\n";
prep_p += "3) grep process.env across companion/src for denylist candidates (R3).\n";
prep_p += "4) Return adr_ok, base_commit=git rev-parse HEAD, touchpoints list, summary. Do NOT implement product code yet.\n";
let prep = agent(prep_p, #{
    label: "prep-adr019",
    capability_mode: "all",
    output_schema: prep_schema,
});
let base_commit = "HEAD";
if prep != () && prep.success && prep.output != () && prep.output.base_commit != () {
    base_commit = prep.output.base_commit;
}
let prep_json = if prep != () && prep.success { json_encode(prep.output) } else { "{}" };
log("Prep done base=" + base_commit);

// ---------- PR1 Implement ----------
phase("PR1-Impl");
let pr1_p = "";
pr1_p += "WORKTREE=" + wt + " ONLY. Implement ADR-019 PR-1 (Companion core) per " + adr + ".\n";
pr1_p += "Prep inventory: " + prep_json + "\n";
pr1_p += "MUST implement:\n";
pr1_p += "A) companion/src/user-env.ts — load/save atomic 0o600 user-env.json under DATA_DIR; VERSION=1; key regex; max keys 64; max value 16KiB; denylist from real process.env scan + dangerous loaders + ban CMSPARK_* prefix; cache; getUserEnvVars() returns {} on corrupt (S9).\n";
pr1_p += "B) buildUserEnvPublic() ONLY outbound path (R2). set: empty string is value NOT delete (R6). delete via delete(). value *** ignored.\n";
pr1_p += "C) WS handlers user_env.list|set|delete + broadcast user_env.updated (auth after). Log/audit redact values (R1).\n";
pr1_p += "D) shell.ts buildChildEnv: process.env then user_env then force CMSPARK_SHELL.\n";
pr1_p += "E) mcp/transport.ts: process → user_env → server.env → PATH buildSpawnPath.\n";
pr1_p += "F) unit tests companion/tests/user-env.test.ts + shell env merge if feasible.\n";
pr1_p += "G) Do NOT implement Chrome Settings UI yet (PR2).\n";
pr1_p += "Run companion tests for user-env (and related). Prefer: cd companion && npm test -- --test-name-pattern user-env  OR full npm test if pattern fails.\n";
pr1_p += "Also tsc if project uses it. Commit when green: feat(companion): user-env secrets for shell/MCP (ADR-019).\n";
pr1_p += "Return changed_files, summary, tests_run, done=true if tests green.\n";
let pr1 = agent(pr1_p, #{
    label: "pr1-companion",
    capability_mode: "all",
    output_schema: impl_schema,
});
let pr1_json = if pr1 != () && pr1.success { json_encode(pr1.output) } else { "{\"done\":false,\"summary\":\"pr1 agent failed\"}" };
log("PR1 impl complete");

// ---------- Gate1 dual external ----------
phase("Gate1-Review");
let body1 = "";
body1 += "# Dual review ADR-019 Gate1 (Companion PR1)\n";
body1 += "Worktree: " + wt + "\n";
body1 += "ADR: docs/adr/019-user-env-secrets.md (§12.1 R1-R7 mandatory)\n";
body1 += "Claim: " + pr1_json + "\n";
body1 += "Verify on REAL code (not claims):\n";
body1 += "1) user-env.ts storage 0o600 atomic; denylist real; CMSPARK_* banned; empty!=delete\n";
body1 += "2) buildUserEnvPublic only outbound; no plaintext on list/updated\n";
body1 += "3) set path redacts before logger/audit\n";
body1 += "4) shell.ts + mcp/transport.ts merge order correct\n";
body1 += "5) tests cover denylist, redact, corrupt degrade, *** ignore\n";
body1 += "6) no secrets in LLM path\n";
body1 += "End with VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";

let g1p = "";
g1p += "Run dual external Claude+Pi review for Gate1. Do not invent verdicts.\n";
g1p += "1) Write /tmp/cmspark-review-user-env-g1.md with exactly:\n-----BEGIN-----\n" + body1 + "\n-----END-----\n";
g1p += "2) cd " + wt + " && bash scripts/dual-external-review.sh user-env-g1 /tmp/cmspark-review-user-env-g1.md " + base_commit + "\n";
g1p += "   If script missing, copy from sibling main or run claude -p and pi -p yourself writing docs/audit/reviews/user-env-g1-claude-*.md and user-env-g1-pi-*.md plus verdict json.\n";
g1p += "3) Read newest docs/audit/reviews/user-env-g1-verdict-*.json and both review files.\n";
g1p += "4) Return both_approve (true if both APPROVE or APPROVE_WITH_NITS), verdicts, paths, exit_code, must_fix from REJECT/NITS, raw_tail.\n";
let g1 = agent(g1p, #{
    label: "gate1-dual-external",
    capability_mode: "all",
    output_schema: dual_schema,
});
if g1 == () || !g1.success || g1.output == () {
    await_user("verification", "Gate1 dual external review failed to run (infra). Fix CLIs or script then /workflow resume.");
}
let g1_out = g1.output;
log("Gate1 claude=" + g1_out.claude_verdict + " pi=" + g1_out.pi_verdict + " both=" + g1_out.both_approve.to_string());

// ---------- Gate1 Fix ----------
phase("Gate1-Fix");
let g1_must = [];
if g1_out.must_fix != () {
    g1_must = g1_out.must_fix;
}
if g1_out.both_approve != true || g1_must.len() > 0 {
    let fix1_p = "";
    fix1_p += "WORKTREE=" + wt + ". Apply Gate1 dual-review findings.\n";
    fix1_p += "both_approve=" + g1_out.both_approve.to_string() + " must_fix=" + json_encode(g1_must) + "\n";
    fix1_p += "Read reviews: " + g1_out.claude_path + " and " + g1_out.pi_path + "\n";
    fix1_p += "If REJECT: fix ALL blockers. If APPROVE_WITH_NITS: fix nits that are security/correctness; skip pure style.\n";
    fix1_p += "Re-run user-env unit tests. Commit if changes. done=true only if tests green.\n";
    let fix1 = agent(fix1_p, #{
        label: "gate1-fix",
        capability_mode: "all",
        output_schema: impl_schema,
    });
    let _f1 = fix1;
    if g1_out.both_approve != true {
        // Second dual pass after fix
        let body1b = "";
        body1b += "# Dual review ADR-019 Gate1-recheck\n";
        body1b += "Previous REJECT. Claim fixes applied for: " + json_encode(g1_must) + "\n";
        body1b += "Re-verify R1-R7 and tests. End VERDICT line.\n";
        let g1bp = "";
        g1bp += "Re-run dual external after Gate1 fix.\n";
        g1bp += "1) Write /tmp/cmspark-review-user-env-g1b.md with:\n-----BEGIN-----\n" + body1b + "\n-----END-----\n";
        g1bp += "2) cd " + wt + " && bash scripts/dual-external-review.sh user-env-g1b /tmp/cmspark-review-user-env-g1b.md " + base_commit + "\n";
        g1bp += "3) Return dual_schema fields from newest user-env-g1b-verdict-*.json\n";
        let g1b = agent(g1bp, #{
            label: "gate1-recheck-dual",
            capability_mode: "all",
            output_schema: dual_schema,
        });
        if g1b == () || !g1b.success || g1b.output == () || g1b.output.both_approve != true {
            await_user("verification", "Gate1 still not dual-approved after fix. Inspect docs/audit/reviews/user-env-g1* then resume or stop.");
        } else {
            g1_out = g1b.output;
            log("Gate1 recheck both_approve=true");
        }
    }
} else {
    log("Gate1 clean approve — skip fix body");
}

// ---------- PR2 Extension UI ----------
phase("PR2-Impl");
let pr2_p = "";
pr2_p += "WORKTREE=" + wt + " ONLY. Implement ADR-019 PR-2 Extension UI.\n";
pr2_p += "Read " + adr + " §7 UI and existing SettingsSlideout.tsx, agentStore, background message routing, ws-client.\n";
pr2_p += "MUST:\n";
pr2_p += "1) Settings section 环境变量（Secrets） with list/add/update/delete; password inputs; independent save per set (not only bottom config Save).\n";
pr2_p += "2) Wire user_env.list|set|delete|updated over existing WS path (auth required).\n";
pr2_p += "3) Never display plaintext after set; show *** / 已配置.\n";
pr2_p += "4) Disable when disconnected; Chinese error_code mapping.\n";
pr2_p += "5) Optional chip DATAYES_TOKEN for name only.\n";
pr2_p += "6) Types in sidepanel types if needed. Minimal tests if extension has pattern.\n";
pr2_p += "Run extension typecheck/tests if available (npm test / tsc). Commit: feat(extension): user-env secrets settings UI (ADR-019).\n";
pr2_p += "Return changed_files, summary, tests_run, done.\n";
let pr2 = agent(pr2_p, #{
    label: "pr2-extension",
    capability_mode: "all",
    output_schema: impl_schema,
});
let pr2_json = if pr2 != () && pr2.success { json_encode(pr2.output) } else { "{\"done\":false}" };
log("PR2 impl complete");

// ---------- Gate2 dual external final ----------
phase("Gate2-Review");
let body2 = "";
body2 += "# Dual review ADR-019 Gate2 FINAL ship\n";
body2 += "Worktree: " + wt + "\n";
body2 += "PR1 claim: " + pr1_json + "\n";
body2 += "PR2 claim: " + pr2_json + "\n";
body2 += "Gate1 result: claude=" + g1_out.claude_verdict + " pi=" + g1_out.pi_verdict + "\n";
body2 += "Ship checklist:\n";
body2 += "- Companion user-env + inject + tests green\n";
body2 += "- Extension UI + WS; no secret in LLM; redact paths\n";
body2 += "- ADR §12.1 all addressed\n";
body2 += "- No regression shell L2 / MCP PATH\n";
body2 += "End VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT (blockers only for REJECT)\n";

let g2p = "";
g2p += "Run FINAL dual external Claude+Pi ship review Gate2.\n";
g2p += "1) Write /tmp/cmspark-review-user-env-g2.md with:\n-----BEGIN-----\n" + body2 + "\n-----END-----\n";
g2p += "2) cd " + wt + " && bash scripts/dual-external-review.sh user-env-g2 /tmp/cmspark-review-user-env-g2.md " + base_commit + "\n";
g2p += "3) Read newest user-env-g2-verdict-*.json + reviews. Return dual_schema fields + must_fix.\n";
let g2 = agent(g2p, #{
    label: "gate2-dual-external",
    capability_mode: "all",
    output_schema: dual_schema,
});
if g2 == () || !g2.success || g2.output == () {
    await_user("verification", "Gate2 dual external failed (infra). Fix then resume.");
}
let g2_out = g2.output;
log("Gate2 claude=" + g2_out.claude_verdict + " pi=" + g2_out.pi_verdict);

// ---------- Gate2 Fix ----------
phase("Gate2-Fix");
let g2_must = [];
if g2_out.must_fix != () {
    g2_must = g2_out.must_fix;
}
if g2_out.both_approve != true || g2_must.len() > 0 {
    let fix2_p = "";
    fix2_p += "WORKTREE=" + wt + ". Apply Gate2 findings (blockers first).\n";
    fix2_p += "both_approve=" + g2_out.both_approve.to_string() + " must_fix=" + json_encode(g2_must) + "\n";
    fix2_p += "Read " + g2_out.claude_path + " " + g2_out.pi_path + "\n";
    fix2_p += "Re-run companion user-env tests + any extension checks. Commit. done=true if green.\n";
    let fix2 = agent(fix2_p, #{
        label: "gate2-fix",
        capability_mode: "all",
        output_schema: impl_schema,
    });
    let _f2 = fix2;
    if g2_out.both_approve != true {
        await_user("verification", "Gate2 not dual-approved. Inspect docs/audit/reviews/user-env-g2* and fix manually or resume after push fixes.");
    }
} else {
    log("Gate2 clean approve");
}

// ---------- Verify + ship note ----------
phase("Verify");
let ver_p = "";
ver_p += "WORKTREE=" + wt + ". Final verify ADR-019 ship readiness.\n";
ver_p += "1) Run companion tests for user-env (and broader if quick).\n";
ver_p += "2) Confirm files exist: companion/src/user-env.ts, shell inject, mcp inject, Settings UI section.\n";
ver_p += "3) Write ship note to " + wt + "/docs/audit/reviews/user-env-ship-note.md with: what shipped, gates verdicts, residual risks (argv/stdout), how to use DATAYES_TOKEN in Settings.\n";
ver_p += "4) Update ADR-019 status line if needed (实现中/已交付).\n";
ver_p += "5) Return ship_note_path, tests_ok, summary, remaining debt.\n";
ver_p += "Do NOT push to origin unless already tracking and user said so — do not force-push.\n";
let ver = agent(ver_p, #{
    label: "verify-ship",
    capability_mode: "all",
    output_schema: ship_schema,
});

let ship_path = wt + "/docs/audit/reviews/user-env-ship-note.md";
let tests_ok = false;
let summary = "verify incomplete";
if ver != () && ver.success && ver.output != () {
    if ver.output.ship_note_path != () { ship_path = ver.output.ship_note_path; }
    if ver.output.tests_ok == true { tests_ok = true; }
    if ver.output.summary != () { summary = ver.output.summary; }
}

// Scratch report for UI
let report = "";
report += "# ADR-019 user-env workflow result\n\n";
report += "- worktree: " + wt + "\n";
report += "- Gate1: " + g1_out.claude_verdict + " / " + g1_out.pi_verdict + " both=" + g1_out.both_approve.to_string() + "\n";
report += "- Gate2: " + g2_out.claude_verdict + " / " + g2_out.pi_verdict + " both=" + g2_out.both_approve.to_string() + "\n";
report += "- tests_ok: " + tests_ok.to_string() + "\n";
report += "- ship_note: " + ship_path + "\n";
report += "- summary: " + summary + "\n";
let report_path = write_scratch_file("user-env-workflow-report.md", report);

complete(#{
    summary: summary,
    worktree: wt,
    ship_note: ship_path,
    tests_ok: tests_ok,
    gate1_claude: g1_out.claude_verdict,
    gate1_pi: g1_out.pi_verdict,
    gate2_claude: g2_out.claude_verdict,
    gate2_pi: g2_out.pi_verdict,
    report: report_path,
});
