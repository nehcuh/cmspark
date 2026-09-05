// #328 execution contract 护栏 — v0 SHADOW spike (log-only).
// GitHub: #328. 设计基准: .omx/artifacts/perm-rethink-20260905/FINAL-SYNTHESIS.md 票 7.
//
// 纪律（票面 + 终审 §1 继承）:
// - 断言走独立 propose 通道，永不进被执行工具的 args（可选=恒关 / 强制=假阳）。
// - checker 是纯确定性代码：本文件禁止 import ../llm/*；match 是纯函数。
//   LLM 自评散文不进任何判决；合同通过永不减少确认（L2 admission 零 diff）。
// - v0 谓词限机器可观测: exit code / 写路径前缀(静态解析) / 出网(静态扫描)。
//   HTTP status / DOM selector 谓词 v0 禁用（浏览器里攻击者可喂真）。
//   hwnd_stable 对 shell_exec 不可观测 → 只记入 unobserved，不计 mismatch。
// - SHADOW: 不一致只写 capability-audit.jsonl + logger，**不 STOP_THREAD、
//   不影响确认/L2**。「高危但符合预期则继续」永远不做 —— 本模块没有放行路径。
// - 默认关: security.execution_contract_shadow（默认 false）。关时工具不
//   offer（adapter 过滤），即使被调用也返回 TOOL_NOT_OFFERED。
//
// 启发式局限（假阳率观测必读）:
// - writes: 只静态解析重定向(> >> &>)与 tee 目标；命令替换、变量、程序内部
//   写文件均不可见。解析不到 ≠ 没写。
// - net: 只静态扫描命令文本（curl/wget/ssh/git fetch|pull|push|clone、
//   包管理 install、http(s):// 字面量等）。扫不到 ≠ 没出网；扫到 ≠ 真出网。
// 因此 v0 would_stop 只计「观测到且与 expect 冲突」的方向：
//   expect.net=false 且观测到出网迹象 → diff（危险方向）。
//   expect.net=true 但未观测到 → 不 diff（欠报方向，启发式不可证伪）。

import * as crypto from "crypto"
import * as path from "path"
import { getConfig } from "../config"
import { logger } from "../logger"
import { appendCapabilityAudit } from "../packs/audit-log"

export const EXECUTION_CONTRACT_PROPOSE_TOOL = "execution_contract_propose" as const

/** v0 单工具族。其它工具的 propose 一律 UNSUPPORTED_TOOL。 */
export const CONTRACT_SUPPORTED_TOOLS: ReadonlySet<string> = new Set(["shell_exec"])

export type ExecutionContractExpect = {
  exit?: number
  writes_prefix?: string[]
  net?: boolean
  hwnd_stable?: boolean
}

export type ExecutionContract = {
  tool: string
  args_digest?: string
  expect: ExecutionContractExpect
  proposed_at: string
}

export type ContractObserve = {
  exit_code: number | null
  writes: string[]
  net: boolean
  net_indicators: string[]
  /** 标注哪些观测来自静态启发式（写/网），供假阳率报告加权。 */
  heuristics: string[]
}

export type ContractDiff = {
  field: "exit" | "writes_prefix" | "net"
  expected: unknown
  actual: unknown
}

export type ContractMatch = {
  match: boolean
  /** shadow 语义：若 fail-stop 启用，这一次是否「会拦」。v0 永远只记录。 */
  would_stop: boolean
  diffs: ContractDiff[]
  /** expect 里声明了但 v0 对该工具不可观测的字段（不计 mismatch）。 */
  unobserved: string[]
}

// ---------------------------------------------------------------------------
// Config flag — 默认关。
// ---------------------------------------------------------------------------

