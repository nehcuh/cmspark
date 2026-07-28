let meta = #{
    name: "docs-reorg-phase12-continue",
    description: "Continue docs reorg after Phase1 implement: P1 Claude/Pi gate → Phase2 hub → P2 Claude/Pi gate",
    when_to_use: "After docs-reorg-phase12 failed at run_external root scope; Phase1 edits already on branch",
    phases: [
        #{ title: "Phase1-Sanity", detail: "confirm Phase1 facts still hold" },
        #{ title: "Phase1-ExternalReview", detail: "Claude + Pi dual review P1" },
        #{ title: "Phase1-Fix", detail: "apply P1 must_fix" },
        #{ title: "Phase2-Implement", detail: "README matrix + docs/README" },
        #{ title: "Phase2-Adversarial", detail: "internal coverage skeptics" },
        #{ title: "Phase2-ExternalReview", detail: "Claude + Pi dual review P2" },
        #{ title: "Phase2-Fix", detail: "apply P2 must_fix" },
        #{ title: "Final-Gate", detail: "negative rg + report" },
    ],
};

let impl_schema = #{
    "type": "object",
    "required": ["summary", "files_changed", "done", "checklist"],
    "properties": #{
        "summary": #{ "type": "string" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "done": #{ "type": "boolean" },
        "checklist": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "notes": #{ "type": "string" },
        "diff_stat": #{ "type": "string" },
    },
};

let adv_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "maxItems": 15, "items": #{
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
        "nits": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 12 },
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
        "must_fix": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "checks", "log"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "checks": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "log": #{ "type": "string" },
        "failed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
    },
};

let max_rounds = 2;
if args != () && args.max_rounds != () {
    max_rounds = args.max_rounds;
}
let base_commit = "HEAD";
if args != () && args.base_commit != () {
    base_commit = args.base_commit;
}
let root = "/Users/huchen/Projects/cmspark";
if args != () && args.root != () {
    root = args.root;
}

let SCOPE = "";
SCOPE += "ALLOWED edit paths ONLY:\n";
SCOPE += "- README.md\n";
SCOPE += "- docs/GOAL.md\n";
SCOPE += "- docs/architecture.md\n";
SCOPE += "- docs/TESTING.md\n";
SCOPE += "- docs/adr/016-mission-board.md\n";
SCOPE += "- docs/README.md (create)\n";
SCOPE += "- docs/docs-reorg-plan-2026-07-28.md (optional status note only)\n";
SCOPE += "- docs/audit/reviews/*docs-reorg* (review artifacts / prompts)\n";
SCOPE += "FORBIDDEN: companion/src/**, chrome-extension/src/**, package.json, any runtime code.\n";
SCOPE += "NOTE: ignore unrelated site-knowledge hostname WIP in companion/chrome-extension.\n";
SCOPE += "Product 0.3.0; Node >=20. Plan: docs/docs-reorg-plan-2026-07-28.md Phase1+2 only.\n";

let PHASE1 = "";
PHASE1 += "PHASE1 already implemented on branch docs/reorg-phase12-0.3.0. Verify only:\n";
PHASE1 += "README L2/Cockpit FAQ; stage line; Node>=20; 0.3.0; Swift tray+pairing; GOAL G8 real gates; ADR-016 Implemented P0; architecture tree no phantoms; TESTING map real paths.\n";

let PHASE2 = "";
PHASE2 += "PHASE 2 — README hub + docs/README.md:\n";
PHASE2 += "2.1 Tiered capability matrix (核心/已交付/进阶opt-in/运维) covering browser, multi-thread, skills, knowledge, cookie trust, L2/Cockpit, MCP, Mission Pack, Obsidian export, Mermaid, NotebookLM, Computer/Host Use, multi-agent+board, Apps, file upload, daemon/tray/pairing. Link existing guides; for CU/host/NLM say 进阶/见 ADR if no full user guide.\n";
PHASE2 += "2.2 Short sections 5-15 lines: 安全与确认; MCP; 任务包; 导出与导入; 桌面与宿主; 多 Agent; 文件上传; 相关文档 table.\n";
PHASE2 += "2.3 No hard-coded 23 tools only; mark tool_chain/sub_agent experimental vs orchestrator.\n";
PHASE2 += "2.4 Keep Knowledge section. Update TOC. Expand ~/.cmspark-agent tree if needed.\n";
PHASE2 += "2.5 Create docs/README.md nav: 用户 | 架构 | ADR | 工程 | 进行中 | 归档说明 (do NOT move archive files).\n";
PHASE2 += "Preserve all Phase1 factual fixes. Do NOT commit.\n";

