let meta = #{
    name: "analyze-image-data-url-p0",
    description: "P0: fix analyze_image data: false Security Block — extension inline decode + companion residual + tests",
    when_to_use: "When analyze_image hard-blocks data: URLs despite L2/god-mode; captcha/inline image OCR broken",
    phases: [
        #{ title: "Implement", detail: "extension promote + companion residual + tests" },
        #{ title: "Adversarial", detail: "skeptic panel on the live diff" },
        #{ title: "FixIfNeeded", detail: "close only blocking findings" },
        #{ title: "Verify", detail: "targeted unit + M4 security-gates tests" },
    ],
};

let implement_schema = #{
    "type": "object",
    "required": ["done", "summary", "files_changed", "tests_added", "tests_run"],
    "properties": #{
        "done": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 15 },
        "tests_added": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "tests_run": #{ "type": "string" },
        "notes": #{ "type": "string" },
        "diff_stat": #{ "type": "string" },
    },
};

let adv_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "maxItems": 12, "items": #{
            "type": "object",
            "required": ["id", "file", "issue"],
            "properties": #{
                "id": #{ "type": "string" },
                "file": #{ "type": "string" },
                "issue": #{ "type": "string" },
                "severity": #{ "type": "string" },
                "evidence": #{ "type": "string" },
            },
        }},
        "summary": #{ "type": "string" },
        "residual_risks": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["done", "summary", "files_changed"],
    "properties": #{
        "done": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 15 },
        "tests_run": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "commands", "log"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "commands": #{ "type": "array", "items": #{ "type": "string" } },
        "log": #{ "type": "string" },
    },
};

// ---------- Locked amended plan (from adversarial GO_WITH_AMENDMENTS) ----------
fn locked_spec() {
    let s = "";
    s += "GOAL: Fix false Security Block when analyze_image sees data: URLs (user had L2+god-mode+whitelist still blocked).\n";
    s += "Repo: /Users/huchen/Projects/cmspark. Branch: stay on current branch. Do NOT commit/push.\n\n";
    s += "LOCKED DESIGN (adversarial amendments — do not reopen):\n";
    s += "1) EXTENSION PRIMARY (browser-bridge analyzeImage AFTER CDP returns, NOT inside CDP expression):\n";
    s += "   - If fetchSrc starts with data: → decode with mime allowlist + size cap → return type:canvas image_base64.\n";
    s += "   - NEVER return fetch_required for data:.\n";
    s += "   - If blob: → success:false clear error (not fetch_required).\n";
    s += "   - http(s) cross-origin → still fetch_required (unchanged).\n";
    s += "2) COMPANION RESIDUAL (server.ts analyze_image branch) for old-extension skew:\n";
    s += "   - BEFORE host/trust/L2: if scheme is data: → mime+size gate; decode payload LOCALLY into type:canvas image_base64;\n";
    s += "     return immediately. NO L2, NO analyze_image_fetch phase2, NO schemeOk expansion to data:.\n";
    s += "   - Reject non-raster (esp image/svg+xml, text/*, empty) with short error + error_code.\n";
    s += "   - Oversize → IMAGE_TOO_LARGE short error.\n";
    s += "3) SIZE CAP: decoded payload ≤ 6 MiB (6291456). WS is 10MB; do NOT use vision 20MB as the gate.\n";
    s += "4) MIME ALLOWLIST (both sides same rules): image/png, image/jpeg, image/jpg→jpeg, image/webp, image/gif. Reject svg+xml and others.\n";
    s += "5) ERROR/LOG HYGIENE: never interpolate full data: or multi-KB candidate_url into tool errors or security.image_fetch_* logs.\n";
    s += "   Use scheme + mime + byte_len + short prefix. Prefer data.error_code fields.\n";
    s += "6) INVARIANTS MUST HOLD: file:/javascript:/blob: hard-block on path B; metadata IP hard-block;\n";
    s += "   untrusted https still L2; god-mode + auto_approve_dangerous still do NOT skip IMAGE_FETCH http(s) confirm;\n";
    s += "   analyze_image_fetch still internal-only.\n";
    s += "7) NO new config flag for data:. NO settings UI. NO vision-pipeline mime refactor in P0.\n";
    s += "8) Update stale comment in server.ts that claims data: never reaches path B.\n";
    s += "9) Optional one-line doc fix in docs/security-design-tiered-gates-2026-07-11.md §6.1.4 data: row if cheap.\n\n";
    s += "FILES (minimal):\n";
    s += "- chrome-extension/src/background/image-extract-utils.ts (allowlist, size cap, helpers)\n";
    s += "- chrome-extension/src/background/browser-bridge.ts (promote data: after CDP)\n";
    s += "- chrome-extension/tests/image-extract-utils.test.ts\n";
    s += "- companion/src/server.ts (data: residual + truncate errors)\n";
    s += "- companion/tests/integration/security-gates.test.ts (M4 cases)\n";
    s += "Optional tiny companion helper (do not import chrome-extension into companion).\n\n";
    s += "TESTS required:\n";
    s += "- decodeDataUrl/helpers: happy raster, reject text/html, reject svg, reject oversize, data: no network\n";
    s += "- M4: fetch_required data:image/png → success, NO confirmation, NO phase2, pendingToolCalls empty\n";
    s += "- M4: data:text/html / oversize → fail short error; file: still blocked; god-mode still confirms untrusted https\n";
    s += "Run: npm --prefix chrome-extension test -- image-extract-utils (or project test runner)\n";
    s += "Run: npm --prefix companion test -- security-gates (or filter M4)\n";
    s += "Use nvm/node if needed. Prefer uv not relevant here.\n";
    s += "Minimal diffs. No drive-by refactors. No commit.\n";
    return s;
}

