let meta = #{
    name: "docs-reorg-phase12",
    description: "Docs reorg Phase1+2: factual fixes + README hub + docs/README, with Claude/Pi dual review gates",
    when_to_use: "After docs-reorg-plan-2026-07-28; execute Phase 1 corrections and Phase 2 README entry with dual external review",
    phases: [
        #{ title: "Setup", detail: "branch + scope freeze" },
        #{ title: "Phase1-Implement", detail: "correct false docs claims" },
        #{ title: "Phase1-Adversarial", detail: "internal fact-check skeptics" },
        #{ title: "Phase1-ExternalReview", detail: "Claude Code + Pi dual review" },
        #{ title: "Phase1-Fix", detail: "apply dual-review must_fix if any" },
        #{ title: "Phase2-Implement", detail: "README matrix + docs/README nav" },
        #{ title: "Phase2-Adversarial", detail: "internal coverage skeptics" },
        #{ title: "Phase2-ExternalReview", detail: "Claude Code + Pi dual review" },
        #{ title: "Phase2-Fix", detail: "apply dual-review must_fix if any" },
        #{ title: "Final-Gate", detail: "negative rg checks + report" },
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

// ---------- args ----------
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

// In-scope files ONLY (docs reorg). Do not touch companion/chrome-extension product code.
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
SCOPE += "NOTE: workspace may contain unrelated WIP (site-knowledge hostname code). IGNORE those diffs in reviews; do not revert them.\n";
SCOPE += "Product version: companion/chrome-extension 0.3.0. Node requirement unify to >=20.\n";
SCOPE += "Plan of record: docs/docs-reorg-plan-2026-07-28.md Phase 1+2 only (NOT Phase 3 archive/new long guides).\n";

let PHASE1 = "";
PHASE1 += "PHASE 1 — factual corrections (must complete all):\n";
PHASE1 += "1.1 README FAQ: rewrite evaluate row — L2 confirmation + Confirm Center/Cockpit SHIPPED; ~45s timeout; NOT 'waiting for confirmation mechanism'.\n";
PHASE1 += "1.2 README footer stage line: MVP stable + delivered extensions (Obsidian/Mermaid/Mission Pack/MCP/etc.) + opt-in advanced (CU/host/multi-agent).\n";
PHASE1 += "1.3 README package examples v0.2.0 → 0.3.0; Node.js >= 20 (align CONTRIBUTING/CI).\n";
PHASE1 += "1.4 README daemon/macOS tray: Swift NSStatusBar + pairing code window (not only node-notifier+readline).\n";
PHASE1 += "1.5 docs/GOAL.md G8: DELETE risk-engine + privilege-manager claims; document real gates (trusted_domains, L2 SecurityConfirmationManager, auto_approved_domains, ADR-010 god-mode, page-sanitizer).\n";
PHASE1 += "1.6 docs/adr/016-mission-board.md status: Implemented (P0) — board/ + board_* tools + BoardPanel exist; keep decision content.\n";
PHASE1 += "1.7 docs/architecture.md §4 tree: fix root name cmsspark→cmspark; remove phantoms (ConnectionStatus.tsx, InputArea.tsx if absent, security-token.ts, companion/src/server/ subdir); list real modules: mcp/, computer/, host-use/, orchestrator/, board/, packs/, capability/, apps/, netsec/, obsidian/, hud/, tray/, cockpit/, notebooklm/; keep §1.5 security truth; remove false 'security-token.ts manages HMAC' if file absent (HMAC is companion security-policy).\n";
PHASE1 += "1.8 docs/TESTING.md: full rewrite — node:test; companion ~120+ tests under companion/tests (map areas: security, integration, computer, host-use, apps, packs, board, orchestrator, mcp, obsidian); extension ~25 pure-logic tests; run commands; delete server.test.ts reference.\n";
PHASE1 += "Negative checks after edits: rg must NOT find '等待用户确认机制完成后开放' in README; rg must NOT find 'risk-engine 风险评分 + privilege-manager' in GOAL as live design.\n";

let PHASE2 = "";
PHASE2 += "PHASE 2 — README as hub + docs/README.md:\n";
PHASE2 += "2.1 Replace narrow 6-row '核心能力' table with TIERED capability matrix (核心/已交付/进阶opt-in/运维) covering: browser tools, multi-thread, skills, knowledge, cookie trust, L2 confirm/Cockpit, MCP, Mission Pack/enterprise, Obsidian export, Mermaid, NotebookLM import, Computer/Host Use, multi-agent+board, Apps, file upload/PDF, daemon/tray/pairing. Link to existing docs (mcp.md, mission-pack-usage.md, confirm-center-user-guide.md, TROUBLESHOOTING.md, ADRs). Do NOT invent missing full user guides as if complete — for CU/host/NLM say '进阶 / 见 ADR 或计划中用户指南'.\n";
PHASE2 += "2.2 Short sections (5-15 lines each + link): 安全与确认; MCP; 任务包; 导出与导入; 桌面与宿主; 多 Agent 与任务板; 文件上传; update 相关文档 table.\n";
PHASE2 += "2.3 Fix tool count language (no hard 23-only); mark skill tool_chain/sub_agent as schema/experimental vs orchestrator multi-agent.\n";
PHASE2 += "2.4 Keep Knowledge section quality (already good).\n";
PHASE2 += "2.5 Create docs/README.md navigation: 用户指南 | 架构与目标 | ADR | 工程 | 进行中 superpowers | 归档说明 (archive policy text; do NOT move files in Phase2).\n";
PHASE2 += "2.6 Update README 目录 TOC for new anchors.\n";
PHASE2 += "2.7 Expand ~/.cmspark-agent/ tree if still missing packs/obsidian/logs.\n";
PHASE2 += "Do NOT archive/move docs/decisions (Phase4). Do NOT write full computer-use-user-guide yet (Phase3).\n";

// ===================== SETUP =====================
phase("Setup");
log("docs-reorg-phase12 starting at " + root);

let setup_p = "";
setup_p += "Repo root: " + root + "\n";
setup_p += "1) cd there; git status --short; git rev-parse --short HEAD\n";
setup_p += "2) Create/switch branch: git checkout -B docs/reorg-phase12-0.3.0 (do not discard existing uncommitted work)\n";
setup_p += "3) Confirm plan files exist: docs/docs-reorg-plan-2026-07-28.md and docs/audit/diagnosis-fanout-2026-07-28.md\n";
setup_p += "4) Do NOT commit or push. Do NOT reset --hard.\n";
setup_p += "5) Return one-line branch + HEAD.\n";
let setup = agent(setup_p, #{
    label: "setup-docs-reorg",
    capability_mode: "execute",
});
if setup == () || !setup.success {
    log("Setup agent soft-failed — continue on current branch");
}

