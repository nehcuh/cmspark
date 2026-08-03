// P0: Anthropic Messages protocol + constrained coding-plan header compat
// SoT: docs/decisions/llm-anthropic-protocol-design-2026-08-03.md (DIRECTION LOCKED)
// Gates: important NODES → Pi-only; MILESTONE P0 → Claude+Pi dual-external-review
//
// Robustness: agent output may be string on failure — never assume map without type_of check.

let meta = #{
    name: "llm-anthropic-protocol-p0-with-gates",
    description: "Implement Anthropic LLM protocol P0 with Pi node reviews and dual milestone review",
    when_to_use: "After design brief DIRECTION LOCKED; ship companion provider layer (no UI in P0)",
    phases: [
        #{ title: "Prep", detail: "Inventory + base_commit; confirm design locks" },
        #{ title: "Node1-Impl", detail: "config schema + headers L7 + unit tests" },
        #{ title: "Node1-Pi", detail: "Pi review Node1" },
        #{ title: "Node1-Fix", detail: "Apply Pi must_fix" },
        #{ title: "Node2-Impl", detail: "convert + SSE + OpenAI/Anthropic providers + tests" },
        #{ title: "Node2-Pi", detail: "Pi review Node2" },
        #{ title: "Node2-Fix", detail: "Apply Pi must_fix" },
        #{ title: "Node3-Impl", detail: "Wire adapter + llm-extract + title; regression" },
        #{ title: "Node3-Pi", detail: "Pi review Node3" },
        #{ title: "Node3-Fix", detail: "Apply Pi must_fix" },
        #{ title: "M1-Tests", detail: "Run companion LLM-related tests" },
        #{ title: "M1-Dual", detail: "Claude+Pi dual review P0 milestone" },
        #{ title: "M1-Fix", detail: "Apply dual-review blockers" },
        #{ title: "Ship", detail: "Ship note + status" },
    ],
};

// --- safe accessors ---
fn agent_output_map(r) {
    if r == () { return (); }
    if !r.success { return (); }
    let o = r.output;
    if o == () { return (); }
    if type_of(o) != "map" { return (); }
    o
}

fn agent_ok(r) {
    let m = agent_output_map(r);
    if m == () { return false; }
    m.ok == true || m.done == true
}

fn agent_fail_reason(r, fallback) {
    if r == () { return fallback + " (null)"; }
    if !r.success {
        let o = r.output;
        if type_of(o) == "string" { return fallback + ": " + o; }
        return fallback + " (success=false)";
    }
    let m = agent_output_map(r);
    if m == () { return fallback + " (no map)"; }
    let bits = fallback;
    if m.summary != () && type_of(m.summary) == "string" { bits += ": " + m.summary; }
    if m.blockers != () && type_of(m.blockers) == "array" { bits += " blockers=" + json_encode(m.blockers); }
    if m.must_fix != () && type_of(m.must_fix) == "array" { bits += " must_fix=" + json_encode(m.must_fix); }
    bits
}

fn dual_approve(r) {
    let m = agent_output_map(r);
    if m == () { return false; }
    m.both_approve == true
}

fn pi_approve(r) {
    let m = agent_output_map(r);
    if m == () { return false; }
    m.approve == true
}

let prep_schema = #{
    "type": "object",
    "required": ["ok", "base_commit", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "base_commit": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "touchpoints": #{ "type": "array", "maxItems": 30, "items": #{ "type": "string" } },
        "blockers": #{ "type": "array", "maxItems": 10, "items": #{ "type": "string" } },
    },
};

let impl_schema = #{
    "type": "object",
    "required": ["ok", "changed_files", "summary", "tests_run"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "changed_files": #{ "type": "array", "maxItems": 40, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "tests_run": #{ "type": "string" },
        "blockers": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "notes": #{ "type": "string" },
    },
};

let pi_schema = #{
    "type": "object",
    "required": ["approve", "pi_verdict", "pi_path", "verdict_json", "exit_code"],
    "properties": #{
        "approve": #{ "type": "boolean" },
        "pi_verdict": #{ "type": "string" },
        "pi_path": #{ "type": "string" },
        "verdict_json": #{ "type": "string" },
        "exit_code": #{ "type": "number" },
        "must_fix": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "raw_tail": #{ "type": "string" },
    },
};

