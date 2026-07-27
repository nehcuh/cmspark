import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-ws-"))
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
process.env.HOME = tempHome

let initDataDir: any
let clearConfigCache: any
let saveConfig: any
let workspace: typeof import("../src/capability/workspace")

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  clearConfigCache = configMod.clearConfigCache
  saveConfig = configMod.saveConfig
  await initDataDir()
  clearConfigCache()
  saveConfig({
    modules: {
      "devsec-workspace": { available: true, enabled: true, enabled_at: new Date().toISOString(), enabled_by: "test" },
    },
  } as any)
  clearConfigCache()
  workspace = await import("../src/capability/workspace")
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("path containment rejects escape", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wsroot-"))
  fs.writeFileSync(path.join(root, "ok.txt"), "hello")
  const bad = workspace.resolveUnderWorkspace(root, "../outside")
  assert.equal(bad.ok, false)
  const good = workspace.resolveUnderWorkspace(root, "ok.txt")
  assert.equal(good.ok, true)
})

test("list and read under workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wsroot2-"))
  fs.writeFileSync(path.join(root, "a.txt"), "content-a")
  const list = workspace.workspaceListDir(root, ".")
  assert.equal(list.success, true)
  assert.ok(list.data.entries.some((e: any) => e.name === "a.txt"))
  const read = workspace.workspaceReadFile(root, "a.txt")
  assert.equal(read.success, true)
  assert.equal(read.data.content, "content-a")
})

test("module gate blocks when disabled", () => {
  saveConfig({
    modules: {
      "devsec-workspace": { available: true, enabled: false },
    },
  } as any)
  clearConfigCache()
  const list = workspace.workspaceListDir("/tmp", ".")
  assert.equal(list.success, false)
  assert.match(list.error || "", /module_disabled/)
  // restore
  saveConfig({
    modules: {
      "devsec-workspace": { available: true, enabled: true },
    },
  } as any)
  clearConfigCache()
})
