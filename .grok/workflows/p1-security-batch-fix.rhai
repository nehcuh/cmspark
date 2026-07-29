let meta = #{
    name: "p1-security-batch-fix",
    description: "ADR-020 Trust P1: design → implement → adversarial → Claude+Pi dual review → gate → build",
    when_to_use: "Implement diagnosis P1 security residuals (god-mode step-up, originWs, evaluate integrity, shell structure)",
    phases: [
        #{ title: "Setup", detail: "branch for batch" },
        #{ title: "Design", detail: "precise patch plan from inventory" },
        #{ title: "Implement", detail: "code + regression tests" },
        #{ title: "Adversarial", detail: "internal skeptic panel" },
        #{ title: "ExternalReview", detail: "Claude Code + Pi dual review" },
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
        "capability_declaration": #{ "type": "string" },
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
        "tests_run": #{ "type": "string" },
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
    pause("verification", "Pass args.batch: one of P1-1 | P1-2 | P1-3 | P1-4");
}
let max_rounds = 3;
if args != () && args.max_rounds != () {
    max_rounds = args.max_rounds;
}
let base_commit = "HEAD";
if args != () && args.base_commit != () {
    base_commit = args.base_commit;
}

// Specs from docs/audit/p1-security-open-items-2026-07-29.md + optimization-plan-post-adr-020 §B
fn batch_spec(b) {
    if b == "P1-1" {
        let s = "";
        s += "P1-1 God-mode / dangerous flag companion step-up (Trust):\n";
        s += "BUG: companion/src/message-router.ts config.set accepts boolean 0→1 for security.allow_all_schemes, auto_approve_dangerous, auto_approve_enterprise_tools without phrase/re-auth. UI SettingsSlideout phrase is theater only.\n";
        s += "GOAL: Companion MUST reject arming (false→true) unless a valid step-up is supplied. Disarm (true→false) stays easy.\n";
        s += "PREFERRED DESIGN (pick one, document in plan):\n";
        s += "A) Require confirmation_phrase matching the same GODMODE_CONFIRM_PHRASE (and enterprise phrase if separate) on config.set when arming those flags; reject with clear error if missing/wrong.\n";
        s += "B) Dedicated security.arm message family with originWs + phrase; config.set cannot set those keys true.\n";
        s += "Keep CU task L2 / shell forceConfirm invariants (god-mode must not silently skip those).\n";
        s += "TESTS: integration — arm without phrase fails; arm with correct phrase succeeds + audit; wrong phrase fails; disarm without phrase ok.\n";
        s += "READ: docs/audit/p1-security-open-items-2026-07-29.md §P1-1; SettingsSlideout phrase constants; ADR-010; ADR-020 Trust.\n";
        s += "Do NOT expand to P1-2/3/4. Minimal diffs. Do NOT commit/push.\n";
        return s;
    }
    if b == "P1-2" {
        let s = "";
        s += "P1-2 MCP + navigate L2 originWs binding (Trust multi-peer):\n";
        s += "BUG: securityConfirmations.request for MCP tools (~server.ts 3905), MCP meta (~4089), navigate URL (~1805) omit { originWs: ws }. Computer/host often bind.\n";
        s += "GOAL: When requesting socket ws exists, default bind originWs for MCP tool, MCP meta, navigate URL L2 (and any other request() in this change set that still broadcasts without reason).\n";
        s += "Preserve tray privileged respond path. Do not break single-client happy path.\n";
        s += "TESTS: two-peer or unit-level origin mismatch reject if harness exists; at least unit on SecurityConfirmationManager origin bind + spot call sites.\n";
        s += "READ: p1 inventory §P1-2; security-confirmation.ts origin checks.\n";
        s += "Do NOT expand to god-mode/evaluate/shell. No commit/push.\n";
        return s;
    }
    if b == "P1-3" {
        let s = "";
        s += "P1-3 evaluate post-approval code integrity:\n";
        s += "BUG: chrome-extension browser-bridge.ts evaluate() sanitizeText(params.code) AFTER companion L2/token bound the original code — silent rewrite.\n";
        s += "GOAL: Approved path executes the code the token/user confirmed. Prefer: with valid security_token path, skip mutative sanitizer (advisory detectDangerousApis only) OR single sanitize before confirm with token on sanitized bytes.\n";
        s += "Coordinate companion token binding if needed. Unapproved path must not bare-run.\n";
        s += "TESTS: code that would be altered by sanitizer still matches confirmed body when token present.\n";
        s += "READ: p1 inventory §P1-3; server.ts evaluate token validate; page-sanitizer.\n";
        s += "Do NOT expand scope. No commit/push.\n";
        return s;
    }
    if b == "P1-4" {
        let s = "";
        s += "P1-4 shell_exec structure tighten (enterprise L2):\n";
        s += "BUG: capability/shell.ts spawn(command,{shell:true}); allowlist is prefix-only → metachar risk.\n";
        s += "GOAL phase P1a: when policy=allowlist, reject shell metacharacters (;|&`$()<> etc.) OR force argv API; keep confirm_per_command + L2 forceConfirm; god-mode must not skip shell L2.\n";
        s += "Optional P1b note only (do not full argv rewrite unless small): shell:false + file/args later.\n";
        s += "TESTS: allowlist prefix with '; rm' rejected; benign allowlisted command still ok; L2 still required path unchanged.\n";
        s += "READ: p1 inventory §P1-4; modules shell policy.\n";
        s += "Do NOT expand to netsec redesign. No commit/push.\n";
        return s;
    }
    "UNKNOWN BATCH"
}

