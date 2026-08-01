let meta = #{
    name: "estop-tap-degraded-cu-fix",
    description: "Soft-fail CGEventTap (socket stays live) to unblock host_computer under LS/TCC; Pi+Claude dual review gates",
    when_to_use: "macOS LaunchServices estop tapCreate fails while CLI same binary works; CU preflight blocked on code 4",
    phases: [
        #{ title: "Diagnose", detail: "Confirm CLI vs LS evidence and current code state" },
        #{ title: "Implement", detail: "Soft-fail tap + listenOnly prefer + diagnostics" },
        #{ title: "Verify", detail: "Unit tests + rebuild host + package reinstall probe" },
        #{ title: "DeviceGate", detail: "SOCKET_LIVE after app relaunch" },
        #{ title: "ExternalReview", detail: "Real Pi + Claude dual review" },
        #{ title: "Gate", detail: "Both non-REJECT or await_user" },
    ],
};

let diag_schema = #{
    "type": "object",
    "required": ["cli_estop_ok", "ls_tap_fails", "summary"],
    "properties": #{
        "cli_estop_ok": #{ "type": "boolean" },
        "ls_tap_fails": #{ "type": "boolean" },
        "ax_trusted_cli": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "cdhash": #{ "type": "string" },
    },
};

let impl_schema = #{
    "type": "object",
    "required": ["done", "summary", "changed_files"],
    "properties": #{
        "done": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "changed_files": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "tests_log": #{ "type": "string" },
        "blocked": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "log"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "log": #{ "type": "string" },
        "socket_live": #{ "type": "boolean" },
        "hotkey_degraded": #{ "type": "boolean" },
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

// ---------- Diagnose ----------
phase("Diagnose");
let diag_p = "";
diag_p += "Repo: /Users/huchen/Projects/cmspark. Read-only diagnose.\n";
diag_p += "1) Read docs/superpowers/plans/2026-08-01-macos-tcc-estop-BLOCKED-HANDOFF.md night section.\n";
diag_p += "2) Confirm device evidence pattern: CLI MacOS/CMspark estop SOCKET_LIVE; ";
diag_p += "app relaunch writes estop-tray.log CGEventTap failed; security-check axTrusted true.\n";
diag_p += "3) Inspect companion/src/host-use/darwin/host.swift runEstop — does it still hard-exit code 4 on tap nil?\n";
diag_p += "4) Return JSON {cli_estop_ok, ls_tap_fails, ax_trusted_cli, cdhash, summary}.\n";
diag_p += "Use tools: read_file, grep, bash for codesign/security-check if safe. Do not kill user apps unless needed.\n";
let diag = agent(diag_p, #{
    label: "diagnose-ls-tap",
    capability_mode: "execute",
    output_schema: diag_schema,
});
if diag == () || !diag.success {
    log("Diagnose agent failed — continuing with known HANDOFF evidence");
} else {
    log("Diagnose: " + diag.output.summary);
}

// ---------- Implement ----------
phase("Implement");
let impl_p = "";
impl_p += "Repo: /Users/huchen/Projects/cmspark ONLY. Implement soft-fail estop CGEventTap.\n";
impl_p += "REQUIREMENTS:\n";
impl_p += "A) In companion/src/host-use/darwin/host.swift runEstop:\n";
impl_p += "   - After binding UNIX socket, try CGEvent.tapCreate with options .listenOnly first,\n";
impl_p += "     then .defaultTap fallback.\n";
impl_p += "   - If BOTH fail: DO NOT throw HostError code 4 / exit. Log stderr that hotkey is\n";
impl_p += "     DEGRADED and socket proof-of-life remains active. Call CFRunLoopRun() anyway.\n";
impl_p += "   - If tap succeeds: arm as today; log mode=listenOnly|defaultTap.\n";
impl_p += "   - Keep AXIsProcessTrustedWithOptions prompt when not trusted.\n";
impl_p += "B) Update comments: fail-closed for CU = socket, not hotkey.\n";
impl_p += "C) Do NOT claim host_computer fully fixed without device SOCKET_LIVE evidence.\n";
impl_p += "D) Run: cd companion && npx tsx --test tests/computer-darwin-estop-owner.test.ts tests/computer-estop.test.ts\n";
impl_p += "   (avoid unlinking live production socket if possible; note if skipped).\n";
impl_p += "E) Return {done, summary, changed_files, tests_log}.\n";
impl_p += "If already implemented matching A, verify and set done=true without churn.\n";
let impl = agent(impl_p, #{
    label: "impl-soft-fail-tap",
    capability_mode: "all",
    output_schema: impl_schema,
});
if impl == () || !impl.success || impl.output == () || impl.output.done != true {
    await_user("verification", "Implement phase failed or incomplete — fix soft-fail tap then resume");
}

