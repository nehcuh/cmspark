let meta = #{
    name: "docs-reorg-phase34",
    description: "Docs reorg Phase3 user guides + Phase4 archive; Claude/Pi dual review at each major gate",
    when_to_use: "After Phase1+2 dual-approved; continue docs coverage and archive wave",
    phases: [
        #{ title: "Setup", detail: "branch + freeze scope" },
        #{ title: "Phase3-Implement", detail: "user guides + arch/GOAL/CONTRIBUTING + ADR stubs" },
        #{ title: "Phase3-Adversarial", detail: "internal fact/coverage skeptics" },
        #{ title: "Phase3-ExternalReview", detail: "Claude + Pi dual review" },
        #{ title: "Phase3-Fix", detail: "apply dual-review must_fix" },
        #{ title: "Phase4-Archive", detail: "git mv high-confidence process docs" },
        #{ title: "Phase4-NavLinks", detail: "update nav + broken links" },
        #{ title: "Phase4-ExternalReview", detail: "Claude + Pi dual review archive" },
        #{ title: "Phase4-Fix", detail: "apply archive review fixes" },
        #{ title: "Final-Gate", detail: "verify + report" },
    ],
};

// ---------- args (no fn capture of these into helpers that need schemas) ----------
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
SCOPE += "ALLOWED paths for Phase3+4:\n";
SCOPE += "- docs/computer-use-user-guide.md (create)\n";
SCOPE += "- docs/host-and-apps.md (create)\n";
SCOPE += "- docs/notebooklm-user-guide.md (create)\n";
SCOPE += "- docs/multi-agent-user-guide.md (create, optional but preferred)\n";
SCOPE += "- docs/architecture.md (add MCP/CU/host/orchestrator/board/apps/packs sections)\n";
SCOPE += "- docs/GOAL.md (add 已交付 bullets for MCP/CU/multi-agent/board/NotebookLM)\n";
SCOPE += "- CONTRIBUTING.md (tree + docs checklist + tests)\n";
SCOPE += "- docs/adr/017-computer-use.md (create compact ADR)\n";
SCOPE += "- docs/adr/018-host-use.md (create compact ADR)\n";
SCOPE += "- README.md (link new guides; keep Phase1+2 facts)\n";
SCOPE += "- docs/README.md (nav update)\n";
SCOPE += "- docs/docs-reorg-plan-2026-07-28.md (DoD checkboxes)\n";
SCOPE += "- docs/archive/** (create via git mv only)\n";
SCOPE += "- docs/audit/reviews/*docs-reorg-p3* and *docs-reorg-p4*\n";
SCOPE += "- CLAUDE.md / AGENTS.md Related Docs only if needed\n";
SCOPE += "FORBIDDEN: companion/src/**, chrome-extension/src/** runtime code.\n";
SCOPE += "IGNORE unrelated site-knowledge WIP in companion/extension.\n";
SCOPE += "Product 0.3.0. Plan: docs/docs-reorg-plan-2026-07-28.md Phase 3+4.\n";

let PHASE3 = "";
PHASE3 += "PHASE 3 — coverage (user guides, not process dumps):\n";
PHASE3 += "A) docs/computer-use-user-guide.md — enable/opt-in, Cockpit L2/急停, session-trust meaning, platforms (macOS/Windows), limits, link confirm-center + ADR-017.\n";
PHASE3 += "B) docs/host-and-apps.md — host_read/write/app tools, apps whitelist, biometric boundary, TargetId, link ADR-018 + host-adapter-interface.\n";
PHASE3 += "C) docs/notebooklm-user-guide.md — Side Panel entry, permissions, what gets imported, link ADR-011/012/013 (user-facing, not eng history).\n";
PHASE3 += "D) docs/multi-agent-user-guide.md — spawn_worker, tab locks, board tools/UI, max workers; extract from mission-pack §10 + ADR-015/016.\n";
PHASE3 += "E) architecture.md — NEW sections for MCP, Computer/Host Use, Orchestrator/Board, Apps, Packs; extend topology mention of desktop face. Keep accurate.\n";
PHASE3 += "F) GOAL.md — 已交付 bullets for MCP, Computer/Host Use, multi-agent, Mission Board, NotebookLM (same style as Obsidian/Mermaid/Pack).\n";
PHASE3 += "G) CONTRIBUTING.md — real tree (mcp/computer/host-use/orchestrator/board/packs/apps/cockpit/notebooklm); Node>=20; docs checklist from plan §7; test commands.\n";
PHASE3 += "H) ADR-017 Computer Use + ADR-018 Host Use: compact status Implemented/Accepted; Context/Decision/Consequences; point to plan paths as history NOT sole norm.\n";
PHASE3 += "I) README + docs/README: point 进阶 rows to NEW user guides (not only decisions).\n";
PHASE3 += "METHOD: read code lightly for truth (list_dir computer/ host-use/ apps/ notebooklm; skim confirm-center). Do NOT invent unshipped UX. Chinese OK. Do NOT commit.\n";

