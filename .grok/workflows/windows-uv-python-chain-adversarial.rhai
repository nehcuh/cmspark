// Windows Qwen-VL uv/Python chain enhancement — adversarial design gate
// Flow: 4 parallel adversaries → synthesizer writes synthesis + draft locks
// Gate: human/Pi review of docs before any implementation workflow

let meta = #{
    name: "windows-uv-python-chain-adversarial",
    description: "Adversarial multi-agent design for Windows uv/Python detection in Qwen-VL experimental layer",
    when_to_use: "When designing Windows PATH/uv/python runtime hardening for Qwen-VL preflight before implementation",
    phases: [
        #{ title: "Adversary Fan-out", detail: "Platform Security Product Compat four independent agents" },
        #{ title: "Synthesize", detail: "Consensus synthesis plus locked decisions and PR plan" },
    ],
};

let adversary_schema = #{
    "type": "object",
    "required": ["lane", "confirmed_problems", "rejected_approaches", "must_locks", "must_not", "test_invariants", "open_questions", "recommended_scheme"],
    "properties": #{
        "lane": #{ "type": "string" },
        "confirmed_problems": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["id", "claim", "evidence", "severity"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "claim": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                },
            },
        },
        "rejected_approaches": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["approach", "why_reject"],
                "properties": #{
                    "approach": #{ "type": "string" },
                    "why_reject": #{ "type": "string" },
                },
            },
        },
        "must_locks": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "must_not": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "test_invariants": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "open_questions": #{ "type": "array", "maxItems": 6, "items": #{ "type": "string" } },
        "recommended_scheme": #{ "type": "string" },
        "scheme_notes": #{ "type": "string" },
    },
};

let synthesis_schema = #{
    "type": "object",
    "required": ["consensus", "rejected", "locked_decisions", "phased_plan", "rejection_gates", "file_touch_list", "pi_ready"],
    "properties": #{
        "consensus": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "rejected": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "locked_decisions": #{
            "type": "array",
            "maxItems": 16,
            "items": #{
                "type": "object",
                "required": ["id", "lock", "rationale"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "lock": #{ "type": "string" },
                    "rationale": #{ "type": "string" },
                },
            },
        },
        "phased_plan": #{
            "type": "array",
            "maxItems": 6,
            "items": #{
                "type": "object",
                "required": ["phase", "scope", "acceptance"],
                "properties": #{
                    "phase": #{ "type": "string" },
                    "scope": #{ "type": "string" },
                    "acceptance": #{ "type": "string" },
                },
            },
        },
        "rejection_gates": #{ "type": "array", "maxItems": 10, "items": #{ "type": "string" } },
        "file_touch_list": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "open_questions_for_user": #{ "type": "array", "maxItems": 6, "items": #{ "type": "string" } },
        "pi_ready": #{ "type": "boolean" },
        "markdown_body": #{ "type": "string" },
    },
};

