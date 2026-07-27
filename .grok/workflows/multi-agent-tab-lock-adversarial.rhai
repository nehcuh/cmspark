let meta = #{
    name: "multi-agent-tab-lock-adversarial",
    description: "Adversarial design dive: multi-agent orchestrator + tab exclusive lock + dashboard for CMspark",
    when_to_use: "When designing multi-agent / sub-agent / orchestrator / tab lock for CMspark before implementation",
    phases: [
        #{ title: "Ground", detail: "Read codebase constraints" },
        #{ title: "Propose", detail: "Parallel design dimensions" },
        #{ title: "Attack", detail: "Adversarial verify each proposal" },
        #{ title: "Lock", detail: "Synthesis of surviving rules" },
    ],
};

let proposals_schema = #{
    "type": "object",
    "required": ["dimension", "proposals"],
    "properties": #{
        "dimension": #{ "type": "string" },
        "proposals": #{
            "type": "array",
            "maxItems": 5,
            "items": #{
                "type": "object",
                "required": ["id", "statement", "level", "rationale", "enforcement_hint"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "statement": #{ "type": "string" },
                    "level": #{ "type": "string" },
                    "rationale": #{ "type": "string" },
                    "enforcement_hint": #{ "type": "string" },
                    "rejected_alt": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["sound", "severity", "reason", "evidence", "counter_if_unsound"],
    "properties": #{
        "sound": #{ "type": "boolean" },
        "severity": #{ "type": "string" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
        "counter_if_unsound": #{ "type": "string" },
    },
};

let ground_schema = #{
    "type": "object",
    "required": ["constraints", "hotspots", "tab_touchpoints"],
    "properties": #{
        "constraints": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "hotspots": #{ "type": "array", "maxItems": 10, "items": #{ "type": "string" } },
        "tab_touchpoints": #{ "type": "array", "maxItems": 10, "items": #{ "type": "string" } },
    },
};

let synth_schema = #{
    "type": "object",
    "required": ["locked_conclusions", "tab_lock_model", "phased_delivery", "open_questions", "rejected"],
    "properties": #{
        "locked_conclusions": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "tab_lock_model": #{ "type": "string" },
        "phased_delivery": #{ "type": "array", "maxItems": 6, "items": #{ "type": "string" } },
        "open_questions": #{ "type": "array", "maxItems": 10, "items": #{ "type": "string" } },
        "rejected": #{ "type": "array", "maxItems": 10, "items": #{ "type": "string" } },
    },
};

// --- Phase 1: Ground in real code ---
phase("Ground");
let ground_prompt = "";
ground_prompt += "You are grounding a multi-agent design for the CMspark repo at /Users/huchen/Projects/cmspark. ";
ground_prompt += "READ (use read_file/grep; do not invent APIs): ";
ground_prompt += "(1) docs/decisions/v1.3/multi-agent-orchestrator-brief-2026-07-27.md ";
ground_prompt += "(2) chrome-extension/src/background/browser-bridge.ts — how tabId/CDP attach works ";
ground_prompt += "(3) companion/src/security-confirmation.ts — confirm queue model ";
ground_prompt += "(4) companion/src/threads/thread-manager.ts — thread isolation ";
ground_prompt += "(5) docs/architecture.md sections on message flow and multi-thread examples ";
ground_prompt += "(6) companion/src/server.ts regions for tool execution / security confirmation if findable via grep. ";
ground_prompt += "Return constraints (architecture hard limits), hotspots (race/security), tab_touchpoints (where tab ops enter). ";
ground_prompt += "Empty arrays only if you truly found nothing after searching — prefer concrete file:symbol references.";

let ground = agent(ground_prompt, #{
    label: "ground-code",
    capability_mode: "read-only",
    output_schema: ground_schema,
});

let constraints_blob = "";
if ground != () && ground.success && ground.output != () {
    constraints_blob = json_encode(ground.output);
} else {
    constraints_blob = "{\"error\":\"grounding failed — still design carefully from brief paths\"}";
    log("WARN: grounding agent failed; proposals continue with brief only");
}

// --- Phase 2: Parallel design proposals ---
phase("Propose");

let dims = [
    "TAB_LOCK",
    "ORCHESTRATOR_WORKER_MODEL",
    "SECURITY_L2_AND_CAPABILITY",
    "DASHBOARD_AND_HITL",
    "FAILURES_DEADLOCK_NON_GOALS",
];

