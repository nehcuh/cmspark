let meta = #{
    name: "sidepanel-design-debt-w123",
    description: "Implement CONDITIONAL GO W1-W3 (StatusRail truth copy, textMuted empty policy B, DESIGN.md SoT) after dual-review APPROVE_WITH_NITS",
    when_to_use: "After sidepanel-design-debt-conditional-go dual-review both approve; implement surgical design debt only",
    phases: [
        #{ title: "Implement", detail: "W1 copy + W2 textSecondary empties + W3 DESIGN SoT" },
        #{ title: "Verify", detail: "acceptance A1-A5 checks + extension tests" },
    ],
};

let impl_schema = #{
    "type": "object",
    "required": ["done", "summary", "files_changed", "w1", "w2", "w3"],
    "properties": #{
        "done": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "w1": #{ "type": "string" },
        "w2": #{ "type": "string" },
        "w3": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["pass", "a1", "a2", "a3", "a4", "a5", "blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "a1": #{ "type": "boolean" },
        "a2": #{ "type": "boolean" },
        "a3": #{ "type": "boolean" },
        "a4": #{ "type": "boolean" },
        "a5": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "test_output_tail": #{ "type": "string" },
    },
};

let sot = "docs/superpowers/specs/2026-08-11-sidepanel-design-debt-conditional-go.md";
let verdict = "docs/audit/reviews/sidepanel-design-debt-conditional-go-verdict-20260811-164753.json";

phase("Implement");
let impl_p = "";
impl_p += "You implement CONDITIONAL GO work W1+W2+W3 ONLY for CMspark Side Panel design debt.\n";
impl_p += "Repo: /Users/huchen/Projects/cmspark\n";
impl_p += "Read SoT: " + sot + "\n";
impl_p += "Dual-review verdict (both APPROVE_WITH_NITS): " + verdict + "\n";
impl_p += "Apply dual-review nits as binding:\n";
impl_p += "- W1: fix StatusRail false 底栏更多 path; copy/slash hints only (/board, 装配, /场景); NO new L0 Board Host entry; Board stays Autonomy.\n";
impl_p += "- W2: policy B — empty/guidance 暂无*/无匹配*/ChatView emptyKicker use tokens.textSecondary; leave decorative meta on textMuted; do NOT globally darken textMuted unless a residual AA-critical site remains.\n";
impl_p += "- W3: DESIGN.md sole hex SoT is tokens.ts; prefer role→tokens.* table WITHOUT stale hex columns; fix entire color role table AND Message Bubbles section; lag note names BoardPanel/AppsPanel/SettingsIntentBar residual #2563eb.\n";
impl_p += "Optional free drive-by: SettingsIntentBar tokens.accent || \"#2563eb\" → tokens.accent only.\n";
impl_p += "FORBIDDEN: FocusBand rewrite, Settings restructure, BottomBar re-enable, ontology rename, hex migration campaign, emoji/type polish pass, companion/WS/Trust changes.\n";
impl_p += "Use Read/Grep before edit. After edits, run a quick rg check that 底栏更多 is gone from StatusRail when strip is off.\n";
impl_p += "Return structured: done, summary, files_changed, w1/w2/w3 one-line each, notes.\n";

let impl = agent(impl_p, #{
    label: "impl-w123",
    capability_mode: "all",
    output_schema: impl_schema,
});

if impl == () || !impl.success {
    complete(#{ summary: "Implement agent failed", done: false, impl: impl });
}

log("Implement: " + impl.output.summary);

phase("Verify");
let ver_p = "";
ver_p += "Verify CONDITIONAL GO acceptance A1-A5 for Side Panel design debt W1-W3. READ-ONLY except running tests.\n";
ver_p += "Repo: /Users/huchen/Projects/cmspark\n";
ver_p += "SoT: " + sot + "\n";
ver_p += "Impl claimed files: use git status / git diff. Spot-check:\n";
ver_p += "A1: rg StatusRail for 底栏更多 — must not teach bottom-bar when ui.bottomBarStrip false.\n";
ver_p += "A2: empty/guidance paths use textSecondary (policy B); ChatView emptyKicker included.\n";
ver_p += "A3: docs/DESIGN.md color table + Message Bubbles not contradicting tokens.ts (role→token preferred).\n";
ver_p += "A4: no FocusBand architecture rewrite, no Settings restructure, no bottomBarStrip true, no ontology rename, no mass hex migration.\n";
ver_p += "A5: run npm --prefix chrome-extension test (or scoped if suite too long) and report pass/fail.\n";
ver_p += "Set pass=true only if A1-A4 true and A5 true (or A5 true with documented skip only if no test env — prefer run).\n";
ver_p += "blocking: list failures. summary: short.\n";

let ver = agent(ver_p, #{
    label: "verify-a1a5",
    capability_mode: "all",
    output_schema: verify_schema,
});

if ver == () || !ver.success {
    complete(#{
        summary: "Verify agent failed after implement",
        done: impl.output.done,
        impl: impl.output,
        verify: ver,
    });
}

let report = "";
report += "# Sidepanel design debt W1-W3\n\n";
report += "Impl: " + impl.output.summary + "\n";
report += "W1: " + impl.output.w1 + "\n";
report += "W2: " + impl.output.w2 + "\n";
report += "W3: " + impl.output.w3 + "\n";
report += "Verify pass: " + ver.output.pass.to_string() + "\n";
report += "A1-A5: " + ver.output.a1.to_string() + "/" + ver.output.a2.to_string() + "/" + ver.output.a3.to_string() + "/" + ver.output.a4.to_string() + "/" + ver.output.a5.to_string() + "\n";
report += "Verify summary: " + ver.output.summary + "\n";

let path = write_scratch_file("sidepanel-design-debt-w123-report.md", report);

let ok = impl.output.done == true && ver.output.pass == true;
let sum = "W1-W3 landed but acceptance failed";
if ok {
    sum = "W1-W3 landed and verified";
}
complete(#{
    summary: sum,
    done: ok,
    files_changed: impl.output.files_changed,
    verify: ver.output,
    report_path: path,
});
