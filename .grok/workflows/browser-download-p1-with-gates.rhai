let meta = #{
    name: "browser-download-p1-with-gates",
    description: "P1 browser_download: design → spike lock → implement → adversarial → Claude+Pi → build",
    when_to_use: "Ship first-class browser_download after Windows plan P0; chrome.downloads primary + text finder + path sandbox",
    phases: [
        #{ title: "Setup", detail: "feature branch from main" },
        #{ title: "Design", detail: "lock P1.0 scope from plan" },
        #{ title: "SpikeLock", detail: "transport spike note + downloads-primary decision" },
        #{ title: "GateSpike", detail: "Claude+Pi dual review of spike decision" },
        #{ title: "Implement", detail: "sandbox + tool + extension + lease/worker + tests" },
        #{ title: "Adversarial", detail: "security + tests skeptics" },
        #{ title: "ExternalReview", detail: "Claude Code + Pi dual review" },
        #{ title: "Gate", detail: "both APPROVE or fix loop" },
        #{ title: "VerifyBuild", detail: "tsc + targeted tests" },
    ],
};

let design_schema = #{
    "type": "object",
    "required": ["plan", "files", "tests", "acceptance", "transport", "capability_declaration"],
    "properties": #{
        "plan": #{ "type": "string" },
        "files": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "tests": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "acceptance": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "transport": #{ "type": "string" },
        "capability_declaration": #{ "type": "string" },
        "risks": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["summary", "files_changed", "tests_added", "done"],
    "properties": #{
        "summary": #{ "type": "string" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "tests_added": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "done": #{ "type": "boolean" },
        "notes": #{ "type": "string" },
        "diff_stat": #{ "type": "string" },
        "tests_run": #{ "type": "string" },
        "spike_path": #{ "type": "string" },
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
        "must_fix": #{ "type": "array", "maxItems": 15, "items": #{ "type": "string" } },
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

let max_rounds = 3;
if args != () && args.max_rounds != () {
    max_rounds = args.max_rounds;
}
let base_commit = "HEAD";
if args != () && args.base_commit != () {
    base_commit = args.base_commit;
}

let plan_path = "docs/superpowers/plans/2026-07-29-windows-download-platform-tools.md";

let spec = "";
spec += "P1.0 browser_download (plan " + plan_path + " §P1):\n";
spec += "GOAL G3: agent can download via visible text (e.g. 下载) to user Downloads without osascript/shell curl.\n";
spec += "TRANSPORT (lock after spike note): PRIMARY chrome.downloads (onCreated/onChanged complete). ";
spec += "CDP Browser.setDownloadBehavior optional path hint only; do not require CDP download events. ";
spec += "If no live Windows Chrome: document S1-S6 as code_read / not_run and still lock downloads-primary (plan default when S1/S2 unproven).\n";
spec += "MUST ship together (one branch/PR):\n";
spec += "1) getUserDownloadsDir + assertDownloadPathAllowed (+ isWithinRoot) pure helpers; roots=[Downloads] only for P1.0; reject UNC/escape; tests PR-3 matrix.\n";
spec += "2) Tool browser_download in tool-definitions: tabId required; selector|text at least one; downloadPath optional; timeoutMs default 60s max 120s.\n";
spec += "3) Extension: permission downloads; case browser_download; text finder (shared helper); DOWNLOAD_BUSY per tab; try/finally restore setDownloadBehavior if set; mockable chrome.downloads tests where possible.\n";
spec += "4) Companion createToolExecutor: path sandbox; strip/deny worker custom path; TAB_LEASE_TOOLS add browser_download; no L2 for default Downloads; auto_approve_dangerous must NOT relax path sandbox.\n";
spec += "5) Alias case download → browser_download or remove dead stub that only setDownloadBehavior.\n";
spec += "6) Typed errors: DOWNLOAD_TIMEOUT PATH_ESCAPE ELEMENT_NOT_FOUND ELEMENT_AMBIGUOUS DOWNLOAD_BUSY TAB_ID_REQUIRED WORKER_PATH_DENIED etc.\n";
spec += "OUT OF SCOPE: pure navigate Content-Disposition wait; shell download path; new L2 dialect; P1b multi-root; full Playwright :has-text engine.\n";
spec += "ADR-020: Surface L1; Compose none; Autonomy single; Trust path sandbox; Channel community. No new confirm family for default Downloads.\n";
spec += "Do NOT commit/push unless told. Minimal diffs.\n";