let PHASE4 = "";
PHASE4 += "PHASE 4 — archive wave (git mv ONLY, never rm):\n";
PHASE4 += "1) mkdir -p docs/archive/2026-07/{proposals,roadmaps,rfcs,audits}\n";
PHASE4 += "2) HIGH-CONFIDENCE moves (if still present):\n";
PHASE4 += "   git mv docs/sprints docs/archive/2026-07/roadmaps/\n";
PHASE4 += "   git mv docs/requirements docs/archive/2026-07/roadmaps/\n";
PHASE4 += "   git mv docs/security-optimization docs/archive/2026-07/proposals/\n";
PHASE4 += "   git mv docs/menu-bar-service docs/archive/2026-07/proposals/\n";
PHASE4 += "   git mv docs/network-interceptor-proposal docs/archive/2026-07/proposals/  (if exists)\n";
PHASE4 += "   git mv docs/knowledge-base-proposal docs/archive/2026-07/proposals/\n";
PHASE4 += "   git mv docs/knowledge-mgmt-proposal docs/archive/2026-07/proposals/\n";
PHASE4 += "   git mv docs/skill-management-proposal docs/archive/2026-07/proposals/ (if exists)\n";
PHASE4 += "   For tournament losers only if dirs remain: keep final-design.md inside archived folder.\n";
PHASE4 += "3) Root closed RFCs / old roadmaps if present (optional):\n";
PHASE4 += "   git mv docs/optimization-roadmap.md docs/archive/2026-07/roadmaps/ if exists\n";
PHASE4 += "   git mv docs/optimization-plan.md docs/archive/2026-07/roadmaps/ if exists and all items done\n";
PHASE4 += "   DO NOT move docs/optimization-plan-post-v0.3.0.md unless empty of open work\n";
PHASE4 += "   Root AUDIT_REPORT_* and audit-report-cmspark-* → docs/archive/2026-07/audits/ if exist\n";
PHASE4 += "4) MUST NOT MOVE (code-cited locks):\n";
PHASE4 += "   docs/decisions/coordinate-computer-use-plan.md, approach-c, model-provenance\n";
PHASE4 += "   docs/decisions/host-adapter-interface.md, targetid-format-synthesis.md\n";
PHASE4 += "   docs/decisions/v1.3/companion-native-hud-n1n10-lock-*.md\n";
PHASE4 += "   docs/decisions/v1.3/enterprise-session-trust-godmode-plan-*.md\n";
PHASE4 += "   docs/superpowers/**\n";
PHASE4 += "   docs/adr/** live ADRs\n";
PHASE4 += "   docs/mcp.md mission-pack confirm-center TROUBLESHOOTING architecture GOAL\n";
PHASE4 += "5) Each archive leaf dir: write README.md one-liner 非规范 historical; see docs/README.md\n";
PHASE4 += "6) Update docs/README.md archive section to point at docs/archive/2026-07/\n";
PHASE4 += "7) Fix broken links in README/docs/README/CONTRIBUTING if any pointed at moved paths\n";
PHASE4 += "8) Do NOT git commit unless asked. Do NOT force-push.\n";

