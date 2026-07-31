// AgentTeam-style UIUX v2 delivery: implement → verify → Pi review gate per PR node.
// OMX $team is unavailable in this environment (no omx/tmux); this workflow is the
// Grok-native substitute: sequential PR nodes from the approved design, with Pi as
// the external reviewer at each node (user-requested).
//
// Spec: docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md §12
//
// Args:
//   node: PR1 | PR2 | PR3 | PR4 | PR5 | PR6 | PR7  (required)
//   max_rounds: optional fix loop after Pi REJECT (default 2)
//   skip_pi: optional bool — for local dry-run only

let meta = #{
    name: "uiux-v2-agentteam",
    description: "UIUX v2 AgentTeam: one PR-node implement + tests + Pi review gate",
    when_to_use: "Implement sidepanel UI redesign PR1–PR7 with Pi review at each node",
    phases: [
        #{ title: "Setup", detail: "branch + scope lock" },
        #{ title: "Implement", detail: "code + tests for the node" },
        #{ title: "Verify", detail: "targeted tests / tsc" },
        #{ title: "PiReview", detail: "external Pi gate" },
        #{ title: "FixLoop", detail: "address Pi blocking if any" },
        #{ title: "Commit", detail: "atomic commit on feature branch" },
    ],
};

let impl_schema = #{
    "type": "object",
    "required": ["done", "summary", "files_changed", "tests_run"],
    "properties": #{
        "done": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "tests_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "log"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "log": #{ "type": "string" },
        "commands": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let pi_schema = #{
    "type": "object",
    "required": ["verdict", "path", "summary"],
    "properties": #{
        "verdict": #{ "type": "string" },
        "path": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 15 },
        "nits": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 15 },
    },
};

let commit_schema = #{
    "type": "object",
    "required": ["committed", "sha", "message"],
    "properties": #{
        "committed": #{ "type": "boolean" },
        "sha": #{ "type": "string" },
        "message": #{ "type": "string" },
    },
};

fn node_spec(n) {
    if n == "PR1" {
        let s = "";
        s += "PR1 — StatusRail + offline hygiene + token connection colors\n";
        s += "Spec: docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md §4.2 StatusRail, §8 v2-P0, §12 PR1\n";
        s += "DO:\n";
        s += "1) Extract/refine Header into StatusRail: mode badge + pin-on-badge + connection (tokens only) + thread switcher + ⋯ menu\n";
        s += "2) Connection colors: NO Material #4CAF50/#FF9800/#F44336 — use tokens.success/warning/danger\n";
        s += "3) Offline reconnect path: remove alert(); use DisconnectedBanner only\n";
        s += "4) Update docs/DESIGN.md: radius SoT 6/8/12; connection section uses status tokens\n";
        s += "5) Prefer tokens from chrome-extension/src/sidepanel/ui/tokens.ts\n";
        s += "DO NOT: delete BottomBar; add 装配 drawer; change FocusBand; touch companion daemon\n";
        s += "Tests: extension unit tests for any pure helpers; npm test chrome-extension if feasible\n";
        return s;
    }
    if n == "PR2" {
        let s = "";
        s += "PR2 — ContextPanelHost extract (NO BottomBar strip delete)\n";
        s += "Spec §4.7 M1: peel activePanel, panel mounts, loadPanelData, cmspark:open-context-panel from BottomBar into ContextPanelHost\n";
        s += "BottomBar becomes thin chrome calling Host API\n";
        s += "DO NOT remove tab strip yet\n";
        return s;
    }
    if n == "PR3" {
        return "PR3 — FocusBand state machine (§4.3): Confirm > L2 Safety+急停 > Fleet > L1 Context; max 80px; remove pending>0 from FleetStrip visibility\n";
    }
    if n == "PR4" {
        return "PR4 — Composer chips + slash parity matrix §4.8 + 装配 P0 entry (section list → Host)\n";
    }
    if n == "PR5" {
        return "PR5 — Hide/remove BottomBar strip behind flag (Host SoT)\n";
    }
    if n == "PR6" {
        return "PR6 — Full 装配 drawer sections + visual density; Board NOT in 装配\n";
    }
    if n == "PR7" {
        return "PR7 — Cockpit StatusRail alignment + DESIGN.md semantic roles cleanup\n";
    }
    "UNKNOWN"
}