// ===================== SETUP =====================
phase("Setup");
log("browser_download P1 workflow starting");
let setup_p = "";
setup_p += "You are release engineer for CMspark monorepo.\n";
setup_p += "1) git status; git rev-parse --short HEAD; git log -1 --oneline\n";
setup_p += "2) Ensure on clean base: git checkout -B feat/browser-download-p1 (from current HEAD; prefer main lineage)\n";
setup_p += "3) Confirm plan exists: " + plan_path + "\n";
setup_p += "4) Do NOT commit/push/reset hard.\n";
setup_p += "Return one-line branch + HEAD.\n";
let setup = agent(setup_p, #{
    label: "setup-browser-download",
    capability_mode: "execute",
});
if setup == () || !setup.success {
    log("Setup agent failed — continue on current branch");
}

// ===================== DESIGN =====================
phase("Design");
let design_p = "";
design_p += "Staff engineer: precise P1.0 browser_download design for CMspark.\n";
design_p += "MUST READ fully: " + plan_path + " §P1 (1.0-1.9), D1-D18, PR-3..PR-6.\n";
design_p += "READ real code: browser-bridge download stub; package.json permissions; tool-definitions; server createToolExecutor; orchestrator constants TAB_LEASE_TOOLS; host-use/win/adapter isWithinRoot; platform.ts.\n";
design_p += "HARD SCOPE:\n" + spec + "\n";
design_p += "Deliver: plan summary, files, tests, acceptance, transport decision string, capability_declaration, risks.\n";
design_p += "Cite file:line of CURRENT gaps. Prefer chrome.downloads primary.\n";
let design = agent(design_p, #{
    label: "design-browser-download",
    capability_mode: "read-only",
    output_schema: design_schema,
});
if design == () || !design.success || design.output == () {
    pause("infra", "Design agent failed for browser_download — resume after investigating");
}
log("Design ready");
let design_json = json_encode(design.output);

// ===================== SPIKE LOCK =====================
phase("SpikeLock");
let spike_p = "";
spike_p += "Create/overwrite docs/audit/reviews/win-dl-p1-spike-checklist.md for transport lock.\n";
spike_p += "Checklist S1-S6 from plan §1.0. Status each: pass | fail | not_run | code_read.\n";
spike_p += "Based on code reading of browser-bridge (no onEvent, private download only setDownloadBehavior) + Chrome MV3 docs knowledge.\n";
spike_p += "MUST conclude recommendation: proceed_with_downloads_primary (default) unless you have hard evidence otherwise.\n";
spike_p += "Include: permission impact, restore behavior plan, Chrome version note for CI.\n";
spike_p += "Do not implement product yet. done=true if file written.\n";
let spike = agent(spike_p, #{
    label: "spike-lock-browser-download",
    capability_mode: "all",
    output_schema: implement_schema,
});
let spike_json = if spike != () && spike.success { json_encode(spike.output) } else { "{}" };
log("Spike note written");

// ===================== GATE SPIKE (dual) =====================
phase("GateSpike");
let body_sp = "";
body_sp += "# Dual review GateSpike — browser_download transport lock\n";
body_sp += "Plan: " + plan_path + " §1.0\n";
body_sp += "Design: " + design_json + "\n";
body_sp += "Spike claim: " + spike_json + "\n";
body_sp += "Read docs/audit/reviews/win-dl-p1-spike-checklist.md + real browser-bridge download stub.\n";
body_sp += "APPROVE if chrome.downloads primary is justified and P1.0 scope (sandbox, text, TAB_LEASE, busy, restore) is clear.\n";
body_sp += "REJECT if full implement without path sandbox/text/TAB_LEASE or claims CDP complete without evidence.\n";
body_sp += "End with VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";