// ===================== SETUP =====================
phase("Setup");
log("docs-reorg-phase34 start root=" + root);

let setup_p = "";
setup_p += "Repo " + root + ". git status; branch.\n";
setup_p += "Stay on docs/reorg-phase12-0.3.0 OR create docs/reorg-phase34-0.3.0 from current if cleaner — prefer CONTINUE current docs branch without discarding work.\n";
setup_p += "Confirm Phase1+2 artifacts exist (docs/README.md, dual-review p1/p2 verdicts).\n";
setup_p += "Do not reset hard. Do not commit. Return branch name.\n";
let setup = agent(setup_p, #{ label: "setup-p34", capability_mode: "execute" });
if setup == () || !setup.success {
    log("setup soft-fail continue");
}

// ===================== PHASE 3 =====================
let p3_ok = false;
let p3_round = 0;
let p3_feedback = "";
let last_p3_impl = ();
let last_p3_ext = ();

while p3_round < max_rounds {
    p3_round += 1;
    log("=== Phase3 round " + p3_round.to_string() + " ===");

    phase("Phase3-Implement");
    let p3i = "";
    p3i += "You are DOCUMENT implementer for CMspark Phase 3.\n";
    p3i += "Repo: " + root + "\n" + SCOPE + "\n" + PHASE3 + "\n";
    if p3_feedback != "" {
        p3i += "PREVIOUS FEEDBACK (must address):\n" + p3_feedback + "\n";
    }
    p3i += "Write accurate Chinese user guides. Spot-check code modules with list_dir/grep.\n";
    p3i += "Preserve Phase1+2 README correctness. Update links to new guides.\n";
    p3i += "Return JSON: summary, files_changed, done, checklist (each A-I item).\n";
    p3i += "Do not commit. Do not archive yet (Phase4).\n";

    let impl3 = agent(p3i, #{
        label: "phase3-impl:r" + p3_round.to_string(),
        capability_mode: "all",
        output_schema: #{
            "type": "object",
            "required": ["summary", "files_changed", "done", "checklist"],
            "properties": #{
                "summary": #{ "type": "string" },
                "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
                "done": #{ "type": "boolean" },
                "checklist": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
                "notes": #{ "type": "string" },
            },
        },
    });
    if impl3 == () || !impl3.success || impl3.output == () {
        p3_feedback = "Phase3 implement agent failed — retry";
        log("p3 impl fail");
        continue;
    }
    last_p3_impl = impl3.output;
    log("Phase3 impl: " + impl3.output.summary);

    phase("Phase3-Adversarial");
    let aj = [];
    let a1 = "";
    a1 += "ADVERSARIAL: Phase3 user-guide accuracy. Default pass=false.\n";
    a1 += "Read new guides + list_dir companion/src/computer host-use apps + extension notebooklm/cockpit.\n";
    a1 += "Flag invented UX, wrong tool names, missing L2/急停 for CU, overclaims.\n";
    a1 += "Implementer: " + json_encode(impl3.output) + "\n";
    a1 += "pass=true only zero blocking.\n";
    aj.push(#{
        label: "p3-adv-facts:r" + p3_round.to_string(),
        capability_mode: "read-only",
        output_schema: #{
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
            },
        },
        prompt: a1,
    });
    let a2 = "";
    a2 += "ADVERSARIAL: Phase3 links + coverage. Default pass=false.\n";
    a2 += "test -f docs/computer-use-user-guide.md host-and-apps notebooklm-user-guide multi-agent-user-guide adr/017 adr/018.\n";
    a2 += "README and docs/README link new guides. architecture/GOAL/CONTRIBUTING updated.\n";
    a2 += "Implementer: " + json_encode(impl3.output) + "\n";
    aj.push(#{
        label: "p3-adv-cov:r" + p3_round.to_string(),
        capability_mode: "read-only",
        output_schema: #{
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
            },
        },
        prompt: a2,
    });
    let ares = parallel(aj);
    let ap = true;
    let blocks = [];
    let sum = "";
    for x in ares {
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
    log("Phase3 adv pass=" + ap.to_string());
    if !ap {
        p3_feedback = "ADVERSARIAL: " + json_encode(#{ blocking: blocks, summary: sum });
        continue;
    }

    // External dual review — INLINE (no outer-capture fn)
    phase("Phase3-ExternalReview");
    let body3 = "";
    body3 += "# Dual review docs-reorg-p3 (Phase3 user guides)\n";
    body3 += "Product 0.3.0. Plan docs/docs-reorg-plan-2026-07-28.md Phase3.\n";
    body3 += "IGNORE companion/extension site-knowledge WIP.\n";
    body3 += "Claim: " + json_encode(impl3.output) + "\n";
    body3 += "Verify: guides match code; no false claims; ADR-017/018 sensible; README links; architecture/GOAL/CONTRIBUTING ok.\n";
    body3 += "End VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";

    let ext3p = "";
    ext3p += "Run dual external review. Do not invent verdicts.\n";
    ext3p += "1) Write /tmp/cmspark-review-docs-reorg-p3.md with:\n-----BEGIN-----\n" + body3 + "\n-----END-----\n";
    ext3p += "2) cd " + root + " && bash scripts/dual-external-review.sh docs-reorg-p3 /tmp/cmspark-review-docs-reorg-p3.md " + base_commit + "\n";
    ext3p += "3) Read newest docs/audit/reviews/docs-reorg-p3-verdict-*.json and review tails.\n";
    ext3p += "4) Return both_approve, claude_verdict, pi_verdict, paths, exit_code, raw_tail, must_fix.\n";
    let ext3 = agent(ext3p, #{
        label: "external-dual:docs-reorg-p3:r" + p3_round.to_string(),
        capability_mode: "all",
        output_schema: #{
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
        },
    });
    if ext3 == () || !ext3.success || ext3.output == () {
        await_user("verification", "Phase3 Claude/Pi dual review failed to run. Fix infra then resume.");
        p3_feedback = "external infra fail p3";
        continue;
    }
    last_p3_ext = ext3.output;
    log("P3 ext claude=" + ext3.output.claude_verdict + " pi=" + ext3.output.pi_verdict);

    if ext3.output.both_approve == true {
        p3_ok = true;
        if ext3.output.must_fix != () && ext3.output.must_fix.len() > 0 {
            phase("Phase3-Fix");
            let n = "Apply nits only: " + json_encode(ext3.output.must_fix) + "\n" + SCOPE + "\n";
            n += "Read " + ext3.output.claude_path + " " + ext3.output.pi_path + "\n";
            let _n = agent(n, #{
                label: "phase3-nits",
                capability_mode: "all",
                output_schema: #{
                    "type": "object",
                    "required": ["summary", "files_changed", "done", "checklist"],
                    "properties": #{
                        "summary": #{ "type": "string" },
                        "files_changed": #{ "type": "array", "items": #{ "type": "string" } },
                        "done": #{ "type": "boolean" },
                        "checklist": #{ "type": "array", "items": #{ "type": "string" } },
                    },
                },
            });
        }
        break;
    }
    phase("Phase3-Fix");
    p3_feedback = "EXTERNAL REJECT claude=" + ext3.output.claude_verdict + " pi=" + ext3.output.pi_verdict + "\n";
    p3_feedback += "must_fix=" + json_encode(ext3.output.must_fix) + "\n" + ext3.output.raw_tail;
}

