// Wave A: Thread History IA gap optimization (post dual-review both_ok 2026-08-11)
// Spec: docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md
// Pins: docs/audit/reviews/thread-history-ia-gap-opt-dual-synthesis-20260811.md S1–S10

let meta = #{
    name: "thread-history-ia-wave-a",
    description: "Implement ThreadList Wave A (discoverability, menu clip, tldr, untagged batch extract) after dual-review approval",
    when_to_use: "After thread-history-ia-gap-opt both_ok; ship Wave A only (no Graph/related)",
    phases: [
        #{ title: "Ground", detail: "Read SoT + current ThreadList/timeline" },
        #{ title: "Implement", detail: "Pure functions + ThreadList UI Wave A-1..A-7" },
        #{ title: "Verify", detail: "Unit tests + typecheck/build smoke" },
        #{ title: "Acceptance", detail: "Checklist against Wave A acceptance criteria" },
    ],
};

let ground_schema = #{
    "type": "object",
    "required": ["files", "gaps", "pins", "ready"],
    "properties": #{
        "files": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "gaps": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "pins": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "ready": #{ "type": "boolean" },
        "notes": #{ "type": "string" },
    },
};

let impl_schema = #{
    "type": "object",
    "required": ["changed_files", "items_done", "tests_added", "summary"],
    "properties": #{
        "changed_files": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "items_done": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "tests_added": #{ "type": "array", "maxItems": 10, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "blockers": #{ "type": "array", "maxItems": 8, "items": #{ "type": "string" } },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["tests_ok", "commands", "failures", "notes"],
    "properties": #{
        "tests_ok": #{ "type": "boolean" },
        "commands": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "failures": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "notes": #{ "type": "string" },
    },
};

let accept_schema = #{
    "type": "object",
    "required": ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "all_pass", "evidence"],
    "properties": #{
        "a1": #{ "type": "boolean" },
        "a2": #{ "type": "boolean" },
        "a3": #{ "type": "boolean" },
        "a4": #{ "type": "boolean" },
        "a5": #{ "type": "boolean" },
        "a6": #{ "type": "boolean" },
        "a7": #{ "type": "boolean" },
        "all_pass": #{ "type": "boolean" },
        "evidence": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "residual": #{ "type": "array", "maxItems": 8, "items": #{ "type": "string" } },
    },
};

phase("Ground");
log("Ground Wave A against dual-approved SoT");

let ground = agent(
    "Repo: CMspark. Wave A ONLY for Thread History IA gap optimization.\n"
        + "Read with tools (mandatory):\n"
        + "1. docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md (Wave A + GAP-11..17)\n"
        + "2. docs/audit/reviews/thread-history-ia-gap-opt-dual-synthesis-20260811.md (S1-S10)\n"
        + "3. chrome-extension/src/sidepanel/components/ThreadList.tsx\n"
        + "4. chrome-extension/src/sidepanel/utils/thread-timeline.ts (buildTagIndex, untagged)\n"
        + "5. chrome-extension/tests/thread-timeline.test.ts\n"
        + "List concrete files to touch, remaining gaps vs A-1..A-7, pins S1-S5 that constrain selection/menu/spinner.\n"
        + "ready=true only if scope is UI-only (no companion protocol). Do not implement yet.",
    #{
        label: "ground-wave-a",
        capability_mode: "read-only",
        output_schema: ground_schema,
    },
);

if ground == () || !ground.success || ground.output == () || ground.output.ready != true {
    complete(#{
        summary: "Ground failed or not ready — abort Wave A",
        ground: ground,
    });
}

phase("Implement");
log("Implement Wave A-1..A-7 with pins S1-S5");

