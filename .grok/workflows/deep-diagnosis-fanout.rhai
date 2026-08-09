let meta = #{
    name: "deep-diagnosis-fanout",
    description: "CMspark deep diagnosis: subsystem map+diagnose fanout, cross-cut audit, synthesize prioritized report",
    phases: [
        #{ title: "Subsystem diagnose", detail: "10 parallel map+diagnose agents across major modules" },
        #{ title: "Cross-cut audit", detail: "6 dimensions: architecture, correctness, security, tests, ops, integration" },
        #{ title: "Synthesize", detail: "Dedup, grade, prioritize P0/P1/P2 action plan, write report" },
    ],
    when_to_use: "Thorough project health audit after major merges; deep diagnosis with parallel fanout",
};

// Structured findings schema for subsystem + cross-cut agents
let findings_schema = #{
    "type": "object",
    "required": ["subsystem", "purpose", "health_grade", "findings", "top_smells"],
    "properties": #{
        "subsystem": #{ "type": "string" },
        "purpose": #{ "type": "string" },
        "health_grade": #{ "type": "string", "enum": ["A", "B", "C", "D", "F"] },
        "top_smells": #{
            "type": "array",
            "maxItems": 5,
            "items": #{ "type": "string" },
        },
        "findings": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["id", "severity", "category", "title", "file", "evidence", "fix_sketch"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "severity": #{ "type": "string", "enum": ["critical", "high", "medium", "low"] },
                    "category": #{ "type": "string" },
                    "title": #{ "type": "string" },
                    "file": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "fix_sketch": #{ "type": "string" },
                },
            },
        },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["executive_summary", "overall_grade", "critical_count", "high_count", "medium_count", "action_plan", "report_markdown"],
    "properties": #{
        "executive_summary": #{ "type": "string" },
        "overall_grade": #{ "type": "string" },
        "critical_count": #{ "type": "integer" },
        "high_count": #{ "type": "integer" },
        "medium_count": #{ "type": "integer" },
        "action_plan": #{
            "type": "array",
            "maxItems": 20,
            "items": #{
                "type": "object",
                "required": ["priority", "title", "rationale"],
                "properties": #{
                    "priority": #{ "type": "string", "enum": ["P0", "P1", "P2"] },
                    "title": #{ "type": "string" },
                    "rationale": #{ "type": "string" },
                },
            },
        },
        "report_markdown": #{ "type": "string" },
    },
};

// ── shared prompt preamble (kept short; each job adds paths) ──
let rules = "";
rules += "You are a senior engineer auditing CMspark (Chrome Extension Plasmo+React + local Companion Node/TS over WebSocket). ";
rules += "REPO ROOT is the workspace. READ-ONLY: use read_file, grep, list_dir only — never edit or run destructive commands. ";
rules += "Ground every finding in actual code you open (file path + line or symbol). Empty findings[] is valid ONLY after you inspected the listed paths. ";
rules += "Do NOT rehash fixed historical issues as open bugs without verifying they still exist on current main. ";
rules += "Severity: critical=security/data-loss/auth bypass; high=correctness under realistic use; medium=maintainability/test gap; low=nit. ";
rules += "Prefer NEW post-0.5.0 / post-health-fanout risks. Recent closeouts fixed many P0–P2 items — look for residual and new surfaces. ";
rules += "Max 12 findings. Output must match the schema exactly.";

// ── Phase 1: subsystem map+diagnose (10-way fanout) ──
phase("Subsystem diagnose");
log("Launching 10 subsystem map+diagnose agents");

