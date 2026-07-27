let meta = #{
    name: "ui-ux-design-adversarial",
    description: "Adversarial validation of CMspark Side Panel UI/UX design claims, then Claude+Pi dual external review",
    when_to_use: "Validate UI/UX strategy conclusions against code before visual/IA implementation",
    phases: [
        #{ title: "Ground", detail: "Read code + approved IA docs" },
        #{ title: "Attack", detail: "Adversarial verify each claim C1-C12" },
        #{ title: "Synthesize", detail: "Lock amended conclusions + gaps" },
        #{ title: "ExternalReview", detail: "Separate Claude Code + Pi dual review" },
        #{ title: "Final", detail: "Merge internal + external into final report" },
    ],
};

let ground_schema = #{
    "type": "object",
    "required": ["chrome_inventory", "token_inconsistencies", "mode_alignment", "conflicts_with_three_mode", "evidence_paths"],
    "properties": #{
        "chrome_inventory": #{
            "type": "array", "maxItems": 16,
            "items": #{ "type": "string" },
        },
        "token_inconsistencies": #{
            "type": "array", "maxItems": 12,
            "items": #{ "type": "string" },
        },
        "mode_alignment": #{ "type": "string" },
        "conflicts_with_three_mode": #{
            "type": "array", "maxItems": 8,
            "items": #{ "type": "string" },
        },
        "evidence_paths": #{
            "type": "array", "maxItems": 16,
            "items": #{ "type": "string" },
        },
    },
};

let claim_verdict_schema = #{
    "type": "object",
    "required": ["claim_id", "verdict", "severity", "reason", "evidence", "amendment"],
    "properties": #{
        "claim_id": #{ "type": "string" },
        "verdict": #{ "type": "string" },
        "severity": #{ "type": "string" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
        "amendment": #{ "type": "string" },
    },
};

let synth_schema = #{
    "type": "object",
    "required": [
        "confirmed",
        "amended",
        "rejected",
        "missing_claims",
        "conflicts",
        "final_conclusions",
        "p0_actions",
        "risks"
    ],
    "properties": #{
        "confirmed": #{ "type": "array", "maxItems": 14, "items": #{ "type": "string" } },
        "amended": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "rejected": #{ "type": "array", "maxItems": 8, "items": #{ "type": "string" } },
        "missing_claims": #{ "type": "array", "maxItems": 10, "items": #{ "type": "string" } },
        "conflicts": #{ "type": "array", "maxItems": 8, "items": #{ "type": "string" } },
        "final_conclusions": #{ "type": "array", "maxItems": 14, "items": #{ "type": "string" } },
        "p0_actions": #{ "type": "array", "maxItems": 10, "items": #{ "type": "string" } },
        "risks": #{ "type": "array", "maxItems": 8, "items": #{ "type": "string" } },
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
        "exit_code": #{ "type": "integer" },
        "raw_tail": #{ "type": "string" },
    },
};

let brief = "docs/decisions/v1.3/ui-ux-gemini-depth-claims-brief-2026-07-27.md";
let three_mode = "docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md";
let design_md = "docs/DESIGN.md";

// ---------------------------------------------------------------------------
// Phase 1: Ground in real Side Panel code + approved IA
// ---------------------------------------------------------------------------
phase("Ground");