// ----- args -----
let node = if args == () { () } else { args.node };
if node == () {
    pause("verification", "Pass args.node: PR1|PR2|PR3|PR4|PR5|PR6|PR7");
}
let spec = node_spec(node);
if spec == "UNKNOWN" {
    pause("verification", "Unknown node. Use PR1..PR7");
}
let max_rounds = 2;
if args != () && args.max_rounds != () {
    max_rounds = args.max_rounds;
}
let skip_pi = false;
if args != () && args.skip_pi == true {
    skip_pi = true;
}

// ===================== SETUP =====================
phase("Setup");
log("AgentTeam node " + node + " starting");

let setup_p = "";
setup_p += "CMspark repo root. Prepare feature branch for UIUX v2.\n";
setup_p += "1) git status; ensure clean enough to work (untracked design docs OK)\n";
setup_p += "2) If not already on feat/uiux-v2-shell: git checkout -B feat/uiux-v2-shell origin/main\n";
setup_p += "3) If docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md is untracked, leave it for implementer to include if needed\n";
setup_p += "4) Do NOT commit yet. Report branch name and HEAD.\n";
let setup = agent(setup_p, #{
    label: "setup:" + node,
    capability_mode: "execute",
});
if setup == () || !setup.success {
    log("Setup agent soft-failed — continue on current branch");
}

// ===================== LOOP =====================
let round = 0;
let pi_ok = false;
let feedback = "";
let last_impl = ();
let last_pi = ();

