let meta = #{
    name: "mission-board-with-gates",
    description: "MissionBoard ADR-016 + P0 implementation with Claude/Pi gates at each decision point",
    when_to_use: "After cairn-mission-board-plan-synthesis; implement MissionBoard with dual external review gates",
    phases: [
        #{ title: "ADR-Draft", detail: "Write ADR-016 from synthesis locks" },
        #{ title: "Gate-ADR", detail: "Claude + Pi review ADR-016" },
        #{ title: "ADR-Revise", detail: "Apply ADR must_fix" },
        #{ title: "Impl-Kernel", detail: "Schema + Thread.mission_board + tests" },
        #{ title: "Impl-Handback-Pack", detail: "handback validation + AppSec pack light edit" },
        #{ title: "Gate-Code", detail: "Claude + Pi review P0 code" },
        #{ title: "Code-Fix", detail: "Apply code must_fix" },
        #{ title: "Verify", detail: "Tests + ship note" },
    ],
};

let draft_schema = #{
    "type": "object",
    "required": ["adr_path", "summary"],
    "properties": #{
        "adr_path": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "open_risks": #{ "type": "array", "maxItems": 8, "items": #{ "type": "string" } },
    },
};

let review_schema = #{
    "type": "object",
    "required": ["verdict", "must_fix", "artifact_path", "notes"],
    "properties": #{
        "verdict": #{ "type": "string" },
        "must_fix": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "artifact_path": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let impl_schema = #{
    "type": "object",
    "required": ["changed_files", "summary", "tests_run"],
    "properties": #{
        "changed_files": #{ "type": "array", "maxItems": 40, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "tests_run": #{ "type": "string" },
        "blocked": #{ "type": "string" },
    },
};

let wt = if args == () { () } else { args.worktree };
if wt == () {
    pause("verification", "Pass args.worktree = absolute path to git worktree (prefer multi-agent-p0)");
}

let synth = wt + "/docs/decisions/v1.3/cairn-mission-board-plan-synthesis-2026-07-27.md";
let brief = wt + "/docs/decisions/v1.3/cairn-inspired-mission-board-brief-2026-07-27.md";

// Ensure synthesis exists in worktree (copy instructions in agent if missing)
phase("ADR-Draft");
let adr_p = "";
adr_p += "WORKTREE=" + wt + ". You author ADR-016 MissionBoard. ";
adr_p += "MUST follow locks in: " + synth + " (PRIMARY). Also read " + brief + " and ADR-014/015 if present. ";
adr_p += "Write FULL file to WORKTREE/docs/adr/016-mission-board.md. ";
adr_p += "Required sections: Context, Decision (thread.mission_board, Fact/Intent/Hint schema draft, trust tiers, complete=L2 HITL, fold handback, audit, non-goals), Consequences, Mapping to Pack/multi-agent, Phase plan. ";
adr_p += "Chinese or bilingual OK. Status: Proposed. Do NOT implement product code yet. ";
adr_p += "If synthesis file missing, also check /Users/huchen/Projects/cmspark/docs/decisions/v1.3/ and copy into worktree. ";
adr_p += "Return adr_path absolute + summary + open_risks.";
let adr = agent(adr_p, #{
    label: "adr016-draft",
    capability_mode: "all",
    output_schema: draft_schema,
});
let adr_path = wt + "/docs/adr/016-mission-board.md";
if adr != () && adr.success && adr.output != () && adr.output.adr_path != () {
    adr_path = adr.output.adr_path;
}
log("ADR draft path=" + adr_path);

// Gate ADR: Claude + Pi
phase("Gate-ADR");
let g_jobs = [];
let gc = "";
gc += "DECISION GATE: Review ADR-016 for CMspark MissionBoard. ";
gc += "Read: " + adr_path + " and " + synth + ". ";
gc += "Write full adversarial review to " + wt + "/docs/audit/reviews/mission-board-adr016-gate-claude.md ";
gc += "Use claude -p --permission-mode bypassPermissions if available, else deep self-review. ";
gc += "Verdict APPROVE|APPROVE_WITH_CHANGES|REJECT + must_fix (only decisions that block implementation). ";
gc += "Check: AGPL safety, trust tiers, complete HITL, thread metadata, conflict with ADR-015, over-scope. ";
gc += "artifact_path = absolute path written.";
g_jobs.push(#{ prompt: gc, label: "gate-adr-claude", capability_mode: "all", output_schema: review_schema });
let gp = "";
gp += "DECISION GATE: Adversarial review ADR-016 MissionBoard as Pi. ";
gp += "Read: " + adr_path + " and " + synth + ". ";
gp += "Write to " + wt + "/docs/audit/reviews/mission-board-adr016-gate-pi.md ";
gp += "Use pi -p --mode text --no-session if available. ";
gp += "Focus: persistence, prompt-injection via Facts, complete reward hack, tool surface bloat. ";
gp += "Verdict + must_fix. artifact_path absolute.";
g_jobs.push(#{ prompt: gp, label: "gate-adr-pi", capability_mode: "all", output_schema: review_schema });
let g1 = parallel(g_jobs);
let must1 = [];
let i = 0;
while i < g1.len() {
    let r = g1[i];
    if r != () && r.success && r.output != () && r.output.must_fix != () {
        let j = 0;
        while j < r.output.must_fix.len() {
            must1.push(r.output.must_fix[j]);
            j += 1;
        }
    }
    i += 1;
}
log("Gate-ADR must_fix=" + must1.len().to_string());

// Revise ADR
phase("ADR-Revise");
let rev = "";
rev += "WORKTREE=" + wt + ". Revise " + adr_path + " applying must_fix only: " + json_encode(must1) + " ";
rev += "Read gate reviews under docs/audit/reviews/mission-board-adr016-gate-*.md. ";
rev += "Update ADR status to Accepted if must_fix empty or all addressed. Commit docs if tests not needed. ";
rev += "Return summary of changes.";
let adr2 = agent(rev, #{
    label: "adr016-revise",
    capability_mode: "all",
    output_schema: draft_schema,
});

// Implement kernel
phase("Impl-Kernel");
let k = "";
k += "WORKTREE=" + wt + ". IMPLEMENT MissionBoard P0 kernel per ACCEPTED ADR-016 and synthesis. ";
k += "1) companion/src/board/schema.ts (or orchestrator/board-schema.ts): Zod/TS MissionBoard, Fact, Intent, Hint, trust tiers. ";
k += "2) thread-manager: mission_board field on Thread; load/save defaults. ";
k += "3) board service: readBoard, applyHandbackPayload, addHint, ensureBoard. ";
k += "4) unit tests: valid/invalid facts, default trust, reject prose-only handback structure. ";
k += "5) appendCapabilityAudit on board mutations. ";
k += "Do NOT implement full multi-agent intent claim yet. ";
k += "Run: cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/*board* .test-dist/tests/orchestrator-*.test.js 2>/dev/null; ensure new tests pass. ";
k += "Commit with clear message. Return changed_files, summary, tests_run.";
let impl_k = agent(k, #{
    label: "impl-board-kernel",
    capability_mode: "all",
    output_schema: impl_schema,
});

