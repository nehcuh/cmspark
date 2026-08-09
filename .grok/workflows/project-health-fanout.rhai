let meta = #{
    name: "project-health-fanout",
    description: "Thorough multi-dimension project health audit via parallel fanout: architecture, docs, design, product, security, tests, maintainability, new surfaces",
    phases: [
        #{ title: "Map", detail: "8 parallel dimension audits against live code and docs" },
        #{ title: "Synthesize", detail: "Dedup findings, score dashboard, prioritized action plan" },
    ],
    when_to_use: "Full project health check / 彻底体检 / fanout audit of architecture docs design product",
};

let dimension_schema = #{
    "type": "object",
    "required": ["dimension", "score_0_to_10", "grade", "summary", "strengths", "findings", "open_questions"],
    "properties": #{
        "dimension": #{ "type": "string" },
        "score_0_to_10": #{ "type": "number" },
        "grade": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "strengths": #{ "type": "array", "maxItems": 8, "items": #{ "type": "string" } },
        "findings": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["id", "severity", "title", "evidence", "file", "impact", "fix_hint"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                    "title": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "file": #{ "type": "string" },
                    "impact": #{ "type": "string" },
                    "fix_hint": #{ "type": "string" },
                    "prior_status": #{ "type": "string" },
                },
            },
        },
        "open_questions": #{ "type": "array", "maxItems": 5, "items": #{ "type": "string" } },
    },
};

let synth_schema = #{
    "type": "object",
    "required": [
        "executive_summary",
        "overall_score",
        "grade",
        "score_dashboard",
        "confirmed_critical",
        "confirmed_high",
        "top_risks",
        "action_plan",
        "delta_vs_prior",
        "dimension_scores"
    ],
    "properties": #{
        "executive_summary": #{ "type": "string" },
        "overall_score": #{ "type": "number" },
        "grade": #{ "type": "string" },
        "score_dashboard": #{ "type": "string" },
        "confirmed_critical": #{ "type": "number" },
        "confirmed_high": #{ "type": "number" },
        "top_risks": #{ "type": "array", "maxItems": 15, "items": #{ "type": "string" } },
        "action_plan": #{ "type": "string" },
        "delta_vs_prior": #{ "type": "string" },
        "dimension_scores": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["dimension", "score", "grade"],
                "properties": #{
                    "dimension": #{ "type": "string" },
                    "score": #{ "type": "number" },
                    "grade": #{ "type": "string" },
                },
            },
        },
        "product_coverage": #{ "type": "string" },
        "docs_health": #{ "type": "string" },
        "architecture_health": #{ "type": "string" },
        "design_health": #{ "type": "string" },
    },
};

// ---- shared prompt prefix (facts for cold agents) ----
let ctx = "";
ctx += "You are auditing CMspark (repo root workspace). ";
ctx += "Product version target: 0.5.0 (companion package.json). HEAD around 0de1760 on main. ";
ctx += "Topology: Chrome Extension (Plasmo+React Side Panel + SW/CDP) <-> WebSocket ws://127.0.0.1:23401 <-> Companion (Node+TS). ";
ctx += "Capability model ADR-020: Surface L0/L1/L2, Composition (Skill/Knowledge/MCP/Pack/user-env), Autonomy (thread/workers/Board). ";
ctx += "Prior audits: 2026-07-09 (4.4/C), 07-25 (5.8/C+), 07-28 (~6.9/B- docs debt), deep fanout 08-02. ";
ctx += "Prior High themes: threadFilePath escape, mcp.add stdio without L2, unredacted thread tool tape, chat.create supersede races, global pending-tool kill on any peer close, macOS cuPidForWindow, HUD spike respond, incomplete cancel, tray launchd args, MCP secret broadcast. ";
ctx += "RULES: Use only read-only tools (read_file, grep, list_dir). Never edit files. ";
ctx += "Every finding MUST cite file:line or path from tools you actually ran. Do not invent. ";
ctx += "Empty findings only after real inspection. Severity: critical|high|medium|low|info. ";
ctx += "prior_status: fixed|partial|open|new|unknown when rechecking known issues. ";
ctx += "Score 0-10 with letter grade. Be calibrated: no Critical without unauthenticated RCE/data-destruction class evidence.\n";