// Helper: run dual external review for a batch id
// NOTE: Rhai fn does not capture outer locals — pass repo_root explicitly.
fn run_external(batch_id, scope_text, claim_json, base, repo_root) {
    let body = "";
    body += "# External dual review — CMspark docs reorg\n";
    body += "Batch: " + batch_id + "\n";
    body += "Product: companion/chrome-extension 0.3.0\n";
    body += "Plan: docs/docs-reorg-plan-2026-07-28.md\n\n";
    body += "## Scope (REVIEW ONLY THESE DOC CHANGES)\n";
    body += scope_text + "\n";
    body += "IGNORE unrelated companion/chrome-extension WIP in the full git diff (site-knowledge hostname etc.).\n\n";
    body += "## Implementer claim\n";
    body += claim_json + "\n\n";
    body += "## What to verify\n";
    body += "1) No false product claims (confirmation exists; no live risk-engine/privilege-manager; ADR-016 board is implemented).\n";
    body += "2) architecture tree matches real directories under companion/src and chrome-extension/src.\n";
    body += "3) TESTING.md not inventing missing files; counts roughly accurate.\n";
    body += "4) README capability matrix matches shipped surfaces; links resolve to existing files.\n";
    body += "5) Node >=20 and version 0.3.0 consistency.\n";
    body += "6) No drive-by code changes claimed as docs work.\n";
    body += "Read files with tools. End with VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";

    let ext_p = "";
    ext_p += "You MUST run the dual external review helper. Do not invent verdicts.\n";
    ext_p += "1) Write review prompt to /tmp/cmspark-review-" + batch_id + ".md (full content between markers):\n";
    ext_p += "-----BEGIN PROMPT-----\n";
    ext_p += body;
    ext_p += "\n-----END PROMPT-----\n";
    ext_p += "2) cd " + repo_root + " && bash scripts/dual-external-review.sh " + batch_id + " /tmp/cmspark-review-" + batch_id + ".md " + base + "\n";
    ext_p += "   Wait until Claude and Pi finish (may take several minutes).\n";
    ext_p += "3) Read newest docs/audit/reviews/" + batch_id + "-verdict-*.json\n";
    ext_p += "4) Read tail of claude and pi review md files; extract must_fix / blocking from REJECT or nits.\n";
    ext_p += "5) Return both_approve, claude_verdict, pi_verdict, paths, exit_code, raw_tail, must_fix array.\n";
    ext_p += "exit_code: 0 both ok, 2 reject, 3 infra.\n";

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

// ===================== PHASE 1 LOOP =====================
let p1_ok = false;
let p1_round = 0;
let p1_feedback = "";
let last_p1_impl = ();
let last_p1_ext = ();

while p1_round < max_rounds {
    p1_round += 1;
    log("=== Phase1 round " + p1_round.to_string() + " ===");

    phase("Phase1-Implement");
    let p1i = "";
    p1i += "You are the DOCUMENT implementer for CMspark docs reorg Phase 1.\n";
    p1i += "Repo: " + root + "\n";
    p1i += SCOPE + "\n";
    p1i += PHASE1 + "\n";
    if p1_feedback != "" {
        p1i += "\nPREVIOUS FEEDBACK (must address):\n" + p1_feedback + "\n";
    }
    p1i += "METHOD:\n";
    p1i += "1) Read each target file and spot-check real code dirs with list_dir/grep before editing.\n";
    p1i += "2) Apply edits with search_replace/write. Minimal, accurate Chinese prose.\n";
    p1i += "3) Run negative rg checks listed in PHASE1.\n";
    p1i += "4) git diff --stat on allowed paths only.\n";
    p1i += "5) Do NOT commit/push. Do NOT touch product code.\n";
    p1i += "Set done=true only if all Phase1 checklist items are satisfied.\n";

    let impl1 = agent(p1i, #{
        label: "phase1-impl:r" + p1_round.to_string(),
        capability_mode: "all",
        output_schema: impl_schema,
    });
    if impl1 == () || !impl1.success || impl1.output == () {
        p1_feedback = "Phase1 implement agent failed; retry carefully.";
        log("Phase1 implement failed");
        continue;
    }
    last_p1_impl = impl1.output;
    log("Phase1 impl: " + impl1.output.summary);

    phase("Phase1-Adversarial");
    let ajobs = [];
    let a1 = "";
    a1 += "ADVERSARIAL FACT CHECKER for docs Phase1. Default pass=false.\n";
    a1 += "Read ACTUAL files after edits and code tree. Refute false claims.\n";
    a1 += SCOPE + "\n" + PHASE1 + "\n";
    a1 += "Implementer claim: " + json_encode(impl1.output) + "\n";
    a1 += "Must verify: README FAQ evaluate; GOAL G8; ADR-016 status; architecture phantoms gone; TESTING no server.test.ts; Node/version.\n";
    a1 += "Use rg/read_file/list_dir. pass=true only if zero blocking factual errors remain.\n";
    ajobs.push(#{
        label: "p1-adv-facts:r" + p1_round.to_string(),
        capability_mode: "read-only",
        output_schema: adv_schema,
        prompt: a1,
    });
    let a2 = "";
    a2 += "ADVERSARIAL CODE-DOC ALIGNMENT for Phase1 architecture tree + TESTING map. Default pass=false.\n";
    a2 += "list_dir companion/src, chrome-extension/src, companion/tests, chrome-extension/tests.\n";
    a2 += "Compare to docs/architecture.md §4 and docs/TESTING.md. Flag phantoms or gross omissions of major modules that Phase1 required.\n";
    a2 += "Implementer: " + json_encode(impl1.output) + "\n";
    ajobs.push(#{
        label: "p1-adv-align:r" + p1_round.to_string(),
        capability_mode: "read-only",
        output_schema: adv_schema,
        prompt: a2,
    });
    let ares = parallel(ajobs);
    let adv_pass = true;
    let adv_blocks = [];
    let adv_sum = "";
    for ar in ares {
        if ar == () || !ar.success || ar.output == () {
            adv_pass = false;
            adv_sum += "adv agent failed; ";
        } else {
            if ar.output.pass != true {
                adv_pass = false;
            }
            if ar.output.blocking != () {
                for b in ar.output.blocking {
                    adv_blocks.push(b);
                }
            }
            adv_sum += ar.output.summary + " | ";
        }
    }
    log("Phase1 adversarial pass=" + adv_pass.to_string() + " blocks=" + adv_blocks.len().to_string());
    if !adv_pass {
        p1_feedback = "INTERNAL ADVERSARIAL FAILED:\n" + json_encode(#{ blocking: adv_blocks, summary: adv_sum });
        continue;
    }

    phase("Phase1-ExternalReview");
    let ext1 = run_external("docs-reorg-p1", SCOPE + "\n" + PHASE1, json_encode(impl1.output), base_commit, root);
    if ext1 == () || !ext1.success || ext1.output == () {
        await_user("verification", "Phase1 external Claude/Pi review failed. Inspect docs/audit/reviews/ then resume.");
        p1_feedback = "External review infra failed — re-run dual-external-review.sh for docs-reorg-p1";
        continue;
    }
    last_p1_ext = ext1.output;
    log("Phase1 external claude=" + ext1.output.claude_verdict + " pi=" + ext1.output.pi_verdict);

    if ext1.output.both_approve == true {
        p1_ok = true;
        // Optional nits still applied once if must_fix non-empty
        if ext1.output.must_fix != () && ext1.output.must_fix.len() > 0 {
            phase("Phase1-Fix");
            let fix1 = "";
            fix1 += "Apply APPROVE_WITH_NITS must_fix only (no scope expansion):\n";
            fix1 += json_encode(ext1.output.must_fix) + "\n";
            fix1 += "Also read: " + ext1.output.claude_path + " and " + ext1.output.pi_path + "\n";
            fix1 += SCOPE + "\nDo not commit.\n";
            fix1 += "Return summary of nits applied.\n";
            let _f1 = agent(fix1, #{
                label: "phase1-nits",
                capability_mode: "all",
                output_schema: impl_schema,
            });
        }
        break;
    }

    phase("Phase1-Fix");
    p1_feedback = "";
    p1_feedback += "EXTERNAL REJECTED.\nclaude=" + ext1.output.claude_verdict + " pi=" + ext1.output.pi_verdict + "\n";
    p1_feedback += "must_fix=" + json_encode(ext1.output.must_fix) + "\n";
    p1_feedback += "raw_tail:\n" + ext1.output.raw_tail + "\n";
    p1_feedback += "Read full review files and fix ALL blocking issues.\n";
}

