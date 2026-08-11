// Scheme 1: default sandbox workspace at ~/CMspark-projects (runtime fallback only).
// Does NOT write thread.workspace_root. Explicit folder-picker bind still wins.
//
// Robustness: when agent success=false, host may set output to a plain string.
// Never read .ok / .blockers without type_of(x) == "map" first.

let meta = #{
    name: "default-workspace-sandbox",
    description: "Scheme 1: workspace_* falls back to ~/CMspark-projects when thread.workspace_root unset; no auto-bind",
    when_to_use: "When users hit workspace_root not set for deliverables; want default sandbox without folder-picker",
    phases: [
        #{ title: "Implement", detail: "effectiveWorkspaceRoot + resolveUnderWorkspace fallback + tests" },
        #{ title: "UICopy", detail: "PacksPanel / gate copy / optional SceneStatusBar sandbox hint" },
        #{ title: "Test", detail: "Run companion workspace + project-dir tests" },
        #{ title: "SelfCheck", detail: "Verify scheme-1 invariants against diff" },
    ],
};

fn agent_output_map(r) {
    if r == () { return (); }
    if !r.success { return (); }
    let o = r.output;
    if o == () { return (); }
    if type_of(o) != "map" { return (); }
    o
}

fn agent_fail_reason(r, fallback) {
    if r == () { return fallback + " (null agent result)"; }
    if !r.success {
        let o = r.output;
        if o == () { return fallback + " (success=false, empty output)"; }
        if type_of(o) == "string" { return fallback + ": " + o; }
        if type_of(o) == "map" {
            let bits = fallback;
            if o.summary != () && type_of(o.summary) == "string" {
                bits += ": " + o.summary;
            }
            if o.blockers != () && type_of(o.blockers) == "array" {
                bits += " blockers=" + json_encode(o.blockers);
            }
            return bits;
        }
        return fallback + " (success=false, output type=" + type_of(o) + ")";
    }
    let m = agent_output_map(r);
    if m == () {
        let o = r.output;
        if type_of(o) == "string" { return fallback + ": " + o; }
        return fallback + " (missing map output)";
    }
    if m.ok != true {
        let bits = fallback + " (ok!=true)";
        if m.summary != () && type_of(m.summary) == "string" {
            bits += ": " + m.summary;
        }
        if m.blockers != () && type_of(m.blockers) == "array" {
            bits += " blockers=" + json_encode(m.blockers);
        }
        return bits;
    }
    fallback
}

fn agent_ok(r) {
    let m = agent_output_map(r);
    if m == () { return false; }
    m.ok == true
}

fn agent_summary(r) {
    let m = agent_output_map(r);
    if m == () { return ""; }
    if m.summary != () && type_of(m.summary) == "string" { return m.summary; }
    ""
}

let impl_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary", "blockers"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "maxItems": 24, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "blockers": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
        "notes": #{ "type": "string" },
    },
};

let ui_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary", "blockers"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "maxItems": 16, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "blockers": #{ "type": "array", "maxItems": 12, "items": #{ "type": "string" } },
    },
};

let test_schema = #{
    "type": "object",
    "required": ["ok", "command", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "command": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "failures": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
    },
};

let check_schema = #{
    "type": "object",
    "required": ["ok", "gates_passed", "gates_failed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "gates_passed": #{ "type": "array", "maxItems": 24, "items": #{ "type": "string" } },
        "gates_failed": #{ "type": "array", "maxItems": 24, "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
    },
};

// ---------- Implement core ----------
phase("Implement");