while round < max_rounds {
    round += 1;
    log("=== " + node + " round " + round.to_string() + " ===");

    phase("Implement");
    let imp_p = "";
    imp_p += "You are Implementer for CMspark UIUX v2 AgentTeam node " + node + ".\n";
    imp_p += "READ FULLY first:\n";
    imp_p += "- docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md\n";
    imp_p += "- docs/DESIGN.md\n";
    imp_p += "- chrome-extension/src/sidepanel/App.tsx (Header, offline banner)\n";
    imp_p += "- chrome-extension/src/sidepanel/ui/tokens.ts\n";
    imp_p += "STRICT SCOPE:\n" + spec + "\n";
    if feedback != "" {
        imp_p += "\nPI / VERIFY FEEDBACK (must fix):\n" + feedback + "\n";
    }
    imp_p += "METHOD: minimal patches; use tokens; no drive-by refactors; run targeted tests.\n";
    imp_p += "Do NOT git commit or push. Set done=true only if scope complete.\n";

    let impl = agent(imp_p, #{
        label: "implement:" + node + ":r" + round.to_string(),
        capability_mode: "all",
        output_schema: impl_schema,
    });
    if impl == () || !impl.success || impl.output == () {
        feedback = "Implement agent failed. Retry carefully.";
        log("Implement failed");
        continue;
    }
    last_impl = impl.output;
    log("Implement: " + impl.output.summary);
    if impl.output.done != true {
        feedback = "Implementer set done=false: " + impl.output.summary;
        continue;
    }

    phase("Verify");
    let ver_p = "";
    ver_p += "Verify UIUX node " + node + " on CMspark.\n";
    ver_p += "1) git diff --stat\n";
    ver_p += "2) chrome-extension: tsc -p tsconfig.test.json && node --test for any new tests; or npm test if reasonable time\n";
    ver_p += "3) Grep for forbidden Material hex in touched files: #4CAF50 #FF9800 #F44336\n";
    ver_p += "4) Grep alert( in App.tsx offline path — should be gone for PR1\n";
    ver_p += "5) Set ok=true only if typecheck/tests pass and scope not violated\n";
    let ver = agent(ver_p, #{
        label: "verify:" + node + ":r" + round.to_string(),
        capability_mode: "execute",
        output_schema: verify_schema,
    });
    if ver == () || !ver.success || ver.output == () || ver.output.ok != true {
        let vlog = "verify failed";
        if ver != () && ver.output != () && ver.output.log != () {
            vlog = ver.output.log;
        }
        feedback = "Verify failed: " + vlog;
        log(feedback);
        continue;
    }
    log("Verify OK");

    if skip_pi {
        log("skip_pi=true — treating Pi as waived");
        pi_ok = true;
        break;
    }

    phase("PiReview");
    let pi_p = "";
    pi_p += "You are the PI REVIEWER gate for CMspark UIUX v2 node " + node + ".\n";
    pi_p += "Run this shell command and capture output to a file under docs/audit/reviews/:\n";
    pi_p += "  TS=$(date +%Y%m%d-%H%M%S)\n";
    pi_p += "  OUT=docs/audit/reviews/uiux-v2-" + node + "-pi-$TS.md\n";
    pi_p += "  PROMPT is multi-line — use pi -p --no-session -t read,bash with:\n";
    pi_p += "Review uncommitted git diff for UIUX node " + node + ".\n";
    pi_p += "Spec: docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md\n";
    pi_p += "Scope:\n" + spec + "\n";
    pi_p += "Use Read/Bash: git diff, git status, open changed files.\n";
    pi_p += "Check: ADR-020 fidelity (no scope creep), tokens not Material, no BottomBar delete if PR1, offline no alert for PR1.\n";
    pi_p += "End with EXACTLY one line: VERDICT: APPROVE or VERDICT: APPROVE_WITH_NITS or VERDICT: REJECT\n";
    pi_p += "If REJECT list blocking file:line issues before verdict.\n";
    pi_p += "Write full pi stdout to OUT. Parse verdict. Return structured result.\n";
    pi_p += "If pi CLI missing, set verdict=REJECT and summary=pi missing.\n";

    let pi_r = agent(pi_p, #{
        label: "pi:" + node + ":r" + round.to_string(),
        capability_mode: "all",
        output_schema: pi_schema,
    });
    if pi_r == () || !pi_r.success || pi_r.output == () {
        feedback = "Pi review agent failed — treat as REJECT";
        log(feedback);
        continue;
    }
    last_pi = pi_r.output;
    log("Pi verdict: " + pi_r.output.verdict);
    let v = pi_r.output.verdict;
    // normalize
    if v == "APPROVE" || v == "APPROVE_WITH_NITS" {
        pi_ok = true;
        break;
    }
    // REJECT
    let fb = "Pi REJECT: " + pi_r.output.summary;
    if pi_r.output.blocking != () {
        fb += " blocking=" + json_encode(pi_r.output.blocking);
    }
    feedback = fb;
}

if !pi_ok {
    await_user("verification", "Node " + node + " failed Pi gate after " + max_rounds.to_string() + " rounds. Resume to retry or waive.");
    // after resume, do not auto-commit
    complete(#{
        node: node,
        success: false,
        message: "Pi gate not passed",
        last_impl: last_impl,
        last_pi: last_pi,
    });
}

phase("Commit");
let c_p = "";
c_p += "Commit UIUX v2 node " + node + " on current branch.\n";
c_p += "1) git status; git diff --stat\n";
c_p += "2) Stage only relevant files for this node (not huge unrelated patches)\n";
c_p += "3) git commit with message: feat(ui): UIUX v2 " + node + " — <short summary>\n";
c_p += "   Include Co-Authored-By only if required by project; prefer clean message.\n";
c_p += "4) Do NOT push unless already tracking and user history implies auto-push — default NO push.\n";
c_p += "5) Return sha and message.\n";
let c = agent(c_p, #{
    label: "commit:" + node,
    capability_mode: "all",
    output_schema: commit_schema,
});

let sha = "";
let msg = "";
let committed = false;
if c != () && c.success && c.output != () {
    committed = c.output.committed;
    sha = c.output.sha;
    msg = c.output.message;
}

complete(#{
    node: node,
    success: true,
    pi_verdict: last_pi,
    committed: committed,
    sha: sha,
    message: msg,
    impl: last_impl,
});
