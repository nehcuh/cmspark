// #569 — worker 终止留痕。
//
// 背景（ibg908 实据）：两个 worker 被**同工具熔断**静默处死，父线程、面板、用户
// 都无法分辨「被处死」与「闲着」—— 因为 runStats.terminal 只活在内存里，回合结束即消失，
// 线程上不留任何痕迹（主 agent 因此只能猜「在等确认中心」，把用户引向了确认台）。
//
// 本文件钉住三件事：
//   ① update() 能把 last_run_terminal / last_run_ended_at 落到 index —— **daemon 重启不丢**
//   ② 三态语义：从未跑过 / 正常跑完（terminal = null）/ 被某 terminal 结束（非 null）
//   ③ 三个 worker 查询工具的返回体确实带上这两个字段（源码守卫，防回归时被删掉）
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { ThreadManager } from "../src/threads/thread-manager"

const ENDED_AT = "2026-09-30T04:40:37.532Z"

/** 每次 `new ThreadManager()` 都从磁盘 index 重新加载 —— 用它模拟 daemon 重启。 */
const fresh = () => new ThreadManager()

test("#569 落盘 last_run_terminal/ended_at，新实例（模拟 daemon 重启）能读回", () => {
  const tm = fresh()
  const t = tm.create("w-569-persist", "t569persist")
  // ① 三态之一：从未跑过 → 两字段都不存在
  assert.equal(t.last_run_terminal, undefined, "从未跑过的线程不该有 terminal")
  assert.equal(t.last_run_ended_at, undefined, "从未跑过的线程不该有 ended_at")

  tm.update("t569persist", { last_run_terminal: "circuit_breaker", last_run_ended_at: ENDED_AT })

  // 模拟 daemon 重启：全新实例从 index 读
  const back = fresh().get("t569persist")
  assert.equal(back?.last_run_terminal, "circuit_breaker", "重启后应能读回死因")
  assert.equal(back?.last_run_ended_at, ENDED_AT, "重启后应能读回结束时刻")
})

test("#569 三态之二：正常跑完 = terminal 为 null 但 ended_at 已设", () => {
  const tm = fresh()
  tm.create("w-569-null", "t569null")
  tm.update("t569null", { last_run_terminal: null, last_run_ended_at: ENDED_AT })
  const back = fresh().get("t569null")
  assert.equal(
    back?.last_run_terminal,
    null,
    "`null` 是「正常跑完」的**合法取值**（RunTerminal 的成员），不是「未知」—— " +
      "读取方必须靠「ended_at 有没有值」区分「没跑过」与「正常跑完」",
  )
  assert.equal(back?.last_run_ended_at, ENDED_AT)
})

test("#569 三个 worker 查询工具都带上这两个字段（源码守卫，防回归删除）", () => {
  // 与 #565 的守卫同款：CWD 可能是 companion/ 或仓库根，两个候选都试。
  const src = ["src/tool/companion-dispatch.ts", "companion/src/tool/companion-dispatch.ts"]
    .map((p) => {
      try {
        return readFileSync(p, "utf8")
      } catch {
        return null
      }
    })
    .find((x) => x !== null)
  assert.ok(src, "找不到 companion-dispatch.ts（请在 companion/ 或仓库根运行）")

  // list_workers / get_worker_status / wait_workers —— 三处返回体各一次
  const term = (src.match(/last_run_terminal:/g) || []).length
  const ended = (src.match(/last_run_ended_at:/g) || []).length
  assert.ok(
    term >= 3,
    `list_workers / get_worker_status / wait_workers 都该带 last_run_terminal，实测 ${term} 处`,
  )
  assert.ok(ended >= 3, `同上，last_run_ended_at 实测 ${ended} 处`)

  // 值必须显式落成 `null` 而不是留着 `undefined` —— 后者会被 JSON 丢掉键，
  // 于是「没跑过」与「正常跑完」在工具返回体里无法区分（评审 claude 的 M3 突变：
  // 把它改成传 undefined，当时的测试全绿）。3 个工具 × 2 字段 = 6 处。
  const covT = src.split("w.last_run_terminal ?? null").length - 1
  const covE = src.split("w.last_run_ended_at ?? null").length - 1
  assert.ok(
    covT >= 3 && covE >= 3,
    `三处返回体都要把两个字段 ?? null 兜成**显式 null**（不是留着 undefined，那会被 JSON 丢键）。` +
      `实测 terminal=${covT} ended_at=${covE}；注意不能按全文件 ?? null 计数（那有 9 处、含无关用途）` ,
  )
})