let dual_schema = #{
    "type": "object",
    "required": ["both_approve", "claude_verdict", "pi_verdict", "claude_path", "pi_path", "verdict_json", "exit_code"],
    "properties": #{
        "both_approve": #{ "type": "boolean" },
        "claude_verdict": #{ "type": "string" },
        "pi_verdict": #{ "type": "string" },
        "claude_path": #{ "type": "string" },
        "pi_path": #{ "type": "string" },
        "verdict_json": #{ "type": "string" },
        "exit_code": #{ "type": "number" },
        "must_fix": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "raw_tail": #{ "type": "string" },
    },
};

let ship_schema = #{
    "type": "object",
    "required": ["ok", "ship_note_path", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "ship_note_path": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "remaining": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
    },
};

// --- args ---
let wt = if args == () { () } else { args.worktree };
if wt == () {
    wt = "/Users/huchen/Projects/cmspark";
}
let root = wt;
let design = root + "/docs/decisions/llm-anthropic-protocol-design-2026-08-03.md";
let synthesis = root + "/docs/decisions/llm-anthropic-protocol-dual-review-synthesis-2026-08-03.md";

// ========== Prep ==========
phase("Prep");
let prep_p = "";
prep_p += "WORKTREE/REPO root: " + root + " — only edit files under this path.\n";
prep_p += "READ FULLY (mandatory):\n";
prep_p += "1) " + design + " (DIRECTION LOCKED; L1-L12; M1-M7; P0 scope Q2=B no UI)\n";
prep_p += "2) " + synthesis + "\n";
prep_p += "3) companion/src/llm/adapter.ts, llm-extract.ts, config.ts llm shape, settings-web test path, package.json deps\n";
prep_p += "Verify: no @anthropic-ai/sdk today; OpenAI-only chat path; server model probe GET /models exists.\n";
prep_p += "Do NOT implement product code yet.\n";
prep_p += "chmod +x scripts/pi-external-review.sh and scripts/dual-external-review.sh if needed.\n";
prep_p += "Return ok=true, base_commit=git rev-parse HEAD, touchpoints, summary.\n";
let prep = agent(prep_p, #{
    label: "prep",
    capability_mode: "all",
    output_schema: prep_schema,
});
let base_commit = "HEAD";
let prep_m = agent_output_map(prep);
if prep_m != () && prep_m.base_commit != () && type_of(prep_m.base_commit) == "string" {
    base_commit = prep_m.base_commit;
}
if !agent_ok(prep) {
    await_user("verification", agent_fail_reason(prep, "Prep failed — design missing or not locked?"));
}
log("Prep base=" + base_commit);

// ========== Node1: config + headers L7 ==========
phase("Node1-Impl");
let n1_p = "";
n1_p += "REPO=" + root + ". Implement NODE1 only of Anthropic protocol P0 per " + design + ".\n";
n1_p += "Scope NODE1 (do NOT wire adapter yet):\n";
n1_p += "A) config.ts — extend llm with protocol (default openai), client_header_profile (default none),\n";
n1_p += "   claude_code_compat_version, auth_style?, anthropic_version?, extra_headers?; migrate omit=defaults.\n";
n1_p += "B) NEW companion/src/llm/providers/headers.ts — clean UA cmspark-companion/version;\n";
n1_p += "   isAnthropicFirstPartyHost (exact + .anthropic.com / .claude.ai; NEVER bare endsWith anthropic.com);\n";
n1_p += "   assertHeaderPolicy / buildRequestHeaders: L7 UNION deny profile OR extra_headers spoof on first-party;\n";
n1_p += "   claude_code_compat injects UA + x-app only when protocol=anthropic and not first-party.\n";
n1_p += "C) companion/tests/llm-headers-policy.test.ts — first-party deny, allow gateway host, default clean, no CRLF/Host.\n";
n1_p += "D) Do NOT change adapter chat loop yet. Do NOT add UI.\n";
n1_p += "Run: cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/llm-headers-policy.test.js\n";
n1_p += "ok=true only if tests green. Return changed_files, summary, tests_run.\n";
let n1 = agent(n1_p, #{
    label: "node1-impl",
    capability_mode: "all",
    output_schema: impl_schema,
});
if !agent_ok(n1) {
    await_user("verification", agent_fail_reason(n1, "Node1 impl failed"));
}
log("Node1 impl: " + agent_fail_reason(n1, "ok"));