// Rhai fn cannot capture outer locals — pass repo_root
fn run_external(batch_id, scope_text, claim_json, base, repo_root) {
    let body = "";
    body += "# External dual review — CMspark docs reorg CONTINUE\n";
    body += "Batch: " + batch_id + "\n";
    body += "Product: 0.3.0 | Plan: docs/docs-reorg-plan-2026-07-28.md\n\n";
    body += "## Scope\n" + scope_text + "\n";
    body += "IGNORE companion/chrome-extension WIP unrelated to docs.\n\n";
    body += "## Claim\n" + claim_json + "\n\n";
    body += "## Verify\n";
    body += "1) No false claims (L2 shipped; no live risk-engine; ADR-016 board implemented).\n";
    body += "2) architecture/TESTING match real trees.\n";
    body += "3) Phase2: README matrix + docs/README.md links resolve.\n";
    body += "4) Node>=20 and 0.3.0.\n";
    body += "End with VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";

    let ext_p = "";
    ext_p += "Run DUAL EXTERNAL REVIEW. Do not invent verdicts.\n";
    ext_p += "1) Write prompt to /tmp/cmspark-review-" + batch_id + ".md:\n";
    ext_p += "-----BEGIN PROMPT-----\n" + body + "\n-----END PROMPT-----\n";
    ext_p += "2) cd " + repo_root + " && bash scripts/dual-external-review.sh " + batch_id + " /tmp/cmspark-review-" + batch_id + ".md " + base + "\n";
    ext_p += "3) Read newest docs/audit/reviews/" + batch_id + "-verdict-*.json and review md tails.\n";
    ext_p += "4) Return both_approve, claude_verdict, pi_verdict, paths, exit_code, raw_tail, must_fix.\n";

    let schema = #{
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
            "must_fix": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        },
    };
    return agent(ext_p, #{
        label: "external-dual:" + batch_id,
        capability_mode: "all",
        output_schema: schema,
    });
}

// ---------- Phase1 sanity ----------
phase("Phase1-Sanity");
log("Continue workflow: Phase1 already on disk; sanity then external dual review");

let sanity_p = "";
sanity_p += "Repo " + root + " on branch docs/reorg-phase12-0.3.0.\n";
sanity_p += "Confirm Phase1 factual fixes with rg/read (do not re-write unless broken):\n";
sanity_p += "1) README must NOT contain 等待用户确认机制完成后开放\n";
sanity_p += "2) README FAQ mentions L2/Cockpit/SecurityConfirmation\n";
sanity_p += "3) GOAL G8 not claiming live risk-engine+privilege-manager as architecture\n";
sanity_p += "4) ADR-016 status Implemented (P0)\n";
sanity_p += "5) architecture no ConnectionStatus.tsx / security-token.ts / cmsspark/ root phantoms\n";
sanity_p += "6) TESTING has no live server.test.ts as existing file; real area map\n";
sanity_p += "If anything broken, FIX it (allowed paths only). Return summary+checklist+done.\n";
sanity_p += SCOPE + "\n" + PHASE1 + "\n";
let p1_claim = agent(sanity_p, #{
    label: "phase1-sanity",
    capability_mode: "all",
    output_schema: impl_schema,
});
if p1_claim == () || !p1_claim.success || p1_claim.output == () {
    pause("infra", "Phase1 sanity agent failed");
}
log("Phase1 sanity: " + p1_claim.output.summary);
let claim1 = json_encode(p1_claim.output);

// ---------- Phase1 external (with fix loop) ----------
let p1_ok = false;
let p1_round = 0;
let p1_feedback = "";
let last_p1_ext = ();

