// Windows Python discovery cascade — adversarial product design gate
// Flow: 4 parallel adversaries → synthesizer → design artifacts for Pi review
// Gate: Pi review of SoT before implementation workflow

let meta = #{
    name: "windows-python-discovery-adversarial",
    description: "Adversarial multi-agent product design for Windows Python env discovery cascade (uv → managers → global → well-known paths → install UX)",
    when_to_use: "When designing Windows Python discovery beyond findUv — pyenv/conda/global/well-known paths and missing-Python install guidance",
    phases: [
        #{ title: "Adversary Fan-out", detail: "Platform Security Product Compat four independent agents" },
        #{ title: "Synthesize", detail: "Consensus synthesis plus locked decisions and phased plan" },
        #{ title: "Draft SoT", detail: "Write design SoT and impl plan drafts to docs for Pi gate" },
    ],
};

let adversary_schema = #{
    "type": "object",
    "required": ["lane", "confirmed_problems", "rejected_approaches", "must_locks", "must_not", "test_invariants", "open_questions", "recommended_scheme", "cascade_order"],
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
        "must_locks": #{ "type": "array", "maxItems": 14, "items": #{ "type": "string" } },
        "must_not": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "test_invariants": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "open_questions": #{ "type": "array", "maxItems": 6, "items": #{ "type": "string" } },
        "recommended_scheme": #{ "type": "string" },
        "scheme_notes": #{ "type": "string" },
        "cascade_order": #{
            "type": "array",
            "maxItems": 12,
            "items": #{ "type": "string" },
            "description": "Ordered discovery steps this lane recommends",
        },
        "install_ux": #{ "type": "string" },
    },
};

let synthesis_schema = #{
    "type": "object",
    "required": ["consensus", "rejected", "locked_decisions", "phased_plan", "rejection_gates", "file_touch_list", "pi_ready", "locked_cascade", "markdown_body"],
    "properties": #{
        "consensus": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "rejected": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "locked_decisions": #{
            "type": "array",
            "maxItems": 18,
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
        "rejection_gates": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "file_touch_list": #{ "type": "array", "maxItems": 24, "items": #{ "type": "string" } },
        "open_questions_for_user": #{ "type": "array", "maxItems": 6, "items": #{ "type": "string" } },
        "pi_ready": #{ "type": "boolean" },
        "locked_cascade": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "recommended_scheme": #{ "type": "string" },
        "markdown_body": #{ "type": "string" },
    },
};

let sot_schema = #{
    "type": "object",
    "required": ["design_md", "impl_plan_md"],
    "properties": #{
        "design_md": #{ "type": "string" },
        "impl_plan_md": #{ "type": "string" },
    },
};