// Node1 Pi
phase("Node1-Pi");
let n1_body = "";
n1_body += "# Pi node review: llm-anthropic-protocol NODE1 (config+headers L7)\n";
n1_body += "Design: docs/decisions/llm-anthropic-protocol-design-2026-08-03.md L6/L7/L9/L12 M1-M3\n";
n1_body += "Claim: " + json_encode(agent_output_map(n1)) + "\n";
n1_body += "Verify REAL code:\n";
n1_body += "1) default protocol=openai profile=none\n";
n1_body += "2) isAnthropicFirstPartyHost covers api.anthropic.com, claude.ai, *.anthropic.com; rejects evilanthropic.com\n";
n1_body += "3) L7 union: extra_headers cannot bypass first-party deny\n";
n1_body += "4) tests exist and pass\n";
n1_body += "REJECT if L7 bypassable or host match naive endsWith.\n";

let n1_pi_p = "";
n1_pi_p += "Run REAL Pi external review (not self-grade).\n";
n1_pi_p += "1) Write prompt to /tmp/cmspark-pi-llm-n1.md with body:\n-----BEGIN-----\n" + n1_body + "\n-----END-----\n";
n1_pi_p += "2) cd " + root + " && bash scripts/pi-external-review.sh llm-anthropic-n1 /tmp/cmspark-pi-llm-n1.md " + base_commit + "\n";
n1_pi_p += "3) Read newest docs/audit/reviews/llm-anthropic-n1-verdict-pi-*.json and pi review md.\n";
n1_pi_p += "4) Return approve, pi_verdict, pi_path, verdict_json, exit_code, must_fix from REJECT/NITS.\n";
let n1_pi = agent(n1_pi_p, #{
    label: "node1-pi",
    capability_mode: "all",
    output_schema: pi_schema,
});
if n1_pi == () || !n1_pi.success {
    await_user("verification", "Node1 Pi review infra failed");
}
let n1_pi_m = agent_output_map(n1_pi);
log("Node1 Pi verdict=" + (if n1_pi_m != () { n1_pi_m.pi_verdict } else { "UNKNOWN" }));

