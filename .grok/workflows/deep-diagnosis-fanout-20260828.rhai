let meta = #{
    name: "deep-diagnosis-fanout-20260828",
    description: "CMspark 0.5.3 deep diagnosis: 12-way subsystem + 6 cross-cut + adversarial verify + synthesize",
    phases: [
        #{ title: "Subsystem diagnose", detail: "12 parallel map+diagnose agents across major modules including overlay and knowledge" },
        #{ title: "Cross-cut audit", detail: "6 dimensions: architecture, correctness, security, tests, ops, integration" },
        #{ title: "Adversarial verify", detail: "Independent skeptics refute or confirm critical/high claims" },
        #{ title: "Synthesize", detail: "Dedup, calibrate, grade, P0/P1/P2 plan, write Chinese report" },
    ],
    when_to_use: "Thorough 0.5.3 project health audit; multi-path adversarial diagnosis then dual review",
};

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

let verdict_schema = #{
    "type": "object",
    "required": ["finding_id", "real", "reason", "evidence"],
    "properties": #{
        "finding_id": #{ "type": "string" },
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
        "severity_if_real": #{ "type": "string" },
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

let rules = "";
rules += "You are a senior engineer auditing CMspark 0.5.3 (Chrome Extension Plasmo+React + local Companion Node/TS over WebSocket). ";
rules += "REPO ROOT is the workspace. READ-ONLY: use read_file, grep, list_dir only — never edit, never write files, never run destructive commands. ";
rules += "Ground every finding in actual code you open (file path + line or symbol). Empty findings[] is valid ONLY after you inspected the listed paths. ";
rules += "Do NOT rehash 2026-08-11 deep-diagnosis or 08-09 health-fanout items as open bugs without verifying they still exist in CURRENT code. ";
rules += "Many P0/P1/P2 closeouts landed 08-09 through 08-12; 0.5.3 added overlay/summoner, knowledge CRUD honesty, grant CLI, outbound first-exfil HITL, chat-shell same-face, RunProgress. ";
rules += "Severity: critical=unauthenticated RCE / mass data destruction / auth bypass; high=post-auth integrity break, local RCE-equivalent, durable secret tape; medium=maintainability/test gap; low=nit. ";
rules += "Prefer NEW post-0.5.3 / overlay Capture card / grant / knowledge risks. Residual #228 T1, #229 summoner P2, #230 are known product leftovers — only report if code is worse than those tickets describe. ";
rules += "Max 12 findings. Output must match the schema exactly.";

phase("Subsystem diagnose");
log("Launching 12 subsystem map+diagnose agents for 0.5.3");