if !p3_ok {
    await_user("verification", "Phase3 dual review not approved. Inspect docs-reorg-p3 reviews then resume for Phase4 or stop.");
}

// ===================== PHASE 4 =====================
let p4_ok = false;
let p4_round = 0;
let p4_feedback = "";
let last_p4_impl = ();
let last_p4_ext = ();

while p4_round < max_rounds {
    p4_round += 1;
    log("=== Phase4 round " + p4_round.to_string() + " ===");

    phase("Phase4-Archive");
    let p4a = "";
    p4a += "Phase4 archive implementer at " + root + ".\n" + SCOPE + "\n" + PHASE4 + "\n";
    if p4_feedback != "" {
        p4a += "FEEDBACK:\n" + p4_feedback + "\n";
    }
    p4a += "Use git mv only. Write archive README files. Update docs/README.md archive section.\n";
    p4a += "Return summary, files_changed (including moved paths), done, checklist.\n";
    let impl4a = agent(p4a, #{
        label: "phase4-archive:r" + p4_round.to_string(),
        capability_mode: "all",
        output_schema: #{
            "type": "object",
            "required": ["summary", "files_changed", "done", "checklist"],
            "properties": #{
                "summary": #{ "type": "string" },
                "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
                "done": #{ "type": "boolean" },
                "checklist": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
                "notes": #{ "type": "string" },
            },
        },
    });
    if impl4a == () || !impl4a.success || impl4a.output == () {
        p4_feedback = "archive agent failed";
        continue;
    }

    phase("Phase4-NavLinks");
    let p4b = "";
    p4b += "After archive, fix links and nav at " + root + ".\n";
    p4b += "1) rg for old paths (docs/sprints, docs/requirements, docs/security-optimization, docs/menu-bar-service, knowledge-base-proposal) in README docs CLAUDE AGENTS CONTRIBUTING — update or remove.\n";
    p4b += "2) Ensure code-cited decisions paths still exist (rg docs/decisions in companion).\n";
    p4b += "3) docs/README.md archive section accurate.\n";
    p4b += "4) Update docs/docs-reorg-plan-2026-07-28.md DoD Phase4 checkbox if done.\n";
    p4b += SCOPE + "\nPrior archive: " + json_encode(impl4a.output) + "\n";
    p4b += "Do not commit.\n";
    let impl4b = agent(p4b, #{
        label: "phase4-nav:r" + p4_round.to_string(),
        capability_mode: "all",
        output_schema: #{
            "type": "object",
            "required": ["summary", "files_changed", "done", "checklist"],
            "properties": #{
                "summary": #{ "type": "string" },
                "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
                "done": #{ "type": "boolean" },
                "checklist": #{ "type": "array", "items": #{ "type": "string" } },
            },
        },
    });
    let claim4 = json_encode(#{ archive: impl4a.output, nav: if impl4b != () && impl4b.success { impl4b.output } else { () } });
    last_p4_impl = claim4;
    log("Phase4 archive+nav done");

    phase("Phase4-ExternalReview");
    let body4 = "";
    body4 += "# Dual review docs-reorg-p4 (archive wave)\n";
    body4 += "Verify: only high-confidence process dirs archived; NO code-cited decision locks moved;\n";
    body4 += "archive READMEs present; links updated; live user docs still at docs/ root.\n";
    body4 += "Claim: " + claim4 + "\n";
    body4 += "Reject if any MUST-NOT-MOVE path missing or deleted.\n";
    body4 += "End VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";

    let ext4p = "";
    ext4p += "Run dual external review.\n";
    ext4p += "1) Write /tmp/cmspark-review-docs-reorg-p4.md:\n-----BEGIN-----\n" + body4 + "\n-----END-----\n";
    ext4p += "2) cd " + root + " && bash scripts/dual-external-review.sh docs-reorg-p4 /tmp/cmspark-review-docs-reorg-p4.md " + base_commit + "\n";
    ext4p += "3) Read verdict json + review tails; return both_approve, verdicts, paths, exit_code, raw_tail, must_fix.\n";
    let ext4 = agent(ext4p, #{
        label: "external-dual:docs-reorg-p4:r" + p4_round.to_string(),
        capability_mode: "all",
        output_schema: #{
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
        },
    });
    if ext4 == () || !ext4.success || ext4.output == () {
        await_user("verification", "Phase4 dual review failed. Resume after fix.");
        p4_feedback = "external fail p4";
        continue;
    }
    last_p4_ext = ext4.output;
    log("P4 ext claude=" + ext4.output.claude_verdict + " pi=" + ext4.output.pi_verdict);

    if ext4.output.both_approve == true {
        p4_ok = true;
        if ext4.output.must_fix != () && ext4.output.must_fix.len() > 0 {
            phase("Phase4-Fix");
            let nf = "Apply archive nits: " + json_encode(ext4.output.must_fix) + "\n" + PHASE4 + "\n" + SCOPE;
            let _nf = agent(nf, #{
                label: "phase4-nits",
                capability_mode: "all",
                output_schema: #{
                    "type": "object",
                    "required": ["summary", "files_changed", "done", "checklist"],
                    "properties": #{
                        "summary": #{ "type": "string" },
                        "files_changed": #{ "type": "array", "items": #{ "type": "string" } },
                        "done": #{ "type": "boolean" },
                        "checklist": #{ "type": "array", "items": #{ "type": "string" } },
                    },
                },
            });
        }
        break;
    }
    phase("Phase4-Fix");
    p4_feedback = "REJECT " + ext4.output.claude_verdict + "/" + ext4.output.pi_verdict + "\n";
    p4_feedback += json_encode(ext4.output.must_fix) + "\n" + ext4.output.raw_tail;
}