let impl_prompt = "";
impl_prompt += "Implement Thread History IA Wave A in CMspark. BOTH dual reviewers APPROVED.\n";
impl_prompt += "SoT: docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md Wave A + GAP-11..17.\n";
impl_prompt += "Pins (mandatory):\n";
impl_prompt += "- S1/GAP-11: batch untagged = !digest OR tags.length===0; send force:true for those; skip threads with non-empty tags unless stale+force needed only for empty tags case\n";
impl_prompt += "- S2/GAP-12: EXCLUDE agent_role worker (and clear worker markers); INCLUDE orchestrator/normal\n";
impl_prompt += "- S3/GAP-13: skip busy; disable CTA/menu when 0 targets\n";
impl_prompt += "- S4/GAP-14: menu portal to document.body, z-index above panel(51)/backdrop(50)\n";
impl_prompt += "- S5/GAP-15: progress from digest_updated; do NOT clear all extractingIds after fixed 60s for batch\n";
impl_prompt += "Deliverables A-1..A-7:\n";
impl_prompt += "A-1: ⋯ menu item 🏷 为未标注提取要点\n";
impl_prompt += "A-2: Tags empty/high-untagged primary CTA same action; fix copy\n";
impl_prompt += "A-3: show digest.tldr one line ellipsis on rows\n";
impl_prompt += "A-4: fix menu clipping via portal\n";
impl_prompt += "A-5: tag cloud max-height + 更多 collapse\n";
impl_prompt += "A-6: keep multi-select 提取要点\n";
impl_prompt += "A-7: batch progress N/M driven by events\n";
impl_prompt += "Prefer pure helpers in thread-timeline.ts (selectUntaggedForExtract, etc.) + unit tests in chrome-extension/tests/thread-timeline.test.ts.\n";
impl_prompt += "Do NOT implement Wave B/C, thread.related, Graph, companion protocol changes, or Knowledge dual-write.\n";
impl_prompt += "Use read_file before edit; keep styles consistent with tokens.\n";
impl_prompt += "After edits, summarize changed_files, items_done, tests_added.\n";
impl_prompt += "Ground notes: " + json_encode(ground.output);

let impl = agent(impl_prompt, #{
    label: "implement-wave-a",
    capability_mode: "read-write",
    output_schema: impl_schema,
});

if impl == () || !impl.success {
    complete(#{
        summary: "Implement agent failed",
        impl: impl,
        ground: ground.output,
    });
}

phase("Verify");
log("Run chrome-extension unit tests for thread timeline / related");

let verify = agent(
    "Verify Wave A implementation with execution (not inspection only).\n"
        + "1. Run: npm --prefix chrome-extension test -- --test-name-pattern 'thread|timeline|tag'  OR full chrome-extension tests if pattern fails.\n"
        + "   Prefer: cd chrome-extension && npm test -- tests/thread-timeline.test.ts (and any new test file).\n"
        + "2. If package scripts differ, discover via package.json and run the lightest correct suite.\n"
        + "3. Spot-check ThreadList.tsx for: portal menu, 为未标注提取要点, tldr row, tag cloud 更多, force true path, worker skip.\n"
        + "4. tests_ok=true only if test commands exit 0. List failures with output excerpts.\n"
        + "Changed files claimed: " + json_encode(impl.output.changed_files),
    #{
        label: "verify-wave-a",
        capability_mode: "execute",
        output_schema: verify_schema,
    },
);

phase("Acceptance");
log("Acceptance checklist A-1..A-7");

let accept_prompt = "";
accept_prompt += "Read the actual post-impl code and dual SoT. Score Wave A acceptance.\n";
accept_prompt += "For each A-1..A-7 set boolean true only with file:line evidence in evidence array.\n";
accept_prompt += "Pins: worker exclude, busy skip, force true for empty tags, portal menu, digest_updated progress.\n";
accept_prompt += "all_pass=true only if A-1..A-7 all true AND verify tests_ok if available.\n";
accept_prompt += "Impl summary: " + json_encode(impl.output) + "\n";
if verify != () && verify.success {
    accept_prompt += "Verify: " + json_encode(verify.output) + "\n";
}
accept_prompt += "Residual nits go in residual (non-blocking).\n";
accept_prompt += "Do not claim Graph/B/C done.";

let accept = agent(accept_prompt, #{
    label: "accept-wave-a",
    capability_mode: "read-only",
    output_schema: accept_schema,
});

let report = #{
    summary: "Wave A workflow finished",
    ground: ground.output,
    impl: if impl != () && impl.success { impl.output } else { () },
    verify: if verify != () && verify.success { verify.output } else { () },
    accept: if accept != () && accept.success { accept.output } else { () },
    both_ok_design: true,
    next: "If all_pass, optional dual-review on implementation diff; then Wave B/C later",
};

let path = write_scratch_file("wave-a-report.json", json_encode(report));
complete(#{ path: path, report: report });
