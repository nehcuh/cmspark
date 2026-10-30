// Exercise the checked-in entry's control flow with inert I/O and spawn seams.
// This is not an actual macOS package, native build or process launch.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import vm from "node:vm"
import { assertTrayBundleGraph, trayBuildDefines, trayPinLiteral, verifyTrayPackage } from "../swift-tray-package-pin.mjs"

const require = createRequire(import.meta.url)
const { transformSync } = require("esbuild")
const sourcePath = new URL("../run-esbuild-bundle.mjs", import.meta.url)
const source = readFileSync(sourcePath, "utf8").replaceAll("import.meta.url", JSON.stringify("file:///owned/companion/scripts/run-esbuild-bundle.mjs"))
const compiled = transformSync(source, { loader: "js", format: "cjs", target: "node22" }).code
const tray = Buffer.from("owned inert tray")

function exercise({ platform = "darwin", arch = "arm64", args = [], data = tray, status = 0, spawnError = null, fresh = true, graph = true, bundleOverride = null, stagingOverride = null } = {}) {
  const calls = []
  const reads = []
  const exits = []
  const removed = []
  const exitSignal = {}
  const fakeProcess = { platform, arch, argv: ["node", "bundle", ...args], execPath: "/owned/node", exit(code) { exits.push(code); throw exitSignal } }
  const fakeFs = {
    existsSync: () => true,
    mkdtempSync: () => "/owned/tmp/cmspark-tray-bundle-fixture",
    rmSync: file => removed.push(file),
    rmdirSync: directory => removed.push(directory),
    readFileSync(file) {
      reads.push(file)
      if (file.endsWith("/dist/cmspark-tray") || file.endsWith("/cmspark-macos-arm64/cmspark-tray")) {
        if (data === null) throw new Error("ENOENT")
        return data
      }
      if (file.endsWith("/integrity.json")) return "{}"
      if (file.endsWith("/swift-tray-bridge.ts")) return "source"
      if (file.endsWith("/swift-tray-bridge.js")) return "compiled"
      if (file.endsWith("/meta.json")) {
        const key = args[0] === "--verify-macos-arm64-tray" ? "../tmp/cmspark-tray-bundle-fixture/cmspark-agent.js" : "dist/cmspark-agent.js"
        return JSON.stringify(graph ? { outputs: { [key]: { inputs: { "dist/tray/swift-tray-bridge.js": { bytesInOutput: 1 } } } } } : { outputs: {} })
      }
      if (file.endsWith("/cmspark-macos-arm64/cmspark-agent.js")) return stagingOverride ?? Buffer.from(`"${trayPinLiteral(data)}"`)
      if (file.endsWith("/cmspark-tray-bundle-fixture/cmspark-agent.js")) return bundleOverride ?? Buffer.from(`"${trayPinLiteral(data)}"`)
      if (file.endsWith("/dist/cmspark-agent.js")) return bundleOverride ?? Buffer.from(`"${trayPinLiteral(data)}"`)
      if (file.endsWith("/esbuild/bin/esbuild")) return Buffer.from("#!")
      throw new Error(`unexpected read: ${file}`)
    },
  }
  const modules = {
    "node:child_process": { spawnSync(command, argv, options) { calls.push({ command, argv, options }); return { status, error: spawnError } } },
    "node:fs": fakeFs,
    "node:module": { createRequire: () => id => id === "typescript"
      ? { sys: { readFile() {} }, readConfigFile: () => ({ config: {} }), parseJsonConfigFileContent: () => ({ options: {}, errors: [] }) }
      : { platform: "node", target: "node22", externals: ["fixture-native"] } },
    // The fake filesystem uses POSIX paths regardless of the real host OS.
    "node:path": path.posix,
    "node:os": { tmpdir: () => "/owned/tmp" },
    "node:url": { fileURLToPath: () => "/owned/companion/scripts/run-esbuild-bundle.mjs" },
    "./desktop-artifacts.mjs": { desktopIntegrity: () => ({}) },
    "./swift-tray-package-pin.mjs": { assertTrayBundleGraph, trayBuildDefines, verifyTrayPackage },
    "./swift-tray-source-freshness.mjs": { assertFreshTraySource({ source, compiled }) {
      if (!fresh || source !== "source" || compiled !== "compiled") throw new Error("TRAY_COMPILED_SOURCE_STALE")
    } },
  }
  const context = { require(id) { if (!(id in modules)) throw new Error(`unexpected module: ${id}`); return modules[id] }, process: fakeProcess, Buffer, console: { error() {} } }
  let thrown
  try { vm.runInNewContext(compiled, context, { timeout: 1000 }) } catch (error) { if (error !== exitSignal) thrown = error }
  return { calls, reads, exits, thrown, removed }
}

