/**
 * #327 plan_readonly — extension-side differential.
 *
 * The companion allowlist (companion/src/tool/plan-readonly.ts) must deny every
 * tool the extension UI treats as an L2 surface (SURFACE_BY_TOOL — the
 * extension-side single table). Parsing the companion source keeps this a
 * cross-package differential against the REAL SoT: no hand-copied name lists
 * here except parsed from source tables.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SURFACE_BY_TOOL } from "../src/sidepanel/mode/surface-by-tool"

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

function parseCompanionAllowlist(): Set<string> {
  const src = read(join("..", "companion", "src", "tool", "plan-readonly.ts"))
  const start = src.indexOf("PLAN_READONLY_ALLOWED_TOOLS: ReadonlySet<string> = new Set([")
  assert.ok(start > 0, "companion plan-readonly.ts must define PLAN_READONLY_ALLOWED_TOOLS")
  const end = src.indexOf("])", start)
  assert.ok(end > start, "unterminated Set literal")
  const body = src.slice(start, end)
  // strip line comments so commented-out names can never sneak in
  const names = [...body.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1])
  return new Set(names)
}

test("#327 allowlist parses non-trivially from companion source", () => {
  const allow = parseCompanionAllowlist()
  assert.ok(allow.size >= 15, `expected a real allowlist, got ${allow.size}`)
  // core observation tools must be present (parsed, not hand-copied assertion
  // targets — these pin the read-only canon)
  for (const t of ["list_tabs", "screenshot", "get_page_text", "run_progress_propose", "mcp_list_resources"]) {
    assert.ok(allow.has(t), `${t} should be plan-safe`)
  }
})

test("#327 deny ⊇ extension L2 surface column (SURFACE_BY_TOOL, no hand-copied list)", () => {
  const allow = parseCompanionAllowlist()
  const l2 = Object.entries(SURFACE_BY_TOOL)
    .filter(([, lvl]) => lvl === "L2")
    .map(([tool]) => tool)
  assert.ok(l2.length >= 10, "SURFACE_BY_TOOL L2 column unexpectedly small — SoT moved?")
  for (const t of l2) {
    assert.equal(
      allow.has(t),
      false,
      `L2-surface tool ${t} must be denied in plan_readonly`,
    )
  }
})

test("#327 deny ⊇ extension L1 interaction/navigate tools (click/navigate/evaluate family)", () => {
  const allow = parseCompanionAllowlist()
  // pin the L1 column split: page interaction & navigation denied even though
  // they are "just browser" L1 — plan mode is observation-only.
  for (const t of ["click", "dblclick", "type", "fill_form", "select_option", "drag_and_drop",
    "scroll", "scroll_to", "hover", "press_key", "navigate", "create_tab", "set_tab_url",
    "close_tab", "evaluate", "set_cookie", "delete_cookie", "browser_download", "upload_file",
    "analyze_image"]) {
    assert.ok(SURFACE_BY_TOOL[t] === "L1", `test fixture drift: ${t} is no longer L1 in SURFACE_BY_TOOL`)
    assert.equal(allow.has(t), false, `${t} must be denied in plan_readonly`)
  }
})

test("#327 companion pregate actually wires the gate (source pin)", () => {
  const pregate = read(join("..", "companion", "src", "orchestrator", "tool-pregate.ts"))
  assert.match(pregate, /plan-readonly/)
  assert.match(pregate, /resolveEffectiveExecutionPolicy/)
  assert.match(pregate, /planReadonlyBlockedResult/)
  // gate must sit inside the thread block (after the paused check, inside try
  // → fail-closed) and before the isToolAllowed pack gate
  const pausedAt = pregate.indexOf("th?.paused")
  const planAt = pregate.indexOf("const effectivePolicy = resolveEffectiveExecutionPolicy")
  const packAt = pregate.indexOf("threadManager.isToolAllowed")
  assert.ok(pausedAt > 0 && planAt > pausedAt && packAt > planAt, "gate order: paused → plan → pack")
})
