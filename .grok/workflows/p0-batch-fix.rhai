let meta = #{
    name: "p0-batch-fix",
    description: "P0 batch fix: design → implement → adversarial verify → SEPARATE Claude Code + Pi dual review → gate",
    when_to_use: "Implement diagnosis P0 batches with adversarial + external Claude/Pi re-review gates",
    phases: [
        #{ title: "Setup", detail: "branch + batch scope" },
        #{ title: "Design", detail: "precise patch plan" },
        #{ title: "Implement", detail: "apply code + tests" },
        #{ title: "Adversarial", detail: "internal skeptic panel" },
        #{ title: "ExternalReview", detail: "Claude Code + Pi as separate processes" },
        #{ title: "Gate", detail: "both APPROVE or fix loop / user pause" },
        #{ title: "VerifyBuild", detail: "typecheck / targeted tests" },
    ],
};

// ---------- schemas ----------
let design_schema = #{
    "type": "object",
    "required": ["batch", "plan", "files", "tests", "acceptance"],
    "properties": #{
        "batch": #{ "type": "string" },
        "plan": #{ "type": "string" },
        "files": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "tests": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 15 },
        "acceptance": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 15 },
        "risks": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["batch", "summary", "files_changed", "tests_added", "done"],
    "properties": #{
        "batch": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "tests_added": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 15 },
        "done": #{ "type": "boolean" },
        "notes": #{ "type": "string" },
        "diff_stat": #{ "type": "string" },
    },
};

let adv_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "maxItems": 12, "items": #{
            "type": "object",
            "required": ["id", "file", "issue"],
            "properties": #{
                "id": #{ "type": "string" },
                "file": #{ "type": "string" },
                "issue": #{ "type": "string" },
                "severity": #{ "type": "string" },
            },
        }},
        "summary": #{ "type": "string" },
        "residual_risks": #{ "type": "string" },
    },
};

let external_schema = #{
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
    },
};

let build_schema = #{
    "type": "object",
    "required": ["ok", "commands", "log"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "commands": #{ "type": "array", "items": #{ "type": "string" } },
        "log": #{ "type": "string" },
    },
};

// ---------- args ----------
let batch = if args == () { () } else { args.batch };
if batch == () {
    pause("verification", "Pass args.batch: one of P0-A | P0-B | P0-C | P0-D");
}
let max_rounds = 3;
if args != () && args.max_rounds != () {
    max_rounds = args.max_rounds;
}
let base_commit = "HEAD";
if args != () && args.base_commit != () {
    base_commit = args.base_commit;
}

// Batch scope catalog (from diagnosis-fanout 2026-07-25)
fn batch_spec(b) {
    if b == "P0-A" {
        let s = "";
        s += "P0-A Security same-day (3 fixes):\n";
        s += "1) SEC-1: chrome-extension/src/background/browser-bridge.ts — JSON.stringify (or CDP DOM API) for ALL selectors in getPageHTML/waitForSelector/getElementCenter; never interpolate raw selector into Runtime.evaluate. Add regression test in chrome-extension/tests.\n";
        s += "2) SRV-1: companion/src/server.ts configEvents CONFIG_CHANGE fanout — use broadcastToClients (authenticated only); redact mcp.servers env/headers before send. Add unauth-negative test if feasible.\n";
        s += "3) XC-Integration-1: chrome-extension/src/background/index.ts security.confirmation.response — forward nonce_response, add_to_thread_whitelist (boolean), stop_thread if present, keep add_to_whitelist. Companion already expects these fields (server.ts ~1481-1515).\n";
        s += "Do NOT expand scope to P0-B/C/D. Atomic small patches + tests.\n";
        return s;
    }
    if b == "P0-B" {
        let s = "";
        s += "P0-B Stop/stream/thread lifecycle:\n";
        s += "1) chat.abort also flips computerTaskAbort (thread-scoped or global as existing design allows) + optional tool.cancel to extension.\n";
        s += "2) useWebSocket: gate chat.token/done/error on msg.thread_id===activeThreadRef; clear streamingRef on SET_ACTIVE_THREAD.\n";
        s += "3) llm/adapter shouldStop / inter-tool abort: deleteMessagesFrom orphans; history rebuild skip unpaired tool rows; do NOT chat.done-commit partial stream after terminal chat.error.\n";
        return s;
    }
    if b == "P0-C" {
        let s = "";
        s += "P0-C Computer gates:\n";
        s += "1) reL2 session-trust must NOT auto-approve danger_detected / experimental_suggestion (TinyClick G4); fix false-green computer-executor tests.\n";
        s += "2) Darwin cuInject client→screen via window bounds + offset; fixture/test if possible.\n";
        return s;
    }
    if b == "P0-D" {
        let s = "";
        s += "P0-D Release packaging:\n";
        s += "1) package.sh/Makefile/release hard-require build:host + cmspark-host/tray presence or fail.\n";
        s += "2) Stage TinyClick/ORT and host-scripts-win OR explicit feature-cut notes in release body.\n";
        s += "3) Fix release.yml body if it still claims WS auth deferred.\n";
        return s;
    }
    "UNKNOWN BATCH"
}