phase("Node1-Fix");
if !pi_approve(n1_pi) || (n1_pi_m != () && n1_pi_m.must_fix != () && type_of(n1_pi_m.must_fix) == "array" && n1_pi_m.must_fix.len() > 0) {
    let fix1 = "";
    fix1 += "REPO=" + root + ". Apply Node1 Pi findings.\n";
    fix1 += "pi_path=" + (if n1_pi_m != () { n1_pi_m.pi_path } else { "" }) + "\n";
    fix1 += "must_fix=" + (if n1_pi_m != () { json_encode(n1_pi_m.must_fix) } else { "[]" }) + "\n";
    fix1 += "If REJECT fix ALL blockers. If NITS fix security/correctness only.\n";
    fix1 += "Re-run llm-headers-policy tests. ok=true only if green.\n";
    let f1 = agent(fix1, #{ label: "node1-fix", capability_mode: "all", output_schema: impl_schema });
    if !agent_ok(f1) {
        await_user("verification", agent_fail_reason(f1, "Node1 fix failed"));
    }
    if !pi_approve(n1_pi) {
        let re1 = "";
        re1 += "Re-run Pi review after Node1 fix: bash scripts/pi-external-review.sh llm-anthropic-n1b /tmp/cmspark-pi-llm-n1b.md " + base_commit + "\n";
        re1 += "Write short recheck prompt emphasizing previous must_fix closed. Return pi_schema.\n";
        let n1b = agent(re1, #{ label: "node1-pi-recheck", capability_mode: "all", output_schema: pi_schema });
        if !pi_approve(n1b) {
            await_user("verification", "Node1 still not Pi-approved after fix");
        }
        n1_pi = n1b;
        n1_pi_m = agent_output_map(n1b);
    }
} else {
    log("Node1 Pi clean — skip fix");
}

// ========== Node2: convert + providers ==========
phase("Node2-Impl");
let n2_p = "";
n2_p += "REPO=" + root + ". Implement NODE2 per " + design + " §4 and §7 new files.\n";
n2_p += "A) companion/src/llm/provider.ts — LlmProvider interface streamChat/complete; CanonicalStreamEvent types; createProvider(llmConfig).\n";
n2_p += "B) providers/openai.ts — wrap existing openai SDK usage for stream+complete (extract from adapter patterns).\n";
n2_p += "C) providers/anthropic-convert.ts — tools→input_schema; messages system hoist; tool_calls↔tool_use; tool results; id sanitize ^[a-zA-Z0-9_-]+$; drop reasoning_content on wire.\n";
n2_p += "D) providers/anthropic.ts — fetch POST /messages + SSE parse → CanonicalStreamEvent; max_tokens=min(8192,max(256,floor(context_window/8))); thinking→reasoning; AbortSignal; use headers.ts.\n";
n2_p += "E) tests: llm-provider-anthropic.test.ts convert fixtures + SSE fixtures + multi-turn tool mock; cross-protocol resume mapping.\n";
n2_p += "Do NOT yet replace adapter loop (Node3). No UI.\n";
n2_p += "Run tsc test + node --test for llm-provider-anthropic + llm-headers-policy.\n";
n2_p += "ok=true only if green.\n";
let n2 = agent(n2_p, #{
    label: "node2-impl",
    capability_mode: "all",
    output_schema: impl_schema,
});
if !agent_ok(n2) {
    await_user("verification", agent_fail_reason(n2, "Node2 impl failed"));
}
log("Node2 impl done");

phase("Node2-Pi");
let n2_body = "";
n2_body += "# Pi node review: NODE2 providers+convert+SSE\n";
n2_body += "Design L1/L2/L4 M4-M7. Claim: " + json_encode(agent_output_map(n2)) + "\n";
n2_body += "Verify: createProvider switches protocol only (no auto-detect); Anthropic max_tokens deterministic;\n";
n2_body += "tool_use id sanitize; SSE maps to canonical; no @anthropic-ai/sdk; first-party+compat refused before fetch.\n";
n2_body += "REJECT if stream loop broken, ids invalid, or L7 not applied in anthropic provider.\n";

let n2_pi_p = "";
n2_pi_p += "Run REAL Pi review via scripts/pi-external-review.sh llm-anthropic-n2 ...\n";
n2_pi_p += "Prompt body:\n-----BEGIN-----\n" + n2_body + "\n-----END-----\n";
n2_pi_p += "base=" + base_commit + " root=" + root + "\n";
n2_pi_p += "Return pi_schema from newest llm-anthropic-n2-verdict-pi-*.json\n";
let n2_pi = agent(n2_pi_p, #{
    label: "node2-pi",
    capability_mode: "all",
    output_schema: pi_schema,
});
if n2_pi == () || !n2_pi.success {
    await_user("verification", "Node2 Pi infra failed");
}
let n2_pi_m = agent_output_map(n2_pi);
log("Node2 Pi=" + (if n2_pi_m != () { n2_pi_m.pi_verdict } else { "?" }));