let gsp_p = "";
gsp_p += "Run dual external Claude+Pi. Do not invent verdicts.\n";
gsp_p += "1) Write prompt to /tmp/cmspark-review-win-dl-p1-spike.md with:\n-----BEGIN-----\n" + body_sp + "\n-----END-----\n";
gsp_p += "2) bash scripts/dual-external-review.sh win-dl-p1-spike /tmp/cmspark-review-win-dl-p1-spike.md " + base_commit + "\n";
gsp_p += "3) Read newest docs/audit/reviews/win-dl-p1-spike-verdict-*.json\n";
gsp_p += "4) Return dual fields. MUST execute script.\n";
let gsp = agent(gsp_p, #{
    label: "gate-spike-dual",
    capability_mode: "all",
    output_schema: external_schema,
});
if gsp == () || !gsp.success || gsp.output == () || gsp.output.both_approve != true {
    await_user("verification", "Spike gate not dual-approved. Inspect docs/audit/reviews/win-dl-p1-spike* then resume or stop.");
}
log("Spike dual-approved — implement allowed");

// ===================== FIX LOOP =====================
let round = 0;
let both_ok = false;
let last_impl = ();
let last_adv = ();
let last_ext = ();
let feedback = "";

while round < max_rounds {
    round += 1;
    log("=== Round " + round.to_string() + "/" + max_rounds.to_string() + " browser_download ===");

    phase("Implement");
    let imp_p = "";
    imp_p += "Implementer for browser_download P1.0 (round " + round.to_string() + ").\n";
    imp_p += "STRICT:\n" + spec + "\n";
    imp_p += "Design JSON:\n" + design_json + "\n";
    imp_p += "Spike: " + spike_json + " (downloads primary locked)\n";
    if feedback != "" {
        imp_p += "\nPREVIOUS FEEDBACK:\n" + feedback + "\n";
    }
    imp_p += "METHOD:\n";
    imp_p += "1) Read every target file before edit.\n";
    imp_p += "2) Path sandbox pure module + unit tests (PR-3 matrix).\n";
    imp_p += "3) tool-definitions + companion executor gates (lease, worker path, sandbox).\n";
    imp_p += "4) Extension browser_download + downloads permission + text finder + busy + restore.\n";
    imp_p += "5) Tests that fail without fix; run companion + extension targeted suites.\n";
    imp_p += "6) Update plan status line if appropriate; short batch note under docs/audit/reviews/browser-download-p1-batch-report.md\n";
    imp_p += "7) Do NOT git commit or push.\n";
    imp_p += "done=true only if acceptance met and tests green.\n";
    let impl = agent(imp_p, #{
        label: "implement-browser-download:r" + round.to_string(),
        capability_mode: "all",
        output_schema: implement_schema,
    });
    if impl == () || !impl.success || impl.output == () {
        feedback = "Implement agent failed. Re-apply carefully.";
        continue;
    }
    last_impl = impl.output;
    log("Implement: " + impl.output.summary);

    phase("Adversarial");
    let adv_jobs = [];
    let a1 = "";
    a1 += "ADVERSARIAL security/correctness for browser_download. Default pass=false.\n";
    a1 += "Scope:\n" + spec + "\n";
    a1 += "Claim: " + json_encode(impl.output) + "\n";
    a1 += "git diff; try bypass path sandbox, worker custom path, UNC, DOWNLOAD_BUSY race, missing restore, bare download without text/selector, L2 dialect creep.\n";
    a1 += "pass=true only zero blocking.\n";
    adv_jobs.push(#{
        label: "adv-sec-bd:r" + round.to_string(),
        capability_mode: "read-only",
        output_schema: adv_schema,
        prompt: a1,
    });
    let a2 = "";
    a2 += "ADVERSARIAL tests for browser_download. Default pass=false.\n";
    a2 += "Read new/changed tests; ensure path escape + busy + timeout + text ambiguous are real asserts not mocks-only.\n";
    a2 += "Claim: " + json_encode(impl.output) + "\n";
    adv_jobs.push(#{
        label: "adv-test-bd:r" + round.to_string(),
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
            adv_summaries += "adv agent failed; ";
        } else {
            if ar.output.pass != true { adv_pass = false; }
            if ar.output.blocking != () {
                for bitem in ar.output.blocking { adv_blocks.push(bitem); }
            }
            adv_summaries += ar.output.summary + " | ";
        }
    }
    last_adv = #{ pass: adv_pass, blocking: adv_blocks, summary: adv_summaries };
    log("Adversarial pass=" + adv_pass.to_string());
    if !adv_pass {
        feedback = "INTERNAL ADVERSARIAL FAILED:\n" + json_encode(last_adv);
        continue;
    }

    phase("ExternalReview");
    let body_x = "";
    body_x += "# Dual review — browser_download P1.0\n";
    body_x += "Plan: " + plan_path + "\n";
    body_x += "ADR-020 checklist: docs/audit/reviews/_templates/dual-review-capability-checklist.md\n";
    body_x += "Design: " + design_json + "\n";
    body_x += "Implementer: " + json_encode(impl.output) + "\n";
    body_x += "Adversarial: " + adv_summaries + "\n";
    body_x += "Verify: path sandbox, downloads primary, text|selector, TAB_LEASE, worker path deny/strip, busy, restore, no shell path, tests real.\n";
    body_x += "End VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";
    let ext_p = "";
    ext_p += "Run dual external review. Do not re-implement.\n";
    ext_p += "1) Write /tmp/cmspark-review-browser-download-p1-r" + round.to_string() + ".md with:\n-----BEGIN-----\n" + body_x + "\n-----END-----\n";
    ext_p += "2) bash scripts/dual-external-review.sh browser-download-p1 /tmp/cmspark-review-browser-download-p1-r" + round.to_string() + ".md " + base_commit + "\n";
    ext_p += "3) Read newest docs/audit/reviews/browser-download-p1-verdict-*.json\n";
    ext_p += "4) Return dual schema. MUST run script.\n";
    let ext = agent(ext_p, #{
        label: "external-dual-bd:r" + round.to_string(),
        capability_mode: "all",
        output_schema: external_schema,
    });
    if ext == () || !ext.success || ext.output == () {
        feedback = "External dual review failed.";
        await_user("verification", "External Claude/Pi failed for browser_download round " + round.to_string());
        continue;
    }
    last_ext = ext.output;
    log("External claude=" + ext.output.claude_verdict + " pi=" + ext.output.pi_verdict);
    if ext.output.both_approve == true {
        both_ok = true;
        break;
    }
    feedback = "EXTERNAL REJECTED claude=" + ext.output.claude_verdict + " pi=" + ext.output.pi_verdict + "\n" + ext.output.raw_tail;
}

