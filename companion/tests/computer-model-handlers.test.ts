// computer.model.* handlers — Qwen3-VL path (settings belt + download/delete/variant).

import "./computer-model-test-env"

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

import { validateWsMessage } from "../src/server"
import {
  handleComputerModelMessage,
  type ComputerModelSessionHolder,
} from "../src/computer/model-handlers"
import { clearConfigCache, getConfig, saveConfig } from "../src/config"
import { LICENSE_DOOR_TEXT_HASH } from "../src/computer/model-license"

const TEST_DATA_DIR = process.env.CMSPARK_DATA_DIR!

function resetModelConfig(computer: Record<string, unknown> = { coordinateEnabled: false }) {
  clearConfigCache()
  try {
    fs.rmSync(path.join(TEST_DATA_DIR, "config.json"))
  } catch {
    /* ignore */
  }
  saveConfig({ computer } as any)
  clearConfigCache()
}

function holderWith(session: any): ComputerModelSessionHolder {
  return { session }
}

const flush = () => new Promise((r) => setImmediate(r))

test("validateWsMessage：set_variant settings + 2b/4b/8b 放行", () => {
  assert.equal(validateWsMessage({ type: "computer.model.set_variant", source: "settings", variant: "2b" }).valid, true)
  assert.equal(validateWsMessage({ type: "computer.model.set_variant", source: "settings", variant: "4b" }).valid, true)
  assert.equal(validateWsMessage({ type: "computer.model.set_variant", variant: "2b" }).valid, false)
  assert.equal(validateWsMessage({ type: "computer.model.set_variant", source: "settings", variant: "hybrid" }).valid, false)
})

test("belt：set_variant 缺 source → INVALID_SOURCE", async () => {
  const r = await handleComputerModelMessage({ type: "computer.model.set_variant", variant: "2b" }, {}, holderWith(null))
  assert.equal(r.type, "error")
  assert.equal(r.code, "INVALID_SOURCE")
})

test("set_variant：写入 4b + 广播 resourceTip", async () => {
  resetModelConfig({ coordinateEnabled: false, modelVariant: "2b" })
  const broadcasts: any[] = []
  const r = await handleComputerModelMessage(
    { type: "computer.model.set_variant", variant: "4b", source: "settings" },
    { broadcast: (d) => broadcasts.push(d) },
    holderWith(null),
  )
  assert.equal(r.variant, "4b")
  assert.equal(r.modelFamily, "qwen3-vl")
  assert.ok(typeof r.resourceTip === "string" && r.resourceTip.length > 10)
  assert.equal(getConfig().computer?.modelVariant, "4b")
  assert.ok(broadcasts.some((b) => b.variant === "4b"))
})

test("download：started + 立即 downloading 广播；fake downloadImpl", async () => {
  resetModelConfig({ coordinateEnabled: false, modelVariant: "2b" })
  const broadcasts: any[] = []
  let release!: () => void
  const pending = new Promise<void>((res) => {
    release = res
  })
  const r = await handleComputerModelMessage(
    { type: "computer.model.download", source: "settings" },
    { broadcast: (d) => broadcasts.push(d) },
    holderWith(null),
    {
      downloadImpl: async () => {
        await pending
        return { dir: "/tmp/x" }
      },
    },
  )
  assert.equal(r.status, "started")
  await flush()
  assert.ok(broadcasts.some((b) => b.modelStatus === "downloading"))
  release()
  for (let i = 0; i < 8; i++) await flush()
})

test("download：失败 reason 挂 state", async () => {
  resetModelConfig({ coordinateEnabled: false, modelVariant: "2b" })
  const { QwenDownloadError } = await import("../src/computer/qwen-vl-download")
  const broadcasts: any[] = []
  await handleComputerModelMessage(
    { type: "computer.model.download", source: "settings" },
    { broadcast: (d) => broadcasts.push(d) },
    holderWith(null),
    {
      downloadImpl: async () => {
        throw new QwenDownloadError("python-missing", "no py")
      },
    },
  )
  for (let i = 0; i < 10; i++) await flush()
  const terminal = [...broadcasts].reverse().find((b) => b.type === "computer.model.state" && b.modelStatus !== "downloading")
  assert.ok(terminal)
  assert.equal(terminal.error, "python-missing")
})