test("#569 落点在 adapter 的 chatCreate finally —— 唯一覆盖全部 run 路径的位置", () => {
  // ⚠️ 这条断言曾经写成「落点在 message-router」，那是**错的**：评审 claude 证实
  // worker 的 kick 路径（`server.ts:789` 直接 `await chatCreate(...)`）**不经过** router，
  // 放在 router 里对 worker 是 no-op —— 而 #569 要修的恰恰就是 worker。
  // 现在落点在 adapter 自己的 finally：一处覆盖 router(chat.create/regenerate/file.upload)
  // 与 server kick 全部路径。下面的守卫防止它被挪回 router。
  const cwd = ["src/llm/adapter.ts", "companion/src/llm/adapter.ts"]
    .find((p) => { try { readFileSync(p, "utf8"); return true } catch { return false } })
  assert.ok(cwd, "找不到 adapter.ts")
  const adapter = readFileSync(cwd, "utf8")
  assert.ok(adapter.includes("last_run_terminal: runStats.terminal"), "落盘应写本 run 的终值")
  assert.ok(
    adapter.includes("runTerminalEpochIsCurrent(threadId, runEpoch)"),
    "落盘必须先确认本 run 仍是该线程最新一次 chatCreate",
  )
  const fn = adapter.slice(adapter.indexOf("export async function chatCreate"))
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const claimAt = code.indexOf("claimRunTerminalEpoch(threadId)")
  const awaitAt = code.indexOf("await ")
  assert.ok(claimAt >= 0 && awaitAt > claimAt, "epoch 必须在 chatCreate 的第一个 await 之前领走")
  const gateAt = adapter.indexOf("runTerminalEpochIsCurrent(threadId, runEpoch)")
  const writeAt = adapter.indexOf("last_run_terminal: runStats.terminal", gateAt)
  assert.ok(gateAt >= 0 && writeAt > gateAt, "写盘必须出现在 epoch 判断之后")
  assert.equal(
    adapter.slice(gateAt, writeAt).includes("await"),
    false,
    "比较和 update 之间不能有 await，否则后任可以插进来",
  )
  assert.ok(adapter.includes("last_run_ended_at: new Date().toISOString()"), "落盘应写结束时刻")

  // 为什么必须写局部值而不是 `runStats.terminal`：`runStats` 是调用方可选传入的，
  // worker kick 路径不传 —— 只靠它就取不到死因。markTerminal 在**每个**终止点都记一份。
  // 本 run 的终值必须来自「本地兜底过的 runStats」：`params.runStats` 是可选传入的，
  // ① 本地兜底：没传 runStats 也要有一份，否则 kick 路径的终值无处可取。
  assert.ok(
    adapter.includes("params.runStats ??"),
    "应有本地兜底：`params.runStats ?? {…}` —— kick 路径不传 runStats",
  )
  // ② 每个终止点仍须写 terminal（原文形式，勿被重构掉）。
  const sites = adapter.split("if (runStats) runStats.terminal =").length - 1
  assert.ok(
    sites >= 12,
    `每个终止点都该写 terminal（security_halt/error/circuit_breaker/round_limit），实测 ${sites}`,
  )

  // 落盘不得被任何 worker/agent_role 条件包裹 —— 评审 claude 用它做突变时，
  // 旧测试**全绿**（因为落点在 router，本就到不了 worker）。这条直接盯住那类突变。
  const at = adapter.indexOf("last_run_terminal: runStats.terminal")
  const around = adapter.slice(Math.max(0, at - 500), at)
  assert.ok(
    !around.includes("agent_role"),
    "落盘不得被 agent_role / worker 条件包裹：worker 正是本票要修的对象，条件化会让它静默失效",
  )
  // 反向守卫：落盘不得被挪回 message-router（那里对 worker 无效）。
  const mr = ["src/message-router.ts", "companion/src/message-router.ts"]
    .find((p) => { try { readFileSync(p, "utf8"); return true } catch { return false } })
  assert.ok(mr, "找不到 message-router.ts")
  assert.ok(
    !readFileSync(mr, "utf8").includes("last_run_terminal"),
    "message-router 里不该再有落盘（对 worker 是 no-op，会使 #569 静默失效）",
  )
})

