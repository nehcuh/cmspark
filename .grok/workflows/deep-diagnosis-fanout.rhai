let meta = #{
    name: "deep-diagnosis-fanout",
    description: "Multi-dimension deep health audit of CMspark via parallel subsystem + cross-cut fan-out",
    when_to_use: "Full-project multi-dimension diagnosis / deep audit / 体检 / 审查",
    phases: [
        #{ title: "Subsystem", detail: "10 parallel map+diagnose agents" },
        #{ title: "CrossCut", detail: "6 parallel cross-cutting auditors" },
        #{ title: "Verify", detail: "adversarial skeptics on Critical/High" },
        #{ title: "Synthesize", detail: "dedupe, score, write audit report" },
    ],
};

// Structured finding card (compact enough for schema validation)
let finding_item = #{
    "type": "object",
    "required": ["id", "severity", "category", "title", "file", "evidence", "impact", "fix_hint"],
    "properties": #{
        "id": #{ "type": "string", "description": "Short id e.g. SEC-1" },
        "severity": #{ "type": "string", "enum": ["critical", "high", "medium", "low", "info"] },
        "category": #{ "type": "string" },
        "title": #{ "type": "string" },
        "file": #{ "type": "string", "description": "path:line or path range" },
        "evidence": #{ "type": "string", "description": "Concrete code evidence; quote snippets" },
        "impact": #{ "type": "string" },
        "fix_hint": #{ "type": "string" },
        "confidence": #{ "type": "string", "enum": ["confirmed", "suspected"] },
        "prior_status": #{ "type": "string", "description": "new | still_open | partial | fixed_verify | n/a" },
    },
};

let diagnose_schema = #{
    "type": "object",
    "required": ["subsystem", "purpose", "summary", "findings", "prior_recheck"],
    "properties": #{
        "subsystem": #{ "type": "string" },
        "purpose": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "health_score": #{ "type": "number", "minimum": 0, "maximum": 10 },
        "findings": #{ "type": "array", "maxItems": 10, "items": finding_item },
        "prior_recheck": #{ "type": "string", "description": "Status of known prior-audit issues in this area" },
        "files_read": #{ "type": "array", "maxItems": 30, "items": #{ "type": "string" } },
    },
};

let crosscut_schema = #{
    "type": "object",
    "required": ["dimension", "summary", "score", "findings"],
    "properties": #{
        "dimension": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "score": #{ "type": "number", "minimum": 0, "maximum": 10 },
        "findings": #{ "type": "array", "maxItems": 8, "items": finding_item },
        "architecture_notes": #{ "type": "string" },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["finding_id", "real", "reason", "evidence"],
    "properties": #{
        "finding_id": #{ "type": "string" },
        "real": #{ "type": "boolean" },
        "severity_adjusted": #{ "type": "string", "enum": ["critical", "high", "medium", "low", "info", "wontfix", "refuted"] },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

let synth_schema = #{
    "type": "object",
    "required": ["overall_score", "grade", "executive_summary", "score_dashboard", "top_risks", "action_plan", "report_markdown"],
    "properties": #{
        "overall_score": #{ "type": "number" },
        "grade": #{ "type": "string" },
        "executive_summary": #{ "type": "string" },
        "score_dashboard": #{ "type": "string" },
        "top_risks": #{ "type": "array", "maxItems": 15, "items": #{ "type": "string" } },
        "action_plan": #{ "type": "string" },
        "confirmed_critical": #{ "type": "number" },
        "confirmed_high": #{ "type": "number" },
        "total_findings": #{ "type": "number" },
        "report_markdown": #{ "type": "string", "description": "Full audit report in markdown" },
    },
};