let ground_p = "";
ground_p += "You are GROUNDING a UI/UX design validation for CMspark. Repo root: /Users/huchen/Projects/cmspark. ";
ground_p += "READ with tools (read_file/grep) — do not invent structure:\n";
ground_p += "1) " + brief + "\n";
ground_p += "2) " + three_mode + " (esp. §2 locked decisions, §4 Side Panel IA, §5 Cockpit)\n";
ground_p += "3) " + design_md + "\n";
ground_p += "4) chrome-extension/src/sidepanel/ui/tokens.ts\n";
ground_p += "5) chrome-extension/src/sidepanel/App.tsx — Header icon inventory, InputArea layout, SecurityConfirmationDialog density, styles at bottom\n";
ground_p += "6) chrome-extension/src/sidepanel/components/BottomBar.tsx — ALL_TABS and mode filtering\n";
ground_p += "7) chrome-extension/src/sidepanel/mode/mode-controller.ts — contextBarTabsForLevel\n";
ground_p += "8) Grep sidepanel for #4A90D9|#F44336|#FF9800|emoji|🤔|⚙️ and list concrete hits\n";
ground_p += "9) Spot-check ChatView.tsx message bubble styles, SafetyStrip.tsx, ComputerTaskBar.tsx if present\n";
ground_p += "10) docs/decisions/v1.3/ui-three-mode-redesign-review-synthesis-2026-07-26.md if exists\n\n";
ground_p += "Return:\n";
ground_p += "- chrome_inventory: permanent UI chrome pieces visible in default Panel path (header buttons, strips, bars, modals)\n";
ground_p += "- token_inconsistencies: file:pattern where colors/styles diverge from tokens.ts / DESIGN.md\n";
ground_p += "- mode_alignment: does implemented mode-controller + BottomBar match three-mode D5/D6/§4?\n";
ground_p += "- conflicts_with_three_mode: any claim in the brief that would reverse locked decisions\n";
ground_p += "- evidence_paths: key files:lines you used\n";
ground_p += "Be factual and hostile to marketing language.";

let ground = agent(ground_p, #{
    label: "ground-ui",
    capability_mode: "read-only",
    output_schema: ground_schema,
});

let ground_blob = "";
if ground != () && ground.success && ground.output != () {
    ground_blob = json_encode(ground.output);
    log("Ground OK");
} else {
    ground_blob = "{\"error\":\"grounding failed\"}";
    log("WARN: grounding failed — attacks continue with brief only");
}

// ---------------------------------------------------------------------------
// Phase 2: Adversarial attack each claim C1-C12
// ---------------------------------------------------------------------------
phase("Attack");

let claims = [
    #{ id: "C1", text: "Root problem is IA + visual execution inconsistency, not missing features. Feature landfill in 320px; tokens inconsistent; old Material colors remain." },
    #{ id: "C2", text: "Gemini beauty = restraint + implicit context + single conversation focus; not purple branding." },
    #{ id: "C3", text: "Kimi WebBridge is architecture overlap (local bridge/CDP) not a visual template; do not default to bridge-console UI." },
    #{ id: "C4", text: "Claude in Chrome is best agent UX reference for depth-without-bloat (chat-first, slash, progressive tools)." },
    #{ id: "C5", text: "Sider/Monica permanent multi-tool nav is an anti-pattern for CMspark default chrome." },
    #{ id: "C6", text: "L0/L1/L2 ontology remains correct; depth escalates with mode/surface not more permanent BottomBar tabs." },
    #{ id: "C7", text: "Default Panel must be conversation-first (>=70% stream); header via ⋯; BottomBar 0-2 by mode; power via / and settings." },
    #{ id: "C8", text: "Depth entry matrix correct: Skills/Packs/MCP not default-visible; page context L1 chip; tools in-message; CU -> Cockpit." },
    #{ id: "C9", text: "Visual stay quiet-professional blue/neutral; reject AI-purple kits; dark only L2/Cockpit." },
    #{ id: "C10", text: "Ugly gap = token inconsistency + chrome density + utilitarian chat/confirm; fix P0 unify then P1 IA cut then polish." },
    #{ id: "C11", text: "Security confirm needs three-layer progressive disclosure; current Panel full dialog overloads." },
    #{ id: "C12", text: "Empty-state suggested prompts + unified composer are high-leverage polish moves." },
];