phase("Node2-Fix");
if !pi_approve(n2_pi) || (n2_pi_m != () && n2_pi_m.must_fix != () && type_of(n2_pi_m.must_fix) == "array" && n2_pi_m.must_fix.len() > 0) {
    let fix2 = "";
    fix2 += "REPO=" + root + " Apply Node2 Pi must_fix. Read " + (if n2_pi_m != () { n2_pi_m.pi_path } else { "" }) + "\n";
    fix2 += "must_fix=" + (if n2_pi_m != () { json_encode(n2_pi_m.must_fix) } else { "[]" }) + "\n";
    fix2 += "Re-run anthropic provider tests. ok=true if green.\n";
    let f2 = agent(fix2, #{ label: "node2-fix", capability_mode: "all", output_schema: impl_schema });
    if !agent_ok(f2) {
        await_user("verification", agent_fail_reason(f2, "Node2 fix failed"));
    }
    if !pi_approve(n2_pi) {
        let n2b = agent(
            "Re-run scripts/pi-external-review.sh llm-anthropic-n2b after fix; return pi_schema. root=" + root + " base=" + base_commit,
            #{ label: "node2-pi-recheck", capability_mode: "all", output_schema: pi_schema }
        );
        if !pi_approve(n2b) {
            await_user("verification", "Node2 still not Pi-approved");
        }
        n2_pi = n2b;
        n2_pi_m = agent_output_map(n2b);
    }
} else {
    log("Node2 Pi clean");
}

// ========== Node3: wire adapter ==========
phase("Node3-Impl");
let n3_p = "";
n3_p += "REPO=" + root + ". NODE3: wire Provider into production paths per design L2/L10.\n";
n3_p += "A) adapter.ts chat loop: createProvider + streamChat; keep tool exec loop, jailbreak scan, WS emit on CanonicalStreamEvent.\n";
n3_p += "B) generateThreadTitle → provider.complete\n";
n3_p += "C) llm-extract.ts → createProvider + complete (single entry)\n";
n3_p += "D) vision-pipeline stays OpenAI direct (do not break)\n";
n3_p += "E) server model probe: if protocol anthropic soft-skip or protocol-aware; do not break openai probe\n";
n3_p += "F) settings-web test: OPTIONAL small protocol branch if low-risk; UI fields NOT required (P1). Prefer not bloating settings HTML unless trivial.\n";
n3_p += "G) Regression: existing DeepSeek path protocol=openai must behave as before.\n";
n3_p += "Run headers + anthropic provider tests + any adapter-related tests that exist.\n";
n3_p += "Prefer: cd companion && npm test with filter if possible; at minimum tsc + node --test for llm-*.test.js\n";
n3_p += "ok=true only if green.\n";
let n3 = agent(n3_p, #{
    label: "node3-impl",
    capability_mode: "all",
    output_schema: impl_schema,
});
if !agent_ok(n3) {
    await_user("verification", agent_fail_reason(n3, "Node3 impl failed"));
}
log("Node3 impl done");

phase("Node3-Pi");
let n3_body = "";
n3_body += "# Pi node review: NODE3 adapter/extract integration\n";
n3_body += "Claim: " + json_encode(agent_output_map(n3)) + "\n";
n3_body += "Verify adapter no longer constructs OpenAI client directly for chat;\n";
n3_body += "openai protocol regression; anthropic path uses provider; tool rounds still work on mock;\n";
n3_body += "vision unchanged; no UI P0 scope creep; secrets not logged.\n";
n3_body += "REJECT if chat still hardcodes OpenAI only, or DeepSeek path broken.\n";

let n3_pi_p = "";
n3_pi_p += "Run scripts/pi-external-review.sh llm-anthropic-n3 with prompt:\n-----BEGIN-----\n" + n3_body + "\n-----END-----\n";
n3_pi_p += "root=" + root + " base=" + base_commit + "\nReturn pi_schema.\n";
let n3_pi = agent(n3_pi_p, #{
    label: "node3-pi",
    capability_mode: "all",
    output_schema: pi_schema,
});
if n3_pi == () || !n3_pi.success {
    await_user("verification", "Node3 Pi infra failed");
}
let n3_pi_m = agent_output_map(n3_pi);
log("Node3 Pi=" + (if n3_pi_m != () { n3_pi_m.pi_verdict } else { "?" }));