if !p1_ok {
    await_user("verification", "Phase1 did not get dual APPROVE after max rounds. Inspect docs/audit/reviews/docs-reorg-p1-* then resume to continue Phase2 anyway or abort.");
}

// ===================== PHASE 2 LOOP =====================
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
    p2i += "You are the DOCUMENT implementer for CMspark docs reorg Phase 2.\n";
    p2i += "Repo: " + root + "\n";
    p2i += SCOPE + "\n" + PHASE2 + "\n";
    p2i += "Phase1 should already have fixed false claims — preserve those fixes.\n";
    if p2_feedback != "" {
        p2i += "\nPREVIOUS FEEDBACK:\n" + p2_feedback + "\n";
    }
    p2i += "METHOD: read README fully; edit capability table + short sections + TOC; create docs/README.md; verify links exist with test -f / list_dir; do not commit; do not touch product code.\n";
    p2i += "Set done=true when matrix + short sections + docs/README.md + 相关文档 are complete.\n";

    let impl2 = agent(p2i, #{
        label: "phase2-impl:r" + p2_round.to_string(),
        capability_mode: "all",
        output_schema: impl_schema,
    });
    if impl2 == () || !impl2.success || impl2.output == () {
        p2_feedback = "Phase2 implement failed";
        continue;
    }
    last_p2_impl = impl2.output;
    log("Phase2 impl: " + impl2.output.summary);

    phase("Phase2-Adversarial");
    let bjobs = [];
    let b1 = "";
    b1 += "ADVERSARIAL README COVERAGE skeptic. Default pass=false.\n";
    b1 += "Read README.md and docs/README.md. Check capability matrix covers MCP, Mission Pack, Confirm/Cockpit, CU/host (as advanced), multi-agent/board, Obsidian export, Mermaid, NotebookLM, Apps, file upload, pairing — or honestly labels missing guides.\n";
    b1 += "Check all markdown links in new sections point to existing paths.\n";
    b1 += "Implementer: " + json_encode(impl2.output) + "\n";
    bjobs.push(#{
        label: "p2-adv-coverage:r" + p2_round.to_string(),
        capability_mode: "read-only",
        output_schema: adv_schema,
        prompt: b1,
    });
    let b2 = "";
    b2 += "ADVERSARIAL NO-REGRESSION skeptic for Phase1 facts after Phase2 edits. Default pass=false.\n";
    b2 += "rg README for forbidden phrase 等待用户确认机制完成后开放; rg GOAL for live risk-engine+privilege-manager; check ADR-016 status; Node>=20; 0.3.0 examples.\n";
    b2 += "pass=true only if Phase1 corrections still hold AND Phase2 hub is real.\n";
    bjobs.push(#{
        label: "p2-adv-noregress:r" + p2_round.to_string(),
        capability_mode: "read-only",
        output_schema: adv_schema,
        prompt: b2,
    });
    let bres = parallel(bjobs);
    let bpass = true;
    let bblocks = [];
    let bsum = "";
    for br in bres {
        if br == () || !br.success || br.output == () {
            bpass = false;
            bsum += "adv failed; ";
        } else {
            if br.output.pass != true {
                bpass = false;
            }
            if br.output.blocking != () {
                for x in br.output.blocking {
                    bblocks.push(x);
                }
            }
            bsum += br.output.summary + " | ";
        }
    }
    log("Phase2 adversarial pass=" + bpass.to_string());
    if !bpass {
        p2_feedback = "INTERNAL ADVERSARIAL: " + json_encode(#{ blocking: bblocks, summary: bsum });
        continue;
    }

    phase("Phase2-ExternalReview");
    let ext2 = run_external("docs-reorg-p2", SCOPE + "\n" + PHASE2 + "\nPreserve Phase1 fixes.", json_encode(impl2.output), base_commit, root);
    if ext2 == () || !ext2.success || ext2.output == () {
        await_user("verification", "Phase2 external Claude/Pi review failed. Inspect docs/audit/reviews/ then resume.");
        p2_feedback = "External review infra failed for docs-reorg-p2";
        continue;
    }
    last_p2_ext = ext2.output;
    log("Phase2 external claude=" + ext2.output.claude_verdict + " pi=" + ext2.output.pi_verdict);

    if ext2.output.both_approve == true {
        p2_ok = true;
        if ext2.output.must_fix != () && ext2.output.must_fix.len() > 0 {
            phase("Phase2-Fix");
            let fix2 = "";
            fix2 += "Apply nits only: " + json_encode(ext2.output.must_fix) + "\n";
            fix2 += "Read " + ext2.output.claude_path + " " + ext2.output.pi_path + "\n" + SCOPE + "\n";
            let _f2 = agent(fix2, #{
                label: "phase2-nits",
                capability_mode: "all",
                output_schema: impl_schema,
            });
        }
        break;
    }

    phase("Phase2-Fix");
    p2_feedback = "EXTERNAL REJECTED claude=" + ext2.output.claude_verdict + " pi=" + ext2.output.pi_verdict + "\n";
    p2_feedback += "must_fix=" + json_encode(ext2.output.must_fix) + "\nraw:\n" + ext2.output.raw_tail;
}

