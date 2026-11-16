import { describe, test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-shell-provision-")))
process.env.CMSPARK_DATA_DIR = root
const realWrite = fs.writeFileSync
let configWrites = 0
const writeAttempts: Array<{ file: string; code?: string }> = []
fs.writeFileSync = ((file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
  const target = String(file)
  if (!target.includes(`${path.sep}config.json`)) return realWrite(file, data, options)
  configWrites += 1
  try {
    const result = realWrite(file, data, options)
    writeAttempts.push({ file: target })
    return result
  } catch (err) {
    writeAttempts.push({ file: target, code: (err as NodeJS.ErrnoException).code })
    throw err
  }
}) as typeof fs.writeFileSync

type Loaded = {
  config: typeof import("../src/config")
  checkShellScope: typeof import("../src/capability/shell").checkShellScope
  setModuleEnabled: typeof import("../src/capability/modules").setModuleEnabled
  handleConfigFamily: typeof import("../src/message-router/handlers/config").handleConfigFamily
  handleMessage: typeof import("../src/message-router").handleMessage
}
let loaded: Loaded | undefined
async function mods(): Promise<Loaded> {
  if (!loaded) {
    const [config, shell, modules, configHandler, router] = await Promise.all([
      import("../src/config"),
      import("../src/capability/shell"),
      import("../src/capability/modules"),
      import("../src/message-router/handlers/config"),
      import("../src/message-router"),
    ])
    loaded = { config, checkShellScope: shell.checkShellScope, setModuleEnabled: modules.setModuleEnabled, handleConfigFamily: configHandler.handleConfigFamily, handleMessage: router.handleMessage }
  }
  return loaded
}

async function writeLegacy() {
  const { config } = await mods()
  fs.mkdirSync(root, { recursive: true })
  fs.chmodSync(root, 0o700)
  realWrite(path.join(root, "config.json"), JSON.stringify({
    capability_profile: "enterprise",
    trusted_domains: ["keep.example"],
    modules: {
      shell: { available: true, enabled: false, enabled_at: null, enabled_by: null, policy: "confirm_per_command", allowlist_commands: ["echo"] },
      netsec: { available: true, enabled: false, enabled_at: null, enabled_by: null, target_allowlist: [], require_task_auth: true },
    },
  }))
  config.clearConfigCache()
  configWrites = 0
}

function disk() {
  return JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"))
}

describe("shell provision task 1", { concurrency: 1 }, () => {
test("cold-cache shell scope repairs legacy false before the L2 precheck", async () => {
  await writeLegacy()
  const { checkShellScope } = await mods()
  const scope = checkShellScope("echo ok")
  const gaps: string[] = []
  if (!scope.ok) gaps.push(`scope=${scope.error}`)
  if (configWrites !== 1) gaps.push(`writes=${configWrites}`)
  const saved = disk()
  if (saved.modules?.shell?.enabled !== true) gaps.push("disk enabled stayed false")
  if (saved.modules?.shell?.allowlist_commands?.[0] !== "echo") gaps.push("policy allowlist changed")
  if (String(scope.ok ? "" : scope.error).includes("modules.set_enabled")) gaps.push("error still teaches modules.set_enabled")
  assert.deepEqual(gaps, [])
})

test("protocol 1 modules.list repairs before the snapshot return", async () => {
  await writeLegacy()
  const { handleMessage } = await mods()
  const reply = await handleMessage({ type: "modules.list", profile_receipt_protocol: 1 }, {
    threadManager: {} as never, skillEngine: {} as never, historyStore: { record: () => 0 } as never,
  })
  const gaps: string[] = []
  if (reply.type !== "modules.profile.snapshot") gaps.push(`type=${reply.type}`)
  if (reply.modules?.shell?.enabled !== true) gaps.push(`snapshot enabled=${reply.modules?.shell?.enabled}`)
  if (reply.modules?.shell?.allowlist_commands?.[0] !== "echo") gaps.push("snapshot lost allowlist")
  if (configWrites !== 1) gaps.push(`writes=${configWrites}`)
  assert.deepEqual(gaps, [])
})

test("shell switch writes are rejected and other modules still change", async () => {
  await writeLegacy()
  const { setModuleEnabled } = await mods()
  configWrites = 0
  const enabled = setModuleEnabled("shell", true)
  const shell = setModuleEnabled("shell", false)
  const shellWrites = configWrites
  const netsec = setModuleEnabled("netsec", true)
  const gaps: string[] = []
  if (enabled.ok || !String(enabled.error).includes("shell_switch_removed")) gaps.push(`shell true=${enabled.ok ? "ok" : enabled.error}`)
  if (shell.ok || !String(shell.error).includes("shell_switch_removed")) gaps.push(`shell false=${shell.ok ? "ok" : shell.error}`)
  if (shellWrites !== 0) gaps.push(`shell writes=${shellWrites}`)
  if (!netsec.ok) gaps.push(`netsec=${netsec.error}`)
  if (disk().modules?.netsec?.enabled !== true) gaps.push("netsec was not enabled")
  assert.deepEqual(gaps, [])
})

test("explicit shell.enabled rejects config.set while an unknown key does not", async () => {
  await writeLegacy()
  const { handleConfigFamily } = await mods()
  const rejected = await handleConfigFamily("config.set", { config: { trusted_domains: ["changed.example"], modules: { shell: { enabled: false } } } })
  const gaps: string[] = []
  if (rejected.type !== "error" || !String(rejected.error).includes("shell_switch_removed")) gaps.push(`rejected=${rejected.type}:${rejected.error}`)
  if (disk().trusted_domains?.[0] !== "keep.example") gaps.push("explicit shell key changed allowlisted field")
  await writeLegacy()
  const allowed = await handleConfigFamily("config.set", { config: { trusted_domains: ["plain.example"], totally_unknown: true } })
  if (allowed.type !== "config.updated") gaps.push(`unknown key type=${allowed.type}`)
  if (disk().trusted_domains?.[0] !== "plain.example") gaps.push("unknown key blocked an allowlisted field")
  assert.deepEqual(gaps, [])
})

test("a failed repair is unknown and the next list retries once", async () => {
  await writeLegacy()
  const { checkShellScope, handleMessage } = await mods()
  const before = writeAttempts.length
  fs.chmodSync(root, 0o500)
  let denied: ReturnType<typeof checkShellScope>
  try { denied = checkShellScope("echo ok") }
  finally { fs.chmodSync(root, 0o700) }
  const failed = writeAttempts.slice(before).filter(item => item.code)
  const gaps: string[] = []
  if (!failed.some(item => item.file.includes(`${path.sep}config.json.tmp`) && item.code === "EACCES")) gaps.push(`write attempts=${JSON.stringify(writeAttempts.slice(before))}`)
  if (denied.ok || !String(denied.error).includes("SHELL_PROVISION_RESULT_UNKNOWN")) gaps.push(`denied=${denied.ok ? "ok" : denied.error}`)
  const reply = await handleMessage({ type: "modules.list", profile_receipt_protocol: 1 }, {
    threadManager: {} as never, skillEngine: {} as never, historyStore: { record: () => 0 } as never,
  })
  if (reply.modules?.shell?.enabled !== true) gaps.push(`retry enabled=${reply.modules?.shell?.enabled}`)
  assert.deepEqual(gaps, [])
})

test("a stale revision does not replace the newer config", async () => {
  await writeLegacy()
  const { config, checkShellScope } = await mods()
  config.clearConfigCache()
  config.getConfig()
  const stale = config.getConfigRevision()
  config.saveConfig({ trusted_domains: ["newer.example"] })
  let conflict = ""
  try { config.saveConfig({ trusted_domains: ["stale.example"] }, undefined, stale) }
  catch (err) { conflict = (err as Error).message }
  const scope = checkShellScope("echo ok")
  const gaps: string[] = []
  if (conflict !== "CONFIG_REVISION_CONFLICT") gaps.push(`conflict=${conflict}`)
  if (config.getConfig().trusted_domains?.[0] !== "newer.example") gaps.push("cache lost newer domain")
  if (disk().trusted_domains?.[0] !== "newer.example") gaps.push("disk lost newer domain")
  if (!scope.ok) gaps.push(`scope=${scope.error}`)
  if (disk().modules?.shell?.enabled !== true) gaps.push("newer config was not projected")
  if (disk().trusted_domains?.[0] !== "newer.example") gaps.push("projection replaced newer domain")
  assert.deepEqual(gaps, [])
})
})