let subs = [
    #{
        id: "core-runtime",
        paths: "companion/src/server.ts, companion/src/message-router.ts, companion/src/config.ts, companion/src/ws-auth.ts, companion/src/index.ts, companion/src/daemon.ts, companion/src/ws/, companion/src/crash-handlers.ts",
        focus: "WS lifecycle, auth pairing, overlay vs extension peer, message routing, config load/save, crash handling, wait-for-extension-peer",
    },
    #{
        id: "llm-adapter",
        paths: "companion/src/llm/ (adapter, providers, context-budget, vision, llm-extract, text-sanitize), companion/src/threads/runtime-context-budget.ts",
        focus: "streaming, tool calling loops, abort, overflow retry, steer/nextRun durable loop, system_prompt override vs security footer, injection via tool results",
    },
    #{
        id: "security",
        paths: "companion/src/security.ts, security-policy.ts, security-confirmation.ts, security-arm.ts, security/, path-sandbox.ts, chrome-extension/src/background/page-sanitizer.ts",
        focus: "confirmation gates, overlay-origin must not bind Allow/Deny, domain whitelist, HMAC/token, evaluate/navigate gates, redaction, path sandbox, prompt-injection sanitizer",
    },
    #{
        id: "bridge-tools",
        paths: "companion/src/bridge/, companion/src/tool/, chrome-extension/src/background/browser-bridge.ts",
        focus: "tool definitions/schemas, tab resolver, CDP safety, companion-dispatch token fail-closed, download tools, tab isolation, site op-memory",
    },
    #{
        id: "mcp",
        paths: "companion/src/mcp/, companion/src/outbound-mcp/",
        focus: "inbound MCP client/manager/transport env inheritance, outbound facade/grants/origin, grant-cli cmg_ keys, require_grant default, first-exfil HITL, confirm cache, tool name collision",
    },
    #{
        id: "computer-host",
        paths: "companion/src/computer/, companion/src/host-use/, companion/src/capability/, companion/src/apps/, companion/src/netsec/",
        focus: "CU policy/estop/evidence, host adapters integrity spawn, enterprise modules, shell/workspace guards, netsec allowlist",
    },
    #{
        id: "voice-meeting",
        paths: "companion/src/voice/, companion/src/meeting/, chrome-extension voice/meeting UI, overlay capture meeting card",
        focus: "Whisper download/binary resolve vs CMSPARK_DATA_DIR, STT sessions, meeting store GC/recording cap, privacy, overlay meeting first-paint",
    },
    #{
        id: "orchestrator-packs",
        paths: "companion/src/orchestrator/, companion/src/board/, companion/src/packs/, companion/src/skills/, companion/src/threads/",
        focus: "spawn_worker ownership, tab lease, mission board vs RunProgress, pack apply, skill TF-IDF match, thread isolation, digest concurrency",
    },
    #{
        id: "extension-ui",
        paths: "chrome-extension/src/sidepanel/, chrome-extension/src/background/, chrome-extension/src/cockpit/, chrome-extension/src/popup/",
        focus: "ChatShell same-face, confirm center UX, settings security, WS client stream/thread gates, keep-alive SW, RunProgress in chat column, empty-state 看山",
    },
    #{
        id: "overlay-summoner",
        paths: "chrome-extension/src/overlay/, companion/src/summoner/, companion/src/summoner-web.ts, companion/src/hud/, companion/src/tray/, companion/src/menu-bar-agent.ts",
        focus: "Capture card first-paint, overlay lease exclusivity, overlay never Allow/Deny, NSApp.activate, tray same-card, honesty CTAs, MCP rail hidden not deleted",
    },
    #{
        id: "knowledge-loop",
        paths: "companion/src/message-router/handlers/knowledge.ts, companion/src/skills/knowledge-related.ts, companion/src/threads/run-progress.ts, companion/src/threads/digest.ts, knowledge WS methods in ws/validate.ts",
        focus: "knowledge CRUD honesty (open/save/download), related cap 3, durable loop abort-heal/overflow/steer, RunProgress H1 tool bind, knowledge.get not in summoner",
    },
    #{
        id: "ops-ci-packaging",
        paths: "companion/package.json, chrome-extension/package.json, .github/, scripts/, Makefile, companion/scripts/run-tests.mjs, build-package.bat, companion/sea-config.json",
        focus: "CI matrix, version lock 0.5.3, SEA/NSIS packaging, release preflight, package gates helpers, Node version, flaky tests",
    },
];

