// WP5 I3 登记项③ — computer.model.reset_circuit_breaker 围栏 +
// get_state 观测面。双层断言：validateWsMessage 形状围栏（server.ts 导出件）
// + handler 层来源核查（belt）+ 复位语义（有会话真复位、无会话诚实 no-op）。
// WP5-I4 WI-4.2 扩充：开关族四路由状态机（见文件后半）。

import "./computer-model-test-env" // DATA_DIR 隔离必须先于一切 src import（模块加载时定型）

import test from "node:test"
import assert from "node:assert/strict"

import { validateWsMessage } from "../src/server"
import {
  handleComputerModelMessage,
  type ComputerModelSessionHolder,
} from "../src/computer/model-handlers"

// --- fakes ------------------------------------------------------------------

function fakeSession(disabled = true) {
  return {
    resetCalls: 0,
    status: disabled ? "disabled" : "idle",
    faults: disabled ? 3 : 0,
    resetCircuitBreaker() {
      this.resetCalls += 1
      this.status = "idle"
      this.faults = 0
    },
    getStatus() {
      return this.status
    },
    getFaults() {
      return this.faults
    },
  }
}

function holderWith(session: any): ComputerModelSessionHolder {
  return { session }
}

// --- validateWsMessage 形状围栏（未知类型默认放行，故此层是真围栏） -------------

test("③ validateWsMessage：reset_circuit_breaker 缺 source → 拒绝", () => {
  const r = validateWsMessage({ type: "computer.model.reset_circuit_breaker" })
  assert.equal(r.valid, false)
  assert.match(r.error!, /source:"settings"/)
})

test("③ validateWsMessage：reset_circuit_breaker 非 settings 来源 → 拒绝", () => {
  for (const source of ["chat", "quick-action", "", 1, null]) {
    const r = validateWsMessage({ type: "computer.model.reset_circuit_breaker", source })
    assert.equal(r.valid, false, `source=${JSON.stringify(source)} 应被拒`)
  }
})

test("③ validateWsMessage：reset_circuit_breaker settings 来源 → 放行", () => {
  const r = validateWsMessage({ type: "computer.model.reset_circuit_breaker", source: "settings" })
  assert.equal(r.valid, true)
})

test("③ validateWsMessage：get_state 无字段要求 → 放行", () => {
  assert.equal(validateWsMessage({ type: "computer.model.get_state" }).valid, true)
})

// --- handler 层二次核查（belt：防直调/校验面变更） ------------------------------

test("③ handler：非 settings 来源 → INVALID_SOURCE，会话绝不被触碰", async () => {
  const session = fakeSession()
  for (const msg of [
    { type: "computer.model.reset_circuit_breaker" },
    { type: "computer.model.reset_circuit_breaker", source: "chat" },
  ]) {
    const r = await handleComputerModelMessage(msg, {}, holderWith(session))
    assert.equal(r.type, "error")
    assert.equal(r.family, "computer")
    assert.equal(r.code, "INVALID_SOURCE")
  }
  assert.equal(session.resetCalls, 0, "围栏拒绝时复位绝不发生")
})

// --- 复位语义 ----------------------------------------------------------------

test("③ handler：settings 来源 + 熔断会话 → 真复位 + 广播 ready 态", async () => {
  const session = fakeSession(true) // disabled, faults=3
  const broadcasts: any[] = []
  const r = await handleComputerModelMessage(
    { type: "computer.model.reset_circuit_breaker", source: "settings" },
    { broadcast: (d: any) => broadcasts.push(d) },
    holderWith(session),
  )
  assert.equal(session.resetCalls, 1)
  // WI-4.2 全形：核心字段深等，扩展字段点断言（默认 config 形）
  assert.equal(r.type, "computer.model.state")
  assert.equal(r.modelStatus, "ready")
  assert.equal(r.faults, 0)
  assert.equal(r.modelEnabled, false)
  assert.equal(r.variant, "hybrid")
  assert.equal(broadcasts.length, 1)
  assert.equal(broadcasts[0].modelStatus, "ready")
  assert.equal(broadcasts[0].faults, 0)
})