// --- shared context for all agents (keep self-contained; no parent fork) ---
let ctx = "";
ctx += "Repo root: C:/Users/HuChen/Projects/cmspark (Windows host). ";
ctx += "Scope: Qwen3-VL experimental layer Windows runtime detection — uv/Python PATH chain ONLY. ";
ctx += "Out of scope: model weights download redesign, torch CUDA install, computer-use locate accuracy, MCP server config UI. ";
ctx += "\n\n## Confirmed user/environment facts (2026-08-02 local machine)\n";
ctx += "- uv IS installed: WinGet package path under LOCALAPPDATA/Microsoft/WinGet/Packages/astral-sh.uv_.../uv.exe\n";
ctx += "- Also exists: %USERPROFILE%/.local/bin/uv.exe (NOT on User PATH)\n";
ctx += "- User PATH has WinGet Packages uv dir; Machine PATH does NOT include uv\n";
ctx += "- Companion runs as dist-package cmspark-agent.exe daemon + tray from Explorer\n";
ctx += "- Interactive shell finds uv; Machine-only PATH simulation fails findUv completely\n";
ctx += "- UI copy says brew install uv even on Windows\n";
ctx += "\n## Code anchors (READ these files with tools; do not invent)\n";
ctx += "- companion/src/computer/python-runtime.ts — findUv(), resolvePythonRuntime, ensureIsolatedPythonEnv, buildInstallCommands\n";
ctx += "- companion/src/computer/qwen-vl-preflight.ts — uvAvailable display, brew install strings\n";
ctx += "- companion/src/computer/model-handlers.ts — uvAvailable passthrough\n";
ctx += "- companion/src/mcp/transport.ts — buildSpawnPath() PATH hardening (MCP only today)\n";
ctx += "- chrome-extension/src/sidepanel/components/SettingsSlideout.tsx — brew install uv UI\n";
ctx += "- companion/tests/computer-python-runtime.test.ts — only sanitizePythonPackages today\n";
ctx += "- companion/tests/mcp.test.ts — buildSpawnPath Windows coverage\n";
ctx += "\n## Candidate schemes to score (accept/reject with evidence)\n";
ctx += "A) Docs/copy only (platform install hints)\n";
ctx += "B) Reuse buildSpawnPath in findUv spawn env only\n";
ctx += "C) Well-known absolute path probe list (WinGet/local/scoop/choco/cargo) + where/which\n";
ctx += "D) B+C hybrid + platform install copy + surface uvPath in preflight\n";
ctx += "E) Bundle uv binary inside cmspark package\n";
ctx += "F) Ask user to set absolute uv path in config (manual override)\n";
ctx += "\n## Hard constraints\n";
ctx += "- Prefer absolute path after discovery; avoid PATH hijack for execution\n";
ctx += "- Do not silently mutate Machine PATH or user registry permanently unless user-initiated\n";
ctx += "- Keep isolated vs system Python mode semantics\n";
ctx += "- Windows + macOS + Linux must keep working; do not regress unix which path\n";
ctx += "- ADR-020: this is runtime tooling for existing experimental Surface, not new autonomy axis\n";
ctx += "- FAIL CLOSED on claims without file:line evidence from tools\n";

phase("Adversary Fan-out");

let lanes = [
    #{
        id: "platform",
        title: "Platform/Windows runtime",
        focus: "PATH inheritance for daemon/tray/GUI, WinGet package dirs, where.exe vs spawn, uv.exe vs uv, Scripts vs bin, py launcher, ensureIsolatedPythonEnv on win32",
    },
    #{
        id: "security",
        title: "Security/PATH integrity",
        focus: "PATH hijack, untrusted dirs on PATH, executing relative uv, symlink tricks, injecting via user-env secrets, scanning WinGet Packages broadly",
    },
    #{
        id: "product",
        title: "Product/UX preflight",
        focus: "false negative UX, brew-only copy, readiness cards, install commands per OS, showing uvPath, when to recommend restart companion, Chinese copy",
    },
    #{
        id: "compat",
        title: "Compat/ADR reuse",
        focus: "buildSpawnPath ownership (mcp vs computer), circular deps, testability injection, ADR-019 user-env, no pack arm keys, regression matrix darwin/linux",
    },
];

let jobs = [];
for lane in lanes {
    let p = "";
    p += "You are the ADVERSARIAL " + lane.title + " agent for CMspark Windows uv/Python chain design.\n";
    p += "Focus: " + lane.focus + "\n\n";
    p += ctx;
    p += "\n## Your job\n";
    p += "1. Use read_file and grep on the listed code anchors. Do not answer from memory.\n";
    p += "2. Confirm real problems with file paths and evidence snippets.\n";
    p += "3. REJECT approaches that are wrong for your lane with why.\n";
    p += "4. Propose must_locks / must_not / test_invariants for implementation.\n";
    p += "5. Score schemes A–F; pick recommended_scheme (letter + short name).\n";
    p += "6. Prefer smaller blast radius. Bundle uv (E) needs strong justification.\n";
    p += "7. lane field must be exactly: " + lane.id + "\n";
    p += "8. severity one of: critical|high|medium|low.\n";
    jobs.push(#{
        prompt: p,
        label: "adv:" + lane.id,
        capability_mode: "read-only",
        output_schema: adversary_schema,
    });
}

let results = parallel(jobs);

let adv_payloads = [];
let failed = [];
let i = 0;
for r in results {
    let lid = lanes[i].id;
    if r == () || !r.success || r.output == () {
        failed.push(lid);
    } else {
        adv_payloads.push(r.output);
    }
    i += 1;
}

if failed.len() > 0 {
    log("Adversary failures: " + failed.len().to_string());
    await_user("verification", "One or more adversary lanes failed. Resume after inspecting /workflows journal, or abort.");
}