while p1_round < max_rounds {
    p1_round += 1;
    if p1_feedback != "" {
        let fixp = "";
        fixp += "Fix Phase1 docs based on external review feedback:\n" + p1_feedback + "\n";
        fixp += SCOPE + "\nDo not commit.\n";
        let fx = agent(fixp, #{
            label: "phase1-fix:r" + p1_round.to_string(),
            capability_mode: "all",
            output_schema: impl_schema,
        });
        if fx != () && fx.success && fx.output != () {
            claim1 = json_encode(fx.output);
            log("Phase1 fix: " + fx.output.summary);
        }
    }

    phase("Phase1-ExternalReview");
    let ext1 = run_external("docs-reorg-p1", SCOPE + "\n" + PHASE1, claim1, base_commit, root);
    if ext1 == () || !ext1.success || ext1.output == () {
        await_user("verification", "Phase1 Claude/Pi dual review failed to run. Check scripts/dual-external-review.sh then resume.");
        p1_feedback = "external infra failed";
        continue;
    }
    last_p1_ext = ext1.output;
    log("P1 external claude=" + ext1.output.claude_verdict + " pi=" + ext1.output.pi_verdict + " both=" + ext1.output.both_approve.to_string());

    if ext1.output.both_approve == true {
        p1_ok = true;
        if ext1.output.must_fix != () && ext1.output.must_fix.len() > 0 {
            phase("Phase1-Fix");
            let n1 = "";
            n1 += "Apply APPROVE_WITH_NITS only: " + json_encode(ext1.output.must_fix) + "\n";
            n1 += "Read " + ext1.output.claude_path + " " + ext1.output.pi_path + "\n" + SCOPE + "\n";
            let _n = agent(n1, #{ label: "phase1-nits", capability_mode: "all", output_schema: impl_schema });
        }
        break;
    }
    phase("Phase1-Fix");
    p1_feedback = "EXTERNAL REJECT: claude=" + ext1.output.claude_verdict + " pi=" + ext1.output.pi_verdict + "\n";
    p1_feedback += "must_fix=" + json_encode(ext1.output.must_fix) + "\nraw:\n" + ext1.output.raw_tail;
}

if !p1_ok {
    await_user("verification", "Phase1 dual review not approved after max rounds. Inspect docs/audit/reviews/docs-reorg-p1-* then resume to continue Phase2 or stop.");
}

// ---------- Phase2 ----------
let p2_ok = false;
let p2_round = 0;
let p2_feedback = "";
let last_p2_impl = ();
let last_p2_ext = ();