let attack_jobs = [];
let ci = 0;
while ci < claims.len() {
    let c = claims[ci];
    let ap = "";
    ap += "ADVERSARIAL SKEPTIC for CMspark UI/UX design claim " + c.id + ".\n";
    ap += "Default verdict=REJECT unless concrete evidence from REPO supports the claim (or AMEND if direction right but wording wrong).\n";
    ap += "Allowed verdict enum exactly: CONFIRMED | AMEND | REJECT\n";
    ap += "Claim: " + c.text + "\n";
    ap += "Brief path: " + brief + " — re-read claim section for " + c.id + ".\n";
    ap += "Grounding JSON from code inventory (may be partial): " + ground_blob + "\n";
    ap += "METHOD (mandatory tools):\n";
    ap += "- For code-facing claims (C1,C6-C12): read App.tsx, BottomBar.tsx, mode-controller.ts, tokens.ts, Security dialog region, DESIGN.md / three-mode spec as needed.\n";
    ap += "- For competitor claims (C2-C5): you may use web_search if available; otherwise mark evidence as 'external-knowledge limited' and judge only product-logic fit to CMspark code.\n";
    ap += "- If claim conflicts with locked three-mode decisions, prefer AMEND or REJECT and say which decision ID.\n";
    ap += "severity: blocker|high|medium|low — impact of acting on a WRONG claim, or of ignoring a true one.\n";
    ap += "evidence: cite file paths / sections you opened.\n";
    ap += "amendment: if AMEND, write the corrected claim in one sentence; else empty string.\n";
    ap += "Be hostile to handwavy 'Gemini is pretty' without operational design rules.";
    attack_jobs.push(#{
        prompt: ap,
        label: "attack:" + c.id,
        capability_mode: "read-only",
        output_schema: claim_verdict_schema,
    });
    ci += 1;
}

let attack_results = parallel(attack_jobs);

let claim_rows = [];
let attack_ok = 0;
let ai = 0;
while ai < attack_results.len() {
    let r = attack_results[ai];
    let c = claims[ai];
    if r != () && r.success && r.output != () {
        attack_ok += 1;
        claim_rows.push(r.output);
    } else {
        claim_rows.push(#{
            claim_id: c.id,
            verdict: "REJECT",
            severity: "high",
            reason: "adversarial agent failed — fail closed",
            evidence: "",
            amendment: "",
        });
    }
    ai += 1;
}
log("Attack complete: " + attack_ok.to_string() + "/" + claims.len().to_string() + " usable");

// ---------------------------------------------------------------------------
// Phase 3: Synthesize internal final conclusions
// ---------------------------------------------------------------------------
phase("Synthesize");

let synth_in = json_encode(#{
    grounding: ground_blob,
    claim_verdicts: claim_rows,
});

let sp = "";
sp += "You are the INTERNAL synthesizer for CMspark UI/UX design validation.\n";
sp += "INPUT JSON: " + synth_in + "\n";
sp += "Re-read " + brief + " and " + three_mode + " with tools if needed.\n";
sp += "Rules:\n";
sp += "1) Prefer CONFIRMED claims with evidence; rewrite AMEND into final_conclusions; drop REJECT unless you re-justify with new tool evidence.\n";
sp += "2) missing_claims: important gaps prior analysis missed (e.g. a11y, localization, onboarding pairing, multi-worker confirm storms, 320px scroll budget math, dark/light flash, i18n density).\n";
sp += "3) conflicts: only real conflicts with three-mode locked decisions.\n";
sp += "4) final_conclusions: product-grade rules engineers can implement next — numbered intent, no marketing.\n";
sp += "5) p0_actions: max 8 concrete code-level actions for Side Panel visual/IA P0 (files + what to change).\n";
sp += "6) risks: ways this design advice could harm power users, security UX, or L2.\n";
sp += "7) Do NOT invent new capability modes beyond L0/L1/L2 without flagging as open question in missing_claims.\n";

let synth = agent(sp, #{
    label: "synthesize-ui",
    capability_mode: "read-only",
    output_schema: synth_schema,
});

let synth_blob = "";
let synth_ok = false;
if synth != () && synth.success && synth.output != () {
    synth_blob = json_encode(synth.output);
    synth_ok = true;
    log("Synthesize OK");
} else {
    synth_blob = "{\"error\":\"synthesize failed\"}";
    log("Synthesize FAILED");
}

// Build internal report early
let md = "";
md += "# UI/UX Design Claims — Adversarial Validation Report\n\n";
md += "Workflow: `ui-ux-design-adversarial`\n";
md += "Brief: `" + brief + "`\n\n";
md += "## 1. Grounding (code inventory)\n\n";
md += "```json\n" + ground_blob + "\n```\n\n";
md += "## 2. Per-claim adversarial verdicts\n\n";
let ri = 0;
while ri < claim_rows.len() {
    let row = claim_rows[ri];
    let cid = "";
    let verd = "";
    let sev = "";
    let reason = "";
    let evid = "";
    let amend = "";
    if row.claim_id != () { cid = row.claim_id; }
    if row.verdict != () { verd = row.verdict; }
    if row.severity != () { sev = row.severity; }
    if row.reason != () { reason = row.reason; }
    if row.evidence != () { evid = row.evidence; }
    if row.amendment != () { amend = row.amendment; }
    md += "### " + cid + " — **" + verd + "** (" + sev + ")\n\n";
    md += "- Reason: " + reason + "\n";
    md += "- Evidence: " + evid + "\n";
    if amend != "" {
        md += "- Amendment: " + amend + "\n";
    }
    md += "\n";
    ri += 1;
}

