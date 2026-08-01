let meta = #{
    name: "tray-estop-cu-fix",
    description: "Tray/Aqua-owned estop: implement → verify tests → Pi+Kimi gate → package notes",
    when_to_use: "macOS host_computer estop code 4 / TCC ownership fix with dual external review",
    phases: [
        #{ title: "Verify", detail: "targeted tests for host-bin + estop ownership" },
        #{ title: "ExternalReview", detail: "Pi + Kimi review of tray-owned estop design/diff" },
        #{ title: "Gate", detail: "both APPROVE or pause" },
    ],
};

let test_schema = #{
    "type": "object",
    "required": ["ok", "log"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "log": #{ "type": "string" },
    },
};

let review_schema = #{
    "type": "object",
    "required": ["verdict", "blocking", "summary"],
    "properties": #{
        "verdict": #{ "type": "string" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 12 },
        "summary": #{ "type": "string" },
        "nits": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 15 },
    },
};

phase("Verify");
let t = agent(
    "In repo /Users/huchen/Projects/cmspark run and report results as JSON {ok, log}: "
    + "cd companion && npx tsx --test tests/host-bin-resolve.test.ts tests/computer-darwin-estop-owner.test.ts tests/computer-estop.test.ts 2>&1. "
    + "ok=true only if all tests pass (or skip-only on non-darwin for darwin-specific). Include command log tail in log.",
    #{ label: "unit-tests", capability_mode: "execute", output_schema: test_schema },
);
if t == () || !t.success || t.output == () || t.output.ok != true {
    complete(#{ summary: "unit tests failed", test: t });
}

phase("ExternalReview");
let review_prompt_base = "";
review_prompt_base += "Review the tray-owned estop fix in /Users/huchen/Projects/cmspark. ";
review_prompt_base += "Read: companion/src/host-use/darwin/host.swift launchAgentTrayAndExit, ";
review_prompt_base += "companion/src/computer/darwin-estop.ts, companion/src/menu-bar-agent.ts (estop hook), ";
review_prompt_base += "docs/audit/reviews/computer-use-platform-analysis-20260801.md §2–4, ";
review_prompt_base += "docs/superpowers/plans/2026-08-01-macos-tcc-estop-BLOCKED-HANDOFF.md. ";
review_prompt_base += "Check: (1) Aqua MacOS/CMspark starts estop before Node tray; ";
review_prompt_base += "(2) Companion prefers connect, daemon spawn is fallback only; ";
review_prompt_base += "(3) no user docs tell to enable node; (4) security of tray ownership. ";
review_prompt_base += "Return JSON {verdict: APPROVE|APPROVE_WITH_NITS|REJECT, blocking[], summary, nits[]}. ";
review_prompt_base += "REJECT if daemon is still the preferred estop owner or TCC identity regresses.";

let jobs = [
    #{
        prompt: review_prompt_base + " You are Pi-style adversarial reviewer.",
        label: "review-pi-style",
        capability_mode: "read-only",
        output_schema: review_schema,
    },
    #{
        prompt: review_prompt_base + " You are Kimi-style product/platform reviewer.",
        label: "review-kimi-style",
        capability_mode: "read-only",
        output_schema: review_schema,
    },
];
let results = parallel(jobs);

let rejects = 0;
let summaries = [];
for r in results {
    if r == () || !r.success || r.output == () {
        rejects += 1;
        summaries.push("review failed/empty");
    } else {
        let v = r.output.verdict;
        if type_of(v) == "string" {
            if v == "REJECT" { rejects += 1; }
            summaries.push(v + ": " + r.output.summary);
        } else {
            rejects += 1;
            summaries.push("bad verdict");
        }
    }
}

if rejects > 0 {
    await_user("verification", "External review had REJECT or failure — fix and resume: " + summaries.len().to_string() + " notes");
}

complete(#{
    summary: "tray-estop workflow: tests ok, reviews non-reject",
    test_ok: true,
    review_summaries: summaries,
    rejects: rejects,
});
