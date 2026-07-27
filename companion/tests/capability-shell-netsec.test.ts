import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-sh-"))
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
process.env.HOME = tempHome

let initDataDir: any
let clearConfigCache: any
let saveConfig: any
let shell: typeof import("../src/capability/shell")
let scan: typeof import("../src/netsec/scan")

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  clearConfigCache = configMod.clearConfigCache
  saveConfig = configMod.saveConfig
  await initDataDir()
  clearConfigCache()
  shell = await import("../src/capability/shell")
  scan = await import("../src/netsec/scan")
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("shell_exec blocked when module disabled", async () => {
  saveConfig({
    capability_profile: "enterprise",
    modules: { shell: { available: true, enabled: false } },
  } as any)
  clearConfigCache()
  const r = await shell.shellExec({ command: "echo hi" })
  assert.equal(r.success, false)
  assert.match(r.error || "", /module_disabled/)
})

test("shell_exec runs when enabled", async () => {
  saveConfig({
    capability_profile: "enterprise",
    modules: {
      shell: { available: true, enabled: true, policy: "confirm_per_command" },
    },
  } as any)
  clearConfigCache()
  const r = await shell.shellExec({ command: "echo hello-cmspark" })
  assert.equal(r.success, true)
  assert.match(r.data?.stdout || "", /hello-cmspark/)
})

test("netsec denied when allowlist empty", async () => {
  saveConfig({
    capability_profile: "enterprise",
    modules: {
      netsec: {
        available: true,
        enabled: true,
        target_allowlist: [],
        require_task_auth: true,
      },
    },
  } as any)
  clearConfigCache()
  const r = await scan.netsecPortScan({
    targets: ["127.0.0.1"],
    taskAuth: { authorized: true, targets: ["127.0.0.1"] },
  })
  assert.equal(r.success, false)
  assert.match(r.error || "", /allowlist/i)
})

test("netsec probes localhost when authorized", async () => {
  saveConfig({
    capability_profile: "enterprise",
    modules: {
      netsec: {
        available: true,
        enabled: true,
        target_allowlist: ["127.0.0.1", "localhost"],
        require_task_auth: true,
      },
    },
  } as any)
  clearConfigCache()
  const r = await scan.netsecPortScan({
    targets: ["127.0.0.1"],
    ports: [1, 65534], // unlikely open
    taskAuth: { authorized: true, targets: ["127.0.0.1"] },
  })
  assert.equal(r.success, true)
  assert.ok(Array.isArray(r.data?.results))
})
