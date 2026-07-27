let meta = #{
    name: "multi-agent-finish-with-reviews",
    description: "Finish ADR-015 remaining work with Claude+Pi review gates at each milestone",
    when_to_use: "Complete multi-agent P1/P2 after FleetStrip; dual external review at gates",
    phases: [
        #{ title: "Inventory", detail: "Diff vs ADR-015 remaining" },
        #{ title: "Implement", detail: "Fill remaining gaps in worktree" },
        #{ title: "Gate1-Review", detail: "Claude + Pi on P1 remaining delta" },
        #{ title: "Gate1-Fix", detail: "Apply must-fix from gate 1" },
        #{ title: "P2-Polish", detail: "Extension queue, docs, tests" },
        #{ title: "Gate2-Review", detail: "Claude + Pi final ship review" },
        #{ title: "Gate2-Fix", detail: "Final fixes + verify tests" },
        #{ title: "Ship-Note", detail: "Write ship summary artifact" },
    ],
};

let inv_schema = #{
    "type": "object",
    "required": ["done", "todo", "priority_order"],
    "properties": #{
        "done": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "todo": #{ "type": "array", "maxItems": 15, "items": #{ "type": "string" } },
        "priority_order": #{ "type": "array", "maxItems": 10, "items": #{ "type": "string" } },
    },
};

let impl_schema = #{
    "type": "object",
    "required": ["changed_files", "summary", "tests_run"],
    "properties": #{
        "changed_files": #{ "type": "array", "maxItems": 30, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "tests_run": #{ "type": "string" },
        "blocked": #{ "type": "string" },
    },
};

let review_schema = #{
    "type": "object",
    "required": ["verdict", "must_fix", "notes", "artifact_path"],
    "properties": #{
        "verdict": #{ "type": "string" },
        "must_fix": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "notes": #{ "type": "string" },
        "artifact_path": #{ "type": "string" },
    },
};

let wt = if args == () { () } else { args.worktree };
if wt == () {
    pause("verification", "Pass args.worktree = absolute path to feat/multi-agent-p0 worktree");
}

// ---------- Inventory ----------
phase("Inventory");
let inv_p = "";
inv_p += "WORKTREE=" + wt + ". Read docs/adr/015-multi-agent-orchestrator-tab-lock.md and git log/diff. ";
inv_p += "List what is DONE for multi-agent P0/P1/P2 and what remains. ";
inv_p += "Use grep/read_file: companion/src/orchestrator/*, FleetStrip, server.ts L2, single-flight, l2-admission. ";
inv_p += "priority_order: max 8 remaining items highest first. Do not implement.";
let inv = agent(inv_p, #{
    label: "inventory",
    capability_mode: "read-only",
    output_schema: inv_schema,
});
let inv_json = if inv != () && inv.success { json_encode(inv.output) } else { "{}" };
log("Inventory done");

// ---------- Implement remaining ----------
phase("Implement");
let impl_p = "";
impl_p += "You implement remaining ADR-015 multi-agent work in WORKTREE: " + wt + " ONLY. ";
impl_p += "Inventory JSON: " + inv_json + " ";
impl_p += "MUST ensure if missing: (1) L2 FIFO admission wired in createToolExecutor with release in finally; ";
impl_p += "(2) shell_exec/netsec_port_scan process single-flight; ";
impl_p += "(3) unit tests for l2-admission + single-flight; ";
impl_p += "(4) extension BrowserBridge per-tab serialize queue; ";
impl_p += "(5) Cockpit shows fleet counts; FleetStrip already exists; ";
impl_p += "(6) update ADR-015 status notes for shipped items. ";
impl_p += "Run: cd WORKTREE/companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/orchestrator-*.test.js ";
impl_p += "Do NOT push. Commit if tests pass with clear message. ";
impl_p += "Return changed_files, summary, tests_run output snippet.";
let impl = agent(impl_p, #{
    label: "implement-remaining",
    capability_mode: "all",
    output_schema: impl_schema,
});
let impl_json = if impl != () && impl.success { json_encode(impl.output) } else { "{\"summary\":\"impl failed\"}" };
log("Implement phase complete");

// ---------- Gate 1: Claude + Pi ----------
phase("Gate1-Review");
let g1_jobs = [];
let g1_claude = "";
g1_claude += "WORKTREE=" + wt + ". Run dual review GATE 1 (P1 remaining: L2 FIFO, single-flight, fleet UI). ";
g1_claude += "Write review to WORKTREE/docs/audit/reviews/multi-agent-gate1-claude.md using tools. ";
g1_claude += "Prefer: claude -p with permission bypass if available, else self-review thoroughly. ";
g1_claude += "Read ADR-015, orchestrator/*, server.ts L2+shell paths, FleetStrip, CockpitApp. ";
g1_claude += "Verdict APPROVE|APPROVE_WITH_CHANGES|REJECT + must_fix list (ordered). ";
g1_claude += "artifact_path = absolute path written.";
g1_jobs.push(#{
    prompt: g1_claude,
    label: "gate1-claude",
    capability_mode: "all",
    output_schema: review_schema,
});
let g1_pi = "";
g1_pi += "WORKTREE=" + wt + ". Adversarial GATE 1 review as Pi-style. ";
g1_pi += "Write WORKTREE/docs/audit/reviews/multi-agent-gate1-pi.md. ";
g1_pi += "Use `pi -p --mode text --no-session` if available else self-review. ";
g1_pi += "Focus: L2 admission deadlocks, single-flight leaks, TAB_LOCKED races, Confirm Center stop targets. ";
g1_pi += "Verdict + must_fix. artifact_path absolute.";
g1_jobs.push(#{
    prompt: g1_pi,
    label: "gate1-pi",
    capability_mode: "all",
    output_schema: review_schema,
});
let g1 = parallel(g1_jobs);
let g1_must = [];
let gi = 0;
while gi < g1.len() {
    let r = g1[gi];
    if r != () && r.success && r.output != () && r.output.must_fix != () {
        let j = 0;
        while j < r.output.must_fix.len() {
            g1_must.push(r.output.must_fix[j]);
            j += 1;
        }
    }
    gi += 1;
}
log("Gate1 must_fix count=" + g1_must.len().to_string());