test("#569 落盘不扰动 run_progress —— update() 是胖 API，带播种副作用", () => {
  // 自查发现的隐患：ThreadManager.update() 里有
  //   `if (thread.run_progress === undefined) { seed from handoff.open_todos }`
  // 而我在 message-router 的 run-end 也调了 update()。若它顺带给 worker 播了种，
  // 就是我引入的、超出本票意图的行为变化。实测结论：**不会** ——
  //   · run_progress 为 null（显式清空，sticky）→ 不播种
  //   · run_progress 已定义 → 不播种
  //   · handoff 一旦写入，同一次 update() 就已播过种（或 open_todos 为空、播种结果为空）
  // 本用例把「落盘前后 run_progress 不变」钉住，防止将来 update() 的副作用改动被无声带出。
  const tm = new ThreadManager()
  tm.create("w-569-rp", "t569rp")
  tm.update("t569rp", {
    runtime_context_budget: {
      mode: "m1",
      last_at: "t",
      dropped_count: 0,
      tokens_before: 10,
      tokens_after: 5,
      handoff: { open_todos: [{ text: "todo-A" }, { text: "todo-B" }] },
    },
  } as never)
  // 显式清空 → sticky null（注释见 thread-manager.ts 的 run_progress 三态说明）
  tm.update("t569rp", { run_progress: null } as never)
  assert.equal((tm.get("t569rp") as never as { run_progress: unknown }).run_progress, null)

  // ← 与 message-router 的落盘调用完全相同
  tm.update("t569rp", { last_run_terminal: "circuit_breaker", last_run_ended_at: ENDED_AT })

  const after = tm.get("t569rp") as never as { run_progress: unknown; last_run_terminal: unknown }
  assert.equal(after.last_run_terminal, "circuit_breaker", "落盘本身要生效")
  assert.equal(
    after.run_progress,
    null,
    "落盘**不得**播种/改动 run_progress（update() 的副作用不能被本调用带出）",
  )
})

test("#569 异常逃逸必须落成 error/aborted —— 不得留下「正常跑完」的错误痕迹", () => {
  // 评审 claude 实测出的两类触发（我最初的实现两者都错）：
  //   A in-try 逃逸：异常从函数级 try 内、不经任何登记点抛出（如 runContextBudgetPass /
  //     buildCurrentContext / 循环内磁盘写）→ finally 先于 router 的 catch 执行 →
  //     terminal 仍为 null → 落盘 {null, now}，而 catalog 文案把「null + 时间戳」教作
  //     「正常跑完」⇒ **错误的肯定痕迹**。
  //   B pre-try 崩溃：entry→try 之间抛出 → finally 不执行 → 零落盘，读到上次 run 残留。
  // 旧落点（在 router 的 catch **之后**）对这两类都写 "error" ⇒ 搬迁后是**回归**。
  const cwd = ["src/llm/adapter.ts", "companion/src/llm/adapter.ts"].find((p) => {
    try { readFileSync(p, "utf8"); return true } catch { return false }
  })
  assert.ok(cwd, "找不到 adapter.ts")
  const src = readFileSync(cwd, "utf8")

  // ① 必须存在**函数级 catch**（在 finally 之前）——这是兜底的前提。
  const catchAt = src.indexOf("} catch (runErr: any) {")
  const finallyAt = src.indexOf("} finally {", catchAt > 0 ? catchAt : 0)
  assert.ok(catchAt > 0, "函数级 try 必须配 catch：只有 finally 会让异常逃逸时落成「正常跑完」")
  assert.ok(finallyAt > catchAt, "catch 必须在 finally 之前（同一 try 语句）")

  // ② catch 里必须在 terminal 未定时兜底，且**抛回原异常**（router 语义不变）。
  const block = src.slice(catchAt, finallyAt)
  assert.ok(block.includes("if (!runStats.terminal)"), "catch 里应仅在未定终值时兜底")
  assert.ok(block.includes('"error"'), "非 abort 异常应落成 error")
  assert.ok(block.includes('"aborted"'), "AbortError 应落成 aborted")
  assert.ok(/throw runErr/.test(block), "必须抛回原异常 —— 否则 router 的 catch 行为被改变")
})

test("#569 后任 epoch 占住之后，前任不得再写终值；没有后任时仍可写", async () => {
  const { claimRunTerminalEpoch, runTerminalEpochIsCurrent } = await import("../src/llm/adapter")
  const first = claimRunTerminalEpoch("t-epoch")
  assert.equal(runTerminalEpochIsCurrent("t-epoch", first), true, "没有后任时，被中止的这一跑仍是当前")
  const second = claimRunTerminalEpoch("t-epoch")
  assert.equal(runTerminalEpochIsCurrent("t-epoch", first), false)
  assert.equal(runTerminalEpochIsCurrent("t-epoch", second), true)
  const other = claimRunTerminalEpoch("t-epoch-other")
  assert.equal(runTerminalEpochIsCurrent("t-epoch", second), true, "别的线程不抢本线程的 epoch")
  assert.equal(runTerminalEpochIsCurrent("t-epoch-other", other), true)
})