let subs = [
    #{
        id: "core-runtime",
        paths: "companion/src/server.ts, companion/src/message-router.ts, companion/src/config.ts, companion/src/ws-auth.ts, companion/src/index.ts, companion/src/daemon.ts, companion/src/io.ts, companion/src/crash-handlers.ts",
        focus: "WS lifecycle, auth pairing, message routing, config load/save, crash handling, connection management",
    },
    #{
        id: "llm-adapter",
        paths: "companion/src/llm/ (adapter, providers, context-budget*, vision*, llm-extract, connection-test, text-sanitize)",
        focus: "streaming, tool calling loops, abort, provider conversion, context budget/handoff, vision pipeline, injection via tool results",
    },
    #{
        id: "security",
        paths: "companion/src/security.ts, security-policy.ts, security-confirmation.ts, security-arm.ts, security/, path-sandbox.ts, chrome-extension/src/background/page-sanitizer.ts, security-confirmation paths in extension",
        focus: "confirmation gates, domain whitelist, HMAC/token, evaluate/navigate gates, redaction, path sandbox, prompt-injection sanitizer",
    },
    #{
        id: "bridge-tools",
        paths: "companion/src/bridge/, chrome-extension/src/background/browser-bridge.ts and related CDP/tab tools",
        focus: "tool definitions/schemas, tab resolver, CDP safety, selector injection, download tools, tab isolation",
    },
    #{
        id: "mcp",
        paths: "companion/src/mcp/, companion/src/outbound-mcp/",
        focus: "inbound MCP client/manager/transport, outbound facade/grants/origin, confirm cache, tool name collision, arg validation",
    },
    #{
        id: "computer-host",
        paths: "companion/src/computer/, companion/src/host-use/, companion/src/capability/, companion/src/apps/, companion/src/netsec/",
        focus: "CU policy/estop/evidence, host adapters, enterprise modules, shell/workspace guards, netsec allowlist",
    },
    #{
        id: "voice-meeting",
        paths: "companion/src/voice/, companion/src/meeting/, chrome-extension voice/meeting UI under sidepanel and tabs",
        focus: "Whisper download/binary resolve, STT sessions, meeting store GC, privacy, Windows packaging sidecar paths",
    },
    #{
        id: "orchestrator-packs",
        paths: "companion/src/orchestrator/, companion/src/board/, companion/src/packs/, companion/src/skills/, companion/src/threads/",
        focus: "spawn_worker, tab lease, mission board, pack apply, skill engine/sanitizer, thread isolation, digest concurrency",
    },
    #{
        id: "extension-ui",
        paths: "chrome-extension/src/sidepanel/, chrome-extension/src/background/, chrome-extension/src/cockpit/, chrome-extension/src/popup/",
        focus: "React state, confirm center UX, settings security, WS client, keep-alive SW, stream gating, hooks order bugs",
    },
    #{
        id: "ops-ci-packaging",
        paths: "companion/package.json, chrome-extension/package.json, root package.json, .github/, scripts/, Makefile, companion/scripts/run-tests.mjs, build-package.bat, companion/sea-config.json",
        focus: "CI matrix, test runners, version lock, SEA packaging, release preflight, Node version, flaky tests",
    },
];

let jobs = [];
for s in subs {
    let p = "";
    p += rules + "\n\n";
    p += "TASK: Map + diagnose subsystem `" + s.id + "`.\n";
    p += "Inspect paths: " + s.paths + "\n";
    p += "Focus: " + s.focus + "\n\n";
    p += "Steps:\n";
    p += "1) list_dir / grep / read_file the key modules (at least 5 files with real content).\n";
    p += "2) Summarize purpose in one sentence; list top smells.\n";
    p += "3) Emit concrete findings with id like " + s.id + "-01, severity, category, title, file (path:line if possible), evidence quote/summary, fix_sketch.\n";
    p += "4) health_grade A–F for this subsystem only.\n";
    p += "Set subsystem field to `" + s.id + "`.";
    jobs.push(#{
        prompt: p,
        label: "diag:" + s.id,
        capability_mode: "read-only",
        agent_type: "explore",
        output_schema: findings_schema,
    });
}

let sub_results = parallel(jobs);

// Collect usable subsystem reports for next phase
let sub_summaries = [];
let i = 0;
for r in sub_results {
    let sid = subs[i].id;
    if r != () && r.success && r.output != () {
        let o = r.output;
        let fcount = 0;
        let flist = "";
        if o.findings != () {
            fcount = o.findings.len();
            for f in o.findings {
                let sev = if f.severity != () { f.severity } else { "?" };
                let fid = if f.id != () { f.id } else { "?" };
                let title = if f.title != () { f.title } else { "?" };
                let file = if f.file != () { f.file } else { "?" };
                flist += " [" + sev + "] " + fid + ": " + title + " @" + file + ";";
            }
        }
        let grade = if o.health_grade != () { o.health_grade } else { "?" };
        let line = sid + " grade=" + grade + " findings=" + fcount.to_string();
        if o.purpose != () {
            line += " purpose=" + o.purpose;
        }
        line += " |" + flist;
        sub_summaries.push(line);
        log("OK subsystem " + sid + " grade=" + grade);
    } else {
        sub_summaries.push(sid + " FAILED_OR_EMPTY");
        log("FAIL subsystem " + sid);
    }
    i += 1;
}

// ── Phase 2: cross-cut (6-way fanout) ──
phase("Cross-cut audit");
log("Launching 6 cross-cut agents with subsystem digest");