export function isExecutionContractShadowEnabled(security?: {
  execution_contract_shadow?: boolean
}): boolean {
  try {
    return (security ?? getConfig().security)?.execution_contract_shadow === true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Propose 入参清洗（纯函数）。模型给的任何字段都不被信任，只登记。
// ---------------------------------------------------------------------------

const MAX_WRITES_PREFIX = 8
const MAX_PREFIX_LEN = 512
const MAX_DIGEST_LEN = 128

function scrubToolName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const t = raw.replace(/[\x00-\x1F\x7F]/g, "").trim()
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(t)) return undefined
  return t
}

function scrubDigest(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const d = raw.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, MAX_DIGEST_LEN)
  return d || undefined
}

/**
 * 清洗 expect。全部字段可选；一个有效字段都没有 → EMPTY_EXPECT。
 * 未知字段静默丢弃（不进入合同，也就不进入判决）。
 */
export function sanitizeContractExpect(
  raw: unknown,
): { ok: true; expect: ExecutionContractExpect } | { ok: false; error_code: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error_code: "EMPTY_EXPECT" }
  }
  const o = raw as Record<string, unknown>
  const expect: ExecutionContractExpect = {}
  if (typeof o.exit === "number" && Number.isInteger(o.exit) && o.exit >= -1 && o.exit <= 255) {
    expect.exit = o.exit
  }
  if (Array.isArray(o.writes_prefix)) {
    const list: string[] = []
    for (const p of o.writes_prefix) {
      if (typeof p !== "string") continue
      const s = p.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, MAX_PREFIX_LEN)
      if (s) list.push(s)
      if (list.length >= MAX_WRITES_PREFIX) break
    }
    if (list.length > 0) expect.writes_prefix = list
  }
  if (typeof o.net === "boolean") expect.net = o.net
  if (typeof o.hwnd_stable === "boolean") expect.hwnd_stable = o.hwnd_stable
  if (
    expect.exit === undefined &&
    expect.writes_prefix === undefined &&
    expect.net === undefined &&
    expect.hwnd_stable === undefined
  ) {
    return { ok: false, error_code: "EMPTY_EXPECT" }
  }
  return { ok: true, expect }
}

// ---------------------------------------------------------------------------
// 合同登记簿 — 每线程最多一份，先进先被下一次同工具执行消费（take = get+del）。
// propose 成功 ≠ 允许执行，只是登记；登记簿本身不是任何许可状态。
// ---------------------------------------------------------------------------

const contractsByThread = new Map<string, ExecutionContract>()

export function registerContract(threadId: string, contract: ExecutionContract): void {
  contractsByThread.set(threadId, contract)
}

/** 消费该线程下一份匹配 tool 的合同；不匹配/没有 → null（合同不跨工具生效）。 */
export function takeContractForTool(threadId: string, tool: string): ExecutionContract | null {
  const c = contractsByThread.get(threadId)
  if (!c) return null
  if (c.tool !== tool) return null
  contractsByThread.delete(threadId)
  return c
}

/** 测试专用。 */
export function clearContractsForTest(): void {
  contractsByThread.clear()
}

/** 登记数观测（测试/审计）。 */
export function contractCountForTest(): number {
  return contractsByThread.size
}

// ---------------------------------------------------------------------------
// args digest — 我们自己对真实执行参数算 sha256，与模型自报 digest 并列记录；
// digest 不匹配只记 digest_match:false（shadow 下不是判决字段）。
// ---------------------------------------------------------------------------

export function argsDigestForShellExec(params: { command?: unknown; cwd?: unknown }): string {
  const canonical = JSON.stringify({
    command: typeof params.command === "string" ? params.command : "",
    cwd: typeof params.cwd === "string" ? params.cwd : "",
  })
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex")
}

// ---------------------------------------------------------------------------
// 静态启发式（纯函数）
// ---------------------------------------------------------------------------

/**
 * 从命令文本静态解析写路径：重定向 (> >> &> 2> 等) 与 tee 目标。
 * 相对路径按 cwd resolve。引号内 `>`、命令替换、变量展开都会漏 ——
 * 这是启发式，解析不到不证明没写（见文件头局限声明）。
 */