test("③ handler：settings 来源 + 无会话 → 诚实 no-op（不伪造复位、不广播）", async () => {
  const broadcasts: any[] = []
  const r = await handleComputerModelMessage(
    { type: "computer.model.reset_circuit_breaker", source: "settings" },
    { broadcast: (d: any) => broadcasts.push(d) },
    holderWith(null),
  )
  assert.equal(r.modelStatus, "absent")
  assert.equal(r.note, "no-session")
  assert.equal(broadcasts.length, 0, "无状态变化不广播")
})

// --- get_state 观测面 ----------------------------------------------------------

test("③ get_state：熔断会话 → modelStatus disabled + faults 计数", async () => {
  const session = fakeSession(true)
  const r = await handleComputerModelMessage({ type: "computer.model.get_state" }, {}, holderWith(session))
  assert.equal(r.type, "computer.model.state")
  assert.equal(r.modelStatus, "disabled")
  assert.equal(r.faults, 3)
  // WI-4.2 全形字段（默认 config 形）
  assert.equal(r.modelEnabled, false)
  assert.equal(r.licenseAccepted, false)
  assert.equal(r.modelLicenseDeclined, false)
  assert.equal(r.variant, "hybrid")
})

test("③ get_state：无会话 → absent / faults 0（磁盘轻量复验细分）", async () => {
  const r = await handleComputerModelMessage({ type: "computer.model.get_state" }, {}, holderWith(null))
  assert.equal(r.type, "computer.model.state")
  assert.equal(r.modelStatus, "absent")
  assert.equal(r.faults, 0)
  assert.equal(r.modelEnabled, false)
  assert.equal(r.variant, "hybrid")
})

test("③ handler：未知 computer.model 类型 → error", async () => {
  const r = await handleComputerModelMessage({ type: "computer.model.nope" }, {}, holderWith(null))
  assert.equal(r.type, "error")
  assert.match(r.error, /Unknown computer model message type/)
})


// --- WP5-I4 WI-4.2 开关族四路由 ---------------------------------------------------
//
// 断言面（plan:542 + P1/P3/P5/P6）：set_enabled 三分支（未接受→license_required
// 零写入 / 已拒绝→LICENSE_DECLINED / 已接受→fake 门双路）；enabled:false 免费
// + dispose；license_response 双路（时间戳+文本哈希 / 拒绝永久跳过）；条款漂移
// 重门（P1）；download 幂等 + 占位 fail-fast（零网络）+ 按变体语义（P3）；
// delete dispose；四 case belt 负测试（P6）；validateWsMessage 四条目形状。

import * as fs from "node:fs"
import * as path from "node:path"
import { clearConfigCache, getConfig, saveConfig } from "../src/config"
import { LICENSE_DOOR_TEXT, LICENSE_DOOR_TEXT_HASH } from "../src/computer/model-license"

const TEST_DATA_DIR = process.env.CMSPARK_DATA_DIR!

function resetModelConfig(computer: Record<string, unknown> = { coordinateEnabled: false }) {
  clearConfigCache()
  try { fs.rmSync(path.join(TEST_DATA_DIR, "config.json")) } catch { /* 不存在可忽略 */ }
  saveConfig({ computer } as any)
  clearConfigCache()
}

function readComputer(): any {
  clearConfigCache()
  return getConfig().computer
}

/** 占位 manifest（url 为 .invalid TLD——裁决 5 禁网兜底场景）。 */
function placeholderManifest(): any {
  const files = ["a.onnx", "b.onnx"].map((name) => ({
    name,
    url: `https://models.cmspark.invalid/tinyclick/rev/hybrid/${name}`,
    sha256: "0".repeat(64),
    size: 10,
  }))
  return { models: { tinyclick: { variants: { hybrid: { files }, int8: { files } } } } }
}