// --- shared context (self-contained; agents cannot rely on parent chat) ---
let ctx = "";
ctx += "Repo root: C:/Users/HuChen/Projects/cmspark (Windows host).\n";
ctx += "Scope: Windows Python ENVIRONMENT discovery cascade for Qwen3-VL experimental layer / computer python-runtime.\n";
ctx += "This is a FOLLOW-UP to S35 findUv (already landed Scheme D). Do NOT re-litigate findUv absolute pin; EXTEND to full Python discovery.\n";
ctx += "\n## User product request (authoritative intent)\n";
ctx += "On Windows, Python discovery should:\n";
ctx += "1) Check whether uv is available (already improved in S35).\n";
ctx += "2) If not (or in parallel for base interpreter needs): check common env managers — pyenv-win, conda/miniconda/mamba/micromamba, virtualenvwrapper-ish layouts as relevant on Windows.\n";
ctx += "3) Check whether a global/system Python is usable (python / py launcher / python3).\n";
ctx += "4) If no global Python but env managers exist, allow creating a managed virtual env (CMspark isolated venv).\n";
ctx += "5) If managers absent, probe well-known Windows install paths (python.org, Store, WinGet, Anaconda, etc.).\n";
ctx += "6) Only if all fail: clear UX that Python is missing + offer install guidance (and optionally install path) to improve experience.\n";
ctx += "\n## Current code truth (READ files; verify with tools — do not invent)\n";
ctx += "- companion/src/computer/python-runtime.ts — findUv (S35 ok), resolvePythonRuntime, ensureIsolatedPythonEnv, probePythonBin, validatePythonExecutable, buildInstallCommands\n";
ctx += "  * probePythonBin only tries bare names via spawn — NO well-known absolute Python paths\n";
ctx += "  * resolvePythonRuntime system mode: systemPythonPath then python/py (win) or python3/python\n";
ctx += "  * isolated missing: probes python3/python/py on PATH only; does not surface managers\n";
ctx += "  * ensureIsolatedPythonEnv: uv absolute preferred; else PATH python -m venv; no conda create\n";
ctx += "- companion/src/computer/qwen-vl-preflight.ts — findPython local, preflight messages\n";
ctx += "- companion/src/computer/model-state-messages.ts — missing Python copy (python.org PATH tip)\n";
ctx += "- companion/src/computer/model-handlers.ts — pick_python_path, ensure_python_env, set_python_mode\n";
ctx += "- companion/tests/computer-python-runtime.test.ts — findUv + ensureIsolated coverage\n";
ctx += "- docs/superpowers/specs/2026-08-02-windows-uv-python-chain-design.md — S35 SoT (uv only)\n";
ctx += "\n## Product modes (must preserve)\n";
ctx += "- pythonMode: isolated (CMspark-managed DATA_DIR/python-env) vs system (user global)\n";
ctx += "- uv is optional accelerator for creating/installing isolated env, not required for canDownload/canEnable alone when system python works\n";
ctx += "- Never silently pip-install into system Python without user intent\n";
ctx += "- Absolute path pin after discovery (W2 class) for any interpreter used for execution\n";
ctx += "\n## Candidate schemes to score (accept/reject with evidence)\n";
ctx += "A) Copy/docs only — better missing-Python install hints (winget/python.org/py launcher)\n";
ctx += "B) Well-known absolute Python path probes only (python.org / Program Files / AppData / Store)\n";
ctx += "C) Env-manager cascade only (detect conda/pyenv-win/mamba; expose; use for base if no PATH python)\n";
ctx += "D) Full hybrid cascade: uv → managers (detect+capability) → global PATH/py → well-known paths → missing install UX; create isolated venv when any usable base found; never auto-mutate system PATH\n";
ctx += "E) Bundle CPython with CMspark package\n";
ctx += "F) Silent auto winget/choco install of Python without explicit user action\n";
ctx += "G) Deep-integrate conda envs as first-class alternative to isolated python-env (run Qwen inside user conda env)\n";
ctx += "\n## Hard constraints\n";
ctx += "- Prefer absolute path after discovery; never return bare 'python' as canonical when absolute known\n";
ctx += "- Do not silently mutate Machine/User PATH or registry permanently\n";
ctx += "- Do not silently install software without explicit user confirmation (F)\n";
ctx += "- Keep isolated vs system product semantics; ADR-020 Surface tooling only\n";
ctx += "- Do not regress findUv S35 locks; do not re-open brew-on-Windows\n";
ctx += "- Windows + macOS + Linux must keep working; win32 is the primary pain, unix may stay thinner\n";
ctx += "- No computer → mcp/transport layer inversion\n";
ctx += "- FAIL CLOSED on claims without file:line evidence from tools\n";
ctx += "- Security veto power on executing untrusted relative paths or scanning entire disks\n";

phase("Adversary Fan-out");

