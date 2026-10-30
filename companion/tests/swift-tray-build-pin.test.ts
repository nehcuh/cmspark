import test from "node:test"
import assert from "node:assert/strict"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vm from "node:vm"
import { buildSync } from "esbuild"

// The historical, non-bundled development pin from swift-tray-bridge.ts.
const developmentPin = "523638554705e3801eecd035dbee0841db8d726129dfdf3eb02e0cd38f1c33dd"
const payload = Buffer.from("owned inert Swift tray bytes; never executed\n")
const payloadPin = crypto.createHash("sha256").update(payload).digest("hex")
const pinPrefix = "CMSPARK_SWIFT_TRAY_SHA256_V1:"
type TrayIntegrityModule = {
  checkIntegrity(file: string): { ok: boolean; inode: number; dev: number; realpath: string }
  getExpectedHash(): string
}

function owned(t: { after(fn: () => void): void }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-tray-build-pin-")))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const binary = path.join(root, "inert-tray")
  fs.writeFileSync(binary, payload, { mode: 0o600 })
  return { root: fs.realpathSync(root), binary }
}

function compileActualBridge(root: string, define: Record<string, string>, outputName = "inert-bridge.cjs") {
  // Supports normal .test-dist/tests output and an explicitly selected source
  // test runner. Both candidates name the actual checked-in production module.
  const source = [
    path.resolve(__dirname, "../../src/tray/swift-tray-bridge.ts"),
    path.resolve(__dirname, "../src/tray/swift-tray-bridge.ts"),
  ].find(file => fs.existsSync(file))
  assert.ok(source, "actual production Swift tray module is available")
  const outfile = path.join(root, outputName)
  const built = buildSync({
    absWorkingDir: path.dirname(source), entryPoints: [source], outfile,
    bundle: true, platform: "node", format: "cjs", target: "node22",
    write: false, metafile: true, logLevel: "silent", define,
  })
  assert.ok(built.outputFiles)
  assert.equal(built.outputFiles.length, 1)
  assert.equal(fs.existsSync(outfile), false, "the bundle stays in memory")
  assert.ok(Object.keys(built.metafile!.inputs).some(
    file => path.resolve(path.dirname(source), file) === source,
  ), "esbuild consumed the real production module, not a copied hash implementation")
  const { assertTrayBundleGraph } = require(path.resolve(__dirname, "../../scripts/swift-tray-package-pin.mjs")) as {
    assertTrayBundleGraph(meta: unknown, output: string, input: string): void
  }
  assertTrayBundleGraph(built.metafile, path.relative(path.dirname(source), outfile).split(path.sep).join("/"), path.basename(source))

  const fds = new Set<number>()
  let forbiddenEffects = 0
  let closeUnknown = 0
  const refuse = () => { forbiddenEffects++; throw new Error("TRAY_TEST_EFFECT_REFUSED") }
  const allowed = (file: unknown) => {
    assert.equal(typeof file, "string")
    const resolved = path.resolve(file as string)
    assert.ok(resolved.startsWith(root + path.sep), "only the owned fixture may be read")
    return resolved
  }
  const requireBuiltin = (id: string) => {
    switch (id.replace(/^node:/, "")) {
      case "crypto": return crypto
      case "path": return path
      case "readline": return Object.freeze({ createInterface: refuse })
      case "child_process": return Object.freeze({
        spawn: refuse, spawnSync: refuse, exec: refuse, execSync: refuse,
        execFile: refuse, execFileSync: refuse, fork: refuse,
      })
      case "fs": return Object.freeze({
        realpathSync(file: unknown) { return allowed(fs.realpathSync(allowed(file))) },
        openSync(file: unknown, flags: string) {
          assert.equal(flags, "r")
          const fd = fs.openSync(allowed(file), flags)
          fds.add(fd)
          return fd
        },
        fstatSync(fd: number) { assert.ok(fds.has(fd)); return fs.fstatSync(fd) },
        readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number | null) {
          assert.ok(fds.has(fd))
          return fs.readSync(fd, buffer, offset, length, position)
        },
        closeSync(fd: number) {
          assert.equal(fds.delete(fd), true, "close only a currently owned FD once")
          try { fs.closeSync(fd) } catch (error) { closeUnknown++; throw error }
        },
      })
      default: return refuse()
    }
  }
  const module = { exports: {} }
  new vm.Script(built.outputFiles[0].text, { filename: outfile }).runInNewContext({
    module, exports: module.exports, require: requireBuiltin, Buffer,
    __dirname: root, __filename: outfile,
  }, { timeout: 1000 })
  const actual = module.exports as TrayIntegrityModule
  assert.equal(typeof actual.checkIntegrity, "function")
  assert.equal(typeof actual.getExpectedHash, "function")
  return {
    actual,
    bundle: built.outputFiles[0].text,
    assertClosed() {
      assert.equal(fds.size, 0, "every actual integrity read closed its owned FD")
      assert.equal(closeUnknown, 0, "no failed close is counted as proved cleanup")
      assert.equal(forbiddenEffects, 0, "no tray spawn, rebuild, daemon or other module is called")
    },
  }
}

