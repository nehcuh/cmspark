let meta = #{
    name: "ocr-describe-enhance",
    description: "Improve host_computer describe OCR (spatial lines) + discourage shell Vision bypass; Pi review gate",
    when_to_use: "After k47c0u-class sessions where agent shell_execs ad-hoc Vision OCR instead of describe",
    phases: [
        #{ title: "Verify", detail: "unit tests for ocr-describe + executor describe" },
        #{ title: "PiReview", detail: "real pi -p adversarial review" },
        #{ title: "Gate", detail: "APPROVE or await_user on REJECT" },
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
    "required": ["verdict", "blocking", "summary", "artifact_path"],
    "properties": #{
        "verdict": #{ "type": "string" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 12 },
        "summary": #{ "type": "string" },
        "nits": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 15 },
        "artifact_path": #{ "type": "string" },
    },
};

phase("Verify");
let t = agent(
    "In /Users/huchen/Projects/cmspark run: "
    + "cd companion && npx tsx --test tests/computer-ocr-describe.test.ts tests/computer-executor.test.ts 2>&1. "
    + "Return {ok:true} only if all pass. Include tail of log in log field.",
    #{ label: "unit-tests", capability_mode: "execute", output_schema: test_schema },
);
if t == () || !t.success || t.output == () || t.output.ok != true {
    complete(#{ summary: "unit tests failed", test: t });
}

phase("PiReview");
let rev_p = "";
rev_p += "Repo /Users/huchen/Projects/cmspark. You are Pi adversarial reviewer for batch ocr-describe-enhance.\n";
rev_p += "Read and inspect with tools:\n";
rev_p += "1) companion/src/computer/ocr-describe.ts\n";
rev_p += "2) companion/src/computer/executor.ts describe branch (formatOcrWordsAsDescribeText)\n";
rev_p += "3) companion/src/llm/adapter.ts host_computer rule (no shell OCR)\n";
rev_p += "4) companion/src/bridge/tool-definitions-catalog.json host_computer actions description\n";
rev_p += "5) companion/tests/computer-ocr-describe.test.ts\n";
rev_p += "Context: thread k47c0u — agent used shell_exec + /tmp/ocr.swift Vision because describe join(\" \") lost line structure.\n";
rev_p += "Must verify: (1) describe uses spatial lines not join-space only; (2) same host OCR engine (no new cloud path); ";
rev_p += "(3) shell OCR discouraged in prompts; (4) no security regression (untrusted marker); ";
rev_p += "(5) tests cover multi-line + truncate.\n";
rev_p += "REJECT if describe still destroys reading order, or if shell OCR is encouraged, or if credential scan was removed.\n";
rev_p += "Write full review to docs/audit/reviews/ocr-describe-enhance-pi-<ts>.md and end with VERDICT line.\n";
rev_p += "Return verdict APPROVE|APPROVE_WITH_NITS|REJECT, blocking[], summary, nits[], artifact_path.\n";
rev_p += "Prefer running: pi -p --no-session -t read,bash with the review prompt, capture stdout to the artifact path.\n";

let rev = agent(rev_p, #{
    label: "pi-review",
    capability_mode: "all",
    output_schema: review_schema,
});

phase("Gate");
if rev == () || !rev.success || rev.output == () {
    await_user("verification", "Pi review infra failed");
}
let v = rev.output.verdict;
if type_of(v) != "string" || v == "REJECT" {
    await_user("verification", "Pi REJECT or missing verdict: " + rev.output.summary);
}

complete(#{
    summary: "ocr-describe enhance: tests green, Pi non-reject",
    verdict: v,
    artifact: rev.output.artifact_path,
    review_summary: rev.output.summary,
});