export function extractShellWrites(command: string, cwd?: string | null): string[] {
  const writes = new Set<string>()
  const push = (target: string) => {
    let t = target.trim().replace(/^["']|["']$/g, "")
    if (!t || t.startsWith("&")) return // fd 复制（2>&1）不是路径
    if (t === "/dev/null" || t === "NUL") return
    try {
      t = path.resolve(cwd || process.cwd(), t)
    } catch {
      return
    }
    writes.add(t)
  }
  // 重定向：可选 fd 前缀（2>、&>），目标 = 下一个非元字符 token。
  const redir = /(?:^|[\s;|&])(?:\d*|&)?>>?\s*([^\s;&|<>]+)/g
  let m: RegExpExecArray | null
  while ((m = redir.exec(command)) !== null) {
    push(m[1]!)
  }
  // tee [-a] target…（到管道/分号为止）
  const tee = /(?:^|[\s;|&])tee\s+((?:-\w+\s+)*)([^;&|]+)/g
  while ((m = tee.exec(command)) !== null) {
    for (const tok of m[2]!.split(/\s+/)) {
      if (tok && !tok.startsWith("-")) push(tok)
    }
  }
  return [...writes].slice(0, 16)
}

const NET_INDICATORS: Array<{ name: string; re: RegExp }> = [
  { name: "net_tool", re: /\b(curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|ftp|telnet|aria2c|socat)\b/ },
  { name: "url_literal", re: /https?:\/\// },
  { name: "dns_probe", re: /\b(ping|dig|nslookup|host|traceroute)\b/ },
  { name: "git_remote", re: /\bgit\s+(?:-\S+\s+)*(fetch|pull|push|clone|ls-remote)\b/ },
  {
    name: "pkg_install",
    re: /\b(npm|npx|yarn|pnpm|pip|pip3|brew|apt|apt-get|dnf|yum|cargo|gem|composer|go)\s+(?:-\S+\s+)*(install|add|update|upgrade|get|fetch)\b/,
  },
]

/**
 * 出网静态扫描。true = 发现出网迹象（附 indicators）；
 * false = 没扫到 —— 不证明没出网（混淆/间接出网不可见）。
 */
export function detectShellNet(command: string): { net: boolean; indicators: string[] } {
  const indicators: string[] = []
  for (const { name, re } of NET_INDICATORS) {
    if (re.test(command)) indicators.push(name)
  }
  return { net: indicators.length > 0, indicators }
}

// ---------------------------------------------------------------------------
// match — 纯函数判决。输入 expect + observe，输出 diff / would_stop。
// 无 IO、无 LLM、无全局状态（单测锁定）。
// ---------------------------------------------------------------------------

export function matchContract(
  expect: ExecutionContractExpect,
  observe: ContractObserve,
): ContractMatch {
  const diffs: ContractDiff[] = []
  const unobserved: string[] = []

  if (expect.exit !== undefined) {
    if (observe.exit_code === null) {
      unobserved.push("exit")
    } else if (observe.exit_code !== expect.exit) {
      diffs.push({ field: "exit", expected: expect.exit, actual: observe.exit_code })
    }
  }

  if (expect.writes_prefix !== undefined) {
    // 语义 = 字符串前缀（票面「写路径前缀」）。/tmp/out 会命中 /tmp/outside，
    // 模型给精确前缀是自己的事；shadow 期如实记录，不替模型收紧。
    const outside = observe.writes.filter(
      (w) => !expect.writes_prefix!.some((p) => w.startsWith(p)),
    )
    if (outside.length > 0) {
      diffs.push({ field: "writes_prefix", expected: expect.writes_prefix, actual: outside })
    }
    // 解析不到任何写 → 无 diff（启发式不可证伪，见文件头）。
  }

  if (expect.net === false && observe.net === true) {
    // 危险方向：声明不出网但观测到出网迹象（篡改 expect 的检测面）。
    diffs.push({ field: "net", expected: false, actual: true })
  }

  if (expect.hwnd_stable !== undefined) {
    // shell_exec 无窗口句柄可观测量；CU 工具族留给 v1。
    unobserved.push("hwnd_stable")
  }

  return {
    match: diffs.length === 0,
    would_stop: diffs.length > 0,
    diffs,
    unobserved,
  }
}

// ---------------------------------------------------------------------------
// shadow 接线（side-effect 边界，dispatch 调用）。绝不 throw、绝不改 result。
// ---------------------------------------------------------------------------

export function buildShellExecObserve(
  params: { command?: unknown; cwd?: unknown },
  result: { success?: boolean; data?: any },
): ContractObserve {
  const command = typeof params.command === "string" ? params.command : ""
  const cwd = typeof params.cwd === "string" ? params.cwd : null
  const exit =
    result && result.data && typeof result.data.exit_code === "number"
      ? (result.data.exit_code as number)
      : null
  const netScan = detectShellNet(command)
  return {
    exit_code: exit,
    writes: extractShellWrites(command, cwd),
    net: netScan.net,
    net_indicators: netScan.indicators,
    heuristics: ["writes_static_parse", "net_static_scan"],
  }
}

/**
 * shell_exec 执行完成后的 shadow 比对：消费合同 → 机检 observe → 纯 match →
 * 只写 capability-audit.jsonl（execution_contract.shadow）+ logger。
 * 无合同时零开销返回。flag 关时零行为。
 */
export function observeShellExecShadow(opts: {
  threadId?: string
  params: { command?: unknown; cwd?: unknown }
  result: { success?: boolean; data?: any }
}): void {
  try {
    if (!isExecutionContractShadowEnabled()) return
    const tid = typeof opts.threadId === "string" ? opts.threadId : ""
    if (!tid) return
    const contract = takeContractForTool(tid, "shell_exec")
    if (!contract) return

    const observe = buildShellExecObserve(opts.params, opts.result)
    const verdict = matchContract(contract.expect, observe)
    const digestActual = argsDigestForShellExec(opts.params)

    appendCapabilityAudit({
      type: "execution_contract.shadow",
      at: new Date().toISOString(),
      thread_id: tid,
      tool: "shell_exec",
      args_digest_proposed: contract.args_digest ?? null,
      args_digest_actual: digestActual,
      digest_match: contract.args_digest != null ? contract.args_digest === digestActual : null,
      expect: contract.expect,
      observe,
      diffs: verdict.diffs,
      unobserved: verdict.unobserved,
      would_stop: verdict.would_stop,
      shadow: true,
      // 明示：shadow 不采取任何动作。fail-stop 需假阳率报告过审后另行开票。
      action_taken: "none",
    })
    logger.info("execution_contract.shadow", {
      thread_id: tid,
      tool: "shell_exec",
      would_stop: verdict.would_stop,
      diff_fields: verdict.diffs.map((d) => d.field),
      unobserved: verdict.unobserved,
    })
  } catch (e: any) {
    // shadow 永远不能影响执行 —— 连日志失败都吞掉。
    try {
      logger.warn("execution_contract_shadow_failed", { error: e?.message || String(e) })
    } catch {
      /* best-effort */
    }
  }
}

/** propose 登记审计（dispatch 调用，flag 已在外层 gate）。 */
export function auditContractPropose(threadId: string, contract: ExecutionContract): void {
  try {
    appendCapabilityAudit({
      type: "execution_contract.propose",
      at: contract.proposed_at,
      thread_id: threadId,
      tool: contract.tool,
      args_digest: contract.args_digest ?? null,
      expect: contract.expect,
      shadow: true,
      note: "registration only — grants no execution permission",
    })
  } catch {
    /* best-effort */
  }
}