let digest = "";
for line in sub_summaries {
    digest += line + "\n";
}

let cross = [
    #{
        id: "architecture",
        focus: "module boundaries, god files, dual-layer topology violations, dead code, capability model (ADR-020) discipline, circular deps",
        paths: "companion/src/message-router.ts size/shape, server.ts, chrome-extension sidepanel store, docs/adr/020-capability-model-three-axes.md",
    },
    #{
        id: "correctness",
        focus: "race conditions, abort/cancel, generation counters, thread isolation leaks, WS disconnect partial state, stream/thread gates",
        paths: "message-router abort, thread-manager, orchestrator single-flight/tab-lease, extension keep-alive and stream gates",
    },
    #{
        id: "security",
        focus: "auth, confirmation bypass, SSRF, path traversal, secret leakage to logs/history, MCP tool surface, evaluate/osascript, auto_approve",
        paths: "security-confirmation, security-policy, settings-web, history redaction, outbound-mcp origin/grants, user-env secrets",
    },
    #{
        id: "tests",
        focus: "coverage gaps on critical paths, flaky patterns, missing regression for recent PRs, test isolation, companion vs extension suite health",
        paths: "companion/tests/, chrome-extension/tests/, run-tests.mjs, CI workflows",
    },
    #{
        id: "ops",
        focus: "packaging SEA/Windows/macOS, daemon lifecycle, tray pairing, log rotation, release scripts, Node 22 CI alignment",
        paths: "scripts/, Makefile, build-package.bat, companion/daemon.ts, tray/, .github/",
    },
    #{
        id: "integration",
        focus: "protocol_version negotiation, WS message contract drift, extension↔companion feature flags, multi-agent + board + pack end-to-end seams",
        paths: "server + extension ws-client message types, protocol_version, packs apply, orchestrator spawn",
    },
];

let cjobs = [];
for c in cross {
    let p = "";
    p += rules + "\n\n";
    p += "TASK: Cross-cut audit dimension `" + c.id + "`.\n";
    p += "Focus: " + c.focus + "\n";
    p += "Seed paths: " + c.paths + "\n\n";
    p += "Subsystem diagnose digest (may be incomplete; verify claims yourself):\n";
    p += digest + "\n";
    p += "Steps: inspect real code for this dimension; dedupe vs digest where possible; prefer cross-module issues the single-subsystem agents miss.\n";
    p += "Set subsystem field to `cross-" + c.id + "`. health_grade for this dimension. findings id like x-" + c.id + "-01.";
    cjobs.push(#{
        prompt: p,
        label: "cross:" + c.id,
        capability_mode: "read-only",
        agent_type: "explore",
        output_schema: findings_schema,
    });
}

let cross_results = parallel(cjobs);

let all_findings_text = "";
all_findings_text += "=== SUBSYSTEM REPORTS ===\n";
let si = 0;
for r in sub_results {
    let sid = subs[si].id;
    if r != () && r.success && r.output != () {
        let o = r.output;
        let grade = if o.health_grade != () { o.health_grade } else { "?" };
        all_findings_text += "\n## " + sid + " grade=" + grade + "\n";
        if o.purpose != () {
            all_findings_text += "purpose: " + o.purpose + "\n";
        }
        if o.top_smells != () {
            for sm in o.top_smells {
                all_findings_text += "- smell: " + sm + "\n";
            }
        }
        if o.findings != () {
            for f in o.findings {
                let sev = if f.severity != () { f.severity } else { "?" };
                let fid = if f.id != () { f.id } else { "?" };
                let cat = if f.category != () { f.category } else { "?" };
                let title = if f.title != () { f.title } else { "?" };
                all_findings_text += "- [" + sev + "] " + fid + " | " + cat + " | " + title + "\n";
                if f.file != () { all_findings_text += "  file: " + f.file + "\n"; }
                if f.evidence != () { all_findings_text += "  evidence: " + f.evidence + "\n"; }
                if f.fix_sketch != () { all_findings_text += "  fix: " + f.fix_sketch + "\n"; }
            }
        }
    } else {
        all_findings_text += "\n## " + sid + " FAILED\n";
    }
    si += 1;
}