// ---------- shared prompt preamble ----------
fn base_rules() {
    let s = "";
    s += "You are a senior staff engineer doing a READ-ONLY deep audit of the CMspark monorepo at the workspace root.\n";
    s += "Project: Chrome Extension (Plasmo+React MV3 Side Panel) <-> WebSocket loopback <-> Companion (Node.js+TypeScript).\n";
    s += "Data dir concept: ~/.cmspark-agent/. Major surfaces: security gates, MCP, computer-use/host-use, tray, Obsidian export, LLM tool loop.\n";
    s += "MANDATORY METHOD:\n";
    s += "1) Use list_dir, grep, and read_file extensively. NEVER answer from memory or prior audits alone.\n";
    s += "2) Every finding MUST cite file:line with a short quoted snippet in evidence.\n";
    s += "3) Prefer real bugs/risks over style nits. Empty findings is valid ONLY after reading the relevant code.\n";
    s += "4) Severity: critical=exploit/data-loss/trust-root; high=bypass/release-block; medium=solid defect; low=debt; info=observation.\n";
    s += "5) confidence=confirmed only if you read the code path; suspected if inferred.\n";
    s += "6) Exclude node_modules, dist, build, dist-package binaries, .plasmo from scope.\n";
    s += "7) Prior full audit (2026-07-09) claimed: WS no auth (C1), history never flush (C2), CI || true (C3), critical npm vulns (C4). RE-VERIFY current code — many may be fixed (ws-auth.ts exists; CI no longer uses || true).\n";
    s += "8) New major surface since last audit: companion/src/computer/ and companion/src/host-use/ (desktop automation).\n";
    s += "Return structured JSON matching the schema. Cap findings to the strongest ones.\n";
    s
}

fn subsystem_prompt(name, focus_paths, special) {
    let p = base_rules();
    p += "\n## Your assignment: SUBSYSTEM MAP + DIAGNOSE\n";
    p += "Subsystem name: " + name + "\n";
    p += "Focus paths (start here, then follow imports):\n" + focus_paths + "\n";
    p += "Special questions:\n" + special + "\n";
    p += "Deliver: purpose (what this subsystem does), health_score 0-10 (10=excellent), findings[], prior_recheck, files_read[].\n";
    p += "id prefix for findings: use a short subsystem tag like SEC-, SRV-, LLM-, MCP-, COMP-, PERS-, EXT-, SKILL-, OPS-, TEST-.\n";
    p
}

// ===================== PHASE 1: SUBSYSTEM FAN-OUT =====================
phase("Subsystem");
log("Phase 1: 10 parallel subsystem map+diagnose agents");

let jobs = [];

jobs.push(#{
    label: "sub:security",
    capability_mode: "read-only",
    output_schema: diagnose_schema,
    prompt: subsystem_prompt(
        "Security (auth, gates, confirmation, policy, sanitizer)",
        "- companion/src/ws-auth.ts\n- companion/src/security.ts, security-policy.ts, security-confirmation.ts\n- companion/src/settings-web.ts\n- companion/src/server.ts (auth handshake, confirmation broadcast)\n- chrome-extension/src/background/security-token.ts, page-sanitizer.ts, browser-bridge.ts (evaluate/cookie paths)",
        "1) Is WebSocket authenticated now (verifyClient / secret / pairing)? Who can connect?\n2) Can confirmation responses be spoofed by another WS peer?\n3) evaluate/osascript_eval default-deny still real? Extension-side HMAC dead or live?\n4) settings-web Host/Origin/token/SSRF still intact?\n5) Selector/value string injection in browser-bridge still present?\n6) config.json permissions and secret handling."
    ),
});

jobs.push(#{
    label: "sub:server-router",
    capability_mode: "read-only",
    output_schema: diagnose_schema,
    prompt: subsystem_prompt(
        "Server + Message Router + Protocol",
        "- companion/src/server.ts\n- companion/src/message-router.ts\n- companion/src/index.ts, daemon.ts, crash-handlers.ts\n- companion/src/types/ if any protocol types",
        "1) WS lifecycle: connect, auth, reject, broadcast filtering.\n2) Shutdown path: does it flush history, close MCP, release locks?\n3) God-file risks and error handling consistency.\n4) Message validation (validateWsMessage) completeness vs untrusted input.\n5) Race conditions with await gaps on config/state."
    ),
});

jobs.push(#{
    label: "sub:llm-tools",
    capability_mode: "read-only",
    output_schema: diagnose_schema,
    prompt: subsystem_prompt(
        "LLM adapter + tool execution loop",
        "- companion/src/llm/ (adapter.ts, llm-extract.ts, ...)\n- companion/src/bridge/\n- companion/src/security.ts (tool gates)\n- MAX_TOOL_CALL_ROUNDS, abort/cancel paths",
        "1) Tool-call loop abort: does chat.abort cancel extension-forwarded tools AND MCP?\n2) Zod/schema validation for native vs mcp__* tools.\n3) Prompt-injection / jailbreak output checks.\n4) Token/cost budget, concurrency limits, retry storms.\n5) History redaction on tool results."
    ),
});

