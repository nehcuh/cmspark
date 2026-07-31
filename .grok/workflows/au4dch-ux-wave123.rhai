let meta = #{
    name: "au4dch-ux-wave123",
    description: "Multi-angle research + adversarial verify for download dedupe, run-status, shell hide/progress",
    when_to_use: "After #au4dch product plans; research three UX points and adversarially check implementation readiness",
    phases: [
        #{ title: "Research", detail: "parallel deep dive per optimization point" },
        #{ title: "ProductAngles", detail: "security, UX, protocol, priority skeptics" },
        #{ title: "Synthesize", detail: "locked priority + ship scope" },
    ],
};

let research_schema = #{
    "type": "object",
    "required": ["point_id", "root_causes", "ship_scope", "risks", "files", "tests", "priority_rank"],
    "properties": #{
        "point_id": #{ "type": "string" },
        "root_causes": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 8 },
        "ship_scope": #{ "type": "string" },
        "out_of_scope": #{ "type": "string" },
        "risks": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 8 },
        "files": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "tests": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 12 },
        "priority_rank": #{ "type": "number" },
        "notes": #{ "type": "string" },
    },
};

let angle_schema = #{
    "type": "object",
    "required": ["angle", "blocking", "nits", "approve_ship_scope"],
    "properties": #{
        "angle": #{ "type": "string" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 10 },
        "nits": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 10 },
        "approve_ship_scope": #{ "type": "boolean" },
        "evidence": #{ "type": "string" },
    },
};

let synth_schema = #{
    "type": "object",
    "required": ["priority_order", "wave1_scope", "pty_deferred", "ready_to_implement", "summary"],
    "properties": #{
        "priority_order": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 6 },
        "wave1_scope": #{ "type": "string" },
        "pty_deferred": #{ "type": "boolean" },
        "ready_to_implement": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "must_fix_before_code": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 8 },
    },
};

phase("Research");
log("Research three #au4dch points against live code");

let rjobs = [];
rjobs.push(#{
    label: "research-DL",
    capability_mode: "read-only",
    output_schema: research_schema,
    prompt: "Repo CMspark. Research DOWNLOAD DEDUPE (point_id=DL). Use read_file/grep on chrome-extension/src/background/browser-download-handler.ts, download-waiter.ts, companion path-sandbox, tool-schemas browser_download. Root causes for re-download; ship_scope for downloads.find + prefer_existing; out_of_scope; risks; files; tests; priority_rank 1-3 (1=highest). Cite real paths.",
});
rjobs.push(#{
    label: "research-ST",
    capability_mode: "read-only",
    output_schema: research_schema,
    prompt: "Repo CMspark. Research RUN STATUS UX (point_id=ST). Read chrome-extension/src/sidepanel/components/ChatView.tsx processingLabel, useWebSocket tool.start/result, FleetStrip. Root causes for 'stuck' feeling during long shell_exec; ship_scope for label fix + tool.progress; files; tests; priority_rank.",
});
rjobs.push(#{
    label: "research-SH",
    capability_mode: "read-only",
    output_schema: research_schema,
    prompt: "Repo CMspark. Research SHELL black window + progress (point_id=SH). Read companion/src/capability/shell.ts spawn options; docs mission-pack shell PTY specs. Ship_scope MUST be one-shot windowsHide+progress NOT full PTY. priority_rank; files; tests; risks if windowsHide breaks interactive tools.",
});
let researches = parallel(rjobs);

phase("ProductAngles");
let ajobs = [];
ajobs.push(#{
    label: "angle-security",
    capability_mode: "read-only",
    output_schema: angle_schema,
    prompt: "Adversarial SECURITY review of shipping: downloads.find read-only, prefer_existing cache, shell windowsHide, tool.progress tails. Use grep/read. approve_ship_scope=true only if no L2 bypass / path escape / secret log risk. List blocking vs nits. angle=security.",
});
ajobs.push(#{
    label: "angle-ux",
    capability_mode: "read-only",
    output_schema: angle_schema,
    prompt: "Adversarial UX review: will processingLabel+progress+windowsHide+prefer_existing fix #au4dch user pain without new primary nav? Read ChatView and product plan if present docs/superpowers/specs/2026-08-01-au4dch-product-plans.md. angle=ux.",
});
ajobs.push(#{
    label: "angle-protocol",
    capability_mode: "read-only",
    output_schema: angle_schema,
    prompt: "Adversarial PROTOCOL review of WS tool.progress: old clients ignore unknown types; size caps on tails; thread_id gating. Read useWebSocket.ts patterns for tool.start. angle=protocol.",
});
ajobs.push(#{
    label: "angle-priority",
    capability_mode: "read-only",
    output_schema: angle_schema,
    prompt: "Adversarial PRIORITY review: must ST+SH-A ship before DL? Defer full PTY? Read docs/optimization-plan-au4dch-ux-shell-download.md. angle=priority. approve_ship_scope if order is sound.",
});
let angles = parallel(ajobs);

phase("Synthesize");
let syn_prompt = "Synthesize locked implementation plan for #au4dch Wave1-2. Research JSON dumps follow. Require: priority_order array, wave1_scope string, pty_deferred true, ready_to_implement bool, summary. Fail ready if security angle blocked.\n\nRESEARCH:\n";
for r in researches {
    if r != () && r.success {
        syn_prompt += json_encode(r.output);
        syn_prompt += "\n";
    }
}
syn_prompt += "\nANGLES:\n";
for a in angles {
    if a != () && a.success {
        syn_prompt += json_encode(a.output);
        syn_prompt += "\n";
    }
}
let syn = agent(syn_prompt, #{
    label: "synthesize",
    capability_mode: "read-only",
    output_schema: synth_schema,
});

let summary = "synth failed";
let ready = false;
if syn != () && syn.success && syn.output != () {
    summary = syn.output.summary;
    ready = syn.output.ready_to_implement == true;
    let path = write_scratch_file("au4dch-research-synth.json", json_encode(syn.output));
    complete(#{
        summary: summary,
        ready_to_implement: ready,
        path: path,
        research_ok: researches.len(),
        angles_ok: angles.len(),
    });
}
complete(#{ summary: summary, ready_to_implement: false });
