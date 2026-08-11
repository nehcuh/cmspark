let meta = #{
    name: "sidepanel-design-debt-w45",
    description: "W4 density budget measure (+ surgical only if fail) and W5 residual accent hex to tokens after dual-review APPROVE_WITH_NITS",
    when_to_use: "After sidepanel-design-debt-remaining dual-review both approve",
    phases: [
        #{ title: "Implement", detail: "W4 measure doc + W5 hex tokens" },
        #{ title: "Verify", detail: "B1-B6 acceptance + tests" },
    ],
};

let impl_schema = #{
    "type": "object",
    "required": ["done", "summary", "files_changed", "w4", "w5", "density_pass"],
    "properties": #{
        "done": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "w4": #{ "type": "string" },
        "w5": #{ "type": "string" },
        "density_pass": #{ "type": "boolean" },
        "structure_changed": #{ "type": "boolean" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["pass", "b1", "b2", "b3", "b4", "b5", "b6", "blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "b1": #{ "type": "boolean" },
        "b2": #{ "type": "boolean" },
        "b3": #{ "type": "boolean" },
        "b4": #{ "type": "boolean" },
        "b5": #{ "type": "boolean" },
        "b6": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "test_output_tail": #{ "type": "string" },
    },
};

let sot = "docs/superpowers/specs/2026-08-11-sidepanel-design-debt-remaining-w4-hex.md";
let verdict = "docs/audit/reviews/sidepanel-design-debt-remaining-verdict-20260811-170904.json";

phase("Implement");
let impl_p = "";
impl_p += "Implement W4+W5 for CMspark Side Panel design debt remaining batch.\n";
impl_p += "Repo: /Users/huchen/Projects/cmspark\n";
impl_p += "SoT: " + sot + "\n";
impl_p += "Dual-review both APPROVE_WITH_NITS: " + verdict + "\n\n";
impl_p += "W4 REQUIRED:\n";
impl_p += "1. Static density budget at 640px panel height using code constants:\n";
impl_p += "   StatusRail 44, FocusBand max 80, Scene/RunBusy/Worker 28 each when present,\n";
impl_p += "   InputArea min 44 max 120, chips ~30-40. ADD gutter allowance for borders/seams (dual-review N1).\n";
impl_p += "2. Scenarios: L0 idle (no scene/runBusy/worker); worst-case all status bands + FocusBand max + composer realistic.\n";
impl_p += "3. Write docs/audit/reviews/sidepanel-density-budget-20260811.md with numbers, gutters, pass/fail vs 55% and 40%.\n";
impl_p += "4. If BOTH pass: do NOT change FocusBand architecture; structure_changed=false.\n";
impl_p += "5. If worst-case ChatStream <40% OR L0 idle <55%: ONLY surgical hide/dedupe RunBusy when FocusBand already shows equivalent fleet busy. Forbidden: new meta-band, FocusBand priority rewrite, bottomBarStrip true.\n\n";
impl_p += "W5 REQUIRED (hue shift blue→indigo intentional):\n";
impl_p += "- BoardPanel.tsx tool_verified bg #2563eb → tokens.accent\n";
impl_p += "- AppsPanel.tsx color #2563eb → tokens.accentText (text-on-light)\n";
impl_p += "- computer-utils.ts UIA badge #dbeafe → tokens.accentSoft (import tokens if needed)\n";
impl_p += "- Do NOT migrate OCR #e5e7eb or mass grays\n";
impl_p += "- Update DESIGN.md lag note: Board/Apps residual only if still any; drop SettingsIntentBar if clean\n\n";
impl_p += "FORBIDDEN: Settings restructure, ontology rename, polish pass, mass hex campaign.\n";
impl_p += "Use tools to edit. Return done, summary, files_changed, w4, w5, density_pass, structure_changed, notes.\n";

let impl = agent(impl_p, #{
    label: "impl-w45",
    capability_mode: "all",
    output_schema: impl_schema,
});

if impl == () || impl.success != true {
    complete(#{ summary: "Implement failed", done: false, impl: impl });
}

log("Implement: " + impl.output.summary);

phase("Verify");
let ver_p = "";
ver_p += "Verify acceptance B1-B6 for Side Panel W4+W5. Repo /Users/huchen/Projects/cmspark.\n";
ver_p += "SoT: " + sot + "\n";
ver_p += "B1: docs/audit/reviews/sidepanel-density-budget-20260811.md exists with 640px L0+worst-case numbers and pass/fail.\n";
ver_p += "B2: If density_pass, no FocusBand architecture rewrite in git diff; if fail, only surgical dedupe.\n";
ver_p += "B3: rg '#2563eb' chrome-extension/src/sidepanel → 0 code hits.\n";
ver_p += "B4: computer-utils no raw #dbeafe/#2563eb for UIA badge.\n";
ver_p += "B5: bottomBarStrip still false; no Settings rewrite; no ontology rename.\n";
ver_p += "B6: npm --prefix chrome-extension test green; report tail.\n";
ver_p += "pass=true only if all B1-B6 true. List blocking if any.\n";

let ver = agent(ver_p, #{
    label: "verify-b1b6",
    capability_mode: "all",
    output_schema: verify_schema,
});

if ver == () || ver.success != true {
    complete(#{
        summary: "Verify failed after implement",
        done: false,
        impl: impl.output,
        verify: ver,
    });
}

let ok = impl.output.done == true && ver.output.pass == true;
let sum = "W4-W5 landed but acceptance failed";
if ok {
    sum = "W4-W5 landed and verified";
}

let report = "";
report += "# Sidepanel design debt W4-W5\n\n";
report += "Impl: " + impl.output.summary + "\n";
report += "W4: " + impl.output.w4 + "\n";
report += "W5: " + impl.output.w5 + "\n";
report += "density_pass: " + impl.output.density_pass.to_string() + "\n";
report += "Verify: " + ver.output.summary + "\n";
report += "B1-B6: " + ver.output.b1.to_string() + "/" + ver.output.b2.to_string() + "/" + ver.output.b3.to_string() + "/" + ver.output.b4.to_string() + "/" + ver.output.b5.to_string() + "/" + ver.output.b6.to_string() + "\n";

let path = write_scratch_file("sidepanel-design-debt-w45-report.md", report);

complete(#{
    summary: sum,
    done: ok,
    files_changed: impl.output.files_changed,
    density_pass: impl.output.density_pass,
    structure_changed: impl.output.structure_changed,
    verify: ver.output,
    report_path: path,
});
