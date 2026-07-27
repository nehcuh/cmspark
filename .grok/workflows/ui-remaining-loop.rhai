let meta = #{
    name: "ui-remaining-loop",
    description: "Loop remaining UI batches: implement → adversarial → Claude+Pi dual review → next batch",
    when_to_use: "After P0-P2 UI modes, clear residual R1-R4 work with dual external gates",
    phases: [
        #{ title: "Batch", detail: "one residual batch at a time" },
        #{ title: "Adversarial", detail: "internal skeptics" },
        #{ title: "ExternalReview", detail: "Claude + Pi separate processes" },
        #{ title: "Gate", detail: "approve or fix loop" },
    ],
};

let impl_schema = #{
    "type": "object",
    "required": ["batch", "summary", "files_changed", "done"],
    "properties": #{
        "batch": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "done": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "notes": #{ "type": "string" },
    },
};

let adv_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
    },
};

let external_schema = #{
    "type": "object",
    "required": ["both_approve", "claude_verdict", "pi_verdict", "exit_code", "claude_path", "pi_path", "verdict_json"],
    "properties": #{
        "both_approve": #{ "type": "boolean" },
        "claude_verdict": #{ "type": "string" },
        "pi_verdict": #{ "type": "string" },
        "exit_code": #{ "type": "integer" },
        "claude_path": #{ "type": "string" },
        "pi_path": #{ "type": "string" },
        "verdict_json": #{ "type": "string" },
        "raw_tail": #{ "type": "string" },
    },
};

// Default: run all residual batches already implemented in working tree for review
let batches = ["R1-R4"];
if args != () && args.batches != () {
    batches = args.batches;
}
let max_rounds = 2;
if args != () && args.max_rounds != () {
    max_rounds = args.max_rounds;
}

let brief = "docs/decisions/v1.3/ui-remaining-work-batches-2026-07-27.md";
let all_results = [];

let bi = 0;
while bi < batches.len() {
    let batch = batches[bi];
    log("=== Batch " + batch + " ===");
    let feedback = "";
    let round = 0;
    let approved = false;

    while round < max_rounds && !approved {
        round += 1;
        phase("Batch");
        let impl_p = "";
        impl_p += "Repo /Users/huchen/Projects/cmspark. Batch=" + batch + " round=" + round.to_string() + ".\n";
        impl_p += "Read " + brief + " for scope.\n";
        if feedback != "" {
            impl_p += "PREVIOUS FEEDBACK TO FIX:\n" + feedback + "\n";
        }
        impl_p += "If code for this batch is ALREADY in the working tree, verify with: npm --prefix chrome-extension test; npx tsc --noEmit -p chrome-extension.\n";
        impl_p += "Only implement missing items; do not re-do P0-P2 already shipped.\n";
        impl_p += "R1: cockpit-window session persist + isCockpitTabUrl + tests.\n";
        impl_p += "R2: ModeBadge pin + MinimalConfirm queue 1/N + Esc deny.\n";
        impl_p += "R3: secondary panel tokens + remove dead ComputerTaskBar.\n";
        impl_p += "R4: empty suggestion chips + L2 header tint FOUC + packs discoverability copy.\n";
        impl_p += "Return files_changed, summary, done=true if complete, tests_ok.\n";

        let impl = agent(impl_p, #{
            label: "impl:" + batch + ":r" + round.to_string(),
            capability_mode: "all",
            output_schema: impl_schema,
        });

        if impl == () || !impl.success || impl.output == () {
            feedback = "Implement agent failed";
            log(feedback);
            continue;
        }
        log("Impl: " + impl.output.summary);

        phase("Adversarial");
        let a1 = "";
        a1 += "ADVERSARIAL for UI remaining batch " + batch + ".\n";
        a1 += "Default pass=false. Read git diff and key files: cockpit-window.ts, ModeBadge.tsx, MinimalConfirm.tsx, App.tsx, ChatView empty chips.\n";
        a1 += "Blockers: broken imports, missing tests for isCockpitTabUrl, pin not dispatching SET_MODE_PIN, confirm Esc regression, material hex reintroduced on primary path.\n";
        a1 += "Implement claim: " + json_encode(impl.output) + "\n";
        let adv = agent(a1, #{
            label: "adv:" + batch + ":r" + round.to_string(),
            capability_mode: "read-only",
            output_schema: adv_schema,
        });
        let adv_pass = false;
        let adv_sum = "";
        if adv != () && adv.success && adv.output != () {
            adv_pass = adv.output.pass == true;
            adv_sum = adv.output.summary;
            if adv.output.blocking != () {
                adv_sum += " blocks=" + json_encode(adv.output.blocking);
            }
        }
        log("Adv pass=" + adv_pass.to_string() + " " + adv_sum);
        if !adv_pass {
            feedback = "ADVERSARIAL: " + adv_sum;
            continue;
        }

        phase("ExternalReview");
        let review_body = "";
        review_body += "# Dual external review — UI remaining " + batch + "\n";
        review_body += "Internal adversarial: PASSED\n";
        review_body += "Brief: " + brief + "\n";
        review_body += "Implementer: " + json_encode(impl.output) + "\n";
        review_body += "Adv: " + adv_sum + "\n";
        review_body += "Inspect chrome-extension sidepanel + cockpit-window. VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";

        let prompt_file = "/tmp/cmspark-review-ui-remaining-" + batch + "-r" + round.to_string() + ".md";
        let ext_p = "";
        ext_p += "Write the following EXACTLY to " + prompt_file + " then run dual-external-review.\n";
        ext_p += "-----BEGIN PROMPT-----\n" + review_body + "\n-----END PROMPT-----\n";
        ext_p += "cd /Users/huchen/Projects/cmspark && bash scripts/dual-external-review.sh ui-remaining-" + batch + " " + prompt_file + " HEAD\n";
        ext_p += "Read newest docs/audit/reviews/ui-remaining-" + batch + "-verdict-*.json and return structured fields. MUST execute script.\n";

        let ext = agent(ext_p, #{
            label: "ext:" + batch + ":r" + round.to_string(),
            capability_mode: "all",
            output_schema: external_schema,
        });

        if ext == () || !ext.success || ext.output == () {
            feedback = "External dual review failed to run";
            log(feedback);
            await_user("verification", "External Claude/Pi failed for " + batch + " — inspect docs/audit/reviews/ then resume");
            continue;
        }
        log("External claude=" + ext.output.claude_verdict + " pi=" + ext.output.pi_verdict);
        if ext.output.both_approve == true {
            approved = true;
            all_results.push(#{
                batch: batch,
                claude: ext.output.claude_verdict,
                pi: ext.output.pi_verdict,
                impl: impl.output.summary,
            });
        } else {
            feedback = "EXTERNAL REJECT/NIT-BLOCK: claude=" + ext.output.claude_verdict + " pi=" + ext.output.pi_verdict;
            if ext.output.raw_tail != () { feedback += "\n" + ext.output.raw_tail; }
        }
    }

    if !approved {
        await_user("verification", "Batch " + batch + " did not get dual APPROVE after " + max_rounds.to_string() + " rounds. Resume to retry or stop.");
    }
    bi += 1;
}

let report = "# UI Remaining Loop Results\n\n" + json_encode(all_results) + "\n";
let path = write_scratch_file("ui-remaining-loop-report.md", report);
complete(#{ summary: "batches done=" + all_results.len().to_string(), path: path, results: all_results });