let jobs = [];
for s in subs {
    let p = "";
    p += rules + "\n\n";
    p += "TASK: Map + diagnose subsystem `" + s.id + "` on CMspark 0.5.3 HEAD (branch feat/overlay-card-first-paint).\n";
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

phase("Cross-cut audit");
log("Launching 6 cross-cut agents with subsystem digest");

let digest = "";
for line in sub_summaries {
    digest += line + "\n";
}

let cross = [
    #{
        id: "architecture",
        focus: "module boundaries, god files (message-router ~4k, useWebSocket ~2k, companion-dispatch ~2k), dual-layer topology vs overlay/summoner/NotebookLM, ADR-020 discipline, circular deps",
        paths: "companion/src/message-router.ts, server.ts, chrome-extension sidepanel store, overlay/, docs/adr/020-capability-model-three-axes.md",
    },
    #{
        id: "correctness",
        focus: "race conditions, abort/cancel, generation counters, overlay vs panel peer, WS disconnect partial state, stream/thread gates, durable loop abort-heal, overlay lease",
        paths: "message-router abort, thread-manager, orchestrator tab-lease, overlay-session, extension keep-alive and stream gates, wait-for-extension-peer",
    },
    #{
        id: "security",
        focus: "auth, overlay-origin confirms, grant cmg_ vs ws_secret, SSRF, path traversal, secret leakage, outbound first-exfil HITL, evaluate/osascript, auto_approve, MCP stdio env",
        paths: "security-confirmation, outbound-mcp/grant-cli.ts origin/grants, settings-web, history redaction, user-env secrets, l2 overlay fan-out",
    },
    #{
        id: "tests",
        focus: "coverage gaps on overlay/knowledge/grant/run-progress, flaky patterns, missing regression for 0.5.3 PRs, companion vs extension suite health",
        paths: "companion/tests/, chrome-extension/tests/, run-tests.mjs, CI workflows",
    },
    #{
        id: "ops",
        focus: "packaging SEA/Windows NSIS/macOS, daemon lifecycle, tray pairing, overlay HUD, log rotation, release scripts, 0.5.3 version lock",
        paths: "scripts/, Makefile, build-package.bat, companion/daemon.ts, tray/, .github/",
    },
    #{
        id: "integration",
        focus: "protocol_version negotiation, overlay Capture vs sidepanel ChatShell same-face, WS contract drift, grant CLI live companion, multi-agent + board + pack + RunProgress seams",
        paths: "server + overlay protocol + extension ws-client, protocol.ts, packs apply, orchestrator spawn, run-progress",
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

// Collect critical/high for adversarial verify (critical first, then high; cap 10)
let crits = [];
let wave = [];
wave.push(sub_results);
wave.push(cross_results);
for wr in wave {
    for r in wr {
        if r != () && r.success && r.output != () {
            let o = r.output;
            if o.findings != () {
                for f in o.findings {
                    if f.severity == "critical" {
                        if crits.len() < 10 {
                            crits.push(f);
                        }
                    }
                }
            }
        }
    }
}
for wr in wave {
    for r in wr {
        if r != () && r.success && r.output != () {
            let o = r.output;
            if o.findings != () {
                for f in o.findings {
                    if f.severity == "high" {
                        if crits.len() < 10 {
                            crits.push(f);
                        }
                    }
                }
            }
        }
    }
}

phase("Adversarial verify");
let verify_text = "=== ADVERSARIAL VERIFY (empty — no critical/high collected) ===\n";
if crits.len() > 0 {
    log("Launching " + crits.len().to_string() + " skeptic agents (default refute)");
    let vjobs = [];
    for f in crits {
        let fid = if f.id != () { f.id } else { "unknown" };
        let title = if f.title != () { f.title } else { "" };
        let file = if f.file != () { f.file } else { "" };
        let ev = if f.evidence != () { f.evidence } else { "" };
        let sev = if f.severity != () { f.severity } else { "high" };
        let vp = "";
        vp += "You are an independent SKEPTIC. Default to real=false unless you independently inspect current code and confirm the bug still exists.\n";
        vp += "READ-ONLY: read_file, grep, list_dir only. Do not edit.\n";
        vp += "Claim id=" + fid + " severity=" + sev + "\n";
        vp += "Title: " + title + "\n";
        vp += "Cited file: " + file + "\n";
        vp += "Cited evidence: " + ev + "\n";
        vp += "Open the cited file and nearby tests. If the 08-11/08-12 closeouts already fixed it, real=false.\n";
        vp += "Set finding_id to `" + fid + "`. If real=true, quote the CURRENT code that proves it. severity_if_real must be critical|high|medium|low after recalibration (critical only for unauth RCE / mass destruction / auth bypass).\n";
        vjobs.push(#{
            prompt: vp,
            label: "skeptic:" + fid,
            capability_mode: "read-only",
            agent_type: "explore",
            output_schema: verdict_schema,
        });
    }
    let verdicts = parallel(vjobs);
    verify_text = "=== ADVERSARIAL VERIFY ===\n";
    let vi = 0;
    let confirmed = 0;
    for v in verdicts {
        let fid = if crits[vi].id != () { crits[vi].id } else { "?" };
        if v != () && v.success && v.output != () {
            let o = v.output;
            let real = if o.real == true { "true" } else { "false" };
            if o.real == true { confirmed += 1; }
            verify_text += "- id=" + fid + " real=" + real + "\n";
            if o.reason != () { verify_text += "  reason: " + o.reason + "\n"; }
            if o.evidence != () { verify_text += "  evidence: " + o.evidence + "\n"; }
            if o.severity_if_real != () { verify_text += "  severity_if_real: " + o.severity_if_real + "\n"; }
        } else {
            verify_text += "- id=" + fid + " real=false (skeptic failed — treat as unconfirmed)\n";
        }
        vi += 1;
    }
    log(confirmed.to_string() + "/" + crits.len().to_string() + " critical/high survived skepticism");
} else {
    log("No critical/high findings to verify");
}