// persist raw adversary outputs for audit trail
let raw_md = "# Raw adversary outputs — windows-uv-python-chain\n\n";
for a in adv_payloads {
    raw_md += "## Lane: " + a.lane + "\n\n";
    raw_md += "Recommended: " + a.recommended_scheme + "\n\n";
    if a.scheme_notes != () { raw_md += a.scheme_notes + "\n\n"; }
    raw_md += "### Confirmed problems\n";
    if a.confirmed_problems != () {
        for c in a.confirmed_problems {
            raw_md += "- **" + c.severity + "** `" + c.id + "`: " + c.claim + " — " + c.evidence + "\n";
        }
    }
    raw_md += "\n### Rejected\n";
    if a.rejected_approaches != () {
        for rj in a.rejected_approaches {
            raw_md += "- ~~" + rj.approach + "~~ — " + rj.why_reject + "\n";
        }
    }
    raw_md += "\n### Locks\n";
    if a.must_locks != () {
        for lk in a.must_locks { raw_md += "- LOCK: " + lk + "\n"; }
    }
    if a.must_not != () {
        for mn in a.must_not { raw_md += "- MUST NOT: " + mn + "\n"; }
    }
    raw_md += "\n### Tests\n";
    if a.test_invariants != () {
        for t in a.test_invariants { raw_md += "- " + t + "\n"; }
    }
    raw_md += "\n---\n\n";
}
let raw_path = write_scratch_file("adversary-raw.md", raw_md);
log("Wrote scratch adversary-raw.md");

phase("Synthesize");

let syn_prompt = "";
syn_prompt += "You are the SYNTHESIZER for CMspark Windows uv/Python chain adversarial design.\n";
syn_prompt += "Read real code if needed to resolve conflicts. Do not invent new scope.\n\n";
syn_prompt += ctx;
syn_prompt += "\n## Adversary JSON inputs (authoritative — reconcile conflicts)\n";
syn_prompt += json_encode(adv_payloads);
syn_prompt += "\n\n## Your job\n";
syn_prompt += "1. Produce consensus claims all lanes agree on (or majority with security veto power on hijack).\n";
syn_prompt += "2. List rejected approaches with who vetoed.\n";
syn_prompt += "3. Emit locked_decisions W1..Wn (Windows chain product/security law).\n";
syn_prompt += "4. Phased plan: P0 (detection+copy), optional P1 (manual override path / diagnostics).\n";
syn_prompt += "5. rejection_gates for Pi: any design that fails these → REJECT implementation start.\n";
syn_prompt += "6. file_touch_list of concrete repo paths for P0.\n";
syn_prompt += "7. pi_ready=true only if no unresolved security/product conflict blocks design.\n";
syn_prompt += "8. markdown_body: full synthesis document in Chinese+English mixed OK, GitHub markdown,\n";
syn_prompt += "   sections: 1 Consensus 2 Scheme scoreboard 3 Locked law 4 Phased path 5 Rejection gates 6 File map 7 Open questions.\n";
syn_prompt += "9. Prefer scheme D hybrid unless security vetoes; justify if different.\n";
syn_prompt += "10. Explicit: findUv must prefer absolute discovered path; platform install copy not brew-only.\n";

let syn = agent(syn_prompt, #{
    label: "synthesize",
    capability_mode: "read-only",
    output_schema: synthesis_schema,
});

if syn == () || !syn.success || syn.output == () {
    pause("infra", "Synthesizer failed — inspect journal and resume or abort.");
}

let body = if syn.output.markdown_body != () { syn.output.markdown_body } else { "(no markdown_body)" };
let syn_path = write_scratch_file("adversary-synthesis.md", body);
log("Wrote scratch adversary-synthesis.md; pi_ready=" + syn.output.pi_ready.to_string());

complete(#{
    summary: "Windows uv/Python chain adversarial design complete",
    pi_ready: syn.output.pi_ready,
    raw_scratch: raw_path,
    synthesis_scratch: syn_path,
    locked_decisions: syn.output.locked_decisions,
    phased_plan: syn.output.phased_plan,
    rejection_gates: syn.output.rejection_gates,
    file_touch_list: syn.output.file_touch_list,
    consensus: syn.output.consensus,
    rejected: syn.output.rejected,
    open_questions_for_user: syn.output.open_questions_for_user,
    markdown_body: body,
});