phase("Gate");
if !both_ok {
    await_user("verification", "browser_download not dual-approved after " + max_rounds.to_string() + " rounds. Inspect docs/audit/reviews/browser-download-p1*");
}

phase("VerifyBuild");
let build_p = "";
build_p += "Verify browser_download changes.\n";
build_p += "1) git diff --stat; git status\n";
build_p += "2) companion: tsc + path sandbox / related unit tests\n";
build_p += "3) extension: tsc test config + evaluate/download related tests if any\n";
build_p += "ok=true only if commands succeed. No commit.\n";
let build = agent(build_p, #{
    label: "build-browser-download",
    capability_mode: "all",
    output_schema: build_schema,
});
let build_ok = false;
if build != () && build.success && build.output != () && build.output.ok == true {
    build_ok = true;
}

let report = "";
report += "# browser_download P1.0 Batch Report\n\n";
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
let rpath = write_scratch_file("browser-download-p1-report.md", report);

if both_ok {
    let persist_p = "";
    persist_p += "Write this markdown to docs/audit/reviews/browser-download-p1-batch-report.md (overwrite ok):\n\n";
    persist_p += report;
    let _p = agent(persist_p, #{
        label: "persist-bd-report",
        capability_mode: "read-write",
    });
}

complete(#{
    batch: "browser_download_p1",
    both_external_approve: both_ok,
    build_ok: build_ok,
    rounds: round,
    report_path: rpath,
    last_impl: last_impl,
    last_adv: last_adv,
    last_ext: last_ext,
    status: if both_ok && build_ok { "ready_to_commit" } else if both_ok { "approved_build_soft_fail" } else { "needs_work" },
});