// ===================== FINAL =====================
phase("Final-Gate");
let vf = "";
vf += "Final verify Phase3+4 at " + root + ":\n";
vf += "1) test -f docs/computer-use-user-guide.md docs/host-and-apps.md docs/notebooklm-user-guide.md docs/multi-agent-user-guide.md\n";
vf += "2) test -f docs/adr/017-computer-use.md docs/adr/018-host-use.md\n";
vf += "3) test -d docs/archive/2026-07 && test ! -d docs/sprints && test ! -d docs/security-optimization\n";
vf += "4) test -f docs/decisions/coordinate-computer-use-plan.md docs/decisions/host-adapter-interface.md  (locks still present)\n";
vf += "5) rg 等待用户确认机制完成后开放 README → empty\n";
vf += "6) README links to new user guides\n";
vf += "ok=true only if all pass. List failed.\n";
let ver = agent(vf, #{
    label: "final-verify-p34",
    capability_mode: "all",
    output_schema: #{
        "type": "object",
        "required": ["ok", "checks", "log"],
        "properties": #{
            "ok": #{ "type": "boolean" },
            "checks": #{ "type": "array", "items": #{ "type": "string" } },
            "log": #{ "type": "string" },
            "failed": #{ "type": "array", "items": #{ "type": "string" } },
        },
    },
});
let verify_ok = false;
if ver != () && ver.success && ver.output != () && ver.output.ok == true {
    verify_ok = true;
}