phase("Map");

let jobs = [];

// 1 Architecture
let p1 = ctx;
p1 += "DIMENSION: Architecture.\n";
p1 += "Tasks: (1) Map companion/src and chrome-extension/src major modules vs docs/architecture.md and ADR-001/002/020. ";
p1 += "(2) Measure god-files (server.ts, message-router.ts, App/hooks) LOC and boundary quality. ";
p1 += "(3) Check WS protocol versioning, shared types, dual-layer responsibility (extension vs companion). ";
p1 += "(4) Assess ADR-020 axis discipline in code (Surface gates, Pack cannot widen god-mode). ";
p1 += "(5) Flag architecture drift vs CLAUDE.md / architecture.md. ";
p1 += "Read: docs/architecture.md, docs/adr/020-capability-model-three-axes.md, companion/src/server.ts (structure/exports only — sample sections), message-router.ts structure, capability/, packs/, orchestrator/, board/, computer/, mcp/. ";
p1 += "Output findings with ARCH-* ids.";
jobs.push(#{
    prompt: p1,
    label: "dim:architecture",
    capability_mode: "read-only",
    output_schema: dimension_schema,
});

// 2 Documentation
let p2 = ctx;
p2 += "DIMENSION: Documentation.\n";
p2 += "Tasks: (1) Inventory user-facing docs vs shipped features (README, docs/README, GOAL, guides). ";
p2 += "(2) Spot fact errors / underclaim / overclaim vs code (version 0.5.0, voice/meeting, MCP outbound, board status). ";
p2 += "(3) Assess docs/ noise: decisions/, audit/reviews/, archive/ vs live guides. ";
p2 += "(4) Check TESTING.md, TROUBLESHOOTING, ADR statuses vs reality. ";
p2 += "(5) Score navigability for a new contributor. ";
p2 += "Read: README.md, docs/README.md, docs/GOAL.md, docs/TESTING.md, docs/architecture.md head, CHANGELOG.md head, a few ADRs (016 board, 022-024), docs-reorg-plan if present. ";
p2 += "Grep for stale phrases (risk-engine, privilege-manager, waiting for confirm, 0.3.0 as current). ";
p2 += "Output findings with DOC-* ids.";
jobs.push(#{
    prompt: p2,
    label: "dim:documentation",
    capability_mode: "read-only",
    output_schema: dimension_schema,
});

// 3 Design / UX
let p3 = ctx;
p3 += "DIMENSION: Design and UX product surface.\n";
p3 += "Tasks: (1) Compare docs/DESIGN.md tokens vs chrome-extension/src/sidepanel/ui/tokens.ts. ";
p3 += "(2) Inventory UI surfaces: Side Panel components, Cockpit, Settings, Packs, MCP, Board, Voice/Meeting, Confirm. ";
p3 += "(3) Mode badge = Surface L0/L1/L2 consistency. ";
p3 += "(4) Quiet-professional chrome rule (SVG vs emoji in chrome). ";
p3 += "(5) Dark mode / L2 SafetyStrip / narrow 320px panel constraints. ";
p3 += "(6) Note UX debt (settings sprawl, discoverability of 0.5.0 voice/meeting). ";
p3 += "Read DESIGN.md, tokens.ts, list sidepanel/components, cockpit, key App layout. ";
p3 += "Output findings with DES-* ids.";
jobs.push(#{
    prompt: p3,
    label: "dim:design",
    capability_mode: "read-only",
    output_schema: dimension_schema,
});

// 4 Product features
let p4 = ctx;
p4 += "DIMENSION: Product features — claimed vs delivered.\n";
p4 += "Build a coverage matrix for: chat+threads, browser CDP tools, skills/knowledge, Obsidian export, Mermaid, NotebookLM, Mission Pack, enterprise modules, MCP inbound+outbound, Confirm Center, multi-agent+Board, Computer Use, Host/Apps, voice local STT Path B, dictation+, meeting workbench, tray/pairing, daemon. ";
p4 += "For each: status shipped|partial|docs-only|missing, key code path, user doc link, gaps. ";
p4 += "Read GOAL.md delivered sections, README capability table, companion package features dirs (voice/, meeting/, outbound-mcp/, packs/, computer/, board/), extension sidepanel panels. ";
p4 += "Output summary strengths as shipped list; findings as gaps/overclaims with FEAT-* ids.";
jobs.push(#{
    prompt: p4,
    label: "dim:product",
    capability_mode: "read-only",
    output_schema: dimension_schema,
});