phase("Node3-Fix");
if !pi_approve(n3_pi) || (n3_pi_m != () && n3_pi_m.must_fix != () && type_of(n3_pi_m.must_fix) == "array" && n3_pi_m.must_fix.len() > 0) {
    let fix3 = "";
    fix3 += "REPO=" + root + " Apply Node3 Pi findings from " + (if n3_pi_m != () { n3_pi_m.pi_path } else { "" }) + "\n";
    fix3 += "must_fix=" + (if n3_pi_m != () { json_encode(n3_pi_m.must_fix) } else { "[]" }) + "\n";
    fix3 += "Re-run llm tests. ok=true if green.\n";
    let f3 = agent(fix3, #{ label: "node3-fix", capability_mode: "all", output_schema: impl_schema });
    if !agent_ok(f3) {
        await_user("verification", agent_fail_reason(f3, "Node3 fix failed"));
    }
    if !pi_approve(n3_pi) {
        let n3b = agent(
            "Re-run pi-external-review.sh llm-anthropic-n3b; return pi_schema. root=" + root,
            #{ label: "node3-pi-recheck", capability_mode: "all", output_schema: pi_schema }
        );
        if !pi_approve(n3b) {
            await_user("verification", "Node3 still not Pi-approved");
        }
        n3_pi = n3b;
        n3_pi_m = agent_output_map(n3b);
    }
} else {
    log("Node3 Pi clean");
}

// ========== Milestone M1: tests + dual ==========
phase("M1-Tests");
let t_p = "";
t_p += "REPO=" + root + ". MILESTONE P0 test gate.\n";
t_p += "Run companion tests covering LLM changes. Preferred:\n";
t_p += "  cd companion && npx tsc -p tsconfig.test.json && node --test $(find .test-dist/tests -name 'llm*.test.js' -o -name '*adapter*.test.js' 2>/dev/null | head -40)\n";
t_p += "If find empty, run: node --test .test-dist/tests/llm-headers-policy.test.js .test-dist/tests/llm-provider-anthropic.test.js\n";
t_p += "Also smoke: npx tsc -p tsconfig.json (or project build) if feasible.\n";
t_p += "ok=true only if all run tests pass. Report tests_run command output summary.\n";
let m1t = agent(t_p, #{
    label: "m1-tests",
    capability_mode: "all",
    output_schema: impl_schema,
});
if !agent_ok(m1t) {
    await_user("verification", agent_fail_reason(m1t, "M1 tests failed — fix before dual review"));
}
log("M1 tests green");

phase("M1-Dual");
let dual_body = "";
dual_body += "# Dual external review: MILESTONE P0 Anthropic protocol\n";
dual_body += "SoT: docs/decisions/llm-anthropic-protocol-design-2026-08-03.md (L1-L12, M1-M7, P0 no UI)\n";
dual_body += "Synthesis: docs/decisions/llm-anthropic-protocol-dual-review-synthesis-2026-08-03.md\n";
dual_body += "Impl claims Node1-3: inspect REAL git diff vs " + base_commit + "\n";
dual_body += "Must verify:\n";
dual_body += "1) createProvider + adapter/extract wired; default openai unchanged\n";
dual_body += "2) L7 first-party host union deny (profile+extra_headers); host match not evilanthropic.com\n";
dual_body += "3) Anthropic convert/SSE/tool id/max_tokens deterministic; fixture tests present\n";
dual_body += "4) No OAuth/Max; no system-prompt CC identity injection\n";
dual_body += "5) No UI scope creep (settings fields optional only)\n";
dual_body += "6) Header values not logged\n";
dual_body += "7) vision still OpenAI-only\n";
dual_body += "REJECT if DeepSeek path broken, L7 bypassable, or P0 missing contract tests.\n";
dual_body += "End VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT\n";

let dual_p = "";
dual_p += "Run REAL dual-external-review (Claude+Pi). Do not invent verdicts.\n";
dual_p += "1) Write /tmp/cmspark-dual-llm-m1.md with:\n-----BEGIN-----\n" + dual_body + "\n-----END-----\n";
dual_p += "2) cd " + root + " && bash scripts/dual-external-review.sh llm-anthropic-p0-m1 /tmp/cmspark-dual-llm-m1.md " + base_commit + "\n";
dual_p += "3) Read newest docs/audit/reviews/llm-anthropic-p0-m1-verdict-*.json and both review files.\n";
dual_p += "4) Return both_approve, verdicts, paths, exit_code, must_fix.\n";
let m1d = agent(dual_p, #{
    label: "m1-dual",
    capability_mode: "all",
    output_schema: dual_schema,
});
if m1d == () || !m1d.success {
    await_user("verification", "M1 dual-review infra failed (claude/pi CLIs?)");
}
let m1d_m = agent_output_map(m1d);
log("M1 dual both=" + (if m1d_m != () { m1d_m.both_approve.to_string() } else { "false" }));