let spec = batch_spec(batch);
if spec == "UNKNOWN BATCH" {
    pause("verification", "Unknown batch. Use P0-A | P0-B | P0-C | P0-D");
}

// ===================== SETUP =====================
phase("Setup");
log("P0 batch-fix starting for " + batch);

let setup_p = "";
setup_p += "You are the release engineer for CMspark monorepo at workspace root.\n";
setup_p += "Task: prepare a git working branch for batch " + batch + ".\n";
setup_p += "1) Run: git status; git rev-parse --short HEAD\n";
setup_p += "2) Create/switch branch fix/p0-" + batch + " (lowercase, e.g. fix/p0-p0-a → prefer fix/diagnosis-p0-a). Use: git checkout -B fix/diagnosis-" + batch + "\n";
setup_p += "3) Do NOT commit yet. Do NOT push. Do NOT reset hard or discard user work.\n";
setup_p += "4) Return a one-line summary of branch name and HEAD.\n";
let setup = agent(setup_p, #{
    label: "setup:" + batch,
    capability_mode: "execute",
});
if setup == () || !setup.success {
    log("Setup agent failed — continuing on current branch");
}

// ===================== DESIGN =====================
phase("Design");
let design_p = "";
design_p += "You are a staff engineer writing a PRECISE patch plan for CMspark.\n";
design_p += "READ the audit: docs/audit/diagnosis-fanout-2026-07-25.md and summary JSON if present.\n";
design_p += "READ current source for every file you will touch BEFORE proposing edits.\n";
design_p += "Batch scope (HARD bound — do not expand):\n";
design_p += spec + "\n";
design_p += "Deliver structured plan: files, tests, acceptance criteria, risks.\n";
design_p += "Cite file:line of CURRENT bugs. Prefer minimal diffs.\n";

let design = agent(design_p, #{
    label: "design:" + batch,
    capability_mode: "read-only",
    output_schema: design_schema,
});
if design == () || !design.success || design.output == () {
    pause("infra", "Design agent failed for " + batch + " — resume after investigating");
}
log("Design ready for " + batch);
let design_json = json_encode(design.output);

// ===================== FIX LOOP =====================
let round = 0;
let both_ok = false;
let last_impl = ();
let last_adv = ();
let last_ext = ();
let feedback = "";