let impl_prompt = "";
impl_prompt += "You implement CMspark Scheme 1: default sandbox workspace for workspace_* tools.\n";
impl_prompt += "Repo: /Users/huchen/Projects/cmspark. Work on current workspace (no new branch required).\n\n";
impl_prompt += "PRODUCT CONTRACT (must not violate):\n";
impl_prompt += "1) When thread.workspace_root is null/empty, workspace_list_dir / workspace_read_file\n";
impl_prompt += "   resolve against ~/CMspark-projects (create dir 0o700 if missing).\n";
impl_prompt += "2) Do NOT write/auto-bind thread.workspace_root. Runtime fallback only.\n";
impl_prompt += "3) When workspace_root IS set, behavior unchanged (explicit picker bind wins).\n";
impl_prompt += "4) Path containment still applies under the effective root (no escape).\n";
impl_prompt += "5) Do NOT change shell_exec cwd defaults to CMspark-projects (shell stays as today).\n";
impl_prompt += "6) Reuse CMSPARK_PROJECTS_DIRNAME / cmsparkProjectsRoot from companion/src/capability/project-dir.ts.\n";
impl_prompt += "7) module gate requireModule('devsec-workspace') still applies before list/read.\n";
impl_prompt += "8) setWorkspaceRoot still requires native folder-picker (consumeNativePick) — do not weaken.\n\n";
impl_prompt += "IMPLEMENT:\n";
impl_prompt += "A) companion/src/capability/workspace.ts\n";
impl_prompt += "   - Import cmsparkProjectsRoot from ./project-dir\n";
impl_prompt += "   - Add ensureDefaultSandboxRoot(home?): returns {ok,path}|{ok:false,error}\n";
impl_prompt += "     * base = cmsparkProjectsRoot(home)\n";
impl_prompt += "     * mkdirSync recursive mode 0o700 if missing\n";
impl_prompt += "     * realpath + must stay under home (containment)\n";
impl_prompt += "   - Add effectiveWorkspaceRoot(workspaceRoot): string | null\n";
impl_prompt += "     * if workspaceRoot non-empty string → return trimmed as-is (resolveUnderWorkspace still validates)\n";
impl_prompt += "     * else → ensureDefaultSandboxRoot path or null on failure\n";
impl_prompt += "   - resolveUnderWorkspace: if !workspaceRoot, use ensureDefaultSandboxRoot() instead of WORKSPACE_ROOT_NOT_SET_ERROR\n";
impl_prompt += "     * Only emit WORKSPACE_ROOT_NOT_SET_ERROR (or clearer sandbox create error) if sandbox ensure fails\n";
impl_prompt += "   - Prefer a distinct error if mkdir fails, e.g. cannot create default sandbox ~/CMspark-projects\n";
impl_prompt += "   - Export ensureDefaultSandboxRoot + effectiveWorkspaceRoot for tests\n\n";
impl_prompt += "B) companion/tests/capability-workspace.test.ts\n";
impl_prompt += "   - This file already sets process.env.HOME = tempHome — use that.\n";
impl_prompt += "   - Test: null workspaceRoot can workspaceListDir('.') under default sandbox (creates CMspark-projects under HOME)\n";
impl_prompt += "   - Test: null workspaceRoot workspaceReadFile after writing a file under sandbox works\n";
impl_prompt += "   - Test: explicit workspace root still preferred over sandbox\n";
impl_prompt += "   - Test: escape ../ still rejected under sandbox fallback\n";
impl_prompt += "   - Test: effectiveWorkspaceRoot(null) returns path ending with CMspark-projects under HOME\n";
impl_prompt += "   - Keep existing tests green\n\n";
impl_prompt += "C) Optionally update companion/src/capability/user-gate-copy.ts only if still referenced\n";
impl_prompt += "   for true failure path (sandbox create fail). Do not force users to pick folder for happy path.\n\n";
impl_prompt += "D) Docs (minimal, only if already touching related files):\n";
impl_prompt += "   - docs/mission-pack-usage.md §3: note default sandbox when unset\n";
impl_prompt += "   Skip large ADR rewrite unless trivial one-liner.\n\n";
impl_prompt += "DO NOT: auto-write workspace_root on threads; change setWorkspaceRoot pick contract;\n";
impl_prompt += "  default shell cwd; expand MCP filesystem allowlist; god-mode bypass.\n";
impl_prompt += "Use search_replace/write. Minimal focused changes.\n";
impl_prompt += "ok=true only if code is compile-ready and tests added. List files_changed.\n";
impl_prompt += "If already implemented, verify against contract and report without rewrite.\n";

let impl = agent(impl_prompt, #{
    label: "impl:sandbox",
    capability_mode: "all",
    output_schema: impl_schema,
});

if !agent_ok(impl) {
    pause("verification", agent_fail_reason(impl, "Implement agent failed or ok=false"));
}
log("Implement: " + agent_summary(impl));

// ---------- UI / copy ----------
phase("UICopy");

let ui_prompt = "";
ui_prompt += "You update CMspark UI/copy for Scheme 1 default sandbox. Repo: /Users/huchen/Projects/cmspark.\n\n";
ui_prompt += "READ first: companion/src/capability/workspace.ts (confirm effectiveWorkspaceRoot exists).\n";
ui_prompt += "If core is missing, set ok=false and blockers — do not invent UI without backend.\n\n";
ui_prompt += "UI REQUIREMENTS:\n";
ui_prompt += "1) chrome-extension/src/sidepanel/components/PacksPanel.tsx\n";
ui_prompt += "   - When workspaceRoot missing, show something like:\n";
ui_prompt += "     工作区：默认沙箱 ~/CMspark-projects（可绑定真实项目）\n";
ui_prompt += "     instead of only 工作区：未选择\n";
ui_prompt += "   - Keep 选择工作区 button; clear button only when explicit workspaceRoot set.\n";
ui_prompt += "2) chrome-extension/src/sidepanel/components/SceneStatusBar.tsx (optional but preferred):\n";
ui_prompt += "   - When no explicit workspaceRoot, may still hide chip OR show soft '默认沙箱' without Clear\n";
ui_prompt += "     Prefer: do NOT show Clear for default sandbox. If showing chip, open scenes on click.\n";
ui_prompt += "3) chrome-extension/src/sidepanel/utils/gate-error-copy.ts + companion user-gate-copy:\n";
ui_prompt += "   - Soften copy: happy path no longer needs pick; only create-fail / module_disabled still gate.\n";
ui_prompt += "   - Keep machine tokens for classifyError recoverability if error strings remain.\n";
ui_prompt += "4) docs/mission-pack-usage.md §3 one short paragraph on default sandbox.\n\n";
ui_prompt += "Minimal diffs. ok=true when UX matches. files_changed list.\n";