/** 真实主机 manifest（配镜像或 owner host 已定场景）。 */
function realHostManifest(): any {
  const files = ["a.onnx", "b.onnx"].map((name) => ({
    name,
    url: `https://models.example.com/tinyclick/rev/hybrid/${name}`,
    sha256: "0".repeat(64),
    size: 10,
  }))
  return { models: { tinyclick: { variants: { hybrid: { files }, int8: { files } } } } }
}

const flush = () => new Promise((r) => setImmediate(r))

function fakeGate(outcome: { approved: boolean; reason?: string; method?: string }) {
  const calls: any[] = []
  return {
    calls,
    gate: async (args: any) => {
      calls.push(args)
      return { approved: outcome.approved, reason: outcome.reason ?? (outcome.approved ? "ok" : "denied"), method: outcome.method ?? "fake" }
    },
  }
}

function fakeSessionFull(disabled = false) {
  return {
    disposed: 0,
    resetCircuitBreaker() {},
    getStatus() { return disabled ? "disabled" : "idle" },
    getFaults() { return disabled ? 3 : 0 },
    async dispose() { this.disposed += 1 },
  }
}

// --- validateWsMessage 四条目（P6 第一层） -----------------------------------------

test("WI-4.2 validateWsMessage：四路由缺/错 source 拒绝；settings 放行；形状字段强制", () => {
  for (const t of ["computer.model.set_enabled", "computer.model.license_response", "computer.model.download", "computer.model.delete"]) {
    assert.equal(validateWsMessage({ type: t }).valid, false, `${t} 缺 source 应拒`)
    assert.equal(validateWsMessage({ type: t, source: "chat" }).valid, false, `${t} 错 source 应拒`)
  }
  assert.equal(validateWsMessage({ type: "computer.model.download", source: "settings" }).valid, true)
  assert.equal(validateWsMessage({ type: "computer.model.delete", source: "settings" }).valid, true)
  // 形状字段：set_enabled 要 enabled:boolean；license_response 要 accepted:boolean
  assert.equal(validateWsMessage({ type: "computer.model.set_enabled", source: "settings" }).valid, false)
  assert.equal(validateWsMessage({ type: "computer.model.set_enabled", enabled: "yes", source: "settings" }).valid, false)
  assert.equal(validateWsMessage({ type: "computer.model.set_enabled", enabled: true, source: "settings" }).valid, true)
  assert.equal(validateWsMessage({ type: "computer.model.license_response", source: "settings" }).valid, false)
  assert.equal(validateWsMessage({ type: "computer.model.license_response", accepted: false, source: "settings" }).valid, true)
})

// --- belt 负测试（P6 第二层：直调 handler 缺/错 source → INVALID_SOURCE） ------------

test("WI-4.2 belt：四 case 直调缺/错 source → INVALID_SOURCE（validateWsMessage 被绕过也拦）", async () => {
  resetModelConfig()
  for (const t of ["computer.model.set_enabled", "computer.model.license_response", "computer.model.download", "computer.model.delete"]) {
    for (const badMsg of [{ type: t }, { type: t, source: "chat" }]) {
      const r = await handleComputerModelMessage(badMsg, {}, holderWith(null))
      assert.equal(r.type, "error", `${t} ${JSON.stringify(badMsg.source)} 应拒`)
      assert.equal(r.code, "INVALID_SOURCE")
    }
  }
  // 旁证：错误来源不得产生任何 config 写入
  assert.equal(readComputer().modelEnabled ?? false, false)
})

// --- set_enabled 状态机 -------------------------------------------------------------