while p2_round < max_rounds {
    p2_round += 1;
    log("=== Phase2 round " + p2_round.to_string() + " ===");

    phase("Phase2-Implement");
    let p2i = "";
    p2i += "DOCUMENT implementer Phase 2 at " + root + ".\n";
    p2i += SCOPE + "\n" + PHASE2 + "\n";
    if p2_feedback != "" {
        p2i += "PREVIOUS FEEDBACK:\n" + p2_feedback + "\n";
    }
    p2i += "Preserve Phase1 fixes. Create docs/README.md. Update README capability matrix + short sections + TOC + 相关文档.\n";
    p2i += "Verify links with test -f. Do not commit. done=true when complete.\n";
    let impl2 = agent(p2i, #{
        label: "phase2-impl:r" + p2_round.to_string(),
        capability_mode: "all",
        output_schema: impl_schema,
    });
    if impl2 == () || !impl2.success || impl2.output == () {
        p2_feedback = "phase2 implement failed";
        continue;
    }
    last_p2_impl = impl2.output;
    log("Phase2: " + impl2.output.summary);

    phase("Phase2-Adversarial");
    let jobs = [];
    let a1 = "";
    a1 += "ADVERSARIAL README coverage. Default pass=false. Read README.md + docs/README.md.\n";
    a1 += "Matrix must cover MCP, Packs, Confirm/Cockpit, CU/host (advanced), multi-agent/board, Obsidian export, Mermaid, NotebookLM, Apps, upload, pairing — or honest 进阶 labels.\n";
    a1 += "Links must exist. Implementer: " + json_encode(impl2.output) + "\n";
    jobs.push(#{ label: "p2-adv-cov:r" + p2_round.to_string(), capability_mode: "read-only", output_schema: adv_schema, prompt: a1 });
    let a2 = "";
    a2 += "ADVERSARIAL no-regression Phase1 after Phase2. Default pass=false.\n";
    a2 += "rg forbidden FAQ phrase; GOAL G8; ADR-016 Implemented; Node>=20; 0.3.0.\n";
    jobs.push(#{ label: "p2-adv-nr:r" + p2_round.to_string(), capability_mode: "read-only", output_schema: adv_schema, prompt: a2 });
    let ar = parallel(jobs);
    let ap = true;
    let blocks = [];
    let sum = "";
    for x in ar {
        if x == () || !x.success || x.output == () {
            ap = false;
            sum += "adv fail; ";
        } else {
            if x.output.pass != true { ap = false; }
            if x.output.blocking != () {
                for b in x.output.blocking { blocks.push(b); }
            }
            sum += x.output.summary + " | ";
        }
    }
    log("Phase2 adv pass=" + ap.to_string());
    if !ap {
        p2_feedback = "ADVERSARIAL: " + json_encode(#{ blocking: blocks, summary: sum });
        continue;
    }

    phase("Phase2-ExternalReview");
    let ext2 = run_external("docs-reorg-p2", SCOPE + "\n" + PHASE2, json_encode(impl2.output), base_commit, root);
    if ext2 == () || !ext2.success || ext2.output == () {
        await_user("verification", "Phase2 Claude/Pi dual review failed. Resume after fix.");
        p2_feedback = "external infra failed p2";
        continue;
    }
    last_p2_ext = ext2.output;
    log("P2 external claude=" + ext2.output.claude_verdict + " pi=" + ext2.output.pi_verdict);

    if ext2.output.both_approve == true {
        p2_ok = true;
        if ext2.output.must_fix != () && ext2.output.must_fix.len() > 0 {
            phase("Phase2-Fix");
            let n2 = "";
            n2 += "Apply nits: " + json_encode(ext2.output.must_fix) + "\n" + SCOPE + "\n";
            n2 += "Read " + ext2.output.claude_path + " " + ext2.output.pi_path + "\n";
            let _n2 = agent(n2, #{ label: "phase2-nits", capability_mode: "all", output_schema: impl_schema });
        }
        break;
    }
    phase("Phase2-Fix");
    p2_feedback = "REJECT claude=" + ext2.output.claude_verdict + " pi=" + ext2.output.pi_verdict + "\n";
    p2_feedback += "must_fix=" + json_encode(ext2.output.must_fix) + "\n" + ext2.output.raw_tail;
}

// ---------- Final ----------
phase("Final-Gate");
let vp = "";
vp += "Final verify at " + root + ":\n";
vp += "1) rg 等待用户确认机制完成后开放 README → empty\n";
vp += "2) ADR-016 not 尚未实现产品代码\n";
vp += "3) test -f docs/README.md\n";
vp += "4) rg MCP|任务包|确认|Mission Pack README\n";
vp += "5) rg ConnectionStatus|security-token.ts|cmsspark/ architecture → empty\n";
vp += "6) git diff --stat on allowed docs only\n";
vp += "ok=true only if 1-5 pass.\n";
let ver = agent(vp, #{ label: "final-verify", capability_mode: "all", output_schema: verify_schema });
let verify_ok = false;
if ver != () && ver.success && ver.output != () && ver.output.ok == true {
    verify_ok = true;
}

let report = "";
report += "# Docs Reorg Phase1+2 CONTINUE Report\n\n";
report += "- p1_ok: " + p1_ok.to_string() + " rounds=" + p1_round.to_string() + "\n";
report += "- p2_ok: " + p2_ok.to_string() + " rounds=" + p2_round.to_string() + "\n";
report += "- verify_ok: " + verify_ok.to_string() + "\n";
report += "- last_p1_ext: " + json_encode(last_p1_ext) + "\n";
report += "- last_p2_impl: " + json_encode(last_p2_impl) + "\n";
report += "- last_p2_ext: " + json_encode(last_p2_ext) + "\n";
if ver != () && ver.success {
    report += "- final: " + json_encode(ver.output) + "\n";
}
report += "\nPrior failure: docs-reorg-phase12 hit Rhai Variable not found: root in run_external — fixed by passing repo_root.\n";

let rpath = write_scratch_file("docs-reorg-phase12-continue-report.md", report);
let persist = "Write this report to docs/audit/reviews/docs-reorg-phase12-workflow-report.md:\n\n" + report;
let _pr = agent(persist, #{ label: "persist-report", capability_mode: "read-write" });

if !p1_ok || !p2_ok || !verify_ok {
    await_user("verification", "continue incomplete p1=" + p1_ok.to_string() + " p2=" + p2_ok.to_string() + " verify=" + verify_ok.to_string());
}

complete(#{
    p1_ok: p1_ok,
    p2_ok: p2_ok,
    verify_ok: verify_ok,
    p1_rounds: p1_round,
    p2_rounds: p2_round,
    report_path: rpath,
    status: if p1_ok && p2_ok && verify_ok { "ready_to_commit" } else { "needs_work" },
    last_p1_ext: last_p1_ext,
    last_p2_ext: last_p2_ext,
});
