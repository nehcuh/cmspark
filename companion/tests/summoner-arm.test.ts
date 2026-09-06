// #433 P3：summoner 开放 task_loop.arm — 三重闸逐条（spec §3c）。
// 租约 = overlay 持有 composer lease；面板/tray 面无租约门。
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-arm-summoner-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let handleMessage: typeof import("../src/message-router").handleMessage
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let config: typeof import("../src/config")
let composerLeases: typeof import("../src/ws/composer-lease").composerLeases
let assertSummonerAllowed: typeof import("../src/ws/summoner-acl").assertSummonerAllowed
let applySummonerPayloadPolicy: typeof import("../src/ws/summoner-acl").applySummonerPayloadPolicy

let seq = 0
function tid(prefix: string): string {
  seq += 1
  return `arm-${prefix}-${Date.now().toString(36)}-${seq}`
}

function makeSession(sent: any[] = []) {
  return {
    sendToExtension: (d: any) => void sent.push(d),
    broadcast: () => {},
  } as any
}

before(async () => {
  handleMessage = (await import("../src/message-router")).handleMessage
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  config = await import("../src/config")
  composerLeases = (await import("../src/ws/composer-lease")).composerLeases
  const acl = await import("../src/ws/summoner-acl")
  assertSummonerAllowed = acl.assertSummonerAllowed
  applySummonerPayloadPolicy = acl.applySummonerPayloadPolicy
  await config.initDataDir()
  config.saveConfig({
    llm: {
      base_url: "http://127.0.0.1:9",
      api_key: "sk-test",
      model_name: "x",
      temperature: 0.2,
      context_window: 512000,
    },
  })
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function newManager(): InstanceType<typeof ThreadManager> {
  return new ThreadManager()
}

test("ACL：summoner 放行 task_loop.arm；stop/其它保持拒", () => {
  assert.deepEqual(assertSummonerAllowed("summoner", "task_loop.arm"), { ok: true })
  assert.equal(assertSummonerAllowed("summoner", "task_loop.stop").ok, false)
  // P2（#433 控制面）已把 execution_policy.set 放进 allowlist，payload 门只许降档：
  // allowlist 层放行，payload 层升档（非 plan_readonly）拒、降档放行。
  assert.equal(assertSummonerAllowed("summoner", "thread.execution_policy.set").ok, true)
  assert.equal(
    applySummonerPayloadPolicy("summoner", { type: "thread.execution_policy.set", thread_id: "t", policy: "default" }).ok,
    false,
  )
  assert.equal(
    applySummonerPayloadPolicy("summoner", { type: "thread.execution_policy.set", thread_id: "t", policy: "plan_readonly", user_gesture: true }).ok,
    true,
  )
})

test("闸①：summoner arm 缺 user_gesture → 拒（即使租约在）", async () => {
  const tm = newManager()
  const thread = tm.create("", tid("nogesture"))
  composerLeases.claim({ thread_id: thread.id, holder: "overlay", rev: 0 })
  const r = await handleMessage(
    { type: "task_loop.arm", thread_id: thread.id, __cmspark_surface: "summoner" },
    { threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any } as any,
    makeSession(),
  )
  assert.equal((r as any).type, "error")
  assert.match(String((r as any).error), /user_gesture/)
})

test("闸②：summoner arm 目标线程非 overlay 持有 lease → OVERLAY_THREAD_MISMATCH", async () => {
  const tm = newManager()
  const thread = tm.create("", tid("nolease"))
  const r = await handleMessage(
    { type: "task_loop.arm", thread_id: thread.id, user_gesture: true, __cmspark_surface: "summoner" },
    { threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any } as any,
    makeSession(),
  )
  assert.equal((r as any).error_code, "OVERLAY_THREAD_MISMATCH")
})

test("三重闸齐 + 默认档：overlay 持有 lease + user_gesture → arm 成功", async () => {
  const tm = newManager()
  const thread = tm.create("", tid("ok"))
  composerLeases.claim({ thread_id: thread.id, holder: "overlay", rev: 0 })
  const r = await handleMessage(
    { type: "task_loop.arm", thread_id: thread.id, user_gesture: true, __cmspark_surface: "summoner" },
    { threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any } as any,
    makeSession(),
  )
  assert.equal((r as any).type, "task_loop.armed", JSON.stringify(r))
})

test("闸③：plan_readonly 线程 summoner arm → loop_off（armLoop 单一收口拒绝）", async () => {
  const tm = newManager()
  const thread = tm.create("", tid("plan"))
  tm.update(thread.id, { execution_policy: "plan_readonly" } as any)
  composerLeases.claim({ thread_id: thread.id, holder: "overlay", rev: 0 })
  const r = await handleMessage(
    { type: "task_loop.arm", thread_id: thread.id, user_gesture: true, __cmspark_surface: "summoner" },
    { threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any } as any,
    makeSession(),
  )
  assert.equal((r as any).code, "loop_off")
})

test("面板/tray 面不引入租约门：非 summoner 无 lease 也可 arm（回归）", async () => {
  const tm = newManager()
  const thread = tm.create("", tid("panel"))
  // 无 summoner stamp（默认非 summoner）→ 不套租约门
  const r = await handleMessage(
    { type: "task_loop.arm", thread_id: thread.id, user_gesture: true },
    { threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any } as any,
    makeSession(),
  )
  assert.equal((r as any).type, "task_loop.armed", JSON.stringify(r))
})

test("L2 导流维持：arm 请求不返回确认给 overlay（无新确认面）", async () => {
  // arm 成功帧不含 confirmation；确认仍走既有 L2 fan-out（此处不触发 L2）。
  const tm = newManager()
  const thread = tm.create("", tid("l2"))
  composerLeases.claim({ thread_id: thread.id, holder: "overlay", rev: 0 })
  const sent: any[] = []
  const r = await handleMessage(
    { type: "task_loop.arm", thread_id: thread.id, user_gesture: true, __cmspark_surface: "summoner" },
    { threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any } as any,
    makeSession(sent),
  )
  assert.equal((r as any).type, "task_loop.armed")
  assert.ok(!sent.some((m) => String(m?.type).includes("security.confirmation")), "无 overlay 确认帧")
})