test("WI-4.2 set_enabled(true)：license 未接受 → license_required + config 零写入（含 LICENSE_DOOR_TEXT 载荷）", async () => {
  resetModelConfig()
  const g = fakeGate({ approved: true })
  const r = await handleComputerModelMessage(
    { type: "computer.model.set_enabled", enabled: true, source: "settings" },
    { requestConfirmation: async () => ({}) },
    holderWith(null),
    { gate: g.gate as any },
  )
  assert.equal(r.type, "computer.model.license_required")
  assert.equal(r.licenseText, LICENSE_DOOR_TEXT, "许可证门载荷 = LICENSE_DOOR_TEXT 单一真源原文")
  assert.ok(typeof r.notice === "string" && r.notice.length > 0)
  assert.equal(readComputer().modelEnabled ?? false, false, "config 零写入")
  assert.equal(g.calls.length, 0, "未过许可证门不得触发生物识别门")
})

test("WI-4.2 set_enabled(true)：license 已拒绝 → LICENSE_DECLINED 永久跳过 + 零写入", async () => {
  resetModelConfig({ coordinateEnabled: false, modelLicenseDeclined: true })
  const r = await handleComputerModelMessage(
    { type: "computer.model.set_enabled", enabled: true, source: "settings" },
    { requestConfirmation: async () => ({}) },
    holderWith(null),
    { gate: fakeGate({ approved: true }).gate as any },
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "LICENSE_DECLINED")
  assert.equal(readComputer().modelEnabled ?? false, false)
})

test("WI-4.2 set_enabled(true)：条款漂移（旧文本哈希）→ 重新弹门 license_required（P1）", async () => {
  resetModelConfig({
    coordinateEnabled: false,
    modelLicenseAcceptedAt: "2026-07-20T00:00:00.000Z",
    modelLicenseAcceptedTextHash: "000000000000", // 旧版本哈希 ≠ 当前 LICENSE_DOOR_TEXT_HASH
  })
  const r = await handleComputerModelMessage(
    { type: "computer.model.set_enabled", enabled: true, source: "settings" },
    { requestConfirmation: async () => ({}) },
    holderWith(null),
    { gate: fakeGate({ approved: true }).gate as any },
  )
  assert.equal(r.type, "computer.model.license_required", "文本漂移 = 未接受，必须重新弹门")
  assert.equal(readComputer().modelEnabled ?? false, false)
})

test("WI-4.2 set_enabled(true)：已接受（时间戳+当前哈希）→ fake 门批准写 config + 广播；拒绝不写", async () => {
  const acceptedCfg = {
    coordinateEnabled: false,
    modelLicenseAcceptedAt: "2026-07-21T00:00:00.000Z",
    modelLicenseAcceptedTextHash: LICENSE_DOOR_TEXT_HASH,
  }
  // 批准臂
  resetModelConfig(acceptedCfg)
  const g1 = fakeGate({ approved: true, method: "hello" })
  const broadcasts: any[] = []
  const r1 = await handleComputerModelMessage(
    { type: "computer.model.set_enabled", enabled: true, source: "settings" },
    { requestConfirmation: async () => ({ approved: true }), broadcast: (d: any) => broadcasts.push(d) },
    holderWith(null),
    { gate: g1.gate as any },
  )
  assert.equal(r1.type, "computer.model.state")
  assert.equal(r1.modelEnabled, true)
  assert.equal(readComputer().modelEnabled, true, "批准后写 config")
  assert.equal(g1.calls.length, 1)
  assert.equal(g1.calls[0].action, "computer.model.set_enabled")
  assert.equal(broadcasts.length, 1)
  assert.equal(broadcasts[0].modelEnabled, true)
  // 拒绝臂
  resetModelConfig(acceptedCfg)
  const g2 = fakeGate({ approved: false, reason: "cancelled" })
  const r2 = await handleComputerModelMessage(
    { type: "computer.model.set_enabled", enabled: true, source: "settings" },
    { requestConfirmation: async () => ({}) },
    holderWith(null),
    { gate: g2.gate as any },
  )
  assert.equal(r2.type, "error")
  assert.equal(r2.code, "BIOMETRIC_DENIED")
  assert.equal(readComputer().modelEnabled ?? false, false, "门拒绝零写入")
})