let spec = batch_spec(batch);
if spec == "UNKNOWN BATCH" {
    pause("verification", "Unknown batch. Use P1-1 | P1-2 | P1-3 | P1-4");
}

// ===================== SETUP =====================
phase("Setup");
log("P1 security batch-fix starting for " + batch);

let setup_p = "";
setup_p += "You are the release engineer for CMspark monorepo at workspace root.\n";
setup_p += "Task: prepare a git working branch for batch " + batch + ".\n";
setup_p += "1) Run: git status; git rev-parse --short HEAD; git log -1 --oneline\n";
setup_p += "2) Create/switch branch: git checkout -B fix/diagnosis-" + batch + "\n";
setup_p += "3) Do NOT commit yet. Do NOT push. Do NOT reset hard or discard unrelated user work.\n";
setup_p += "4) Confirm docs/audit/p1-security-open-items-2026-07-29.md exists (commit 8d0cc2e era).\n";
setup_p += "5) Return one-line summary of branch name and HEAD.\n";
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
design_p += "You are a staff security engineer writing a PRECISE patch plan for CMspark.\n";
design_p += "MUST READ fully:\n";
design_p += "- docs/audit/p1-security-open-items-2026-07-29.md\n";
design_p += "- docs/optimization-plan-post-adr-020.md section B\n";
design_p += "- docs/adr/020-capability-model-three-axes.md Trust / Surface rules\n";
design_p += "READ current source for every file you will touch BEFORE proposing edits. Use read_file/grep — do not invent line numbers.\n";
design_p += "Batch scope (HARD bound — do not expand):\n";
design_p += spec + "\n";
design_p += "Deliver structured plan: files, tests, acceptance criteria, risks.\n";
design_p += "Include capability_declaration string (Surface/Compose/Autonomy/Trust/Channel per ADR-020).\n";
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

    phase("Implement");
    let imp_p = "";
    imp_p += "You are the implementer for CMspark security batch " + batch + " (round " + round.to_string() + ").\n";
    imp_p += "STRICT SCOPE:\n" + spec + "\n";
    imp_p += "Approved design JSON:\n" + design_json + "\n";
    if feedback != "" {
        imp_p += "\nPREVIOUS ROUND FEEDBACK (must address):\n" + feedback + "\n";
    }
    imp_p += "METHOD:\n";
    imp_p += "1) Read each target file fully around the bug sites.\n";
    imp_p += "2) Apply minimal patches. No drive-by refactors. No new primary UI chrome.\n";
    imp_p += "3) Add/adjust tests that FAIL without the fix and PASS with it.\n";
    imp_p += "4) Run targeted tests (companion and/or extension).\n";
    imp_p += "5) git diff --stat; list files_changed; tests_run string.\n";
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

    phase("Adversarial");
    let adv_jobs = [];
    let a1 = "";
    a1 += "ADVERSARIAL SKEPTIC (security+correctness) for batch " + batch + ".\n";
    a1 += "Default pass=false. Only pass=true if you independently read the DIFF and code and cannot find blocking issues.\n";
    a1 += "Scope: " + spec + "\n";
    a1 += "Implementer claim: " + json_encode(impl.output) + "\n";
    a1 += "METHOD: git diff; read every changed file; try to bypass the fix (config.set without phrase, wrong peer confirm, evaluate rewrite, shell metachar).\n";
    a1 += "Apply ADR-020: trust monotonicity; no bare middle-agent; Pack-first irrelevant unless UI added.\n";
    a1 += "Return blocking[] with file:line. pass=true only if zero blocking.\n";
    adv_jobs.push(#{
        label: "adv-sec:" + batch + ":r" + round.to_string(),
        capability_mode: "read-only",
        output_schema: adv_schema,
        prompt: a1,
    });

    let a2 = "";
    a2 += "ADVERSARIAL SKEPTIC (tests+regression) for batch " + batch + ".\n";
    a2 += "Default pass=false. Check tests actually assert the fixed behavior; no false-green mocks.\n";
    a2 += "Scope: " + spec + "\n";
    a2 += "Implementer claim: " + json_encode(impl.output) + "\n";
    a2 += "METHOD: git diff; read new/changed tests.\n";
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

    if !adv_pass {
        feedback = "INTERNAL ADVERSARIAL FAILED:\n" + json_encode(last_adv);
        log("Skipping external review this round — fix adversarial blockers first");
        continue;
    }

    phase("ExternalReview");
    log("Adversarial passed — launching SEPARATE Claude Code + Pi Agent reviews");

    let review_prompt_body = "";
    review_prompt_body += "# External dual review request — P1 security\n";
    review_prompt_body += "Batch: " + batch + " round " + round.to_string() + "\n";
    review_prompt_body += "Inventory: docs/audit/p1-security-open-items-2026-07-29.md\n";
    review_prompt_body += "Plan: docs/optimization-plan-post-adr-020.md §B\n";
    review_prompt_body += "ADR-020 capability checklist: docs/audit/reviews/_templates/dual-review-capability-checklist.md\n";
    review_prompt_body += "Internal adversarial: PASSED\n";
    review_prompt_body += "Design: " + design_json + "\n";
    review_prompt_body += "Implementer: " + json_encode(impl.output) + "\n";
    review_prompt_body += "Adversarial summary: " + adv_summaries + "\n";
    review_prompt_body += "Scope bound:\n" + spec + "\n";
    review_prompt_body += "Confirm the fix fully addresses the inventory item, tests are real, no new holes, Trust monotonicity holds.\n";
    review_prompt_body += "End with VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";

    let ext_p = "";
    ext_p += "You must run the DUAL EXTERNAL REVIEW helper. Do not re-implement code.\n";
    ext_p += "1) Write the following content EXACTLY to /tmp/cmspark-review-" + batch + "-r" + round.to_string() + ".md using the write tool or shell heredoc:\n";
    ext_p += "-----BEGIN PROMPT-----\n";
    ext_p += review_prompt_body;
    ext_p += "\n-----END PROMPT-----\n";
    ext_p += "2) Run this SINGLE command (Claude Code + Pi as TWO separate processes):\n";
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
}

// ===================== BUILD VERIFY =====================
phase("VerifyBuild");
let build_p = "";
build_p += "Run verification for batch " + batch + " changes.\n";
build_p += "1) git diff --stat; git status\n";
build_p += "2) If extension touched: npm --prefix chrome-extension test (or targeted)\n";
build_p += "3) If companion touched: npm --prefix companion test (or targeted security/config/shell tests); tsc if available\n";
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

let report = "";
report += "# P1 Security Batch Fix Report — " + batch + "\n\n";
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
let rpath = write_scratch_file("p1-" + batch + "-report.md", report);

if both_ok {
    let persist_p = "";
    persist_p += "Write the following markdown to docs/audit/reviews/" + batch + "-batch-report.md using the write tool (overwrite ok):\n\n";
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