md += "## 3. Internal synthesis\n\n";
if synth_ok {
    let o = synth.output;
    md += "### Confirmed\n\n";
    if o.confirmed != () {
        let i = 0;
        while i < o.confirmed.len() {
            md += "- " + o.confirmed[i] + "\n";
            i += 1;
        }
    }
    md += "\n### Amended\n\n";
    if o.amended != () {
        let i = 0;
        while i < o.amended.len() {
            md += "- " + o.amended[i] + "\n";
            i += 1;
        }
    }
    md += "\n### Rejected\n\n";
    if o.rejected != () {
        let i = 0;
        while i < o.rejected.len() {
            md += "- " + o.rejected[i] + "\n";
            i += 1;
        }
    }
    md += "\n### Missing claims (gaps)\n\n";
    if o.missing_claims != () {
        let i = 0;
        while i < o.missing_claims.len() {
            md += "- " + o.missing_claims[i] + "\n";
            i += 1;
        }
    }
    md += "\n### Conflicts with three-mode\n\n";
    if o.conflicts != () {
        let i = 0;
        while i < o.conflicts.len() {
            md += "- " + o.conflicts[i] + "\n";
            i += 1;
        }
    }
    md += "\n### Final conclusions (internal)\n\n";
    if o.final_conclusions != () {
        let i = 0;
        while i < o.final_conclusions.len() {
            md += (i + 1).to_string() + ". " + o.final_conclusions[i] + "\n";
            i += 1;
        }
    }
    md += "\n### P0 actions\n\n";
    if o.p0_actions != () {
        let i = 0;
        while i < o.p0_actions.len() {
            md += "- " + o.p0_actions[i] + "\n";
            i += 1;
        }
    }
    md += "\n### Risks\n\n";
    if o.risks != () {
        let i = 0;
        while i < o.risks.len() {
            md += "- " + o.risks[i] + "\n";
            i += 1;
        }
    }
} else {
    md += "_Synthesis agent failed._\n";
}

let internal_path = write_scratch_file("ui-ux-internal-report.md", md);
log("Internal report: " + internal_path);

// Fail closed if too few attacks worked
if attack_ok < 8 {
    complete(#{
        summary: "INTERNAL ADVERSARIAL INCOMPLETE — skip external",
        attack_ok: attack_ok,
        internal_path: internal_path,
        external: #{"skipped": true},
    });
}

// ---------------------------------------------------------------------------
// Phase 4: External Claude + Pi dual review (separate processes)
// ---------------------------------------------------------------------------
phase("ExternalReview");
log("Launching SEPARATE Claude Code + Pi dual design review");