let ui = agent(ui_prompt, #{
    label: "impl:ui-copy",
    capability_mode: "all",
    output_schema: ui_schema,
});

if !agent_ok(ui) {
    pause("verification", agent_fail_reason(ui, "UI/copy agent failed or ok=false"));
}
log("UICopy: " + agent_summary(ui));

// ---------- Test ----------
phase("Test");

let test_prompt = "";
test_prompt += "Run CMspark companion tests for workspace sandbox Scheme 1.\n";
test_prompt += "Repo: /Users/huchen/Projects/cmspark.\n";
test_prompt += "Commands (prefer npm --prefix companion test with file filter if supported):\n";
test_prompt += "  cd companion && npx tsx --test tests/capability-workspace.test.ts tests/project-dir.test.ts\n";
test_prompt += "If path differs, discover via package.json scripts and run equivalent.\n";
test_prompt += "Also run security-thread test snippet if WORKSPACE_ROOT errors changed:\n";
test_prompt += "  npx tsx --test tests/security-thread.test.ts\n";
test_prompt += "  (ok if only unrelated failures; note them)\n";
test_prompt += "Set ok=true only if capability-workspace + project-dir tests pass.\n";
test_prompt += "Return command used, summary, failures array.\n";

let tests = agent(test_prompt, #{
    label: "test:workspace",
    capability_mode: "execute",
    output_schema: test_schema,
});

if !agent_ok(tests) {
    pause("verification", agent_fail_reason(tests, "Tests failed or ok=false"));
}
log("Test: " + agent_summary(tests));

// ---------- Self-check ----------
phase("SelfCheck");

let check_prompt = "";
check_prompt += "Read-only self-check of Scheme 1 default sandbox. Repo: /Users/huchen/Projects/cmspark.\n";
check_prompt += "Use git diff / read_file / grep. Do NOT edit.\n\n";
check_prompt += "Gates (pass/fail each):\n";
check_prompt += "G1: resolveUnderWorkspace(null, '.') does not hard-fail with pick-folder only; uses CMspark-projects\n";
check_prompt += "G2: no code path auto-assigns thread.workspace_root to default sandbox\n";
check_prompt += "G3: setWorkspaceRoot still requires consumeNativePick\n";
check_prompt += "G4: explicit workspace_root still preferred over sandbox\n";
check_prompt += "G5: path escape under sandbox still rejected\n";
check_prompt += "G6: shell normalizeShellCwd NOT changed to force CMspark-projects\n";
check_prompt += "G7: tests cover null-root list/read + explicit override\n";
check_prompt += "G8: UI no longer only says 未选择 without mentioning default sandbox\n";
check_prompt += "G9: cmsparkProjectsRoot reused (no hard-coded divergent dirname)\n";
check_prompt += "G10: module gate still required for workspace_*\n\n";
check_prompt += "ok=true only if all gates pass. List gates_passed and gates_failed. summary.\n";

let check = agent(check_prompt, #{
    label: "selfcheck:gates",
    capability_mode: "read-only",
    output_schema: check_schema,
});

if !agent_ok(check) {
    pause("verification", agent_fail_reason(check, "SelfCheck failed or ok=false"));
}
log("SelfCheck: " + agent_summary(check));

// ---------- Assemble report ----------
let files = [];
let im = agent_output_map(impl);
if im != () && im.files_changed != () && type_of(im.files_changed) == "array" {
    for f in im.files_changed { files.push(f); }
}
let um = agent_output_map(ui);
if um != () && um.files_changed != () && type_of(um.files_changed) == "array" {
    for f in um.files_changed { files.push(f); }
}

let report = "";
report += "# Default workspace sandbox (Scheme 1)\n\n";
report += "## Implement\n" + agent_summary(impl) + "\n\n";
report += "## UI / copy\n" + agent_summary(ui) + "\n\n";
report += "## Tests\n" + agent_summary(tests) + "\n\n";
report += "## Self-check\n" + agent_summary(check) + "\n\n";
report += "## Files touched\n";
for f in files {
    report += "- " + f + "\n";
}

let report_path = write_scratch_file("default-workspace-sandbox-report.md", report);

complete(#{
    ok: true,
    summary: "Scheme 1 default sandbox implemented and verified",
    report_path: report_path,
    files: files,
    implement: agent_summary(impl),
    tests: agent_summary(tests),
    selfcheck: agent_summary(check),
});