jobs.push(#{
    label: "sub:mcp",
    capability_mode: "read-only",
    output_schema: diagnose_schema,
    prompt: subsystem_prompt(
        "MCP subsystem",
        "- companion/src/mcp/ (manager, transport, aggregator, client, confirm-cache)\n- server/message-router MCP handlers\n- tests under companion/tests related to mcp",
        "1) Capability gates / declared capabilities enforcement.\n2) Destructive tool detection bypasses (ASCII-only, synonyms).\n3) Result redaction into history.\n4) Process lifecycle: force-kill, deadServers, restart storms.\n5) Injection scan coverage on tool descriptions vs titles/examples."
    ),
});

jobs.push(#{
    label: "sub:computer-use",
    capability_mode: "read-only",
    output_schema: diagnose_schema,
    prompt: subsystem_prompt(
        "Computer-use + Host-use (desktop automation — NEW major surface)",
        "- companion/src/computer/ (all ts)\n- companion/src/host-use/ (all ts + darwin)\n- related server/router tool registration\n- docs/decisions/v1.3/ if present",
        "1) Privilege model: what can the agent click/type/screenshot without confirmation?\n2) E-stop / kill-switch reliability.\n3) Coordinate/window focus races; FOREGROUND-YIELD safety.\n4) Path/script injection in host scripts.\n5) Platform gates (macOS vs Windows) and entitlement risks.\n6) Trust elevation and session-level trust abuse."
    ),
});

jobs.push(#{
    label: "sub:persistence",
    capability_mode: "read-only",
    output_schema: diagnose_schema,
    prompt: subsystem_prompt(
        "Persistence (history, threads, config, logs)",
        "- companion/src/history/store.ts\n- companion/src/threads/\n- companion/src/config.ts\n- companion/src/logger.ts, log-rotation.ts\n- companion/src/io.ts, paths.ts",
        "1) Does history.db flush on record and/or shutdown close()? Prior C2 claimed never.\n2) Atomic writes (temp+rename) vs overwrite corruption.\n3) File modes 0o600 on secrets.\n4) Thread JSON integrity and concurrent writers.\n5) Log rotation and secret redaction in logs."
    ),
});

jobs.push(#{
    label: "sub:extension",
    capability_mode: "read-only",
    output_schema: diagnose_schema,
    prompt: subsystem_prompt(
        "Chrome Extension (background, sidepanel, bridge)",
        "- chrome-extension/src/background/\n- chrome-extension/src/sidepanel/\n- chrome-extension/src/utils/\n- chrome-extension/src/popup/\n- chrome-extension/tests/",
        "1) keep-alive listener re-registration leak.\n2) State sync races between SW / sidepanel / store.\n3) Streaming re-render performance risks.\n4) CSP, mermaid sanitization residual risk.\n5) Message origin validation chrome.runtime.\n6) Dead PrivilegeMode UI or other dead code."
    ),
});

jobs.push(#{
    label: "sub:skills-obsidian",
    capability_mode: "read-only",
    output_schema: diagnose_schema,
    prompt: subsystem_prompt(
        "Skills engine + Obsidian + apps",
        "- companion/src/skills/\n- companion/src/obsidian/\n- companion/src/apps/\n- companion/builtin-skills/",
        "1) Skill craft path injection / arbitrary code.\n2) Obsidian path containment (realpath) still correct.\n3) Privacy of vault profiling.\n4) Apps panel capability surface."
    ),
});

jobs.push(#{
    label: "sub:ops-release",
    capability_mode: "read-only",
    output_schema: diagnose_schema,
    prompt: subsystem_prompt(
        "Ops, packaging, tray, release, supply-chain",
        "- companion/src/tray/, menu-bar-agent.ts, platform.ts\n- scripts/package.sh, create-dmg.sh, verify-*.js/sh\n- .github/workflows/ci.yml, release.yml\n- docs/supply-chain.md\n- companion/package.json, chrome-extension/package.json",
        "1) CI: is || true gone? Are tests gating? Extension tests in CI?\n2) Node binary download SHA256 verification.\n3) Code signing / notarization status.\n4) npm audit posture (prod high+).\n5) Tray pairing secret handling (never logs secret?)."
    ),
});