test("entry passes actual producer defines as separate argv to its spawn seam", () => {
  const result = exercise({ args: ["--packaged-macos-arm64-tray"] })
  assert.equal(result.thrown, undefined)
  assert.deepEqual(result.exits, [0])
  assert.equal(result.calls.length, 1)
  const { command, argv, options } = result.calls[0]
  assert.equal(command, "/owned/node")
  assert.equal(argv[0], "/owned/companion/node_modules/esbuild/bin/esbuild")
  assert.equal(options.cwd, "/owned/companion")
  assert.equal(options.stdio, "inherit")
  for (const [key, value] of Object.entries(trayBuildDefines(tray))) {
    assert.equal(argv.filter(arg => arg === `--define:${key}=${value}`).length, 1)
    assert.equal(argv.filter(arg => arg.startsWith(`--define:${key}=`)).length, 1)
  }
  assert.ok(argv.includes("--external:fixture-native"))
  assert.ok(argv.includes("--metafile=/owned/tmp/cmspark-tray-bundle-fixture/meta.json"))
  assert.deepEqual(result.removed, ["/owned/tmp/cmspark-tray-bundle-fixture/meta.json", "/owned/tmp/cmspark-tray-bundle-fixture"])
})

test("entry rejects unknown arguments, wrong platform, missing and empty bytes", () => {
  for (const input of [
    { args: ["--unknown"] },
    { platform: "linux", args: ["--packaged-macos-arm64-tray"] },
    { arch: "x64", args: ["--packaged-macos-arm64-tray"] },
    { data: null, args: ["--packaged-macos-arm64-tray"] },
    { data: Buffer.alloc(0), args: ["--packaged-macos-arm64-tray"] },
    { fresh: false, args: ["--packaged-macos-arm64-tray"] },
  ]) {
    const result = exercise(input)
    assert.ok(result.thrown)
    assert.equal(result.calls.length, 0)
  }
})

test("entry without the option retains ordinary cross-platform behavior", () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    const result = exercise({ platform, arch: "x64" })
    assert.equal(result.thrown, undefined)
    assert.deepEqual(result.exits, [0])
    assert.equal(result.reads.some(file => file.endsWith("/dist/cmspark-tray")), false)
    assert.equal(result.calls[0].argv.some(arg => arg.includes("__CMSPARK_PACKAGED_TRAY__")), false)
  }
})

test("entry propagates nonzero and spawn failures", () => {
  assert.deepEqual(exercise({ status: 7 }).exits, [7])
  assert.deepEqual(exercise({ spawnError: new Error("fixture") }).exits, [1])
})

test("entry rejects a bundle lacking the bridge and removes its metadata", () => {
  const result = exercise({ args: ["--packaged-macos-arm64-tray"], graph: false })
  assert.match(result.thrown?.message ?? "", /TRAY_BUNDLE_BRIDGE_MISSING/)
  assert.deepEqual(result.removed, ["/owned/tmp/cmspark-tray-bundle-fixture/meta.json", "/owned/tmp/cmspark-tray-bundle-fixture"])
})

test("entry rejects a mismatched literal and removes metadata after spawn failure", () => {
  const mismatched = exercise({ args: ["--packaged-macos-arm64-tray"], bundleOverride: Buffer.from(`"${trayPinLiteral(Buffer.from("different"))}"`) })
  assert.match(mismatched.thrown?.message ?? "", /TRAY_PIN_MISMATCH/)
  assert.equal(mismatched.removed.length, 2)
  const failed = exercise({ args: ["--packaged-macos-arm64-tray"], status: 7 })
  assert.deepEqual(failed.exits, [7])
  assert.equal(failed.removed.length, 2)
})

test("standalone verification builds privately and rejects different staging bytes", () => {
  const good = exercise({ args: ["--verify-macos-arm64-tray"] })
  assert.equal(good.thrown, undefined)
  assert.deepEqual(good.exits, [0])
  assert.ok(good.calls[0].argv.includes("--outfile=/owned/tmp/cmspark-tray-bundle-fixture/cmspark-agent.js"))
  assert.equal(good.removed.length, 3)
  const stale = exercise({ args: ["--verify-macos-arm64-tray"], stagingOverride: Buffer.from("old bundle") })
  assert.match(stale.thrown?.message ?? "", /TRAY_STAGING_BUNDLE_MISMATCH/)
  assert.equal(stale.removed.length, 3)
})