// 5 Security residual
let p5 = ctx;
p5 += "DIMENSION: Security residual recheck of known Highs + new 0.5.0 surfaces.\n";
p5 += "Recheck with CURRENT code (prior_status fixed|partial|open): ";
p5 += "(A) threadFilePath / sanitizeId on all readers/writers; ";
p5 += "(B) mcp.add stdio L2 gate; ";
p5 += "(C) thread JSON tool redaction; ";
p5 += "(D) chat.create supersede generation CAS + drain; ";
p5 += "(E) pendingToolCalls originWs + per-socket close; ";
p5 += "(F) macOS cuPidForWindow; ";
p5 += "(G) MCP list/env redaction; ";
p5 += "(H) voice/meeting/STT new trust surface (paths, model download, audio files). ";
p5 += "Grep/read the actual files. Do not rubber-stamp prior reports. ";
p5 += "Output findings with SEC-* ids.";
jobs.push(#{
    prompt: p5,
    label: "dim:security",
    capability_mode: "read-only",
    output_schema: dimension_schema,
});

// 6 Testing CI Release
let p6 = ctx;
p6 += "DIMENSION: Testing, CI, and Release.\n";
p6 += "Tasks: (1) Count companion/tests and chrome-extension/tests roughly; compare docs/TESTING.md. ";
p6 += "(2) Read .github/workflows/ci.yml and release.yml for hard gates, npm audit, soft-fail. ";
p6 += "(3) Check startServer real boot coverage; platform skips for CU. ";
p6 += "(4) Packaging: scripts/package, signing (ad-hoc?), SBOM. ";
p6 += "(5) Version lock-step companion vs extension package.json. ";
p6 += "Output findings with TEST-* / REL-* ids.";
jobs.push(#{
    prompt: p6,
    label: "dim:testing-release",
    capability_mode: "read-only",
    output_schema: dimension_schema,
});

// 7 Maintainability / code health
let p7 = ctx;
p7 += "DIMENSION: Maintainability and code health.\n";
p7 += "Tasks: (1) Identify largest modules and complexity hotspots. ";
p7 += "(2) Dead code / experimental spikes still in tree (hud spike, TinyClick remnants). ";
p7 += "(3) Test co-location quality and fixture isolation (CMSPARK_DATA_DIR). ";
p7 += "(4) Dependency hygiene glance (package.json engines, known heavy deps). ";
p7 += "(5) Cross-cutting concerns scattered (security originWs inconsistently). ";
p7 += "Use list_dir + grep + selective reads. Output MAINT-* findings.";
jobs.push(#{
    prompt: p7,
    label: "dim:maintainability",
    capability_mode: "read-only",
    output_schema: dimension_schema,
});

// 8 New 0.5.0 surfaces: voice / meeting / outbound MCP
let p8 = ctx;
p8 += "DIMENSION: New 0.5.0 product surfaces deep dive (voice, meeting, dictation, outbound MCP, Windows Python discovery).\n";
p8 += "Tasks: (1) Map companion/src/voice and meeting modules + extension voice hooks. ";
p8 += "(2) ADR-022/023/024 alignment with code. ";
p8 += "(3) Failure modes, progressive Whisper assumptions, M2 claims. ";
p8 += "(4) Outbound MCP server trust boundary. ";
p8 += "(5) Completeness of user guides vs code flags. ";
p8 += "Output findings with VOICE-* / MCPO-* / MEET-* ids.";
jobs.push(#{
    prompt: p8,
    label: "dim:surfaces-050",
    capability_mode: "read-only",
    output_schema: dimension_schema,
});

log("Launching 8-dimension parallel audit");
let results = parallel(jobs);