// ---------- Phase 1: Implement ----------
phase("Implement");
let impl_prompt = locked_spec();
impl_prompt += "\nImplement the locked design fully. Use read_file before edit; use search_replace/write. ";
impl_prompt += "After coding, run the targeted tests and report actual command output summaries in tests_run. ";
impl_prompt += "Set done=true only if code is written and tests you ran are green (or explain failures honestly in notes with done=false).";

let impl = agent(impl_prompt, #{
    label: "implement-p0",
    capability_mode: "all",
    output_schema: implement_schema,
});

let impl_ok = impl != () && impl.success && impl.output != () && impl.output.done == true;
if !impl_ok {
    let msg = "Implement phase failed or done=false";
    if impl != () && impl.output != () && impl.output.summary != () {
        msg = "Implement incomplete: " + impl.output.summary;
    }
    log(msg);
    complete(#{
        status: "implement_failed",
        summary: msg,
        implement: if impl != () { impl.output } else { () },
    });
}

log("Implement done: " + impl.output.summary);

// ---------- Phase 2: Adversarial on diff ----------
phase("Adversarial");
let adv_jobs = [];
let claims = [
    "data: never reaches network fetch / phase2; residual is local decode only",
    "mime allowlist + size cap enforced; svg and oversize rejected with short errors",
    "untrusted https L2 and file/metadata hard-blocks and god-mode non-bypass still hold",
    "no full data: base64 in errors or security logs; extension never emits fetch_required for data:",
];
let ci = 0;
for c in claims {
    let ap = "";
    ap += "Adversarially verify this claim against the LIVE uncommitted diff in /Users/huchen/Projects/cmspark. ";
    ap += "Claim: " + c + ". ";
    ap += "Use git diff and read_file/grep on: browser-bridge.ts, image-extract-utils.ts, server.ts analyze_image branch, security-gates M4 tests. ";
    ap += "Set pass=true only with concrete evidence from the code you read. ";
    ap += "If the claim is false or incomplete, pass=false and list blocking findings with file paths. ";
    ap += "Empty blocking only if truly sound after reading.";
    adv_jobs.push(#{
        prompt: ap,
        label: "adv-" + ci.to_string(),
        capability_mode: "read-only",
        output_schema: adv_schema,
    });
    ci += 1;
}
let adv_results = parallel(adv_jobs);

let all_blocking = [];
let adv_pass = true;
for r in adv_results {
    if r == () || !r.success || r.output == () {
        adv_pass = false;
        all_blocking.push(#{
            id: "adv_agent_fail",
            file: "workflow",
            issue: "adversarial agent failed or returned empty",
            severity: "high",
            evidence: "",
        });
    } else {
        if r.output.pass != true {
            adv_pass = false;
        }
        if r.output.blocking != () {
            for b in r.output.blocking {
                all_blocking.push(b);
            }
        }
    }
}

log("Adversarial pass=" + adv_pass.to_string() + " blocking=" + all_blocking.len().to_string());

// ---------- Phase 3: Fix if needed ----------
phase("FixIfNeeded");
if !adv_pass && all_blocking.len() > 0 {
    let fix_prompt = locked_spec();
    fix_prompt += "\nAdversarial review found BLOCKING issues. Fix ONLY these (minimal):\n";
    fix_prompt += json_encode(all_blocking);
    fix_prompt += "\nRe-run targeted tests after fix. done=true only if fixed and tests green.";
    let fix = agent(fix_prompt, #{
        label: "fix-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });
    if fix == () || !fix.success || fix.output == () || fix.output.done != true {
        complete(#{
            status: "fix_failed",
            summary: "Blocking adversarial findings remain",
            blocking: all_blocking,
            implement: impl.output,
        });
    }
    log("Fix applied: " + fix.output.summary);
} else {
    log("No fix phase needed");
}

// ---------- Phase 4: Verify ----------
phase("Verify");
let vprompt = "";
vprompt += "In /Users/huchen/Projects/cmspark run verification for the analyze_image data: P0 fix. ";
vprompt += "1) Run chrome-extension image-extract-utils tests. ";
vprompt += "2) Run companion security-gates tests (or M4 subset). ";
vprompt += "3) Confirm via git diff that: data: is not schemeOk-widened globally; phase2 not used for data: residual; ";
vprompt += "file:/metadata/god-mode tests still present. ";
vprompt += "Report ok=true only if tests exit 0. Include command list and a truncated log.";

let ver = agent(vprompt, #{
    label: "verify-tests",
    capability_mode: "all",
    output_schema: verify_schema,
});

let vok = ver != () && ver.success && ver.output != () && ver.output.ok == true;

let report = #{
    status: if vok { "success" } else { "verify_failed" },
    summary: if vok {
        "P0 analyze_image data: fix implemented and verified"
    } else {
        "Implementation done but verification failed — inspect log"
    },
    implement: impl.output,
    adversarial_pass: adv_pass,
    blocking_count: all_blocking.len(),
    verify: if ver != () { ver.output } else { () },
};

let path = write_scratch_file("analyze-image-data-url-p0-report.json", json_encode(report));
complete(#{ path: path, report: report });