test("WI-4.2 set_enabled(true)：已接受但无确认通道 → NO_CONFIRMATION_CHANNEL（P5）", async () => {
  resetModelConfig({
    coordinateEnabled: false,
    modelLicenseAcceptedAt: "2026-07-21T00:00:00.000Z",
    modelLicenseAcceptedTextHash: LICENSE_DOOR_TEXT_HASH,
  })
  const r = await handleComputerModelMessage(
    { type: "computer.model.set_enabled", enabled: true, source: "settings" },
    {}, // 无 requestConfirmation
    holderWith(null),
    { gate: fakeGate({ approved: true }).gate as any },
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "NO_CONFIRMATION_CHANNEL")
  assert.equal(readComputer().modelEnabled ?? false, false)
})

test("WI-4.2 set_enabled(false)：免费 + dispose 会话 + holder=null + 广播", async () => {
  resetModelConfig({ coordinateEnabled: false, modelEnabled: true })
  const session = fakeSessionFull()
  const holder = holderWith(session)
  const broadcasts: any[] = []
  const r = await handleComputerModelMessage(
    { type: "computer.model.set_enabled", enabled: false, source: "settings" },
    { broadcast: (d: any) => broadcasts.push(d) },
    holder,
  )
  assert.equal(r.modelEnabled, false)
  assert.equal(session.disposed, 1, "disable 必须 dispose（裁决 4）")
  assert.equal(holder.session, null)
  assert.equal(readComputer().modelEnabled, false)
  assert.equal(broadcasts.length, 1)
})

// --- license_response 双路 ----------------------------------------------------------

test("WI-4.2 license_response accepted:true → 时间戳+文本哈希写入 + 广播 + 自动下载（占位主机如实 note）", async () => {
  resetModelConfig()
  const broadcasts: any[] = []
  const r = await handleComputerModelMessage(
    { type: "computer.model.license_response", accepted: true, source: "settings" },
    { broadcast: (d: any) => broadcasts.push(d) },
    holderWith(null),
    { manifestLoader: async () => placeholderManifest() },
  )
  const c = readComputer()
  assert.ok(typeof c.modelLicenseAcceptedAt === "string" && !Number.isNaN(Date.parse(c.modelLicenseAcceptedAt)), "ISO 时间戳写入")
  assert.equal(c.modelLicenseAcceptedTextHash, LICENSE_DOOR_TEXT_HASH, "P1：文本版本哈希绑定")
  assert.equal(c.modelLicenseDeclined, false)
  assert.equal(r.licenseAccepted, true)
  assert.equal(r.download, "download-host-unset", "占位主机自动下载如实落空（裁决 5，零网络）")
  assert.ok(broadcasts.some((b) => b.type === "computer.model.state" && b.licenseAccepted === true))
})

test("WI-4.2 license_response accepted:true + 配镜像 → 自动触发 download（按当前变体，P3）", async () => {
  resetModelConfig({ coordinateEnabled: false, modelMirror: "https://hf-mirror.example", modelVariant: "int8" })
  const calls: any[] = []
  const downloadImpl = async (args: any) => {
    calls.push(args)
    return {} as any
  }
  const r = await handleComputerModelMessage(
    { type: "computer.model.license_response", accepted: true, source: "settings" },
    {},
    holderWith(null),
    { manifestLoader: async () => realHostManifest(), downloadImpl: downloadImpl as any },
  )
  assert.equal(r.download, "started")
  await flush(); await flush(); await flush()
  assert.equal(calls.length, 1, "自动下载触发一次")
  assert.equal(calls[0].variant, "int8", "下载对象 = 当前配置变体（P3）")
  assert.equal(calls[0].mirror, "https://hf-mirror.example")
})