phase("M1-Fix");
if !dual_approve(m1d) || (m1d_m != () && m1d_m.must_fix != () && type_of(m1d_m.must_fix) == "array" && m1d_m.must_fix.len() > 0) {
    let mfix = "";
    mfix += "REPO=" + root + ". Apply M1 dual-review findings.\n";
    mfix += "claude=" + (if m1d_m != () { m1d_m.claude_path } else { "" }) + "\n";
    mfix += "pi=" + (if m1d_m != () { m1d_m.pi_path } else { "" }) + "\n";
    mfix += "must_fix=" + (if m1d_m != () { json_encode(m1d_m.must_fix) } else { "[]" }) + "\n";
    mfix += "If REJECT fix all blockers. If NITS fix security/correctness. Re-run llm tests. ok=true if green.\n";
    let mf = agent(mfix, #{ label: "m1-fix", capability_mode: "all", output_schema: impl_schema });
    if !agent_ok(mf) {
        await_user("verification", agent_fail_reason(mf, "M1 fix failed"));
    }
    if !dual_approve(m1d) {
        let recheck = "";
        recheck += "Re-run dual-external-review.sh llm-anthropic-p0-m1b after fix. root=" + root + " base=" + base_commit + "\n";
        recheck += "Return dual_schema. both_approve required.\n";
        let m1b = agent(recheck, #{ label: "m1-dual-recheck", capability_mode: "all", output_schema: dual_schema });
        if !dual_approve(m1b) {
            await_user("verification", "M1 dual still not approved after fix — inspect docs/audit/reviews/llm-anthropic-p0-m1*");
        }
        m1d = m1b;
        m1d_m = agent_output_map(m1b);
    }
} else {
    log("M1 dual clean");
}

// ========== Ship ==========
phase("Ship");
let ship_p = "";
ship_p += "REPO=" + root + ". Write ship note for P0 Anthropic protocol.\n";
ship_p += "Create docs/audit/reviews/llm-anthropic-protocol-p0-ship-note-2026-08-03.md with:\n";
ship_p += "- Status P0 landed (or partial)\n";
ship_p += "- Files changed summary\n";
ship_p += "- Node Pi verdicts + M1 dual verdicts (paths)\n";
ship_p += "- What is NOT done (P1 UI)\n";
ship_p += "- How to enable protocol=anthropic in config.json manually\n";
ship_p += "Update design brief status line if needed to note P0 implementation landed (keep DIRECTION LOCKED).\n";
ship_p += "Do NOT force-push. Commit only if user would want — prefer leave commits to human unless already committing in prior nodes.\n";
ship_p += "ok=true, ship_note_path, summary, remaining P1 items.\n";
let ship = agent(ship_p, #{
    label: "ship-note",
    capability_mode: "all",
    output_schema: ship_schema,
});
if !agent_ok(ship) {
    await_user("verification", agent_fail_reason(ship, "Ship note failed"));
}

let n1o = agent_output_map(n1);
let n2o = agent_output_map(n2);
let n3o = agent_output_map(n3);
let m1to = agent_output_map(m1t);
let m1do = agent_output_map(m1d);
let shipo = agent_output_map(ship);

complete(#{
    summary: "P0 Anthropic protocol workflow finished (nodes Pi-gated, milestone dual-reviewed)",
    base_commit: base_commit,
    node1: n1o,
    node1_pi: agent_output_map(n1_pi),
    node2: n2o,
    node2_pi: agent_output_map(n2_pi),
    node3: n3o,
    node3_pi: agent_output_map(n3_pi),
    m1_tests: m1to,
    m1_dual: m1do,
    ship: shipo,
});
