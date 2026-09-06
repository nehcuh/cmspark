/**
 * L-4 (#390) 巡航档位绑定 + loop UI — acceptance tests.
 *
 *  - 零新 enum：deriveAutopilotTier/deriveDisplayTier 六档真值表 + 档位绑定
 *    只读既有 config key（LOOP_TIER_CONFIG_KEYS 钉死，无新档位 key）
 *  - 档表帽路线扇出真值表：off/full+/值守/自定义 host 面按 coordinateEnabled；
 *    browser 仅 L1 面（CU 已武装也被表帽）
 *  - closeRouteRun browser 档 blocked：unlock 文案指路「升档」+ 审计 r3-tier-capped
 *  - plan_readonly=loop_off：armLoop 单一收口拒绝（null + task_loop.arm_denied
 *    审计 + 不写 loop_state）
 *  - deriveLoopStatusView 全相位非空（#356 教训）+ done 永不「任务已完成」
 *    （#397 MAJOR-2 machine-tier 承接）+ task_loop.status 帧 shape
 */
import test, { before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-loop-tier-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

type AuditEvent = { type: string; [k: string]: unknown }
let audits: AuditEvent[]
const auditSink = (e: AuditEvent) => {
  audits.push(e)
}

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let kernel: typeof import("../src/loop/loop-kernel")
let tierBind: typeof import("../src/loop/tier-bind")
let autopilot: typeof import("../src/security/autopilot-tier")
let loopStatus: typeof import("../src/loop/loop-status")
let routeEngine: typeof import("../src/loop/route-engine")
let loopStateMod: typeof import("../src/loop/loop-state")

let tm: InstanceType<typeof ThreadManager>
let seq = 0

before(async () => {
  const tmm = await import("../src/threads/thread-manager")
  ThreadManager = tmm.ThreadManager
  kernel = await import("../src/loop/loop-kernel")
  tierBind = await import("../src/loop/tier-bind")
  autopilot = await import("../src/security/autopilot-tier")
  loopStatus = await import("../src/loop/loop-status")
  routeEngine = await import("../src/loop/route-engine")
  loopStateMod = await import("../src/loop/loop-state")
  const config = await import("../src/config")
  await config.initDataDir()
})

beforeEach(() => {
  tm = new ThreadManager()
  audits = []
  seq++
})

// --- 零新 enum：六档真值表 ---

test("deriveAutopilotTier 六档真值表（#390 零新 enum — bool 仍是 SoT）", () => {
  const { deriveAutopilotTier, deriveDisplayTier } = autopilot
  assert.equal(deriveAutopilotTier({}), "off")
  assert.equal(deriveAutopilotTier({ auto_approve_dangerous: true }), "browser")
  assert.equal(
    deriveAutopilotTier({ auto_approve_dangerous: true, auto_approve_enterprise_tools: true }),
    "full",
  )
  assert.equal(
    deriveAutopilotTier({
      auto_approve_dangerous: true,
      auto_approve_enterprise_tools: true,
      allow_all_schemes: true,
    }),
    "full_protocol",
  )
  // 非显式武装组合 → custom（不发明新档）
  assert.equal(deriveAutopilotTier({ auto_approve_enterprise_tools: true }), "custom")
  assert.equal(deriveAutopilotTier({ allow_all_schemes: true }), "custom")
  assert.equal(
    deriveAutopilotTier({ auto_approve_dangerous: true, allow_all_schemes: true }),
    "custom",
  )
  // 值守 override
  assert.equal(deriveDisplayTier({}, true), "unattended")
  assert.equal(deriveDisplayTier({ auto_approve_dangerous: true }, false), "browser")
})

test("档位绑定零新 config key：LOOP_TIER_CONFIG_KEYS 只读既有 key，源码无 tier 写入", () => {
  const keys = [...tierBind.LOOP_TIER_CONFIG_KEYS].sort()
  assert.deepEqual(keys, [
    "computer.coordinateEnabled",
    "security.allow_all_schemes",
    "security.auto_approve_dangerous",
    "security.auto_approve_enterprise_tools",
  ])
  // 每个 leaf 都是该 PR 之前就存在的 config 字段（config.ts 内声明）
  const configSrc = fs.readFileSync(
    path.join(process.cwd(), "src", "config.ts"),
    "utf8",
  )
  for (const leaf of [
    "auto_approve_dangerous",
    "auto_approve_enterprise_tools",
    "allow_all_schemes",
    "coordinateEnabled",
  ]) {
    assert.ok(configSrc.includes(leaf), `config.ts 必须已有 ${leaf}（不是新 key）`)
  }
  // tier-bind 是只读视图：模块里没有配置写入
  const tierSrc = fs.readFileSync(
    path.join(process.cwd(), "src", "loop", "tier-bind.ts"),
    "utf8",
  )
  assert.ok(!/saveConfig|writeFile/.test(tierSrc), "档位绑定绝不写配置（loop 不替你升档）")
})

// --- 档表帽路线扇出真值表 ---

test("routeCapsFromFlags：browser 仅 L1 面（CU 已武装也被表帽）；off/full+/值守/自定义按 coordinateEnabled", () => {
  const f = tierBind.routeCapsFromFlags

  // off（每次确认）：已激活也续跑，host 面 iff coordinateEnabled（linux：CU 永不可用）
  const hostCu = process.platform !== "linux"
  assert.deepEqual(f({}, { coordinateEnabled: true, unattendedArmed: false }), {
    cuArmed: hostCu,
    osascriptAvailable: f({}, { coordinateEnabled: true, unattendedArmed: false }).osascriptAvailable,
    r3CapReason: null,
    tier: "off",
  })
  assert.equal(f({}, { coordinateEnabled: false, unattendedArmed: false }).cuArmed, false)
  assert.equal(f({}, { coordinateEnabled: false, unattendedArmed: false }).r3CapReason, null, "off 档的 cap 原因不是 tier")

  // browser（仅 L1 面）：coordinateEnabled=true 也进不了 host 面
  const browser = f({ auto_approve_dangerous: true }, { coordinateEnabled: true, unattendedArmed: false })
  assert.equal(browser.tier, "browser")
  assert.equal(browser.cuArmed, false, "browser 档表帽 host 面（即使 CU 已武装）")
  assert.equal(browser.osascriptAvailable, false)
  assert.equal(browser.r3CapReason, "browser-tier")

  // full / full_protocol（已武装面）：host iff coordinateEnabled（且非 linux）
  const fullFlags = { auto_approve_dangerous: true, auto_approve_enterprise_tools: true } as const
  assert.equal(f(fullFlags, { coordinateEnabled: true, unattendedArmed: false }).cuArmed, hostCu)
  assert.equal(f(fullFlags, { coordinateEnabled: false, unattendedArmed: false }).cuArmed, false)
  assert.equal(
    f(fullFlags, { coordinateEnabled: true, unattendedArmed: false }).r3CapReason,
    null,
  )
  const fpFlags = { ...fullFlags, allow_all_schemes: true }
  assert.equal(f(fpFlags, { coordinateEnabled: true, unattendedArmed: false }).tier, "full_protocol")
  assert.equal(f(fpFlags, { coordinateEnabled: true, unattendedArmed: false }).cuArmed, hostCu)

  // 值守（L-5 前同 full+）
  const unattended = f({}, { coordinateEnabled: true, unattendedArmed: true })
  assert.equal(unattended.tier, "unattended")
  assert.equal(unattended.cuArmed, hostCu)
  assert.equal(unattended.r3CapReason, null)

  // custom（非显式武装组合，同 off — least surprise）
  const custom = f({ auto_approve_enterprise_tools: true }, { coordinateEnabled: true, unattendedArmed: false })
  assert.equal(custom.tier, "custom")
  assert.equal(custom.cuArmed, hostCu)
})

test("#417: routeCapsFromFlags cuArmed is false on linux even when coordinateEnabled", () => {
  const f = tierBind.routeCapsFromFlags
  const caps = f(
    { auto_approve_dangerous: true, auto_approve_enterprise_tools: true },
    { coordinateEnabled: true, unattendedArmed: false },
  )
  if (process.platform === "linux") {
    assert.equal(caps.cuArmed, false, "linux has no host_computer surface")
  } else {
    assert.equal(caps.cuArmed, true)
  }
})

test("tierAllowsHostSurface：唯一表帽档是 browser", () => {
  for (const tier of ["off", "full", "full_protocol", "unattended", "custom"] as const) {
    assert.equal(tierBind.tierAllowsHostSurface(tier), true)
  }
  assert.equal(tierBind.tierAllowsHostSurface("browser"), false)
})

// --- closeRouteRun browser 档 blocked ---

test("browser 档 escalation 卡死 → blocked + unlock 指路「升档」+ 审计 r3-tier-capped", () => {
  const { emptyRouteEngineState, beginRouteRun, closeRouteRun, noteTool } = routeEngine
  const progress = {
    items: [{ id: "live:0", text: "提交表单", source: "seed" as const, done: false, tool: "click" }],
  }
  // 用真实档位绑定输出（browser 档 ⇒ cuArmed=false + r3CapReason=browser-tier）
  const caps = tierBind.routeCapsFromFlags(
    { auto_approve_dangerous: true },
    { coordinateEnabled: true, unattendedArmed: false },
  )
  assert.equal(caps.tier, "browser")
  assert.equal(caps.cuArmed, false)
  const input = {
    runProgress: progress as any,
    originEscalated: true,
    caps: caps as any,
    hadProgress: false,
  }
  let s = emptyRouteEngineState()
  s = noteTool(beginRouteRun(s, []), "click")
  let r = closeRouteRun(s, input)
  assert.equal(r.pendingSteers.length, 0, "第一轮 stale 不动作")
  s = noteTool(beginRouteRun(r.state, []), "click")
  r = closeRouteRun(s, input)
  // 表帽档：不 steer（不偷偷启用 CU），直接 blocked + 解锁契约
  assert.equal(r.pendingSteers.length, 0, "browser 档不扇出到 host 面")
  const blocked = r.state.items["live:0"]!
  assert.ok(blocked.blocked, "item 落 blocked")
  assert.match(
    blocked.blocked!.unlock.detail,
    /升档/,
    "解锁文案指路升档巡航（loop 不会替你升档）",
  )
  assert.match(blocked.blocked!.unlock.detail, /网页巡航/)
  assert.ok(
    r.audits.some((a) => a.reason === "r3-tier-capped" && a.type === "task_loop.item_blocked"),
    "审计 reason=r3-tier-capped",
  )
  // 对照：unarmed（coordinateEnabled 关）落 r3-unarmed
  const unarmedInput = {
    ...input,
    caps: { cuArmed: false, osascriptAvailable: false, r3CapReason: null } as any,
  }
  let s2 = emptyRouteEngineState()
  s2 = noteTool(beginRouteRun(s2, []), "click")
  let r2 = closeRouteRun(s2, unarmedInput)
  s2 = noteTool(beginRouteRun(r2.state, []), "click")
  r2 = closeRouteRun(s2, unarmedInput)
  assert.ok(
    r2.audits.some((a) => a.reason === "r3-unarmed"),
    "coordinateEnabled 关时仍是 r3-unarmed（两个 cap 原因可区分）",
  )
})

// --- plan_readonly = loop_off ---

test("armLoop 拒绝 plan_readonly 线程：null + task_loop.arm_denied 审计 + 不写 loop_state", () => {
  const tid = tm.create(`plan-readonly-${seq}`).id
  tm.update(tid, { execution_policy: "plan_readonly" } as any)

  const st = kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  assert.equal(st, null, "计划只读线程 loop 永不激活")
  assert.equal(loopStateMod.sanitizeLoopState((tm.get(tid) as any)?.loop_state), null, "loop_state 不落")
  assert.equal(audits.length, 1)
  assert.equal(audits[0]!.type, "task_loop.arm_denied")
  assert.equal(audits[0]!.reason, "plan_readonly")
  assert.equal(audits[0]!.armed_by, "explicit_command")
  // 建议卡手势同样被拒（单一收口）
  audits = []
  assert.equal(kernel.armLoop(tm, tid, "suggestion_card", { audit: auditSink }), null)
  assert.equal(audits[0]!.type, "task_loop.arm_denied")

  // 对照：普通线程照常激活
  const normal = tm.create(`normal-${seq}`).id
  assert.equal(kernel.armLoop(tm, normal, "explicit_command", { audit: auditSink })?.status, "active")
})

test("切到 plan_readonly 停掉进行中的 loop（反向强制）", () => {
  const tid = tm.create(`switch-${seq}`).id
  kernel.armLoop(tm, tid, "explicit_command", { audit: auditSink })
  assert.equal(loopStateMod.sanitizeLoopState((tm.get(tid) as any)?.loop_state)?.status, "active")

  // execution_policy.set → plan_readonly 路径调用的同一 kernel 原语
  const stopped = kernel.markLoopStoppedByUser(tm, tid, "plan_readonly")
  assert.equal(stopped, true)
  assert.equal(
    loopStateMod.sanitizeLoopState((tm.get(tid) as any)?.loop_state)?.status,
    "stopped_user",
  )
})

// --- deriveLoopStatusView 全相位 ---

function mkLoop(status: import("../src/loop/loop-state").LoopStatus): any {
  return { status, armed_by: "explicit_command", armed_at: new Date().toISOString(), started_at_ms: Date.now(), wall_clock_ms: 30 * 60_000, runs_used: 1, tokens_used: 0, run_tokens: [] }
}

const PROGRESS_2_5 = {
  items: [
    { id: "a", text: "打开页面", source: "seed", done: true, tool: "navigate" },
    { id: "b", text: "填表", source: "seed", done: true, tool: "fill_form" },
    { id: "c", text: "提交", source: "seed", done: false, tool: "click" },
    { id: "d", text: "截图", source: "seed", done: false, tool: "screenshot" },
    { id: "e", text: "下载", source: "seed", done: false, tool: "download" },
  ],
}

const NO_IMPOSSIBLE = null

test("deriveLoopStatusView 各态非空（#356）+ done ≠ 任务已完成（#397 MAJOR-2）", () => {
  const d = loopStatus.deriveLoopStatusView

  // 无 loop_state → null（面板静默）
  assert.equal(d({ loopState: null, runProgress: null, pendingSteers: [], impossible: NO_IMPOSSIBLE, pendingConfirms: 0, tier: "off" }), null)

  // 推进中 N/M
  const advancing = d({ loopState: mkLoop("active"), runProgress: PROGRESS_2_5 as any, pendingSteers: [], impossible: NO_IMPOSSIBLE, pendingConfirms: 0, tier: "off" })!
  assert.equal(advancing.phase, "advancing")
  assert.equal(advancing.label, "推进中 2/5")
  assert.equal(advancing.done, 2)
  assert.equal(advancing.total, 5)

  // 换路中
  const rerouting = d({ loopState: mkLoop("active"), runProgress: PROGRESS_2_5 as any, pendingSteers: [{ itemId: "c", itemText: "提交", target: "host_computer", text: "..." } as any], impossible: NO_IMPOSSIBLE, pendingConfirms: 0, tier: "full" })!
  assert.equal(rerouting.phase, "rerouting")
  assert.ok(rerouting.label.length > 0)
  assert.match(rerouting.detail, /host_computer/)

  // 等待确认（广播侧 pendingConfirms>0；扩展端还有本地抬升）
  const awaiting = d({ loopState: mkLoop("active"), runProgress: PROGRESS_2_5 as any, pendingSteers: [], impossible: NO_IMPOSSIBLE, pendingConfirms: 1, tier: "off" })!
  assert.equal(awaiting.phase, "awaiting_confirm")
  assert.equal(awaiting.label, "等待确认")

  // 受阻：原因（active + impossible 非空）
  const impossibleActive = { items: [{ item_id: "c", item_text: "提交", blocker_class: "needs-credential", unlock: { action: "login", detail: "需要登录站点 X" } }] }
  const blocked = d({ loopState: mkLoop("active"), runProgress: PROGRESS_2_5 as any, pendingSteers: [], impossible: impossibleActive as any, pendingConfirms: 0, tier: "browser" })!
  assert.equal(blocked.phase, "blocked")
  assert.match(blocked.label, /受阻：缺钥匙\/登录/)

  // DONE：机器核验 → 计划完成待你确认（永不「任务已完成」）
  const done = d({ loopState: mkLoop("completed"), runProgress: PROGRESS_2_5 as any, pendingSteers: [], impossible: NO_IMPOSSIBLE, pendingConfirms: 0, tier: "off" })!
  assert.equal(done.phase, "done")
  assert.equal(done.label, "计划完成，待你确认")
  assert.match(done.detail, /机器核验/)

  // 无法完成：钥匙清单（终态 + impossible）
  const impossibleTerm = d({ loopState: mkLoop("stopped_no_checklist"), runProgress: PROGRESS_2_5 as any, pendingSteers: [], impossible: impossibleActive as any, pendingConfirms: 0, tier: "off" })!
  assert.equal(impossibleTerm.phase, "impossible")
  assert.equal(impossibleTerm.label, "无法完成：钥匙清单")
  assert.match(impossibleTerm.detail, /需要登录站点 X/)

  // 各终态 stop / halt 非空
  for (const status of ["stopped_budget", "stopped_user"] as const) {
    const v = d({ loopState: mkLoop(status), runProgress: PROGRESS_2_5 as any, pendingSteers: [], impossible: NO_IMPOSSIBLE, pendingConfirms: 0, tier: "off" })!
    assert.equal(v.phase, "stopped")
    assert.ok(v.label.length > 0, `${status} label 非空`)
    assert.ok(v.detail.length > 0, `${status} 指引 re-arm 的 detail 非空`)
  }
  const halt = d({ loopState: mkLoop("halt_security"), runProgress: PROGRESS_2_5 as any, pendingSteers: [], impossible: NO_IMPOSSIBLE, pendingConfirms: 0, tier: "off" })!
  assert.equal(halt.phase, "halt")
  assert.ok(halt.label.length > 0)

  // 全相位永不出「任务已完成」
  const all = [advancing, rerouting, awaiting, blocked, done, impossibleTerm, halt]
  for (const v of all) {
    assert.ok(!v.label.includes("任务已完成"), `${v.phase} label 不得是「任务已完成」`)
    assert.ok(!v.detail.includes("任务已完成"), `${v.phase} detail 不得是「任务已完成」`)
  }
  // 全相位 label 非空
  for (const v of all) assert.ok(v.label.length > 0)

  // 优先级：completed 优先于 impossible
  const doneWithImpossible = d({ loopState: mkLoop("completed"), runProgress: PROGRESS_2_5 as any, pendingSteers: [], impossible: impossibleActive as any, pendingConfirms: 0, tier: "off" })!
  assert.equal(doneWithImpossible.phase, "done")
})

test("推进中 total=0：先要清单（不静默空态）", () => {
  const v = loopStatus.deriveLoopStatusView({
    loopState: mkLoop("active"),
    runProgress: { items: [] },
    pendingSteers: [],
    impossible: NO_IMPOSSIBLE,
    pendingConfirms: 0,
    tier: "off",
  })!
  assert.equal(v.phase, "advancing")
  assert.equal(v.label, "推进中 0/0")
  assert.match(v.detail, /清单/)
})

test("buildTaskLoopStatusFrame：task_loop.status 帧 shape（扩展逐字渲染）", () => {
  const view = loopStatus.deriveLoopStatusView({
    loopState: mkLoop("active"),
    runProgress: PROGRESS_2_5 as any,
    pendingSteers: [],
    impossible: NO_IMPOSSIBLE,
    pendingConfirms: 0,
    tier: "browser",
  })!
  const frame = loopStatus.buildTaskLoopStatusFrame("th1", view)
  assert.deepEqual(frame, {
    type: "task_loop.status",
    thread_id: "th1",
    phase: "advancing",
    label: "推进中 2/5",
    detail: "",
    done: 2,
    total: 5,
    tier: "网页巡航",
    status: "active",
  })
  // tier 字段 = display-tier 中文短标（companion SoT，扩展不复算）
  assert.equal(frame.tier, "网页巡航")
})

test("loopStatusLabelFromStatus：面板重开回填文案", () => {
  assert.equal(loopStatus.loopStatusLabelFromStatus("completed"), "计划完成，待你确认")
  assert.equal(loopStatus.loopStatusLabelFromStatus("stopped_user"), "已停止续跑")
  assert.ok(!loopStatus.loopStatusLabelFromStatus("completed").includes("任务已完成"))
})

test("loopStateFromThread：脏载荷过 sanitize", () => {
  assert.equal(loopStatus.loopStateFromThread(null), null)
  assert.equal(loopStatus.loopStateFromThread({ loop_state: "garbage" }), null)
  assert.equal(loopStatus.loopStateFromThread({ loop_state: { status: "weird" } }), null)
  const sanitized = loopStatus.loopStateFromThread({ loop_state: mkLoop("active") })
  assert.equal(sanitized?.status, "active")
})
