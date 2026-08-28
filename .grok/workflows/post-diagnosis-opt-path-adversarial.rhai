let meta = #{
    name: "post-diagnosis-opt-path-adversarial",
    description: "Four-lane attack on the 0.5.3 post-diagnosis optimization path strawman then synthesize pins",
    phases: [
        #{ title: "Attack", detail: "Security, Product, Impl, Skeptic in parallel" },
        #{ title: "Synthesize", detail: "Fold BLOCK pins into amended path + Chinese report" },
    ],
    when_to_use: "After deep diagnosis, lock the next optimization path before any code",
};

let lane_schema = #{
    "type": "object",
    "required": ["lane", "verdict", "blocking", "changes", "keep", "never"],
    "properties": #{
        "lane": #{ "type": "string" },
        "verdict": #{ "type": "string", "enum": ["PASS", "PASS_WITH_CHANGES", "REJECT"] },
        "blocking": #{
            "type": "array",
            "maxItems": 10,
            "items": #{ "type": "string" },
        },
        "changes": #{
            "type": "array",
            "maxItems": 12,
            "items": #{ "type": "string" },
        },
        "keep": #{
            "type": "array",
            "maxItems": 8,
            "items": #{ "type": "string" },
        },
        "never": #{
            "type": "array",
            "maxItems": 8,
            "items": #{ "type": "string" },
        },
        "file_evidence": #{ "type": "string" },
    },
};

let synth_schema = #{
    "type": "object",
    "required": ["overall_verdict", "must_fold", "amended_batches", "report_markdown"],
    "properties": #{
        "overall_verdict": #{ "type": "string" },
        "must_fold": #{
            "type": "array",
            "maxItems": 16,
            "items": #{ "type": "string" },
        },
        "amended_batches": #{ "type": "string" },
        "report_markdown": #{ "type": "string" },
    },
};

let strawman = "";
strawman += "STRAWMAN path is in docs/superpowers/specs/2026-08-28-post-diagnosis-opt-path.md (GitHub #245). ";
strawman += "Diagnosis: docs/audit/deep-diagnosis-fanout-2026-08-28.md. Dual: docs/audit/reviews/deep-diagnosis-20260828-dual-synthesis.md. ";
strawman += "Frozen: #228 no profile expand; #229 no WorkBuddy; #230 no F-S-10, no overlay-acl-ROLLBACK, no overlay Allow/Deny. ";
strawman += "Batches A Capture P0 (XSS then hide-lease then true L0), B knowledge truncate + darwin estop, C/D/E listed not in this issue. ";
strawman += "A3 deletes overlay MCP mutate HTTP (not bringing toggle back). Hide aborts overlay LLM. Estop keeps long-lived EOF contract, moves socket. ";

let rules = "";
rules += "You are an independent lane attacking a STRAWMAN optimization PATH for CMspark 0.5.3. ";
rules += "READ-ONLY: read_file, grep, list_dir. Open the strawman spec AND the cited source files. ";
rules += "Do not rubber-stamp. Ground BLOCK in current code (file:line) or in #230/#245/#228 text. ";
rules += "Verdict REJECT if the path would ship a product lie, expand a freeze, or sequence a security hole after its amplifier. ";
rules += "PASS_WITH_CHANGES if the batch split is right but pins must fold. PASS only if you would implement as written. ";
rules += "Max 10 blocking items. Output schema exactly.";

phase("Attack");
log("Launching 4-lane path adversaries");

let lanes = [
    #{
        id: "security",
        focus: "XSS vs token-in-argv order; CSP nonce vs DOM href; overlay L0 tool crop vs L2 gates still needed; estop TCC 2026-08-01 contract; MCP toggle delete vs F-S-10; spawn/shell not sneaking into A",
    },
    #{
        id: "product",
        focus: "User-visible Capture vs Operate; what overlay chat MAY still do (voice/meeting/file/history); hide abort vs handoff to sidepanel; knowledge truncated Save copy; NEVER overlay Allow/Deny; do not pretend Capture closed after A1 only",
    },
    #{
        id: "impl",
        focus: "File map completeness (validate.ts, summoner-acl, overlay-session, ChatCreateParams plumbing); test commands; stacked PR vs one PR; god-file touch budget; whether adapter.surface is enough or router must filter tools before chatCreate",
    },
    #{
        id: "skeptic",
        focus: "Default refute: path too big; A3 is secretly #230 rollback; B2 breaks tray-owned estop; A2 abort kills Operate chats; knowledge fail-closed blocks legitimate short edits. Cite code that kills the strawman pin.",
    },
];