while round < max_rounds {
    round += 1;
    log("=== Round " + round.to_string() + "/" + max_rounds.to_string() + " for " + batch + " ===");

    // ----- Implement -----
    phase("Implement");
    let imp_p = "";
    imp_p += "You are the implementer for CMspark batch " + batch + " (round " + round.to_string() + ").\n";
    imp_p += "STRICT SCOPE:\n" + spec + "\n";
    imp_p += "Approved design JSON:\n" + design_json + "\n";
    if feedback != "" {
        imp_p += "\nPREVIOUS ROUND FEEDBACK (must address):\n" + feedback + "\n";
    }
    imp_p += "METHOD:\n";
    imp_p += "1) Read each target file fully around the bug sites.\n";
    imp_p += "2) Apply minimal patches with search_replace/write. No drive-by refactors.\n";
    imp_p += "3) Add/adjust tests that FAIL without the fix and PASS with it.\n";
    imp_p += "4) Run targeted tests (node --test or package scripts) for touched areas.\n";
    imp_p += "5) git diff --stat and list files_changed.\n";
    imp_p += "6) Do NOT git commit or push.\n";
    imp_p += "Set done=true only if acceptance criteria are met.\n";

    let impl = agent(imp_p, #{
        label: "implement:" + batch + ":r" + round.to_string(),
        capability_mode: "all",
        output_schema: implement_schema,
    });
    if impl == () || !impl.success || impl.output == () {
        feedback = "Implement agent failed or returned empty. Re-apply carefully.";
        log("Implement failed round " + round.to_string());
        continue;
    }
    last_impl = impl.output;
    log("Implement summary: " + impl.output.summary);

    // ----- Internal adversarial -----
    phase("Adversarial");
    let adv_jobs = [];
    let a1 = "";
    a1 += "ADVERSARIAL SKEPTIC (security+correctness) for batch " + batch + ".\n";
    a1 += "Default pass=false. Only pass=true if you independently read the DIFF and code and cannot find blocking issues.\n";
    a1 += "Scope: " + spec + "\n";
    a1 += "Implementer claim: " + json_encode(impl.output) + "\n";
    a1 += "METHOD: git diff; read every changed file; try to refute the fix (bypass paths, missing redaction, incomplete field forward, tests that can't fail).\n";
    a1 += "Return blocking[] with file:line. pass=true only if zero blocking.\n";
    adv_jobs.push(#{
        label: "adv-sec:" + batch + ":r" + round.to_string(),
        capability_mode: "read-only",
        output_schema: adv_schema,
        prompt: a1,
    });

    let a2 = "";
    a2 += "ADVERSARIAL SKEPTIC (tests+regression) for batch " + batch + ".\n";
    a2 += "Default pass=false. Check tests actually assert the fixed behavior; check no regressions in neighboring code.\n";
    a2 += "Scope: " + spec + "\n";
    a2 += "Implementer claim: " + json_encode(impl.output) + "\n";
    a2 += "METHOD: git diff; read new/changed tests; judge authenticity (not auto-pass mocks).\n";
    adv_jobs.push(#{
        label: "adv-test:" + batch + ":r" + round.to_string(),
        capability_mode: "read-only",
        output_schema: adv_schema,
        prompt: a2,
    });

    let adv_results = parallel(adv_jobs);
    let adv_pass = true;
    let adv_blocks = [];
    let adv_summaries = "";
    for ar in adv_results {
        if ar == () || !ar.success || ar.output == () {
            adv_pass = false;
            adv_summaries += "adversarial agent failed; treat as fail. ";
        } else {
            if ar.output.pass != true {
                adv_pass = false;
            }
            if ar.output.blocking != () {
                for bitem in ar.output.blocking {
                    adv_blocks.push(bitem);
                }
            }
            adv_summaries += ar.output.summary + " | ";
        }
    }
    last_adv = #{
        pass: adv_pass,
        blocking: adv_blocks,
        summary: adv_summaries,
    };
    log("Adversarial pass=" + adv_pass.to_string() + " blocks=" + adv_blocks.len().to_string());

    // If internal adversarial fails, skip external (save cost) and feed back
    if !adv_pass {
        feedback = "INTERNAL ADVERSARIAL FAILED:\n" + json_encode(last_adv);
        log("Skipping external review this round — fix adversarial blockers first");
        continue;
    }

    // ----- External dual review: SEPARATE Claude Code + Pi processes -----
    // REQUIRED: only after adversarial ends successfully.
    phase("ExternalReview");
    log("Adversarial passed — launching SEPARATE Claude Code + Pi Agent reviews");

    let review_prompt_body = "";
    review_prompt_body += "# External dual review request\n";
    review_prompt_body += "Batch: " + batch + " round " + round.to_string() + "\n";
    review_prompt_body += "Internal adversarial: PASSED\n";
    review_prompt_body += "Design: " + design_json + "\n";
    review_prompt_body += "Implementer: " + json_encode(impl.output) + "\n";
    review_prompt_body += "Adversarial summary: " + adv_summaries + "\n";
    review_prompt_body += "Scope bound:\n" + spec + "\n";
    review_prompt_body += "Confirm the fixes fully address SEC/SRV/integration items in scope, tests are real, no new holes.\n";
    review_prompt_body += "End with VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";

    // Write prompt via implementer-capable agent that only writes the prompt file + runs helper
    let ext_p = "";
    ext_p += "You must run the DUAL EXTERNAL REVIEW helper. Do not re-implement code.\n";
    ext_p += "1) Write the following content EXACTLY to /tmp/cmspark-review-" + batch + "-r" + round.to_string() + ".md using the write tool or shell heredoc:\n";
    ext_p += "-----BEGIN PROMPT-----\n";
    ext_p += review_prompt_body;
    ext_p += "\n-----END PROMPT-----\n";
    ext_p += "2) Run this SINGLE command (it launches Claude Code and Pi as TWO separate processes):\n";
    ext_p += "   bash scripts/dual-external-review.sh " + batch + " /tmp/cmspark-review-" + batch + "-r" + round.to_string() + ".md " + base_commit + "\n";
    ext_p += "3) Wait for it to finish. Read the newest docs/audit/reviews/" + batch + "-verdict-*.json\n";
    ext_p += "4) Return structured fields: both_approve, claude_verdict, pi_verdict, paths, exit_code, raw_tail of the two review md files (last 40 lines each).\n";
    ext_p += "CRITICAL: You MUST actually execute the shell script. Do not fabricate verdicts.\n";
    ext_p += "exit_code: 0=both approve, 2=reject, 3=infra.\n";

    let ext = agent(ext_p, #{
        label: "external-dual:" + batch + ":r" + round.to_string(),
        capability_mode: "all",
        output_schema: external_schema,
    });

    if ext == () || !ext.success || ext.output == () {
        feedback = "External dual review agent failed to run claude/pi. Re-run dual-external-review.sh.";
        log("External review agent failed");
        // Hard gate: user must confirm whether to continue
        await_user("verification", "External Claude/Pi review failed to produce verdicts for " + batch + " round " + round.to_string() + ". Inspect docs/audit/reviews/ then resume.");
        continue;
    }
    last_ext = ext.output;
    log("External: claude=" + ext.output.claude_verdict + " pi=" + ext.output.pi_verdict + " both=" + ext.output.both_approve.to_string());

    if ext.output.both_approve == true {
        both_ok = true;
        break;
    }

    feedback = "";
    feedback += "EXTERNAL DUAL REVIEW REJECTED.\n";
    feedback += "claude_verdict=" + ext.output.claude_verdict + " path=" + ext.output.claude_path + "\n";
    feedback += "pi_verdict=" + ext.output.pi_verdict + " path=" + ext.output.pi_path + "\n";
    feedback += "Read both review files and fix ALL blocking issues. raw_tail:\n";
    feedback += ext.output.raw_tail;
    log("External rejected — looping fix round");
}