// Collect successful dimension outputs as JSON text for synthesizer
let dim_blob = "";
let ok_count = 0;
let i = 0;
for r in results {
    if r != () && r.success && r.output != () {
        ok_count += 1;
        dim_blob += "\n--- DIMENSION RESULT " + i.to_string() + " ---\n";
        dim_blob += json_encode(r.output);
        dim_blob += "\n";
    } else {
        dim_blob += "\n--- DIMENSION RESULT " + i.to_string() + " FAILED ---\n";
    }
    i += 1;
}
log(ok_count.to_string() + "/8 dimension agents succeeded");

if ok_count == 0 {
    complete(#{
        error: "All dimension agents failed",
        summary: "No audit data",
    });
}

phase("Synthesize");

let sp = "";
sp += "You are the senior engineer synthesizer for CMspark project health fanout (2026-08-09). ";
sp += "Product 0.5.0. Prior overall ~6.9/B- (07-28 docs-focused) and 5.8/C+ (07-25 security fanout). ";
sp += "Below are structured outputs from up to 8 dimension agents. ";
sp += "Deduplicate findings across dimensions. Prefer higher severity when evidence conflicts only if evidence is stronger. ";
sp += "Recalibrate: confirmed Critical only with unauthenticated RCE/mass data destruction; High = auth-peer integrity/RCE or durable secret tape class. ";
sp += "Produce overall score 0-10, letter grade, ASCII score_dashboard (multi-line string), top_risks, P0/P1/P2 action_plan, delta_vs_prior. ";
sp += "Also fill product_coverage, docs_health, architecture_health, design_health narrative paragraphs. ";
sp += "dimension_scores array must include all dimensions that reported. ";
sp += "Write executive_summary in Chinese (3-6 sentences) covering code/security + docs + product readiness for 0.5.0. ";
sp += "Do NOT invent findings not grounded in the dimension results; you may slightly refine wording. ";
sp += "If a dimension failed, note it in delta_vs_prior.\n\n";
sp += "DIMENSION DATA:\n";
sp += dim_blob;

let synth = agent(sp, #{
    label: "synthesize",
    capability_mode: "read-only",
    output_schema: synth_schema,
});

// Also write a markdown report via a second agent for human readability
let rp = "";
rp += "Write a full Chinese+English hybrid Markdown audit report for CMspark fanout health check dated 2026-08-09. ";
rp += "Title: # CMspark Project Health Fanout Report (2026-08-09). ";
rp += "Sections: Executive Summary, Score Dashboard (table + ascii), Prior Audit Delta, Architecture Map notes, Product Coverage Matrix narrative, ";
rp += "Documentation Health, Design/UX Health, Security Residual (table of rechecked Highs), Testing/CI/Release, Maintainability, New 0.5.0 Surfaces, ";
rp += "Top Risks, Prioritized Action Plan (P0/P1/P2), Finding Catalog (deduped, severity-sorted). ";
rp += "Use the structured synthesis and dimension JSON below. Be concrete with file paths. ";
rp += "If synthesis failed, best-effort from dimensions only.\n\n";
if synth != () && synth.success && synth.output != () {
    rp += "SYNTHESIS:\n";
    rp += json_encode(synth.output);
    rp += "\n\n";
}
rp += "DIMENSIONS:\n";
rp += dim_blob;
rp += "\nReturn ONLY the full markdown report body as plain text (no JSON wrapper).";

let report_agent = agent(rp, #{
    label: "write-report-md",
    capability_mode: "read-only",
});

let report_md = "";
if report_agent != () && report_agent.success && report_agent.output != () {
    report_md = report_agent.output;
    if type_of(report_md) != "string" {
        report_md = json_encode(report_md);
    }
} else {
    report_md = "# Report generation failed\n\nSee synthesis JSON.\n";
}

let path = write_scratch_file("health-fanout-2026-08-09.md", report_md);

let final_out = #{
    report_path: path,
    dimensions_ok: ok_count,
};
if synth != () && synth.success && synth.output != () {
    final_out.synthesis = synth.output;
    final_out.summary = synth.output.executive_summary;
    final_out.overall_score = synth.output.overall_score;
    final_out.grade = synth.output.grade;
} else {
    final_out.summary = "Synthesis agent failed; see dimension scratch and report.";
}

complete(final_out);