phase("Synthesize");
log("Synthesizing prioritized 0.5.3 diagnosis report");

let sp = "";
sp += "You are the lead engineer synthesizing a DEEP DIAGNOSIS report for CMspark 0.5.3 after parallel fanout + adversarial verify.\n";
sp += "READ-ONLY tools only. Spot-check a few high-severity claims with read_file/grep if dubious.\n";
sp += "Date: 2026-08-28. Product 0.5.3. HEAD on feat/overlay-card-first-paint (overlay Capture card first-paint; main already has #239/#242).\n";
sp += "Prior: 2026-08-11 deep diagnosis grade C (7 critical / 18 high, likely over-scored); 08-09 health fanout 6.6/B- with 0 Critical/9 High after calibration; P2 residual closeout 08-12.\n";
sp += "0.5.3 shipped: knowledge CRUD honesty, grant CLI, outbound first-exfil HITL, overlay summoner, ChatShell same-face, RunProgress, T1 bake-off scored (PW portal fail).\n";
sp += "Known leftovers (do not treat as new bugs): #228 T1, #229 summoner fast/fade, #230 residual list.\n\n";
sp += "CALIBRATION: confirmed Critical only with unauthenticated RCE / mass destruction / pairing bypass. High = post-auth integrity / local RCE-equivalent / durable secret tape. Failed or missing skeptic = unconfirmed, drop from critical/high counts.\n\n";
sp += "INPUT from 12 subsystem + 6 cross-cut agents:\n";
sp += all_findings_text + "\n\n";
sp += verify_text + "\n\n";
sp += "TASKS:\n";
sp += "1) Deduplicate findings (same root cause once). Drop refuted/stale/unconfirmed critical-high.\n";
sp += "2) Overall grade A–F with justification (calibrated; do not copy the 08-11 seven-critical inflation).\n";
sp += "3) Counts of critical/high/medium after dedup AND after skepticism.\n";
sp += "4) action_plan P0 (release-blocking) / P1 / P2 with clear titles.\n";
sp += "5) report_markdown: full professional report in Markdown with:\n";
sp += "   # CMspark Deep Diagnosis Fanout — 2026-08-28\n";
sp += "   ## Executive summary\n";
sp += "   ## Overall grade\n";
sp += "   ## Architecture assessment\n";
sp += "   ## Findings by severity (critical/high/medium/low tables: id, title, file, evidence, fix, verified?)\n";
sp += "   ## Subsystem health matrix\n";
sp += "   ## Prioritized action plan (P0/P1/P2)\n";
sp += "   ## Delta vs 2026-08-11\n";
sp += "   ## What looks healthy\n";
sp += "   ## Method (fanout map + adversarial verify)\n";
sp += "Write report_markdown in Chinese for narrative sections; keep finding ids and file paths in English/path form.\n";
sp += "Be honest: if Health Fanout #159 / P2 residual already fixed items, do not re-list as open.\n";

let syn = agent(sp, #{
    label: "synthesize",
    capability_mode: "read-only",
    agent_type: "general-purpose",
    output_schema: report_schema,
});

if syn == () || !syn.success || syn.output == () {
    let dump = all_findings_text + "\n" + verify_text;
    let fail_path = write_scratch_file("deep-diagnosis-failed.md", dump);
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
    date: "2026-08-28",
    product: "0.5.3",
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
    note: "Copy report_path into docs/audit/deep-diagnosis-fanout-2026-08-28.md then run kimi+claude dual re-review",
});
