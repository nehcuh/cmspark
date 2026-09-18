/**
 * #502 D-G1 honest status copy after the 100-round cap.
 *
 * Before G1 the cap left loop_state.status === "active" with nothing running, so
 * the status row kept reading 「推进中 N/M」 — a silent stall that claimed to be
 * progressing. After G1 the run is over and (when armed) the next segment is
 * already queued, so the row must say so instead.
 *
 * Priority rule: a pending confirm / blocked item / re-route outranks the
 * round-limit note; terminal success (completed) outranks everything.
 */
import test, { before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { join } from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-round-limit-copy-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let loopStatus: typeof import("../src/loop/loop-status")

before(async () => {
  loopStatus = await import("../src/loop/loop-status")
  const config = await import("../src/config")
  await config.initDataDir()
})

beforeEach(() => {
  // no ThreadManager needed — deriveLoopStatusView is pure
})

function mkLoop(status: import("../src/loop/loop-state").LoopStatus): any {
  return {
    status,
    armed_by: "explicit_command",
    armed_at: new Date().toISOString(),
    started_at_ms: Date.now(),
    wall_clock_ms: 30 * 60_000,
    runs_used: 1,
    tokens_used: 0,
    run_tokens: [],
  }
}

const PROGRESS = {
  items: [
    { id: "a", text: "打开页面", source: "seed", done: true, tool: "navigate" },
    { id: "b", text: "提交", source: "seed", done: false, tool: "click" },
  ],
}
const NO_IMPOSSIBLE = { items: [] } as any

function derive(over: Partial<Parameters<typeof loopStatus.deriveLoopStatusView>[0]> = {}) {
  return loopStatus.deriveLoopStatusView({
    loopState: mkLoop("active"),
    runProgress: PROGRESS as any,
    pendingSteers: [],
    impossible: NO_IMPOSSIBLE,
    pendingConfirms: 0,
    tier: "off",
    ...over,
  })
}

// --- the G1 fix ---

test("round_limit: active loop no longer claims 推进中", () => {
  const v = derive({ lastTerminal: "round_limit" })!
  assert.equal(v.label.includes("推进中"), false, `label still claims progress: ${v.label}`)
  assert.equal(v.label.includes("这一段"), true, `label must name the run boundary: ${v.label}`)
  // phase stays "advancing" on purpose: the extension renders phase verbatim and
  // a new enum value would be a protocol change beyond G1's blast radius.
  assert.equal(v.phase, "advancing")
  assert.equal(v.status, "active")
  assert.equal(v.done, 1)
  assert.equal(v.total, 2)
})

test("regression: a normal run end still reads 推进中 N/M", () => {
  assert.equal(derive({ lastTerminal: null })!.label, "推进中 1/2")
  assert.equal(derive({ lastTerminal: undefined })!.label, "推进中 1/2")
  assert.equal(derive()!.label, "推进中 1/2")
})

test("regression: other terminals do not get the round-limit copy", () => {
  for (const t of ["circuit_breaker", "error", "aborted", "security_halt"] as const) {
    const v = derive({ lastTerminal: t as any })!
    assert.equal(
      v.label.includes("这一段"),
      false,
      `terminal ${t} must not show the round-limit copy: ${v.label}`,
    )
  }
})

// --- priority: round_limit never outranks a real blocker ---

test("round_limit does not mask a pending confirm", () => {
  const v = derive({ lastTerminal: "round_limit", pendingConfirms: 1 })!
  assert.equal(v.phase, "awaiting_confirm")
  assert.equal(v.label, "等待确认")
})

test("round_limit does not mask a route re-plan (pending steers)", () => {
  const v = derive({
    lastTerminal: "round_limit",
    pendingSteers: [{ target: "host_computer" } as any],
  })!
  assert.equal(v.phase, "rerouting")
  assert.equal(v.label, "换路中")
})

test("round_limit does not mask an impossible report", () => {
  const v = derive({
    lastTerminal: "round_limit",
    impossible: {
      items: [{ item_id: "x", blocker_class: "external-wall", unlock: { action: "external-wait", detail: "d" } }],
    } as any,
  })!
  assert.equal(v.phase, "blocked")
})

test("terminal success outranks round_limit", () => {
  const v = derive({ loopState: mkLoop("completed"), lastTerminal: "round_limit" })!
  assert.equal(v.phase, "done")
  assert.equal(v.label, "计划完成，待你确认")
})

// --- source lock: the tombstone copy must never reach the status row ---

test("status copy sources carry no tombstone string", () => {
  const files = [
    join(process.cwd(), "src/loop/loop-status.ts"),
    join(process.cwd(), "../chrome-extension/src/sidepanel/components/LoopStatusRow.tsx"),
  ]
  for (const f of files) {
    const src = readFileSync(f, "utf8")
    assert.doesNotMatch(src, /最大工具调用轮次/, `${f} reintroduced the tombstone copy`)
  }
})