test("Swift tray build pin: default development module retains its historical pin", t => {
  const f = owned(t)
  const built = compileActualBridge(f.root, {})
  assert.equal(built.actual.getExpectedHash(), developmentPin)
  assert.notEqual(payloadPin, developmentPin)
  assert.equal(built.actual.checkIntegrity(f.binary).ok, false)
  built.assertClosed()
})

test("Swift tray build pin: the real packaged module accepts matching owned bytes and rejects tampering", t => {
  const f = owned(t)
  const built = compileActualBridge(f.root, {
    __CMSPARK_PACKAGED_TRAY__: "true",
    __CMSPARK_SWIFT_TRAY_SHA256__: JSON.stringify(pinPrefix + payloadPin),
  })
  assert.equal(built.actual.getExpectedHash(), payloadPin)
  assert.equal(built.bundle.split(pinPrefix).length, 2, "the compiled bridge contains one marked literal")
  assert.ok(built.bundle.includes(JSON.stringify(pinPrefix + payloadPin)))
  const good = built.actual.checkIntegrity(f.binary)
  assert.equal(good.ok, true)
  assert.equal(good.realpath, fs.realpathSync(f.binary))
  assert.equal(good.inode, fs.statSync(f.binary).ino)
  assert.equal(good.dev, fs.statSync(f.binary).dev)
  built.assertClosed()
  fs.writeFileSync(f.binary, "different inert owned bytes\n")
  assert.equal(built.actual.checkIntegrity(f.binary).ok, false)
  built.assertClosed()
})

test("Swift tray build pin: producer defines feed the real compiled consumer", t => {
  const f = owned(t)
  const helper = path.resolve(__dirname, "../../scripts/swift-tray-package-pin.mjs")
  const { trayBuildDefines } = require(helper) as { trayBuildDefines(bytes: Buffer): Record<string, string> }
  const built = compileActualBridge(f.root, trayBuildDefines(payload))
  assert.equal(built.actual.getExpectedHash(), payloadPin)
  assert.equal(built.actual.checkIntegrity(f.binary).ok, true)
  fs.writeFileSync(f.binary, "different inert bytes")
  assert.equal(built.actual.checkIntegrity(f.binary).ok, false)
  built.assertClosed()
})

test("Swift tray build pin: private verification output path preserves bridge bundle bytes", t => {
  const f = owned(t)
  const helper = path.resolve(__dirname, "../../scripts/swift-tray-package-pin.mjs")
  const { trayBuildDefines } = require(helper) as { trayBuildDefines(bytes: Buffer): Record<string, string> }
  const define = trayBuildDefines(payload)
  const built = compileActualBridge(f.root, define, "packaged.cjs")
  const rebuilt = compileActualBridge(f.root, define, "verify.cjs")
  assert.equal(rebuilt.bundle, built.bundle)
  built.assertClosed()
  rebuilt.assertClosed()
})

test("Swift tray build pin: packaged mode without an injected pin never falls back to the development pin", t => {
  const f = owned(t)
  const built = compileActualBridge(f.root, { __CMSPARK_PACKAGED_TRAY__: "true" })
  assert.notEqual(built.actual.getExpectedHash(), developmentPin)
  assert.equal(built.actual.checkIntegrity(f.binary).ok, false)
  built.assertClosed()
})

test("Swift tray build pin: an injected marker cannot activate packaged mode", t => {
  const f = owned(t)
  const built = compileActualBridge(f.root, {
    __CMSPARK_PACKAGED_TRAY__: "false",
    __CMSPARK_SWIFT_TRAY_SHA256__: JSON.stringify(pinPrefix + payloadPin),
  })
  assert.equal(built.actual.getExpectedHash(), developmentPin)
  assert.equal(built.actual.checkIntegrity(f.binary).ok, false)
  built.assertClosed()
})

test("Swift tray build pin: malformed or non-lowercase build literals fail closed", t => {
  const f = owned(t)
  for (const pinLiteral of [JSON.stringify("not-a-pin"), "null", JSON.stringify(pinPrefix + "A".repeat(64)), JSON.stringify(payloadPin), JSON.stringify(pinPrefix + payloadPin + "_")]) {
    const built = compileActualBridge(f.root, {
      __CMSPARK_PACKAGED_TRAY__: "true", __CMSPARK_SWIFT_TRAY_SHA256__: pinLiteral,
    })
    assert.notEqual(built.actual.getExpectedHash(), developmentPin)
    assert.equal(built.actual.checkIntegrity(f.binary).ok, false)
    built.assertClosed()
  }
})