jobs.push(#{
    label: "sub:testing",
    capability_mode: "read-only",
    output_schema: diagnose_schema,
    prompt: subsystem_prompt(
        "Testing authenticity + coverage gaps",
        "- companion/tests/ (sample security, history, ws, computer, mcp)\n- chrome-extension/tests/\n- .github/workflows/ci.yml",
        "1) Are security-gate tests real (not auto-approve via HOME leak)?\n2) Hang sources: unref timers, open servers, ws teardown.\n3) Mock-heavy tests that cannot fail on real regressions.\n4) Missing integration for computer-use / auth handshake.\n5) Test count vs critical paths (estimate coverage holes)."
    ),
});

let sub_results = parallel(jobs);

let sub_reports = [];
let all_findings = [];
let i = 0;
for r in sub_results {
    if r != () && r.success && r.output != () {
        sub_reports.push(r.output);
        if r.output.findings != () {
            for f in r.output.findings {
                all_findings.push(f);
            }
        }
        log("Subsystem OK: " + r.output.subsystem);
    } else {
        log("Subsystem agent FAILED slot " + i.to_string());
    }
    i += 1;
}
log("Collected findings from subsystems: " + all_findings.len().to_string());

// ===================== PHASE 2: CROSS-CUT FAN-OUT =====================
phase("CrossCut");
log("Phase 2: 6 parallel cross-cut auditors");

let prior_blob = json_encode(sub_reports);
// Cap prompt size — encode only summaries if huge; still pass findings list
let findings_blob = json_encode(all_findings);

fn crosscut_prompt(dim, extra, findings_json) {
    let p = base_rules();
    p += "\n## Your assignment: CROSS-CUT DIMENSION\n";
    p += "Dimension: " + dim + "\n";
    p += extra + "\n";
    p += "\nYou are given JSON of subsystem findings already collected (may be incomplete). DEDUPLICATE against them but also hunt NEW cross-cutting issues that single-subsystem agents miss.\n";
    p += "Subsystem findings JSON:\n";
    p += findings_json + "\n";
    p += "\nScore this dimension 0-10 (10=best). Return findings with id prefix XC-" + dim + "-.\n";
    p
}

let xjobs = [];

xjobs.push(#{
    label: "xc:architecture",
    capability_mode: "read-only",
    output_schema: crosscut_schema,
    prompt: crosscut_prompt("Architecture",
        "Assess dual-layer topology, god-files (server.ts size), layering violations, dead code, ADR drift vs code. Read docs/architecture.md and a sample of ADRs under docs/adr/. List structural risks.",
        findings_blob),
});

xjobs.push(#{
    label: "xc:correctness",
    capability_mode: "read-only",
    output_schema: crosscut_schema,
    prompt: crosscut_prompt("Correctness",
        "Hunt logic bugs, race conditions (await gaps), error swallowing, incorrect invariants. Grep for catch(()=>{}), empty catch, TODO/FIXME/HACK, and silent returns. Focus companion/src and chrome-extension/src.",
        findings_blob),
});

xjobs.push(#{
    label: "xc:security",
    capability_mode: "read-only",
    output_schema: crosscut_schema,
    prompt: crosscut_prompt("Security",
        "Adversarial security pass across trust boundaries: WS peer, malicious page, malicious MCP server, hostile LLM tool args, package install path. Re-read ws-auth, security-confirmation origin binding, computer-use privilege, cookie tools. Prefer exploit narratives with file:line.",
        findings_blob),
});

xjobs.push(#{
    label: "xc:tests",
    capability_mode: "read-only",
    output_schema: crosscut_schema,
    prompt: crosscut_prompt("Testing",
        "Evaluate test authenticity, CI gating, hang risks, and whether critical paths from findings are covered. Sample failing-pattern tests; check security-gates isolation. Read .github/workflows/ci.yml fully.",
        findings_blob),
});

xjobs.push(#{
    label: "xc:ops",
    capability_mode: "read-only",
    output_schema: crosscut_schema,
    prompt: crosscut_prompt("Ops-Release",
        "Observability (healthz, log rotation, crash handlers), packaging integrity, version alignment companion vs extension, release.yml, supply-chain docs vs reality.",
        findings_blob),
});

xjobs.push(#{
    label: "xc:integration",
    capability_mode: "read-only",
    output_schema: crosscut_schema,
    prompt: crosscut_prompt("Integration",
        "End-to-end protocol consistency: extension message types vs companion handlers; auth handshake both sides; computer-use tool registration vs UI; abort/cancel end-to-end. Grep message type strings across both packages.",
        findings_blob),
});

let x_results = parallel(xjobs);