// ===================== FINAL GATE =====================
phase("Final-Gate");
let v_p = "";
v_p += "Final verification for docs reorg Phase1+2 in " + root + ".\n";
v_p += "1) rg -n '等待用户确认机制完成后开放' README.md → must be empty\n";
v_p += "2) rg -n 'risk-engine 风险评分 \\+ privilege-manager' docs/GOAL.md → must be empty or only historical negation\n";
v_p += "3) head status line docs/adr/016-mission-board.md — must not say 尚未实现产品代码\n";
v_p += "4) test -f docs/README.md\n";
v_p += "5) rg -n 'MCP|任务包|确认|Mission Pack|Cockpit' README.md | head\n";
v_p += "6) rg -n 'ConnectionStatus|security-token.ts|cmsspark/' docs/architecture.md → should be empty\n";
v_p += "7) git diff --stat -- README.md docs/GOAL.md docs/architecture.md docs/TESTING.md docs/adr/016-mission-board.md docs/README.md\n";
v_p += "8) Confirm no product code files were modified by this work intentionally (if companion/chrome-extension dirty, note as pre-existing WIP).\n";
v_p += "Return ok=true only if checks 1-6 pass. List failed.\n";
let ver = agent(v_p, #{
    label: "final-verify",
    capability_mode: "all",
    output_schema: verify_schema,
});

