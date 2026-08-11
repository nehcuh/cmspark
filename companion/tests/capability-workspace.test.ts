import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { CMSPARK_PROJECTS_DIRNAME } from "../src/capability/project-dir"

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

test("read missing file returns agent-friendly error (not raw ENOENT)", () => {
  // Regression n2486l: missing path used to surface Node's
  // "ENOENT: no such file or directory, stat …" and kill the chat turn.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wsroot-miss-"))
  const read = workspace.workspaceReadFile(root, "test.txt")
  assert.equal(read.success, false)
  assert.match(read.error || "", /file not found/i)
  assert.doesNotMatch(read.error || "", /ENOENT/i)
  assert.doesNotMatch(read.error || "", /, stat /i)
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

test("effectiveWorkspaceRoot(null) returns ~/CMspark-projects under HOME", () => {
  const eff = workspace.effectiveWorkspaceRoot(null)
  assert.ok(eff)
  assert.ok(eff!.endsWith(CMSPARK_PROJECTS_DIRNAME))
  assert.ok(eff!.startsWith(fs.realpathSync(tempHome)) || eff!.startsWith(tempHome))
  assert.ok(fs.existsSync(eff!) && fs.statSync(eff!).isDirectory())
})

test("null workspaceRoot can workspaceListDir under default sandbox", () => {
  const sandbox = path.join(tempHome, CMSPARK_PROJECTS_DIRNAME)
  // ensure not pre-created so list path creates it
  if (fs.existsSync(sandbox)) {
    // leave existing from prior test — list still works
  }
  const list = workspace.workspaceListDir(null, ".")
  assert.equal(list.success, true, list.error)
  assert.ok(fs.existsSync(sandbox) && fs.statSync(sandbox).isDirectory())
  assert.equal(list.data.path, ".")
  assert.ok(Array.isArray(list.data.entries))
})

test("null workspaceRoot workspaceReadFile after writing under sandbox", () => {
  const sandbox = path.join(tempHome, CMSPARK_PROJECTS_DIRNAME)
  fs.mkdirSync(sandbox, { recursive: true, mode: 0o700 })
  const fname = `sandbox-read-${Date.now().toString(36)}.txt`
  fs.writeFileSync(path.join(sandbox, fname), "sandbox-hello")
  const read = workspace.workspaceReadFile(null, fname)
  assert.equal(read.success, true, read.error)
  assert.equal(read.data.content, "sandbox-hello")
})

test("explicit workspace root preferred over default sandbox", () => {
  const explicit = fs.mkdtempSync(path.join(os.tmpdir(), "ws-explicit-"))
  fs.writeFileSync(path.join(explicit, "only-here.txt"), "explicit-content")
  // poison sandbox with same name different content
  const sandbox = path.join(tempHome, CMSPARK_PROJECTS_DIRNAME)
  fs.mkdirSync(sandbox, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(sandbox, "only-here.txt"), "sandbox-content")

  const read = workspace.workspaceReadFile(explicit, "only-here.txt")
  assert.equal(read.success, true, read.error)
  assert.equal(read.data.content, "explicit-content")

  const list = workspace.workspaceListDir(explicit, ".")
  assert.equal(list.success, true)
  assert.ok(list.data.entries.some((e: any) => e.name === "only-here.txt"))

  fs.rmSync(explicit, { recursive: true, force: true })
})

test("escape ../ still rejected under sandbox fallback", () => {
  const bad = workspace.resolveUnderWorkspace(null, "../outside")
  assert.equal(bad.ok, false)
  assert.match(bad.ok === false ? bad.error : "", /escapes workspace_root/)
})

test("default sandbox rejects in-home symlink root (N2)", () => {
  const sandbox = path.join(tempHome, CMSPARK_PROJECTS_DIRNAME)
  const target = fs.mkdtempSync(path.join(tempHome, "symlink-target-"))
  fs.writeFileSync(path.join(target, "secret.txt"), "nope")
  // Replace sandbox dir with symlink into another in-home folder
  if (fs.existsSync(sandbox)) {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
  fs.symlinkSync(target, sandbox, "dir")
  try {
    const ensured = workspace.ensureDefaultSandboxRoot(tempHome)
    assert.equal(ensured.ok, false)
    if (!ensured.ok) {
      assert.match(ensured.error, /symbolic link|default_sandbox_unavailable/)
    }
    const list = workspace.workspaceListDir(null, ".")
    assert.equal(list.success, false)
    assert.match(list.error || "", /default_sandbox_unavailable|symbolic link/)
  } finally {
    fs.rmSync(sandbox, { force: true })
    fs.rmSync(target, { recursive: true, force: true })
  }
})

test("ensureDefaultSandboxRoot best-effort chmod 0o700 on existing dir (N6)", () => {
  const sandbox = path.join(tempHome, CMSPARK_PROJECTS_DIRNAME)
  fs.mkdirSync(sandbox, { recursive: true, mode: 0o755 })
  const ensured = workspace.ensureDefaultSandboxRoot(tempHome)
  assert.equal(ensured.ok, true, ensured.ok ? "" : ensured.error)
  if (!ensured.ok) return
  const mode = fs.statSync(ensured.path).mode & 0o777
  // On some FS chmod is ignored; accept 0o700 when platform applies it
  if (process.platform !== "win32") {
    assert.equal(mode, 0o700)
  }
})

test("resolveEffectiveWorkspaceRoot wires explicit vs sandbox (M1)", () => {
  const explicit = fs.mkdtempSync(path.join(os.tmpdir(), "ws-eff-"))
  const r1 = workspace.resolveEffectiveWorkspaceRoot(explicit)
  assert.equal(r1.ok, true)
  if (r1.ok) {
    assert.equal(r1.source, "explicit")
    assert.equal(r1.path, explicit)
  }
  const r2 = workspace.resolveEffectiveWorkspaceRoot(null)
  assert.equal(r2.ok, true)
  if (r2.ok) {
    assert.equal(r2.source, "sandbox")
    assert.ok(r2.path.endsWith(CMSPARK_PROJECTS_DIRNAME))
  }
  fs.rmSync(explicit, { recursive: true, force: true })
})