let review_body = "";
review_body += "# External dual review — UI/UX design conclusions (NOT a code-fix PR)\n\n";
review_body += "You are reviewing a **product UI/UX strategy** for CMspark Side Panel, not a security patch.\n\n";
review_body += "## Your job\n";
review_body += "1. Read the claims brief and the internal adversarial synthesis (below + files).\n";
review_body += "2. Independently inspect Side Panel code and three-mode redesign docs with tools.\n";
review_body += "3. Challenge over-claiming (especially competitor comparisons C2-C5 without code proof).\n";
review_body += "4. Check consistency with approved three-mode redesign locked decisions.\n";
review_body += "5. Say whether the P0 visual/IA direction is safe to implement.\n";
review_body += "6. List blocking issues if any (wrong ontology, security UX regressions, power-user traps).\n\n";
review_body += "## Must-read files\n";
review_body += "- " + brief + "\n";
review_body += "- " + three_mode + "\n";
review_body += "- " + design_md + "\n";
review_body += "- chrome-extension/src/sidepanel/App.tsx\n";
review_body += "- chrome-extension/src/sidepanel/components/BottomBar.tsx\n";
review_body += "- chrome-extension/src/sidepanel/mode/mode-controller.ts\n";
review_body += "- chrome-extension/src/sidepanel/ui/tokens.ts\n\n";
review_body += "## Internal synthesis JSON\n";
review_body += synth_blob + "\n\n";
review_body += "## Per-claim verdicts JSON\n";
review_body += json_encode(claim_rows) + "\n\n";
review_body += "## Grounding JSON\n";
review_body += ground_blob + "\n\n";
review_body += "Ignore empty/unrelated git diffs if working tree is dirty with unrelated files; focus on design docs + sidepanel source.\n\n";
review_body += "Structure your review as:\n";
review_body += "### Strengths\n### Blocking issues (if any)\n### Nits\n### Missing angles\n### Recommended final stance\n";
review_body += "Then end with EXACTLY one line:\n";
review_body += "VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";
review_body += "(Use APPROVE if conclusions are sound enough to drive P0; REJECT if major ontology or safety UX error.)\n";

let prompt_file = "/tmp/cmspark-review-ui-ux-depth-20260727.md";
let batch = "ui-ux-depth";

let ext_p = "";
ext_p += "You must run the DUAL EXTERNAL REVIEW helper. Do not re-implement UI.\n";
ext_p += "1) Write the following content EXACTLY to " + prompt_file + " using write tool or shell heredoc:\n";
ext_p += "-----BEGIN PROMPT-----\n";
ext_p += review_body;
ext_p += "\n-----END PROMPT-----\n";
ext_p += "2) Run this SINGLE command from repo root /Users/huchen/Projects/cmspark:\n";
ext_p += "   bash scripts/dual-external-review.sh " + batch + " " + prompt_file + " HEAD\n";
ext_p += "3) Wait for completion (may take several minutes). Read newest docs/audit/reviews/" + batch + "-verdict-*.json\n";
ext_p += "4) Read tails of the claude and pi md review files.\n";
ext_p += "5) Return structured: both_approve, claude_verdict, pi_verdict, claude_path, pi_path, verdict_json, exit_code, raw_tail.\n";
ext_p += "CRITICAL: Actually execute the shell script. Do not fabricate verdicts.\n";
ext_p += "exit_code: 0=both approve, 2=reject, 3=infra.\n";

let ext = agent(ext_p, #{
    label: "external-dual-ui-ux",
    capability_mode: "all",
    output_schema: external_schema,
});

let ext_blob = "";
let ext_section = "";
if ext != () && ext.success && ext.output != () {
    ext_blob = json_encode(ext.output);
    ext_section += "## 4. External dual review (Claude + Pi)\n\n";
    ext_section += "- claude: " + ext.output.claude_verdict + "\n";
    ext_section += "- pi: " + ext.output.pi_verdict + "\n";
    ext_section += "- both_approve: " + ext.output.both_approve.to_string() + "\n";
    ext_section += "- exit_code: " + ext.output.exit_code.to_string() + "\n";
    if ext.output.claude_path != () {
        ext_section += "- claude_path: `" + ext.output.claude_path + "`\n";
    }
    if ext.output.pi_path != () {
        ext_section += "- pi_path: `" + ext.output.pi_path + "`\n";
    }
    if ext.output.verdict_json != () {
        ext_section += "- verdict_json: `" + ext.output.verdict_json + "`\n";
    }
    if ext.output.raw_tail != () {
        ext_section += "\n### raw_tail\n\n```\n" + ext.output.raw_tail + "\n```\n";
    }
    log("External: claude=" + ext.output.claude_verdict + " pi=" + ext.output.pi_verdict);
} else {
    ext_blob = "{\"error\":\"external dual review failed\"}";
    ext_section += "## 4. External dual review\n\n_FAILED — inspect scripts/dual-external-review.sh and docs/audit/reviews/_\n\n";
    log("External dual review agent failed");
}

// ---------------------------------------------------------------------------
// Phase 5: Final merge report
// ---------------------------------------------------------------------------
phase("Final");