let lanes = [
    #{
        id: "platform",
        title: "Platform/Windows layouts",
        focus: "py launcher, python.org installs, Windows Store stub, WinGet Python, Anaconda/Miniconda/mamba/micromamba paths, pyenv-win, Scoop/Choco shims, Scripts vs bin, py -0p list, ensureIsolatedPythonEnv base selection, version filters (need 3.x), Store redirect, long paths",
    },
    #{
        id: "security",
        title: "Security/PATH integrity",
        focus: "PATH hijack, Store alias python.exe stubs, executing relative python, broad disk scans, running untrusted conda activate scripts, auto-install privilege, user-env denylist, absolute pin for all interpreters",
    },
    #{
        id: "product",
        title: "Product/UX discovery",
        focus: "false negatives for installed-but-not-on-PATH Python, progressive cascade UX, when to offer create-venv vs install Python, Chinese copy, preflight readiness cards, one-click ensure env, install guidance quality, not overwhelming with managers",
    },
    #{
        id: "compat",
        title: "Compat/S35-ADR",
        focus: "reuse findUv/probe patterns without breaking S35 tests, isolated vs system, preflight/handler/UI surface fields, ADR-019 denylist, ADR-020 no new autonomy, darwin/linux regression, test injection deps",
    },
];

let jobs = [];
for lane in lanes {
    let p = "";
    p += "You are the ADVERSARIAL " + lane.title + " agent for CMspark Windows Python discovery cascade design.\n";
    p += "Focus: " + lane.focus + "\n\n";
    p += ctx;
    p += "\n## Your job\n";
    p += "1. Use read_file and grep on the listed code anchors. Do not answer from memory.\n";
    p += "2. Confirm REAL gaps vs user cascade intent with file paths and evidence.\n";
    p += "3. REJECT approaches wrong for your lane (A–G) with why.\n";
    p += "4. Propose must_locks / must_not / test_invariants.\n";
    p += "5. Recommend cascade_order as ordered steps (strings).\n";
    p += "6. Score schemes; pick recommended_scheme (letter + short name). Prefer D unless security vetoes.\n";
    p += "7. install_ux: what to show when fully missing (winget? python.org? both? never silent install).\n";
    p += "8. lane field must be exactly: " + lane.id + "\n";
    p += "9. severity one of: critical|high|medium|low.\n";
    p += "10. Prefer smaller blast radius; G (deep conda) needs strong justification vs isolated mode.\n";
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

// persist raw adversary outputs
let raw_md = "# Raw adversary outputs — windows-python-discovery\n\n";
raw_md += "> Generated by workflow `windows-python-discovery-adversarial`\n\n";
for a in adv_payloads {
    raw_md += "## Lane: " + a.lane + "\n\n";
    raw_md += "Recommended: " + a.recommended_scheme + "\n\n";
    if a.scheme_notes != () { raw_md += a.scheme_notes + "\n\n"; }
    raw_md += "### Cascade order\n";
    if a.cascade_order != () {
        let step_i = 1;
        for step in a.cascade_order {
            raw_md += step_i.to_string() + ". " + step + "\n";
            step_i += 1;
        }
    }
    raw_md += "\n### Confirmed problems\n";
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
    if a.install_ux != () {
        raw_md += "\n### Install UX\n" + a.install_ux + "\n";
    }
    raw_md += "\n---\n\n";
}
let raw_path = write_scratch_file("adversary-raw.md", raw_md);
log("Wrote scratch adversary-raw.md");

phase("Synthesize");

let syn_prompt = "";
syn_prompt += "You are the SYNTHESIZER for CMspark Windows Python discovery cascade adversarial design.\n";
syn_prompt += "Read real code if needed to resolve conflicts. Do not invent new scope beyond user cascade.\n\n";
syn_prompt += ctx;
syn_prompt += "\n## Adversary JSON inputs (authoritative — reconcile conflicts)\n";
syn_prompt += json_encode(adv_payloads);
syn_prompt += "\n\n## Your job\n";
syn_prompt += "1. consensus claims all lanes agree on (security veto on hijack / silent install).\n";
syn_prompt += "2. rejected approaches with who vetoed.\n";
syn_prompt += "3. locked_decisions P1..Pn (product/security law for Python discovery).\n";
syn_prompt += "4. locked_cascade: single ordered cascade all lanes can live with.\n";
syn_prompt += "5. phased_plan: P0 ship (discovery+copy+create base), P1 optional (manager deep-integrate / re-detect button).\n";
syn_prompt += "6. rejection_gates for Pi: any design failing these → REJECT implementation start.\n";
syn_prompt += "7. file_touch_list concrete repo paths for P0.\n";
syn_prompt += "8. pi_ready=true only if no unresolved security/product conflict blocks design.\n";
syn_prompt += "9. recommended_scheme letter+name (prefer D hybrid).\n";
syn_prompt += "10. markdown_body: full synthesis in Chinese+English OK, GitHub markdown, sections:\n";
syn_prompt += "    1 Consensus 2 Scheme scoreboard 3 Locked cascade 4 Locked law 5 Phased path 6 Rejection gates 7 File map 8 Open questions.\n";
syn_prompt += "11. Explicit: keep S35 findUv; extend probePython/base selection; absolute pin; no silent install; no brew-only.\n";
syn_prompt += "12. Clarify manager role: DETECT for capability messaging + use as base interpreter seed when PATH empty — not G deep-run-inside-conda unless justified as P1+.\n";

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

phase("Draft SoT");

let sot_prompt = "";
sot_prompt += "You are the DESIGN DOC WRITER for CMspark Windows Python discovery cascade.\n";
sot_prompt += "Produce two complete markdown documents based on the locked synthesis (do not reopen scheme debates).\n\n";
sot_prompt += "## Synthesis (authoritative)\n";
sot_prompt += json_encode(syn.output);
sot_prompt += "\n\n## design_md requirements\n";
sot_prompt += "Write product+tech SoT suitable for docs/superpowers/specs/2026-08-09-windows-python-discovery-design.md\n";
sot_prompt += "Sections: header meta, one-liner, problem (user+code), goals/non-goals, scheme conclusion, locked cascade, product locks P*, design shape (API sketch for findPythonBase / resolve cascade), UX copy rules, security locks, phased plan, acceptance, relation to S35 uv chain, ADR notes.\n";
sot_prompt += "Chinese primary OK with English IDs.\n";
sot_prompt += "\n## impl_plan_md requirements\n";
sot_prompt += "Write implementation plan for docs/superpowers/plans/2026-08-09-windows-python-discovery-impl.md\n";
sot_prompt += "Sections: overview, tasks with files, test plan, UI surface fields, non-goals, PR checklist, Pi gate note.\n";
sot_prompt += "Be concrete enough for an implementer agent (function names, order of work, test cases).\n";
sot_prompt += "Do NOT implement code — documents only.\n";

let sot = agent(sot_prompt, #{
    label: "draft-sot",
    capability_mode: "read-only",
    output_schema: sot_schema,
});