let x_reports = [];
for r in x_results {
    if r != () && r.success && r.output != () {
        x_reports.push(r.output);
        if r.output.findings != () {
            for f in r.output.findings {
                all_findings.push(f);
            }
        }
        log("CrossCut OK: " + r.output.dimension + " score=" + r.output.score.to_string());
    } else {
        log("CrossCut agent FAILED");
    }
}
log("Total findings after cross-cut: " + all_findings.len().to_string());

// ===================== PHASE 3: ADVERSARIAL VERIFY (Critical/High) =====================
phase("Verify");
log("Phase 3: adversarial verify on critical/high findings");

let to_verify = [];
for f in all_findings {
    if f.severity == "critical" || f.severity == "high" {
        if to_verify.len() < 16 {
            to_verify.push(f);
        }
    }
}
log("Verifying " + to_verify.len().to_string() + " critical/high findings (cap 16)");

let vjobs = [];
for f in to_verify {
    let vp = "";
    vp += "You are an adversarial SKEPTIC. Your job is to REFUTE the finding if possible.\n";
    vp += "Default real=false unless you independently read the code and confirm the defect is present and impactful.\n";
    vp += "Finding id: " + f.id + "\n";
    vp += "Claimed severity: " + f.severity + "\n";
    vp += "Title: " + f.title + "\n";
    vp += "File: " + f.file + "\n";
    vp += "Claimed evidence: " + f.evidence + "\n";
    vp += "Impact: " + f.impact + "\n";
    vp += "METHOD: open the cited file(s) with read_file; grep related symbols; check for mitigations the reporter missed (auth, flush, tests, feature flags).\n";
    vp += "If partially true, set real=true but severity_adjusted lower. If fixed already, real=false severity_adjusted=refuted.\n";
    vp += "evidence must quote current code.\n";
    vjobs.push(#{
        label: "verify:" + f.id,
        capability_mode: "read-only",
        output_schema: verdict_schema,
        prompt: vp,
    });
}

let confirmed = [];
let refuted = [];
if vjobs.len() > 0 {
    let verdicts = parallel(vjobs);
    let vi = 0;
    for v in verdicts {
        if v != () && v.success && v.output != () {
            if v.output.real == true {
                // attach verdict to original finding
                let orig = to_verify[vi];
                confirmed.push(#{
                    finding: orig,
                    verdict: v.output,
                });
            } else {
                refuted.push(v.output);
            }
            log("Verdict " + v.output.finding_id + " real=" + v.output.real.to_string());
        } else {
            log("Verify agent failed slot " + vi.to_string() + " — treat as unverified");
        }
        vi += 1;
    }
}
log("Confirmed critical/high: " + confirmed.len().to_string() + "; refuted: " + refuted.len().to_string());

// ===================== PHASE 4: SYNTHESIZE =====================
phase("Synthesize");
log("Phase 4: synthesize full audit report");

let synth_p = "";
synth_p += "You are the lead auditor synthesizing a multi-agent deep diagnosis of CMspark.\n";
synth_p += "Commit context: current main around computer-use v1.3 + security P0 batches. Versions companion/extension 0.3.0.\n";
synth_p += "Date for report: 2026-07-25.\n";
synth_p += "Prior audits: 2026-06-16, 2026-06-23 diagnosis, 2026-07-09 full 25-dim (score 4.4/C). This is a RE-AUDIT + NEW surface (computer-use).\n\n";
synth_p += "INPUT — subsystem reports JSON:\n";
synth_p += json_encode(sub_reports) + "\n\n";
synth_p += "INPUT — cross-cut reports JSON:\n";
synth_p += json_encode(x_reports) + "\n\n";
synth_p += "INPUT — adversarially CONFIRMED critical/high:\n";
synth_p += json_encode(confirmed) + "\n\n";
synth_p += "INPUT — REFUTED claims (do not re-raise as open critical unless you re-verify):\n";
synth_p += json_encode(refuted) + "\n\n";
synth_p += "INPUT — all raw findings (may include unconfirmed medium/low):\n";
synth_p += json_encode(all_findings) + "\n\n";
synth_p += "TASK:\n";
synth_p += "1) Deduplicate findings; prefer confirmed critical/high; keep strong mediums with file:line.\n";
synth_p += "2) Produce score_dashboard for: Security, Stability, Performance, Testing, Maintainability, Design, Release, Computer-Use, Overall (0-10, letter grade).\n";
synth_p += "3) Write report_markdown as a complete professional audit report with:\n";
synth_p += "   # CMspark Deep Diagnosis Fanout Report (2026-07-25)\n";
synth_p += "   ## Executive Summary\n";
synth_p += "   ## Score Dashboard\n";
synth_p += "   ## Prior Audit Delta (what fixed since 2026-07-09)\n";
synth_p += "   ## Top Risks table\n";
synth_p += "   ## Findings by severity (Critical/High/Medium/Low) with file:line evidence\n";
synth_p += "   ## Subsystem health notes\n";
synth_p += "   ## Cross-cut dimension scores\n";
synth_p += "   ## Prioritized Action Plan (P0/P1/P2)\n";
synth_p += "   ## Method appendix (agents used, verification policy)\n";
synth_p += "4) Be honest: if major prior Criticals are fixed, celebrate and re-score upward. Do not invent Criticals.\n";
synth_p += "5) action_plan should be concrete executable batches.\n";
synth_p += "6) Count confirmed_critical, confirmed_high, total_findings in the schema fields.\n";
synth_p += "Use Chinese for narrative sections if natural for this project (mixed CN/EN ok like prior audits), keep code/ids English.\n";