let final_p = "";
final_p += "Merge INTERNAL synthesis and EXTERNAL Claude/Pi reviews into FINAL recommended conclusions for CMspark UI/UX.\n";
final_p += "Internal synthesis: " + synth_blob + "\n";
final_p += "External dual: " + ext_blob + "\n";
final_p += "Per-claim: " + json_encode(claim_rows) + "\n";
final_p += "If external failed or REJECT, still produce best-effort finals but mark confidence low and list blockers.\n";
final_p += "Re-open " + brief + " only if needed.\n";
final_p += "Return same schema as internal synth but with FINAL stance incorporating external nits/blocks.\n";
final_p += "p0_actions must be implementable tomorrow without reversing three-mode locked decisions.\n";

let final_agent = agent(final_p, #{
    label: "final-merge-ui",
    capability_mode: "read-only",
    output_schema: synth_schema,
});

let final_md = md + "\n" + ext_section + "\n";
final_md += "## 5. FINAL recommended conclusions (post Claude/Pi)\n\n";

if final_agent != () && final_agent.success && final_agent.output != () {
    let fo = final_agent.output;
    final_md += "### Confirmed\n\n";
    if fo.confirmed != () {
        let i = 0;
        while i < fo.confirmed.len() {
            final_md += "- " + fo.confirmed[i] + "\n";
            i += 1;
        }
    }
    final_md += "\n### Amended (use these wordings)\n\n";
    if fo.amended != () {
        let i = 0;
        while i < fo.amended.len() {
            final_md += "- " + fo.amended[i] + "\n";
            i += 1;
        }
    }
    final_md += "\n### Rejected\n\n";
    if fo.rejected != () {
        let i = 0;
        while i < fo.rejected.len() {
            final_md += "- " + fo.rejected[i] + "\n";
            i += 1;
        }
    }
    final_md += "\n### Gaps still open\n\n";
    if fo.missing_claims != () {
        let i = 0;
        while i < fo.missing_claims.len() {
            final_md += "- " + fo.missing_claims[i] + "\n";
            i += 1;
        }
    }
    final_md += "\n### Conflicts\n\n";
    if fo.conflicts != () {
        let i = 0;
        while i < fo.conflicts.len() {
            final_md += "- " + fo.conflicts[i] + "\n";
            i += 1;
        }
    }
    final_md += "\n### Final conclusions\n\n";
    if fo.final_conclusions != () {
        let i = 0;
        while i < fo.final_conclusions.len() {
            final_md += (i + 1).to_string() + ". " + fo.final_conclusions[i] + "\n";
            i += 1;
        }
    }
    final_md += "\n### P0 actions (approved direction)\n\n";
    if fo.p0_actions != () {
        let i = 0;
        while i < fo.p0_actions.len() {
            final_md += "- " + fo.p0_actions[i] + "\n";
            i += 1;
        }
    }
    final_md += "\n### Risks\n\n";
    if fo.risks != () {
        let i = 0;
        while i < fo.risks.len() {
            final_md += "- " + fo.risks[i] + "\n";
            i += 1;
        }
    }
} else {
    final_md += "_Final merge agent failed — use internal synthesis + external files manually._\n";
}

final_md += "\n---\n\n*Generated by workflow ui-ux-design-adversarial*\n";

let report_path = write_scratch_file("ui-ux-final-report.md", final_md);

// Also persist into docs/audit via shell-capable agent best-effort
let persist_p = "";
persist_p += "Write the following markdown EXACTLY to docs/decisions/v1.3/ui-ux-depth-adversarial-final-2026-07-27.md using the write tool (create/overwrite).\n";
persist_p += "Also copy same content to docs/audit/reviews/ui-ux-depth-adversarial-final-2026-07-27.md if the directory exists.\n";
persist_p += "CONTENT:\n\n";
persist_p += final_md;

let persist = agent(persist_p, #{
    label: "persist-report",
    capability_mode: "read-write",
});

let summary = "UI/UX adversarial validation complete";
if ext != () && ext.success && ext.output != () {
    summary = "attack_ok=" + attack_ok.to_string() + " claude=" + ext.output.claude_verdict + " pi=" + ext.output.pi_verdict;
}

complete(#{
    summary: summary,
    attack_ok: attack_ok,
    internal_scratch: internal_path,
    final_scratch: report_path,
    external: ext.output,
    final: final_agent.output,
});