if sot == () || !sot.success || sot.output == () {
    pause("infra", "SoT draft agent failed — inspect journal and resume or abort.");
}

let design_md = if sot.output.design_md != () { sot.output.design_md } else { "" };
let impl_md = if sot.output.impl_plan_md != () { sot.output.impl_plan_md } else { "" };
let design_scratch = write_scratch_file("design-sot-draft.md", design_md);
let impl_scratch = write_scratch_file("impl-plan-draft.md", impl_md);
log("Wrote design and impl plan drafts to scratch");

complete(#{
    summary: "Windows Python discovery adversarial design complete",
    pi_ready: syn.output.pi_ready,
    recommended_scheme: syn.output.recommended_scheme,
    locked_cascade: syn.output.locked_cascade,
    raw_scratch: raw_path,
    synthesis_scratch: syn_path,
    design_scratch: design_scratch,
    impl_scratch: impl_scratch,
    locked_decisions: syn.output.locked_decisions,
    phased_plan: syn.output.phased_plan,
    rejection_gates: syn.output.rejection_gates,
    file_touch_list: syn.output.file_touch_list,
    consensus: syn.output.consensus,
    rejected: syn.output.rejected,
    open_questions_for_user: syn.output.open_questions_for_user,
    markdown_body: body,
    design_md: design_md,
    impl_plan_md: impl_md,
});