all_findings_text += "\n=== CROSS-CUT REPORTS ===\n";
let ci = 0;
for r in cross_results {
    let cid = cross[ci].id;
    if r != () && r.success && r.output != () {
        let o = r.output;
        let grade = if o.health_grade != () { o.health_grade } else { "?" };
        all_findings_text += "\n## cross-" + cid + " grade=" + grade + "\n";
        if o.purpose != () {
            all_findings_text += "purpose: " + o.purpose + "\n";
        }
        if o.findings != () {
            for f in o.findings {
                let sev = if f.severity != () { f.severity } else { "?" };
                let fid = if f.id != () { f.id } else { "?" };
                let cat = if f.category != () { f.category } else { "?" };
                let title = if f.title != () { f.title } else { "?" };
                all_findings_text += "- [" + sev + "] " + fid + " | " + cat + " | " + title + "\n";
                if f.file != () { all_findings_text += "  file: " + f.file + "\n"; }
                if f.evidence != () { all_findings_text += "  evidence: " + f.evidence + "\n"; }
                if f.fix_sketch != () { all_findings_text += "  fix: " + f.fix_sketch + "\n"; }
            }
        }
    } else {
        all_findings_text += "\n## cross-" + cid + " FAILED\n";
    }
    ci += 1;
}

// Bound context size for synthesizer (string length via chars count if available)
// Skip hard truncate when empty/short; rely on agent context if oversize.

// ── Phase 3: synthesize ──
phase("Synthesize");
log("Synthesizing prioritized diagnosis report");

let sp = "";
sp += "You are the lead engineer synthesizing a DEEP DIAGNOSIS report for CMspark after parallel fanout audits.\n";
sp += "READ-ONLY tools only. You may spot-check a few high-severity claims with read_file/grep if dubious.\n\n";
sp += "INPUT from 10 subsystem + 6 cross-cut agents:\n";
sp += all_findings_text + "\n\n";
sp += "TASKS:\n";
sp += "1) Deduplicate findings (same root cause once). Drop refuted/stale items.\n";
sp += "2) Overall grade A–F with justification.\n";
sp += "3) Counts of critical/high/medium after dedup.\n";
sp += "4) action_plan P0 (release-blocking) / P1 / P2 with clear titles.\n";
sp += "5) report_markdown: full professional report in Markdown with:\n";
sp += "   # CMspark Deep Diagnosis Fanout — 2026-08-09\n";
sp += "   ## Executive summary\n";
sp += "   ## Overall grade\n";
sp += "   ## Architecture assessment\n";
sp += "   ## Findings by severity (critical/high/medium/low tables: id, title, file, evidence, fix)\n";
sp += "   ## Subsystem health matrix\n";
sp += "   ## Prioritized action plan (P0/P1/P2)\n";
sp += "   ## What looks healthy\n";
sp += "   ## Method (fanout map)\n";
sp += "Write report_markdown in Chinese for narrative sections; keep finding ids and file paths in English/path form.\n";
sp += "Be honest: if Health Fanout #159 already fixed items, do not re-list as open.\n";

let syn = agent(sp, #{
    label: "synthesize",
    capability_mode: "read-only",
    agent_type: "general-purpose",
    output_schema: report_schema,
});

if syn == () || !syn.success || syn.output == () {
    let fail_path = write_scratch_file("deep-diagnosis-failed.md", all_findings_text);
    complete(#{
        ok: false,
        error: "Synthesizer failed; raw fanout dump saved",
        raw_path: fail_path,
        subsystem_ok: sub_summaries,
    });
}

let out = syn.output;
let report_md = if out.report_markdown != () { out.report_markdown } else { "# empty report\n" };
let scratch = write_scratch_file("deep-diagnosis-report.md", report_md);

let og = if out.overall_grade != () { out.overall_grade } else { "?" };
let es = if out.executive_summary != () { out.executive_summary } else { "" };
let cc = if out.critical_count != () { out.critical_count } else { 0 };
let hc = if out.high_count != () { out.high_count } else { 0 };
let mc = if out.medium_count != () { out.medium_count } else { 0 };
let ap = if out.action_plan != () { out.action_plan } else { [] };

let summary_json = json_encode(#{
    overall_grade: og,
    executive_summary: es,
    critical_count: cc,
    high_count: hc,
    medium_count: mc,
    action_plan: ap,
});
let scratch_json = write_scratch_file("deep-diagnosis-summary.json", summary_json);

log("Diagnosis complete grade=" + og
    + " C=" + cc.to_string()
    + " H=" + hc.to_string()
    + " M=" + mc.to_string());

complete(#{
    ok: true,
    overall_grade: og,
    executive_summary: es,
    critical_count: cc,
    high_count: hc,
    medium_count: mc,
    action_plan: ap,
    report_path: scratch,
    summary_path: scratch_json,
    note: "Copy report_path content into docs/audit/ if you want it in-repo",
});