// ---------- Gate 1 Fix ----------
phase("Gate1-Fix");
let fix1_p = "";
fix1_p += "WORKTREE=" + wt + ". Apply Gate1 must_fix only: " + json_encode(g1_must) + " ";
fix1_p += "Read gate1 review files under docs/audit/reviews/multi-agent-gate1-*.md if present. ";
fix1_p += "Implement fixes, run orchestrator unit tests, commit if green. ";
fix1_p += "If must_fix empty, verify tests still pass and summarize no-op.";
let fix1 = agent(fix1_p, #{
    label: "gate1-fix",
    capability_mode: "all",
    output_schema: impl_schema,
});

// ---------- P2 polish ----------
phase("P2-Polish");
let p2_p = "";
p2_p += "WORKTREE=" + wt + ". P2 polish only: ensure extension tab queue works; ";
p2_p += "document shared-observer as deferred in ADR if not implementing; ";
p2_p += "add/adjust mission-pack or multi-agent usage note section if missing; ";
p2_p += "keep auto-spawn NOT implemented (explicit only). ";
p2_p += "Run tests. Commit if meaningful changes.";
let p2 = agent(p2_p, #{
    label: "p2-polish",
    capability_mode: "all",
    output_schema: impl_schema,
});

// ---------- Gate 2 final reviews ----------
phase("Gate2-Review");
let g2_jobs = [];
let g2c = "";
g2c += "WORKTREE=" + wt + ". FINAL ship review GATE 2 for multi-agent ADR-015 P0+P1+P2-lite. ";
g2c += "Write WORKTREE/docs/audit/reviews/multi-agent-gate2-claude.md. ";
g2c += "Use claude CLI if available. Verdict ship/no-ship. must_fix only blockers. ";
g2c += "Compare against ADR-015 locked decisions (SOFT mutex, evaluate allowed, max 5, host chrome gate, HITL inject).";
g2_jobs.push(#{ prompt: g2c, label: "gate2-claude", capability_mode: "all", output_schema: review_schema });
let g2p = "";
g2p += "WORKTREE=" + wt + ". FINAL adversarial GATE 2 as Pi. ";
g2p += "Write WORKTREE/docs/audit/reviews/multi-agent-gate2-pi.md. ";
g2p += "pi CLI if available. Focus false exclusivity, cancel/lease drain, L2 admission leaks.";
g2_jobs.push(#{ prompt: g2p, label: "gate2-pi", capability_mode: "all", output_schema: review_schema });
let g2 = parallel(g2_jobs);
let g2_must = [];
let gj = 0;
while gj < g2.len() {
    let r = g2[gj];
    if r != () && r.success && r.output != () && r.output.must_fix != () {
        let j = 0;
        while j < r.output.must_fix.len() {
            g2_must.push(r.output.must_fix[j]);
            j += 1;
        }
    }
    gj += 1;
}
log("Gate2 must_fix count=" + g2_must.len().to_string());

// ---------- Gate 2 Fix ----------
phase("Gate2-Fix");
let fix2_p = "";
fix2_p += "WORKTREE=" + wt + ". Apply Gate2 BLOCKER must_fix only: " + json_encode(g2_must) + " ";
fix2_p += "Run full companion orchestrator tests + tsc --noEmit. Commit. ";
fix2_p += "If empty must_fix, still re-run tests and report.";
let fix2 = agent(fix2_p, #{
    label: "gate2-fix",
    capability_mode: "all",
    output_schema: impl_schema,
});

// ---------- Ship note ----------
phase("Ship-Note");
let ship_p = "";
ship_p += "WORKTREE=" + wt + ". Write docs/decisions/v1.3/multi-agent-ship-summary-2026-07-27.md summarizing: ";
ship_p += "P0/P1/P2-lite delivered, deferred items, gate1/gate2 verdicts, how to test FleetStrip+locks. ";
ship_p += "Also write scratch multi-agent-ship.md with short bullet summary. Commit docs if needed.";
let ship = agent(ship_p, #{
    label: "ship-summary",
    capability_mode: "all",
    output_schema: #{
        "type": "object",
        "required": ["path", "headline"],
        "properties": #{
            "path": #{ "type": "string" },
            "headline": #{ "type": "string" },
        },
    },
});

let report = "# Multi-agent finish workflow\n\n";
report += "## Inventory\n" + inv_json + "\n\n";
report += "## Implement\n" + impl_json + "\n\n";
report += "## Gate1 must_fix\n" + json_encode(g1_must) + "\n\n";
report += "## Gate2 must_fix\n" + json_encode(g2_must) + "\n\n";
if ship != () && ship.success && ship.output != () {
    report += "## Ship\n" + ship.output.headline + "\n" + ship.output.path + "\n";
}
let path = write_scratch_file("multi-agent-finish-report.md", report);
complete(#{
    summary: "multi-agent finish workflow complete",
    path: path,
    gate1_must_fix: g1_must.len(),
    gate2_must_fix: g2_must.len(),
    worktree: wt,
});