// Handback + pack
phase("Impl-Handback-Pack");
let h = "";
h += "WORKTREE=" + wt + ". Continue P0: ";
h += "1) Enrich collect_handback (server.ts) to parse structured board payload; on board-mode pack or mission_board present, reject free-form-only with recoverable HANDBACK_MISSING_STRUCTURE. ";
h += "2) Light-edit appsec-prd-review pack system_prompt_append to require Fact/Intent JSON shape matching schema. ";
h += "3) Optional board_read tool for orchestrator allowlist if needed. ";
h += "4) Tests for handback path. Commit. Return changed_files, summary, tests_run.";
let impl_h = agent(h, #{
    label: "impl-handback-pack",
    capability_mode: "all",
    output_schema: impl_schema,
});

// Gate code
phase("Gate-Code");
let c_jobs = [];
let cc = "";
cc += "CODE GATE: Review MissionBoard P0 implementation in " + wt + ". ";
cc += "Read ADR-016, companion board modules, thread-manager, collect_handback, appsec pack, tests. ";
cc += "Write " + wt + "/docs/audit/reviews/mission-board-p0-code-gate-claude.md ";
cc += "Use claude CLI if available. Verdict + must_fix blockers only. Focus security (injection via facts), schema enforcement, ADR-015 regression risk.";
c_jobs.push(#{ prompt: cc, label: "gate-code-claude", capability_mode: "all", output_schema: review_schema });
let cp = "";
cp += "CODE GATE: Pi adversarial review of MissionBoard P0 in " + wt + ". ";
cp += "Write " + wt + "/docs/audit/reviews/mission-board-p0-code-gate-pi.md ";
cp += "pi CLI if available. Focus: false structure, complete without HITL, handback bypass, AGPL contamination.";
c_jobs.push(#{ prompt: cp, label: "gate-code-pi", capability_mode: "all", output_schema: review_schema });
let g2 = parallel(c_jobs);
let must2 = [];
let k2 = 0;
while k2 < g2.len() {
    let r = g2[k2];
    if r != () && r.success && r.output != () && r.output.must_fix != () {
        let j = 0;
        while j < r.output.must_fix.len() {
            must2.push(r.output.must_fix[j]);
            j += 1;
        }
    }
    k2 += 1;
}
log("Gate-Code must_fix=" + must2.len().to_string());

// Fix code
phase("Code-Fix");
let fx = "";
fx += "WORKTREE=" + wt + ". Apply CODE GATE must_fix only: " + json_encode(must2) + " ";
fx += "Read mission-board-p0-code-gate-*.md. Fix, re-run board+orchestrator unit tests, commit. ";
fx += "If empty must_fix, re-run tests and report green.";
let fix = agent(fx, #{
    label: "code-fix",
    capability_mode: "all",
    output_schema: impl_schema,
});

// Verify + note
phase("Verify");
let v = "";
v += "WORKTREE=" + wt + ". Final verify: tsc + board tests + orchestrator tests. ";
v += "Write docs/decisions/v1.3/mission-board-p0-ship-note-2026-07-27.md with: what shipped, gate verdicts, how to try AppSec board, deferred. ";
v += "Commit docs. Return summary.";
let ver = agent(v, #{
    label: "verify-ship-note",
    capability_mode: "all",
    output_schema: impl_schema,
});

let report = "# MissionBoard workflow with gates\n\n";
report += "worktree: " + wt + "\n";
report += "adr: " + adr_path + "\n";
report += "gate_adr_must_fix: " + json_encode(must1) + "\n";
report += "gate_code_must_fix: " + json_encode(must2) + "\n";
if impl_k != () && impl_k.success { report += "kernel: " + impl_k.output.summary + "\n"; }
if impl_h != () && impl_h.success { report += "handback: " + impl_h.output.summary + "\n"; }
if fix != () && fix.success { report += "fix: " + fix.output.summary + "\n"; }
if ver != () && ver.success { report += "verify: " + ver.output.summary + "\n"; }
let path = write_scratch_file("mission-board-gates-report.md", report);
complete(#{
    summary: "MissionBoard workflow complete",
    path: path,
    worktree: wt,
    adr_path: adr_path,
    gate_adr_must_fix: must1.len(),
    gate_code_must_fix: must2.len(),
});