let dim_focus = #{
    "TAB_LOCK": "Exclusive tab operation lock: granularity (tab vs window), read vs write tools, lease duration (per-tool vs per-turn vs explicit release), holder identity, enforcement in Companion vs Extension, timeout/steal/user force-release, multi-tab workers, interaction with L2 while holding lock, Computer-Use orthogonality. USER HARD RULE: while a sub-agent operates a tab, others must wait for lock release.",
    "ORCHESTRATOR_WORKER_MODEL": "Worker as Thread vs new runtime; orchestrator narrow tools; spawn UX (user approve vs auto); Pack as role; parent/child metadata; result collect; concurrency caps.",
    "SECURITY_L2_AND_CAPABILITY": "Confirm fanout storms; shared confirm queue; capability downgrade on spawn; shell/netsec never silent parallel; audit who did what; enterprise profile interaction.",
    "DASHBOARD_AND_HITL": "Dashboard entry (Side Panel vs full page); status model; enter worker chat; pause/cancel; confirm center; 320px constraints; relation to L0/L1/L2 UI modes.",
    "FAILURES_DEADLOCK_NON_GOALS": "Deadlock scenarios; orphan locks; worker crash mid-lock; partial results; non-goals to reject; kill criteria for bad designs.",
};

let propose_jobs = [];
for d in dims {
    let focus = dim_focus[d];
    let p = "";
    p += "CMspark multi-agent DESIGN (not implement). Dimension=" + d + ". ";
    p += "User hard rule: tab exclusive lock while a sub-agent operates that tab. ";
    p += "Brief: docs/decisions/v1.3/multi-agent-orchestrator-brief-2026-07-27.md — READ it. ";
    p += "Grounding JSON from codebase (may be partial): " + constraints_blob + " ";
    p += "Your focus: " + focus + " ";
    p += "Also spot-check relevant code with grep/read_file when you cite enforcement points. ";
    p += "Emit 3-5 proposals. level must be one of: must | should | could. ";
    p += "id format: " + d + "-N (e.g. TAB_LOCK-1). statement is a precise product/architecture rule. ";
    p += "enforcement_hint: where it would be enforced (companion/extension/UI). ";
    p += "rejected_alt: one tempting alternative you reject and why. ";
    p += "Be adversarial to naive 'just run N agents'. Prefer CMspark dual-layer realities.";
    propose_jobs.push(#{
        prompt: p,
        label: "propose:" + d,
        capability_mode: "read-only",
        output_schema: proposals_schema,
    });
}

let prop_results = parallel(propose_jobs);

// Flatten proposals (cap for attack budget)
let all_props = [];
let MAX_PROPS = 18;
let pi = 0;
while pi < prop_results.len() {
    let r = prop_results[pi];
    if r != () && r.success && r.output != () && r.output.proposals != () {
        let list = r.output.proposals;
        let j = 0;
        while j < list.len() {
            if all_props.len() < MAX_PROPS {
                let item = list[j];
                // tag dimension for later
                all_props.push(#{
                    id: item.id,
                    statement: item.statement,
                    level: item.level,
                    rationale: item.rationale,
                    enforcement_hint: item.enforcement_hint,
                    dimension: r.output.dimension,
                });
            }
            j += 1;
        }
    }
    pi += 1;
}
log("Proposals collected: " + all_props.len().to_string());

if all_props.len() == 0 {
    complete(#{
        summary: "No proposals generated — abort",
        locked_conclusions: [],
        path: "",
    });
}

// --- Phase 3: Adversarial attack each proposal ---
phase("Attack");
let attack_jobs = [];
let ai = 0;
while ai < all_props.len() {
    let pr = all_props[ai];
    let encoded = json_encode(pr);
    let ap = "";
    ap += "Adversarially VERIFY this CMspark multi-agent design proposal. ";
    ap += "Default to sound=false unless you find concrete support in repo docs/code. ";
    ap += "Proposal JSON: " + encoded + " ";
    ap += "Read brief docs/decisions/v1.3/multi-agent-orchestrator-brief-2026-07-27.md and relevant code if enforcement_hint names files. ";
    ap += "sound=true ONLY if: (a) compatible with dual-layer Extension/Companion, (b) does not break L2/security model, ";
    ap += "(c) for TAB_LOCK topics: actually enforces exclusive tab ops (not honor-system prompts), ";
    ap += "(d) evidence field cites file paths or brief sections you inspected. ";
    ap += "severity: blocker|high|medium|low for impact if we adopt an UNSOUND proposal, or of the gap if sound=false. ";
    ap += "counter_if_unsound: better rule or empty if sound. ";
    ap += "Be hostile to handwaving and to unbounded parallelism.";
    attack_jobs.push(#{
        prompt: ap,
        label: "attack:" + pr.id,
        capability_mode: "read-only",
        output_schema: verdict_schema,
    });
    ai += 1;
}

let attack_results = parallel(attack_jobs);

let survivors = [];
let killed = [];
let vi = 0;
while vi < attack_results.len() {
    let v = attack_results[vi];
    let pr = all_props[vi];
    if v != () && v.success && v.output != () && v.output.sound == true
        && v.output.evidence != () && v.output.evidence != "" {
        survivors.push(#{
            id: pr.id,
            statement: pr.statement,
            level: pr.level,
            dimension: pr.dimension,
            reason: v.output.reason,
            evidence: v.output.evidence,
        });
    } else {
        let why = "no usable verdict";
        let counter = "";
        if v != () && v.success && v.output != () {
            if v.output.reason != () { why = v.output.reason; }
            if v.output.counter_if_unsound != () { counter = v.output.counter_if_unsound; }
        }
        killed.push(#{
            id: pr.id,
            statement: pr.statement,
            why: why,
            counter: counter,
        });
    }
    vi += 1;
}
log("Survivors " + survivors.len().to_string() + " / killed " + killed.len().to_string());