let verify_ok = false;
if ver != () && ver.success && ver.output != () && ver.output.ok == true {
    verify_ok = true;
}

// Persist report
let report = "";
report += "# Docs Reorg Phase1+2 Workflow Report\n\n";
report += "- date: 2026-07-28\n";
report += "- p1_ok: " + p1_ok.to_string() + " rounds=" + p1_round.to_string() + "\n";
report += "- p2_ok: " + p2_ok.to_string() + " rounds=" + p2_round.to_string() + "\n";
report += "- verify_ok: " + verify_ok.to_string() + "\n";
report += "- last_p1_impl: " + json_encode(last_p1_impl) + "\n";
report += "- last_p1_ext: " + json_encode(last_p1_ext) + "\n";
report += "- last_p2_impl: " + json_encode(last_p2_impl) + "\n";
report += "- last_p2_ext: " + json_encode(last_p2_ext) + "\n";
if ver != () && ver.success {
    report += "- final_verify: " + json_encode(ver.output) + "\n";
}
report += "\n## Artifacts\n";
report += "- Plan: docs/docs-reorg-plan-2026-07-28.md\n";
report += "- Diagnosis: docs/audit/diagnosis-fanout-2026-07-28.md\n";
report += "- Dual reviews: docs/audit/reviews/docs-reorg-p1-* and docs-reorg-p2-*\n";

let rpath = write_scratch_file("docs-reorg-phase12-report.md", report);

let persist = "";
persist += "Write the following report to docs/audit/reviews/docs-reorg-phase12-workflow-report.md using the write tool (overwrite OK):\n\n";
persist += report;
let _pr = agent(persist, #{
    label: "persist-report",
    capability_mode: "read-write",
});

if !p1_ok || !p2_ok || !verify_ok {
    await_user("verification", "docs-reorg-phase12 incomplete: p1_ok=" + p1_ok.to_string() + " p2_ok=" + p2_ok.to_string() + " verify_ok=" + verify_ok.to_string() + ". Inspect reviews then resume or stop.");
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
