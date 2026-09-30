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
})

test("#569 run 结束时的落盘点在 message-router（而非 onLoopRunFinished）", () => {
  // 评审 claude 指出的落点约束：`onLoopRunFinished` 对 worker 直接 early-return
  // （loop-kernel.ts:295），worker 永远到不了那里 —— 落点必须是 message-router
  // 的 run-end 区块，否则本票对 worker **完全无效**。
  const src = readFileSync("src/message-router.ts", "utf8")
  assert.match(src, /last_run_terminal/, "message-router 应负责落盘 run terminal")
  assert.match(
    src,
    /last_run_ended_at/,
    "message-router 应同时落盘 ended_at（三态语义的另一半）",
  )
})