let jobs = [];
for ln in lanes {
    let p = "";
    p += rules + "\n\n";
    p += strawman + "\n\n";
    p += "LANE: " + ln.id + "\n";
    p += "Focus: " + ln.focus + "\n";
    p += "Read at least: the strawman spec, overlay-md.ts, summoner-web.ts hideSummonerWebShell, summoner-acl.ts, darwin-estop.ts header, message-router chat.create + pack.apply overlay branch, #245 is the issue this path belongs to.\n";
    p += "Set lane to `" + ln.id + "`.";
    jobs.push(#{
        prompt: p,
        label: "lane:" + ln.id,
        capability_mode: "read-only",
        agent_type: "explore",
        output_schema: lane_schema,
    });
}

let results = parallel(jobs);

let digest = "";
let li = 0;
for r in results {
    let id = lanes[li].id;
    if r != () && r.success && r.output != () {
        let o = r.output;
        let v = if o.verdict != () { o.verdict } else { "?" };
        digest += "\n## lane " + id + " verdict=" + v + "\n";
        if o.blocking != () {
            for b in o.blocking { digest += "- BLOCK: " + b + "\n"; }
        }
        if o.changes != () {
            for c in o.changes { digest += "- CHANGE: " + c + "\n"; }
        }
        if o.keep != () {
            for k in o.keep { digest += "- KEEP: " + k + "\n"; }
        }
        if o.never != () {
            for n in o.never { digest += "- NEVER: " + n + "\n"; }
        }
        if o.file_evidence != () {
            digest += "evidence: " + o.file_evidence + "\n";
        }
        log("OK lane " + id + " " + v);
    } else {
        digest += "\n## lane " + id + " FAILED\n";
        log("FAIL lane " + id);
    }
    li += 1;
}

phase("Synthesize");
log("Folding lane pins into amended path");

let sp = "";
sp += "You synthesize the CMspark 0.5.3 post-diagnosis optimization PATH after 4-lane attack.\n";
sp += "READ-ONLY. Spot-check dubious BLOCK claims.\n";
sp += "Issue #245. Strawman: docs/superpowers/specs/2026-08-28-post-diagnosis-opt-path.md\n";
sp += "Rule: any REJECT or blocking pin MUST be folded or the overall_verdict is REJECT (path not ready to implement).\n";
sp += "If all lanes PASS or PASS_WITH_CHANGES and pins are foldable, overall_verdict=PASS_WITH_CHANGES.\n";
sp += "Write report_markdown in Chinese titled `# 0.5.3 体检优化路径 — 四路合成 2026-08-28` with: lane table, folded pins, amended A/B/C/D/E, DoD, NEVER, whether implement is allowed yet (NO until kimi+claude dual).\n";
sp += "amended_batches: short string describing A1/A2/A3 then B then later.\n";
sp += "must_fold: concrete pins.\n\nLANE DIGEST:\n";
sp += digest;

let syn = agent(sp, #{
    label: "synthesize-path",
    capability_mode: "read-only",
    agent_type: "general-purpose",
    output_schema: synth_schema,
});

if syn == () || !syn.success || syn.output == () {
    let fail_path = write_scratch_file("path-adversary-failed.md", digest);
    complete(#{ ok: false, raw_path: fail_path });
}

let out = syn.output;
let md = if out.report_markdown != () { out.report_markdown } else { digest };
let report_path = write_scratch_file("opt-path-adversary-synthesis.md", md);
let ov = if out.overall_verdict != () { out.overall_verdict } else { "?" };

complete(#{
    ok: true,
    overall_verdict: ov,
    must_fold: out.must_fold,
    amended_batches: out.amended_batches,
    report_path: report_path,
    note: "Copy into docs/audit/reviews then fold into spec; dual-review before implement",
});