let report = "";
report += "# Docs Reorg Phase3+4 Workflow Report\n\n";
report += "- p3_ok: " + p3_ok.to_string() + " rounds=" + p3_round.to_string() + "\n";
report += "- p4_ok: " + p4_ok.to_string() + " rounds=" + p4_round.to_string() + "\n";
report += "- verify_ok: " + verify_ok.to_string() + "\n";
report += "- last_p3_impl: " + json_encode(last_p3_impl) + "\n";
report += "- last_p3_ext: " + json_encode(last_p3_ext) + "\n";
report += "- last_p4_impl: " + last_p4_impl + "\n";
report += "- last_p4_ext: " + json_encode(last_p4_ext) + "\n";
if ver != () && ver.success {
    report += "- final: " + json_encode(ver.output) + "\n";
}
let rpath = write_scratch_file("docs-reorg-phase34-report.md", report);

let pr = "Write report to docs/audit/reviews/docs-reorg-phase34-workflow-report.md:\n\n" + report;
let _pr = agent(pr, #{ label: "persist-p34-report", capability_mode: "read-write" });

if !p3_ok || !p4_ok || !verify_ok {
    await_user("verification", "phase34 incomplete p3=" + p3_ok.to_string() + " p4=" + p4_ok.to_string() + " verify=" + verify_ok.to_string());
}

complete(#{
    p3_ok: p3_ok,
    p4_ok: p4_ok,
    verify_ok: verify_ok,
    p3_rounds: p3_round,
    p4_rounds: p4_round,
    report_path: rpath,
    status: if p3_ok && p4_ok && verify_ok { "ready_to_commit" } else { "needs_work" },
    last_p3_ext: last_p3_ext,
    last_p4_ext: last_p4_ext,
});
