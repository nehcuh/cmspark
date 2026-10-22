/** #725 source/ownedFS only. Does not load or execute a PTY/native package. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
const repo = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../.." : "../..")
const fixtures = path.join(repo, "companion/tests/fixtures/node-pty-725")
const { patchNodePtyWorker: patch, transformWindowsPtyAgent: transform, CERT } = require(path.join(repo, "scripts/patch-node-pty-worker.cjs"))
const { scenario } = require(path.join(fixtures, "runtime.cjs"))
const before = fs.readFileSync(path.join(fixtures, "source/windowsPtyAgent.js"))
const hash = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex")
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pty725-owned-")))
  const scope = path.join(root, "node_modules/@lydell")
  fs.mkdirSync(scope, { recursive: true })
  for (const arch of ["x64", "arm64"]) {
    const name = "@lydell/node-pty-win32-" + arch, folder = path.join(root, "node_modules", name)
    fs.mkdirSync(path.join(folder, "lib"), { recursive: true })
    fs.copyFileSync(path.join(fixtures, arch + "-package.json"), path.join(folder, "package.json"))
    fs.writeFileSync(path.join(folder, "lib/windowsPtyAgent.js"), before, { flag: "wx", mode: 0o644 })
  }
  const wrapper = path.join(scope, "node-pty"); fs.mkdirSync(wrapper)
  fs.copyFileSync(path.join(fixtures, "wrapper-package.json"), path.join(wrapper, "package.json"))
  fs.copyFileSync(path.join(repo, "companion/package-lock.json"), path.join(root, "package-lock.json"))
  const file = path.join(scope, "node-pty-win32-x64/lib/windowsPtyAgent.js")
  return { root, scope, file, run: (io: any = fs, required = false, arch = "x64") => patch({ companionDir: root, platform: "win32", arch, required, io }), close: () => fs.rmSync(root, { recursive: true, force: true }) }
}
test("#725 exact upstream natural exit retires its retained output Worker only after original flush", async () => {
  const actual = await scenario({ patched: true })
  assert.equal(actual.closedFrames, 1); assert.equal(actual.productBusy, false)
  assert.equal(actual.afterFirstClose.workerTerminated, 0)
  assert.deepEqual(actual.afterFirstClose.workerDelayMs, [1000])
  assert.equal(actual.workerTerminated, 1); assert.equal(actual.workerOwnedServersListening, 0)
  assert.equal(actual.nativeKill, 0); assert.equal(actual.treeKill, 0); assert.equal(actual.fork, 0)
})
test("#725 exact old natural-exit counterexample remains recorded, not a native success", async () => {
  const old = await scenario({ patched: false })
  assert.equal(old.closedFrames, 1); assert.equal(old.productBusy, false)
  assert.equal(old.workerTerminated, 0); assert.equal(old.workerReferenced, 1); assert.equal(old.workerOwnedServersListening, 1)
})
test("#725 duplicate native exit and a concurrent replacement cannot retire the replacement Worker", async () => {
  const actual = await scenario({ patched: true, duplicate: true, replacement: true })
  assert.equal(actual.oldWorkerTerminated, true); assert.equal(actual.replacementWorkerTerminated, false)
  assert.equal(actual.productBusy, true); assert.equal(actual.workerTerminated, 1)
  assert.equal(actual.nativeKill, 0); assert.equal(actual.treeKill, 0); assert.equal(actual.fork, 0)
})
test("#725 pre-ready deferred kill remains a separate unchanged boundary", async () => {
  const actual = await scenario({ patched: true, mode: "close-before-ready" })
  assert.equal(actual.upstreamReady, false); assert.equal(actual.upstreamDeferred, 1); assert.equal(actual.nativeKill, 0)
})
test("#725 source transform is exact, once-only, inverse-preserving and idempotent on both locked architectures", () => {
  const anchor = "        this._conoutSocketWorker.dispose();\n    };\n    return WindowsPtyAgent;"
  for (const arch of ["x64", "arm64"]) {
    assert.equal(hash(before), CERT.architectures[arch].beforeSHA256)
    const after = transform(before, arch)
    assert.equal(hash(after), CERT.architectures[arch].afterSHA256)
    assert.equal(after.toString().split(anchor).length, 2)
    assert.equal(after.toString().replace(anchor, "    };\n    return WindowsPtyAgent;"), before.toString())
    assert.equal(transform(after, arch), after)
  }
  assert.throws(() => transform(Buffer.concat([before, before]), "x64"), /PTY725_SOURCE/)
  assert.throws(() => transform(Buffer.from(before.toString().replace("this._outSocket.destroy();", "this._outSocket.end();")), "x64"), /PTY725_SOURCE/)
  assert.throws(() => transform(before, "ia32"), /PTY725_ARCH/)
})
test("#725 real ownedFS publishes both present Windows packages atomically and preserves mode; repeat is no-op", () => {
  const f = fixture()
  try {
    const mode = fs.lstatSync(f.file).mode
    assert.equal(f.run().patched, 2); assert.equal(hash(fs.readFileSync(f.file)), CERT.architectures.x64.afterSHA256)
    assert.equal(fs.lstatSync(f.file).mode, mode)
    const inode = fs.lstatSync(f.file, { bigint: true }).ino
    assert.equal(f.run().status, "already-patched"); assert.equal(fs.lstatSync(f.file, { bigint: true }).ino, inode)
    assert.equal(fs.readdirSync(path.dirname(f.file)).some(n => n.startsWith(".cmspark-725-")), false)
  } finally { f.close() }
})
test("#725 non-Windows and unsupported normal installs do not look up installed native packages", () => {
  const io = new Proxy({}, { get() { throw Error("UNEXPECTED_IO") } })
  assert.equal(patch({ platform: "darwin", io }).status, "not-windows")
  assert.equal(patch({ platform: "linux", io }).status, "not-windows")
  assert.equal(patch({ platform: "win32", arch: "ia32", io }).status, "not-supported")
  assert.throws(() => patch({ platform: "win32", arch: "ia32", required: true, io }), /PTY725_ARCH/)
})
test("#725 optional absent wrapper/platform is honest normal degradation, but Windows packaging refuses", () => {
  for (const missing of ["scope", "wrapper", "platform"]) {
    const f = fixture()
    try {
      if (missing === "scope") fs.rmSync(f.scope, { recursive: true })
      if (missing === "wrapper") { fs.rmSync(f.scope, { recursive: true }); fs.mkdirSync(f.scope) }
      if (missing === "platform") for (const arch of ["x64", "arm64"]) fs.rmSync(path.join(f.scope, "node-pty-win32-" + arch), { recursive: true })
      assert.equal(f.run().status, "not-installed"); assert.throws(() => f.run(fs, true), /PTY725_NOT_INSTALLED/)
    } finally { f.close() }
  }
})
test("#725 installed unknown version, lock integrity, source, missing metadata and alias-shaped file all refuse", () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { const p = path.join(f.scope, "node-pty/package.json"); const pkg = JSON.parse(fs.readFileSync(p, "utf8")); pkg.version = "1.2.0"; fs.writeFileSync(p, JSON.stringify(pkg)) },
    (f: ReturnType<typeof fixture>) => { const p = path.join(f.root, "package-lock.json"), lock = JSON.parse(fs.readFileSync(p, "utf8")); lock.packages["node_modules/@lydell/node-pty-win32-x64"].integrity = "unknown"; fs.writeFileSync(p, JSON.stringify(lock)) },
    (f: ReturnType<typeof fixture>) => fs.appendFileSync(f.file, "\n// unknown source"),
    (f: ReturnType<typeof fixture>) => fs.unlinkSync(path.join(f.scope, "node-pty-win32-x64/package.json")),
  ]
  for (const mutate of mutations) { const f = fixture(); try { mutate(f); assert.throws(() => f.run()); assert.equal(fs.readFileSync(path.join(f.scope, "node-pty-win32-arm64/lib/windowsPtyAgent.js")).equals(before), true) } finally { f.close() } }
  const f = fixture(); try {
    const io = { ...fs, lstatSync(name: fs.PathLike, opts?: any): any { const s = fs.lstatSync(name, opts); return String(name) === f.file ? new Proxy(s, { get(target, key) { if (key === "isSymbolicLink") return () => true; return Reflect.get(target, key) } }) : s } }
    assert.throws(() => f.run(io), /PTY725_FILE/)
  } finally { f.close() }
})
test("#725 a package directory junction or alias cannot redirect this fixed patch", () => {
  const f = fixture(); let alias = ""
  try {
    const pkg = path.join(f.scope, "node-pty-win32-x64"), held = pkg + "-held"; fs.renameSync(pkg, held)
    fs.symlinkSync(held, pkg, process.platform === "win32" ? "junction" : "dir"); alias = pkg
    assert.throws(() => f.run(), /PTY725_DIRECTORY/); assert.equal(fs.readFileSync(path.join(held, "lib/windowsPtyAgent.js")).equals(before), true)
  } finally { if (alias) fs.unlinkSync(alias); f.close() }
})
test("#725 incomplete write refuses and retains the original source without orphan pending files", () => {
  const f = fixture()
  try {
    const io = { ...fs, writeSync(fd: number, bytes: Buffer, offset: number, length: number) { return fs.writeSync(fd, bytes, offset, length - 1) } }
    assert.throws(() => f.run(io), /PTY725_INCOMPLETE_WRITE/)
    assert.equal(fs.readFileSync(f.file).equals(before), true)
    assert.equal(fs.readdirSync(path.dirname(f.file)).some(n => n.startsWith(".cmspark-725-")), false)
  } finally { f.close() }
})
test("#725 same-byte target replacement or directory identity change before publication refuses", () => {
  for (const change of ["file", "directory", "metadata"]) {
    const f = fixture(); let changed = false
    try {
      const io = { ...fs, fsyncSync(fd: number) { fs.fsyncSync(fd); if (!changed) { changed = true; if (change === "directory") { fs.renameSync(path.dirname(f.file), path.dirname(f.file) + "-held"); fs.mkdirSync(path.dirname(f.file)) } else if (change === "metadata") { fs.appendFileSync(path.join(f.scope, "node-pty/package.json"), " ") } else { fs.renameSync(f.file, f.file + ".held"); fs.writeFileSync(f.file, before) } } } }
      assert.throws(() => f.run(io)); if (change !== "directory") assert.equal(fs.readFileSync(f.file).equals(before), true)
    } finally { f.close() }
  }
})
test("#725 close error retires the local descriptor before its number can be reused; no close retry", () => {
  const f = fixture(); let pending: number | undefined, replacement: number | undefined, attempts = 0
  try {
    const io = { ...fs, openSync(name: fs.PathLike, flags: any, mode?: any) { const fd = fs.openSync(name, flags, mode); if (String(name).includes(".cmspark-725-")) pending = fd; return fd }, closeSync(fd: number) { if (fd === pending) { pending = undefined; attempts++; fs.closeSync(fd); replacement = fs.openSync(path.join(f.root, "unrelated-owned"), "wx"); throw Error("OWNED_CLOSE_FAILURE") } fs.closeSync(fd) } }
    assert.throws(() => f.run(io), /OWNED_CLOSE_FAILURE/); assert.equal(attempts, 1)
    assert.ok(replacement !== undefined); assert.ok(fs.fstatSync(replacement).isFile()); assert.equal(fs.readFileSync(f.file).equals(before), true)
  } finally { if (replacement !== undefined) fs.closeSync(replacement); f.close() }
})
test("#725 normal postinstall and both Windows packagers invoke the same strict patch before copy", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "companion/package.json"), "utf8"))
  assert.equal(pkg.scripts.postinstall, "node ../scripts/patch-node-pty-worker.cjs && node ../scripts/verify-systray2.js && node ../scripts/build-swift-tray.js")
  const ps = fs.readFileSync(path.join(repo, "scripts/build-windows-exe.ps1"), "utf8"), sh = fs.readFileSync(path.join(repo, "scripts/package.sh"), "utf8")
  const psPatchIndex = ps.indexOf('& $NodeExe "$ProjectRoot\\scripts\\patch-node-pty-worker.cjs" --windows-package')
  const psCopyIndex = ps.indexOf("$PtyPackages = @(")
  assert.ok(psPatchIndex >= 0, "the bound Node executable invokes the strict worker patch")
  assert.ok(psCopyIndex >= 0 && psPatchIndex < psCopyIndex, "strict worker correction precedes the packaging copy")
  assert.ok(ps.includes('if ($LASTEXITCODE -ne 0) { Fail "Pinned PTY worker correction refused" }'))
  assert.ok(sh.includes('windows-*) node "${ROOT_DIR}/scripts/patch-node-pty-worker.cjs" --windows-package ;;'))
  assert.ok(sh.indexOf("patch-node-pty-worker.cjs") < sh.indexOf('cp -r "companion/node_modules/@lydell"'))
})

// The canonical current lock is larger than the package/source file budget. Preserve its real bytes.
test("#725 real lock keeps its separate finite budget and optional absence remains honest", () => {
  const real = fs.readFileSync(path.join(repo, "companion/package-lock.json")); assert.ok(real.length > 131072); assert.ok(real.length <= 262144)
  const f = fixture()
  try {
    assert.equal(fs.readFileSync(path.join(f.root, "package-lock.json")).equals(real), true)
    assert.equal(f.run().patched, 2)
    fs.rmSync(f.scope, { recursive: true }); assert.equal(f.run().status, "not-installed"); assert.throws(() => f.run(fs, true), /PTY725_NOT_INSTALLED/)
  } finally { f.close() }
  for (const kind of ["lock", "package", "source"]) {
    const over = fixture()
    try {
      const target = kind === "lock" ? path.join(over.root, "package-lock.json") : kind === "package" ? path.join(over.scope, "node-pty/package.json") : over.file
      const bound = kind === "lock" ? 262144 : 131072, original = fs.readFileSync(target)
      fs.appendFileSync(target, " ".repeat(bound + 1 - original.length)); assert.throws(() => over.run(), /PTY725_FILE/)
      assert.equal(fs.readFileSync(path.join(over.scope, "node-pty-win32-arm64/lib/windowsPtyAgent.js")).equals(before), true)
    } finally { over.close() }
  }
})
