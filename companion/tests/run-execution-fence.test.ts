import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"

const root = mkdtempSync(join(tmpdir(), "cmspark-run-execution-fence-"))
const previousDataDir = process.env.CMSPARK_DATA_DIR
process.env.CMSPARK_DATA_DIR = root
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let chatCreate: typeof import("../src/llm/adapter").chatCreate
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let Provider: typeof import("../src/llm/providers/openai").OpenAIProvider
let plans: typeof import("../src/orchestrator/cooperation-plan")
let state: typeof import("../src/orchestrator/cooperation-state")
let superviseFleet: typeof import("../src/orchestrator/fleet-supervision").superviseFleet
let collect: typeof import("../src/board/service").collectWorkerHandback
let originalStream: InstanceType<typeof Provider>["streamChat"]

before(async () => {
  await (await import("../src/config")).initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  chatCreate = (await import("../src/llm/adapter")).chatCreate
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  Provider = (await import("../src/llm/providers/openai")).OpenAIProvider
  plans = await import("../src/orchestrator/cooperation-plan")
  state = await import("../src/orchestrator/cooperation-state")
  superviseFleet = (await import("../src/orchestrator/fleet-supervision")).superviseFleet
  collect = (await import("../src/board/service")).collectWorkerHandback
  originalStream = Provider.prototype.streamChat
  Provider.prototype.streamChat = async function* () {
    yield { type: "token", text: "Report establishes the required coverage." }
    yield { type: "done", finish_reason: "stop" }
  }
})
after(() => {
  if (originalStream) Provider.prototype.streamChat = originalStream
  if (previousDataDir === undefined) delete process.env.CMSPARK_DATA_DIR
  else process.env.CMSPARK_DATA_DIR = previousDataDir
  rmSync(root, { recursive: true, force: true })
})

const llm = { base_url: "http://localhost:9999", api_key: "fixture", model_name: "fixture-model", temperature: 0, context_window: 8000 }