// ===================== GATE =====================
phase("Gate");
if !both_ok {
    let gate_msg = "";
    gate_msg += "Batch " + batch + " did not get dual APPROVE after " + max_rounds.to_string() + " rounds.\n";
    gate_msg += "last_adv=" + json_encode(last_adv) + "\n";
    gate_msg += "last_ext=" + json_encode(last_ext) + "\n";
    gate_msg += "Options: resume to force another cycle, or stop and inspect docs/audit/reviews/.\n";
    await_user("verification", gate_msg);
    // After user resume, do not auto-claim success
}

// ===================== BUILD VERIFY =====================
phase("VerifyBuild");
let build_p = "";
build_p += "Run verification for batch " + batch + " changes.\n";
build_p += "1) git diff --stat\n";
build_p += "2) If extension touched: cd chrome-extension && npm test (or targeted test files)\n";
build_p += "3) If companion touched: cd companion && npm test -- <relevant> or full if fast enough; at least tsc/build if tests long\n";
build_p += "4) Return ok=true only if commands you ran succeeded.\n";
build_p += "Do not commit.\n";
let build = agent(build_p, #{
    label: "build:" + batch,
    capability_mode: "all",
    output_schema: build_schema,
});

let build_ok = false;
if build != () && build.success && build.output != () && build.output.ok == true {
    build_ok = true;
}

// Scratch report
let report = "";
report += "# P0 Batch Fix Report — " + batch + "\n\n";
report += "- both_external_approve: " + both_ok.to_string() + "\n";
report += "- build_ok: " + build_ok.to_string() + "\n";
report += "- rounds: " + round.to_string() + "\n";
report += "- design: " + design_json + "\n";
report += "- last_impl: " + json_encode(last_impl) + "\n";
report += "- last_adv: " + json_encode(last_adv) + "\n";
report += "- last_ext: " + json_encode(last_ext) + "\n";
if build != () && build.success {
    report += "- build: " + json_encode(build.output) + "\n";
}
let rpath = write_scratch_file("p0-" + batch + "-report.md", report);

// Persist a copy under docs/audit/reviews via shell agent if approved
if both_ok {
    let persist_p = "";
    persist_p += "Copy the following markdown into docs/audit/reviews/" + batch + "-batch-report.md using the write tool:\n\n";
    persist_p += report;
    let _p = agent(persist_p, #{
        label: "persist-report:" + batch,
        capability_mode: "read-write",
    });
}

complete(#{
    batch: batch,
    both_external_approve: both_ok,
    build_ok: build_ok,
    rounds: round,
    report_path: rpath,
    last_impl: last_impl,
    last_adv: last_adv,
    last_ext: last_ext,
    status: if both_ok && build_ok { "ready_to_commit" } else if both_ok { "approved_build_soft_fail" } else { "needs_work" },
});