// --- Phase 4: Lock conclusions ---
phase("Lock");
let synth_in = json_encode(#{
    survivors: survivors,
    killed: killed,
    grounding: constraints_blob,
});

let sp = "";
sp += "You are the FINAL synthesizer for CMspark multi-agent + tab lock design. ";
sp += "INPUT (JSON): " + synth_in + " ";
sp += "Also re-read docs/decisions/v1.3/multi-agent-orchestrator-brief-2026-07-27.md. ";
sp += "Produce product-grade locked conclusions. Rules: ";
sp += "(1) Prefer survivor proposals; you MAY include a killed proposal ONLY if you independently re-justify with code evidence via tools. ";
sp += "(2) Tab exclusive lock MUST appear as a first-class locked conclusion with a state-machine-ish tab_lock_model string. ";
sp += "(3) phased_delivery: P0/P1/P2 concrete. ";
sp += "(4) open_questions: only real product forks. ";
sp += "(5) rejected: include tempting bad designs (silent multi-shell, prompt-only locks, etc.). ";
sp += "Write for engineers shipping next quarter — precise, no marketing fluff.";

let synth = agent(sp, #{
    label: "synthesize-lock",
    capability_mode: "read-only",
    output_schema: synth_schema,
});

// Build markdown report
let md = "";
md += "# Multi-Agent Orchestrator + Tab Lock — Adversarial Workflow Synthesis\n\n";
md += "Generated by workflow `multi-agent-tab-lock-adversarial`.\n\n";
md += "## Grounding (code)\n\n";
md += "```json\n" + constraints_blob + "\n```\n\n";
md += "## Proposal funnel\n\n";
md += "- Collected proposals: " + all_props.len().to_string() + "\n";
md += "- Survivors after attack: " + survivors.len().to_string() + "\n";
md += "- Killed: " + killed.len().to_string() + "\n\n";

if synth != () && synth.success && synth.output != () {
    let o = synth.output;
    md += "## Locked conclusions\n\n";
    if o.locked_conclusions != () {
        let i = 0;
        while i < o.locked_conclusions.len() {
            md += (i + 1).to_string() + ". " + o.locked_conclusions[i] + "\n";
            i += 1;
        }
    }
    md += "\n## Tab lock model\n\n";
    if o.tab_lock_model != () {
        md += o.tab_lock_model + "\n";
    }
    md += "\n## Phased delivery\n\n";
    if o.phased_delivery != () {
        let i = 0;
        while i < o.phased_delivery.len() {
            md += "- " + o.phased_delivery[i] + "\n";
            i += 1;
        }
    }
    md += "\n## Open questions\n\n";
    if o.open_questions != () {
        let i = 0;
        while i < o.open_questions.len() {
            md += "- " + o.open_questions[i] + "\n";
            i += 1;
        }
    }
    md += "\n## Rejected alternatives\n\n";
    if o.rejected != () {
        let i = 0;
        while i < o.rejected.len() {
            md += "- " + o.rejected[i] + "\n";
            i += 1;
        }
    }
} else {
    md += "## Synthesis agent failed\n\nFalling back to survivor list only.\n\n";
}

md += "\n## Survivors (verified sound)\n\n";
let si = 0;
while si < survivors.len() {
    let s = survivors[si];
    md += "### " + s.id + " (" + s.level + " / " + s.dimension + ")\n\n";
    md += s.statement + "\n\n";
    md += "- reason: " + s.reason + "\n";
    md += "- evidence: " + s.evidence + "\n\n";
    si += 1;
}

md += "## Killed proposals\n\n";
let ki = 0;
while ki < killed.len() {
    let k = killed[ki];
    md += "### " + k.id + "\n\n";
    md += k.statement + "\n\n";
    md += "- why unsound: " + k.why + "\n";
    if k.counter != "" {
        md += "- counter: " + k.counter + "\n";
    }
    md += "\n";
    ki += 1;
}

let report_path = write_scratch_file("multi-agent-tab-lock-synthesis.md", md);

// Also try to mirror under docs for Claude/Pi (scratch may be session-local)
// synthesizer path returned for complete()

if synth != () && synth.success && synth.output != () {
    complete(#{
        summary: "Adversarial multi-agent+tab-lock design complete",
        path: report_path,
        survivors: survivors.len(),
        killed: killed.len(),
        locked_conclusions: synth.output.locked_conclusions,
        tab_lock_model: synth.output.tab_lock_model,
        phased_delivery: synth.output.phased_delivery,
        open_questions: synth.output.open_questions,
        rejected: synth.output.rejected,
    });
}

complete(#{
    summary: "Partial — synthesis schema failed; see survivor markdown",
    path: report_path,
    survivors: survivors.len(),
    killed: killed.len(),
});