test("real chatCreate persists a new execution before await; crashed rerun cannot reuse accepted reports after restart", async () => {
  const tm = new ThreadManager(), parent = tm.create("fence parent"), worker = tm.create("fence worker")
  tm.update(parent.id, { orchestrator_run_id: "execution-fence-run" })
  tm.update(worker.id, { parent_thread_id: parent.id, agent_role: "worker", orchestrator_run_id: "execution-fence-run", tool_whitelist: [] })
  const task = { id: "a", goal: "Establish coverage", criteria: [{ id: "coverage", description: "Establish the required coverage" }] }
  const plan = plans.createCooperationPlan(tm, parent.id, { tasks: [task, { ...task, id: "b", depends_on: ["a"] }] })
  plans.bindPlannedWorker(tm, parent.id, { plan_id: plan.id, plan_task_id: "a", plan_task_attempt: 1, goal: task.goal }, worker.id, () => false)
  const run = () => chatCreate({ threadId: worker.id, message: "produce report", skillIds: [], config: llm,
    threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 },
    sendToExtension: () => {}, executeTool: async () => ({ success: true }),
  } as any)
  await run()
  const settled = new ThreadManager().get(worker.id)!
  assert.ok(settled.last_run_execution_id)
  assert.equal(settled.last_run_settled_execution_id, settled.last_run_execution_id)
  const read = await collect(tm, { workerId: worker.id, callerThreadId: parent.id, isThreadLlmActive: () => false })
  assert.equal(read.success, true, JSON.stringify(read))
  const result = read.data!.task_result!
  assert.equal(result.status, "completed")
  assert.equal(result.source.execution_id, settled.last_run_execution_id)
  plans.reviewCooperationTask(tm, parent.id, { plan_id: plan.id, task_id: "a", source_version: result.source.version,
    criteria: [{ id: "coverage", passed: true, reason: "Report establishes coverage", refs: [`source:${result.source.version}`] }], conflicts: [] }, () => false)
  assert.equal(plans.cooperationPlanSnapshot(tm, parent.id, () => false)!.tasks[0].accepted, true)
  const supervise = (manager: InstanceType<typeof ThreadManager>, calls: string[]) => superviseFleet({
    tm: manager, parentId: parent.id, isActive: () => false, pollMs: 1, timeoutMs: 100,
    collect: async id => { calls.push(id); return collect(manager, { workerId: id, callerThreadId: parent.id, isThreadLlmActive: () => false }) },
  })
  const initialCalls: string[] = []
  assert.equal((await supervise(tm, initialCalls))[0].status, "completed")
  assert.deepEqual(initialCalls, [worker.id])
  assert.deepEqual(await supervise(tm, initialCalls), [], "settled epoch is collected only once")

  // A fresh daemon process starts the *same* worker, then dies while its real
  // adapter awaits the provider. No model, terminal or external network is used.
  const script = `
    const {ThreadManager}=require(${JSON.stringify(require.resolve("../src/threads/thread-manager"))});
    const {SkillEngine}=require(${JSON.stringify(require.resolve("../src/skills/skill-engine"))});
    const {OpenAIProvider}=require(${JSON.stringify(require.resolve("../src/llm/providers/openai"))});
    OpenAIProvider.prototype.streamChat=async function*(){process.stdout.write('rerun-blocked\\n');await new Promise(()=>{})};
    const {chatCreate}=require(${JSON.stringify(require.resolve("../src/llm/adapter"))});
    setInterval(()=>{},1000);
    chatCreate({threadId:${JSON.stringify(worker.id)},message:'rerun before crash',skillIds:[],config:${JSON.stringify(llm)},
      threadManager:new ThreadManager(),skillEngine:new SkillEngine(),historyStore:{record:()=>0},sendToExtension:()=>{},executeTool:async()=>({success:true})})
      .catch(e=>{console.error(e);process.exit(1)});
  `
  const child = spawn(process.execPath, ["-e", script], { env: { ...process.env, CMSPARK_DATA_DIR: root }, stdio: ["ignore", "pipe", "pipe"] })
  let stderr = ""
  child.stderr.on("data", chunk => { stderr += String(chunk) })
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`rerun did not reach provider await: ${stderr}`)), 10000)
      let output = ""
      child.stdout.on("data", chunk => {
        output += String(chunk)
        if (output.includes("rerun-blocked\n")) { clearTimeout(timeout); resolve() }
      })
      child.once("error", err => { clearTimeout(timeout); reject(err) })
      child.once("exit", code => { clearTimeout(timeout); reject(new Error(`rerun exited early ${code}: ${stderr}`)) })
    })
  } finally {
    child.kill("SIGKILL")
    await new Promise<void>(resolve => child.once("close", () => resolve()))
  }
  const restarted = new ThreadManager(), interrupted = { ...restarted.get(worker.id)! }
  assert.notEqual(interrupted.last_run_execution_id, settled.last_run_execution_id)
  assert.equal(interrupted.last_run_settled_execution_id, settled.last_run_execution_id)
  assert.equal(interrupted.last_run_ended_at, settled.last_run_ended_at, "old completion timestamp still exists; execution fence must invalidate it")
  const snapshot = plans.cooperationPlanSnapshot(restarted, parent.id, () => false)!
  assert.equal(snapshot.tasks[0].runtime_status, "interrupted")
  assert.equal(snapshot.tasks[0].accepted, false)
  assert.deepEqual(snapshot.tasks[1].blocked_by, ["a"])
  const cached = state.cooperationSnapshot(restarted, parent.id, { isActive: () => false })
  assert.equal(cached.tasks.find(t => t.source.thread_id === worker.id)!.status, "stale", "unified status cannot advertise the cached old report as completed")
  assert.throws(() => plans.reviewCooperationTask(restarted, parent.id, { plan_id: plan.id, task_id: "a", source_version: result.source.version,
    criteria: [{ id: "coverage", passed: true, reason: "reuse old report", refs: [`source:${result.source.version}`] }], conflicts: [] }, () => false))
  const recollect = await collect(restarted, { workerId: worker.id, callerThreadId: parent.id, isThreadLlmActive: () => false })
  assert.equal(recollect.success, false)
  assert.equal(recollect.error_code, "COOPERATION_INTERRUPTED")
  assert.equal(recollect.data!.task_result!.status, "stale")
  assert.notEqual(recollect.data!.task_result!.status, "completed")
  const interruptedCalls: string[] = []
  const supervisedCrash = await supervise(restarted, interruptedCalls)
  assert.deepEqual(interruptedCalls, [worker.id], "new execution cannot be skipped using the old completed supervision epoch")
  assert.equal(supervisedCrash[0].status, "interrupted")
  assert.deepEqual(await supervise(restarted, interruptedCalls), [], "same stable interruption is disclosed once")

  // Recovery is a new real execution, and normal completion settles its own id.
  await chatCreate({ threadId: worker.id, message: "recover interrupted run", skillIds: [], config: llm,
    threadManager: restarted, skillEngine: new SkillEngine(), historyStore: { record: () => 0 },
    sendToExtension: () => {}, executeTool: async () => ({ success: true }),
  } as any)
  const recovered = new ThreadManager().get(worker.id)!
  assert.notEqual(recovered.last_run_execution_id, interrupted.last_run_execution_id)
  assert.equal(recovered.last_run_execution_id, recovered.last_run_settled_execution_id)
  const newRead = await collect(new ThreadManager(), { workerId: worker.id, callerThreadId: parent.id, isThreadLlmActive: () => false })
  assert.equal(newRead.success, true)
  assert.equal(newRead.data!.task_result!.status, "completed")
  assert.notEqual(newRead.data!.task_result!.source.version, result.source.version)
  const recoveryCalls: string[] = []
  assert.equal((await supervise(new ThreadManager(), recoveryCalls))[0].status, "completed")
  assert.deepEqual(recoveryCalls, [worker.id], "a settled recovery gets its own supervision epoch")
})