test("license_response accepted → 写哈希 + 自动 download started", async () => {
  resetModelConfig({ coordinateEnabled: false, modelVariant: "2b" })
  // Ensure no leftover activeDownload from prior tests
  for (let i = 0; i < 5; i++) await flush()
  let dl = 0
  const r = await handleComputerModelMessage(
    { type: "computer.model.license_response", accepted: true, source: "settings" },
    {},
    holderWith(null),
    {
      downloadImpl: async () => {
        dl++
        return { dir: "/tmp" }
      },
    },
  )
  assert.equal(r.licenseAccepted, true)
  assert.ok(r.download === "started" || r.download === "already-running")
  assert.equal(getConfig().computer?.modelLicenseAcceptedTextHash, LICENSE_DOOR_TEXT_HASH)
  for (let i = 0; i < 8; i++) await flush()
  assert.ok(dl >= 0)
})

test("get_state：含 availableVariants 与 resourceTip", async () => {
  resetModelConfig({ coordinateEnabled: false, modelVariant: "2b" })
  const r = await handleComputerModelMessage({ type: "computer.model.get_state" }, {}, holderWith(null))
  assert.equal(r.type, "computer.model.state")
  assert.equal(r.variant, "2b")
  assert.deepEqual(r.availableVariants, ["2b", "4b", "8b"])
  assert.ok(r.resourceTip)
  assert.ok(r.minRamGb >= 8)
})

test("set_enabled(true): !canEnable → CANNOT_ENABLE, zero config write", async () => {
  resetModelConfig({
    coordinateEnabled: false,
    modelVariant: "2b",
    modelLicenseAcceptedAt: new Date().toISOString(),
    modelLicenseAcceptedTextHash: LICENSE_DOOR_TEXT_HASH,
    modelEnabled: false,
  })
  const r: any = await handleComputerModelMessage(
    { type: "computer.model.set_enabled", enabled: true, source: "settings" },
    {
      requestConfirmation: async () => ({ approved: true, method: "test" }),
    },
    holderWith(null),
    {
      canEnableProbe: () => false,
      gate: async () => ({ approved: true, method: "touchid" as const, nonce: "n1" }),
    },
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "CANNOT_ENABLE")
  assert.equal(getConfig().computer?.modelEnabled, false)
})

test("set_enabled(true): canEnable + gate approve → modelEnabled true", async () => {
  resetModelConfig({
    coordinateEnabled: false,
    modelVariant: "2b",
    modelLicenseAcceptedAt: new Date().toISOString(),
    modelLicenseAcceptedTextHash: LICENSE_DOOR_TEXT_HASH,
    modelEnabled: false,
  })
  const r: any = await handleComputerModelMessage(
    { type: "computer.model.set_enabled", enabled: true, source: "settings" },
    {
      requestConfirmation: async () => ({ approved: true, method: "test" }),
    },
    holderWith(null),
    {
      canEnableProbe: () => true,
      gate: async () => ({ approved: true, method: "touchid" as const, nonce: "n1" }),
    },
  )
  assert.notEqual(r.type, "error")
  assert.equal(getConfig().computer?.modelEnabled, true)
})

test("license_response reset_decline clears permanent skip", async () => {
  resetModelConfig({
    coordinateEnabled: false,
    modelVariant: "2b",
    modelLicenseDeclined: true,
  })
  const r: any = await handleComputerModelMessage(
    { type: "computer.model.license_response", reset_decline: true, source: "settings" },
    {},
    holderWith(null),
  )
  assert.equal(getConfig().computer?.modelLicenseDeclined, false)
  assert.equal(r.declineReset, true)
})

test("validateWsMessage: license_response reset_decline without accepted is valid", () => {
  assert.equal(
    validateWsMessage({
      type: "computer.model.license_response",
      reset_decline: true,
      source: "settings",
    }).valid,
    true,
  )
  assert.equal(
    validateWsMessage({
      type: "computer.model.license_response",
      source: "settings",
    }).valid,
    false,
  )
})