// ---------- Verify (rebuild + device) ----------
phase("Verify");
let ver_p = "";
ver_p += "Repo: /Users/huchen/Projects/cmspark. Rebuild host binary, reinstall into /Applications/CMspark.app if packaging scripts allow,\n";
ver_p += "fully quit CMspark (pkill -x CMspark + kill tray/daemon by pid, not broad pkill -f),\n";
ver_p += "relaunch open -a /Applications/CMspark.app, wait 4s, check:\n";
ver_p += "1) cat ~/.cmspark-agent/logs/estop-tray.log — expect either 'hotkey armed' OR 'hotkey DEGRADED' (NOT process exit with only old code-4 message then dead socket)\n";
ver_p += "2) python connect /tmp/cmspark-estop.sock → SOCKET_LIVE true required for ok=true\n";
ver_p += "3) ps shows living CMspark estop child OR in-process (parent CMspark holds socket)\n";
ver_p += "Build: companion/src/host-use/darwin/build-host.sh then package/ditto as project docs describe.\n";
ver_p += "If full DMG too heavy, ditto MacOS/CMspark + re-codesign app identity is OK for local probe.\n";
ver_p += "Return {ok, log, socket_live, hotkey_degraded}. ok=true ONLY if socket_live=true.\n";
let ver = agent(ver_p, #{
    label: "verify-device-socket",
    capability_mode: "all",
    output_schema: verify_schema,
});
if ver == () || !ver.success || ver.output == () || ver.output.ok != true {
    await_user("verification", "Device verify failed: SOCKET not live after soft-fail — inspect estop-tray.log and resume");
}

// ---------- External review: Pi + Claude (real CLIs; Kimi optional/skipped) ----------
phase("ExternalReview");
let rev_p = "";
rev_p += "Repo: /Users/huchen/Projects/cmspark.\n";
rev_p += "Use prompt docs/audit/reviews/estop-tap-degraded-dual-review-prompt-20260801.md (Pi+Claude).\n";
rev_p += "Run REAL external reviewers via bash (do NOT use kimi unless user asked):\n";
rev_p += "1) pi -p --no-session -t read,bash \"$(cat prompt)\" → docs/audit/reviews/estop-tap-degraded-pi-<ts>.md\n";
rev_p += "2) claude -p \"$(cat prompt)\" --output-format text --permission-mode acceptEdits ";
rev_p += "--allowedTools Read,Grep,Glob,Bash → docs/audit/reviews/estop-tap-degraded-claude-<ts>.md\n";
rev_p += "Or use scripts/dual-external-review.sh with batch estop-tap-degraded if available.\n";
rev_p += "Parse last VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT from each file.\n";
rev_p += "Write docs/audit/reviews/estop-tap-degraded-verdict-<ts>.json with both_approve.\n";
rev_p += "Return review_schema: verdict=worst of two (REJECT wins), blocking merged, artifact_path=verdict json, summary.\n";
rev_p += "Timeouts ~8 min each. UNKNOWN/empty → REJECT for gate.\n";
let rev = agent(rev_p, #{
    label: "pi-claude-dual-review",
    capability_mode: "all",
    output_schema: review_schema,
});

phase("Gate");
if rev == () || !rev.success || rev.output == () {
    await_user("verification", "External review infra failed — check pi/kimi outputs");
}
let v = rev.output.verdict;
if type_of(v) != "string" {
    await_user("verification", "Missing verdict from dual review");
}
if v == "REJECT" {
    await_user("verification", "Pi+Kimi REJECT — address blocking then resume: " + rev.output.summary);
}

// ---------- HANDOFF update ----------
let hand_p = "";
hand_p += "Update docs/superpowers/plans/2026-08-01-macos-tcc-estop-BLOCKED-HANDOFF.md with a new section:\n";
hand_p += "soft-fail tap landed; device SOCKET_LIVE evidence; hotkey degraded or armed; Pi+Kimi verdicts; remaining Developer ID.\n";
hand_p += "Do not claim full Computer Use DoD if screenshot/click not re-verified.\n";
let hand = agent(hand_p, #{
    label: "update-handoff",
    capability_mode: "all",
});

complete(#{
    summary: "estop tap soft-fail workflow complete",
    device_ok: true,
    review_verdict: v,
    review_summary: rev.output.summary,
    handoff: if hand != () && hand.success { "updated" } else { "pending" },
});