test("WI-4.2 license_response accepted:false → modelLicenseDeclined=true + 此后 set_enabled 恒 LICENSE_DECLINED", async () => {
  resetModelConfig()
  const r = await handleComputerModelMessage(
    { type: "computer.model.license_response", accepted: false, source: "settings" },
    {},
    holderWith(null),
  )
  assert.equal(r.modelLicenseDeclined, true)
  assert.equal(readComputer().modelLicenseDeclined, true)
  const r2 = await handleComputerModelMessage(
    { type: "computer.model.set_enabled", enabled: true, source: "settings" },
    { requestConfirmation: async () => ({}) },
    holderWith(null),
    { gate: fakeGate({ approved: true }).gate as any },
  )
  assert.equal(r2.code, "LICENSE_DECLINED", "拒绝后永久跳过（复位仅手改 config）")
})

// --- download 路由 ------------------------------------------------------------------

test("WI-4.2 download：占位主机 + 未配镜像 → DOWNLOAD_HOST_UNSET fail-fast（零网络，fake 零调用）", async () => {
  resetModelConfig()
  let implCalls = 0
  const r = await handleComputerModelMessage(
    { type: "computer.model.download", source: "settings" },
    {},
    holderWith(null),
    {
      manifestLoader: async () => placeholderManifest(),
      downloadImpl: (async () => { implCalls += 1; return {} as any }) as any,
    },
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "DOWNLOAD_HOST_UNSET")
  await flush()
  assert.equal(implCalls, 0, "禁网兜底：零网络请求（非 DNS 失败后的 network-error）")
})

test("WI-4.2 download：配镜像 → started + 按变体下载；进行中再调 → already-running 幂等（P10 防并发）", async () => {
  resetModelConfig({ coordinateEnabled: false, modelMirror: "https://hf-mirror.example", modelVariant: "int8" })
  const calls: any[] = []
  let release!: () => void
  const pending = new Promise<void>((res) => { release = res })
  const downloadImpl = async (args: any) => {
    calls.push(args)
    await pending
    return {} as any
  }
  const r1 = await handleComputerModelMessage(
    { type: "computer.model.download", source: "settings" },
    {},
    holderWith(null),
    { manifestLoader: async () => realHostManifest(), downloadImpl: downloadImpl as any },
  )
  assert.deepEqual({ ok: r1.ok, status: r1.status, variant: r1.variant }, { ok: true, status: "started", variant: "int8" })
  const r2 = await handleComputerModelMessage(
    { type: "computer.model.download", source: "settings" },
    {},
    holderWith(null),
    { manifestLoader: async () => realHostManifest(), downloadImpl: downloadImpl as any },
  )
  assert.equal(r2.status, "already-running", "并发第二次幂等")
  release()
  await flush(); await flush(); await flush()
  assert.equal(calls.length, 1, "单飞：下载实现只被调用一次")
  assert.equal(calls[0].variant, "int8")
})

test("WI-4.2 download：manifest 不可用 → MANIFEST_INVALID 诚实错误", async () => {
  resetModelConfig()
  const r = await handleComputerModelMessage(
    { type: "computer.model.download", source: "settings" },
    {},
    holderWith(null),
    { manifestLoader: async () => { throw new Error("bad json") } },
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "MANIFEST_INVALID")
})

// --- delete 路由 -------------------------------------------------------------------

test("WI-4.2 delete：dispose + holder=null + 删除当前变体 + 广播", async () => {
  resetModelConfig({ coordinateEnabled: false, modelEnabled: true, modelVariant: "int8" })
  const session = fakeSessionFull()
  const holder = holderWith(session)
  const delCalls: any[] = []
  const broadcasts: any[] = []
  const r = await handleComputerModelMessage(
    { type: "computer.model.delete", source: "settings" },
    { broadcast: (d: any) => broadcasts.push(d) },
    holder,
    { deleteImpl: (async (args: any) => { delCalls.push(args); return { removedBytes: 123 } }) as any },
  )
  assert.equal(session.disposed, 1, "delete 必须 dispose（裁决 4）")
  assert.equal(holder.session, null)
  assert.deepEqual(delCalls, [{ variant: "int8" }], "删除对象 = 当前配置变体（P3）")
  assert.equal(r.ok, true)
  assert.equal(r.removedBytes, 123)
  assert.ok(broadcasts.some((b) => b.type === "computer.model.state"))
})