let synth = agent(synth_p, #{
    label: "synthesize",
    capability_mode: "read-only",
    output_schema: synth_schema,
});

if synth == () || !synth.success || synth.output == () {
    // Fail-open fallback report from raw data
    let fallback = "# CMspark Deep Diagnosis Fanout — PARTIAL\n\nSynthesis agent failed. Raw finding count: " + all_findings.len().to_string() + "\n\n";
    fallback += "## Confirmed critical/high (adversarial)\n" + json_encode(confirmed) + "\n\n";
    fallback += "## All findings\n" + json_encode(all_findings) + "\n";
    let path = write_scratch_file("deep-diagnosis-2026-07-25.md", fallback);
    complete(#{
        status: "partial",
        path: path,
        confirmed: confirmed.len(),
        total: all_findings.len(),
    });
}

let report = "";
if synth.output.report_markdown != () {
    report = synth.output.report_markdown;
} else {
    report = "# CMspark Deep Diagnosis Fanout — synthesis incomplete\n\n";
    report += "Raw findings: " + all_findings.len().to_string() + "\n";
    report += "Confirmed: " + confirmed.len().to_string() + "\n";
    report += json_encode(confirmed);
}
if report == "" {
    report = "(empty report)";
}
let path = write_scratch_file("deep-diagnosis-2026-07-25.md", report);

// Also write a machine-readable summary (guard missing schema fields)
let ov = if synth.output.overall_score != () { synth.output.overall_score } else { 0.0 };
let gr = if synth.output.grade != () { synth.output.grade } else { "n/a" };
let ex = if synth.output.executive_summary != () { synth.output.executive_summary } else { "" };
let sd = if synth.output.score_dashboard != () { synth.output.score_dashboard } else { "" };
let tr = if synth.output.top_risks != () { synth.output.top_risks } else { [] };
let ap = if synth.output.action_plan != () { synth.output.action_plan } else { "" };
let cc = if synth.output.confirmed_critical != () { synth.output.confirmed_critical } else { 0 };
let ch = if synth.output.confirmed_high != () { synth.output.confirmed_high } else { 0 };
let tf = if synth.output.total_findings != () { synth.output.total_findings } else { all_findings.len() };

let summary_json = json_encode(#{
    overall_score: ov,
    grade: gr,
    executive_summary: ex,
    score_dashboard: sd,
    top_risks: tr,
    action_plan: ap,
    confirmed_critical: cc,
    confirmed_high: ch,
    total_findings: tf,
    confirmed_detail: confirmed,
    refuted_count: refuted.len(),
    subsystem_count: sub_reports.len(),
    crosscut_count: x_reports.len(),
});
let jpath = write_scratch_file("deep-diagnosis-2026-07-25-summary.json", summary_json);

log("Report written. overall=" + ov.to_string() + " grade=" + gr);

complete(#{
    status: "ok",
    path: path,
    summary_path: jpath,
    overall_score: ov,
    grade: gr,
    executive_summary: ex,
    score_dashboard: sd,
    top_risks: tr,
    action_plan: ap,
    confirmed_critical: cc,
    confirmed_high: ch,
    total_findings: tf,
    verified_confirmed: confirmed.len(),
    refuted: refuted.len(),
    report_markdown: report,
});
