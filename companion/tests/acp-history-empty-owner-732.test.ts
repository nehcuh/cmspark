// #732 real store control flow with an explicit inert Windows/owner boundary, never NTFS proof.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
const storeFile = path.resolve(__dirname, "../../src/acp/history-store.ts")
function storeFixture(variant = "success", platform = "win32") {
  const root = "/owned", high = 0x20000000000000n
  const table = new Map<string, any>([[root, { dir: true, owner: variant === "unsafe-root" ? "other" : "user", ino: high, bytes: Buffer.alloc(0) }]])
  const descriptors = new Map<number, { name: string; object: any }>(); let next = 10, enabled = true, initialized = 0, writes = 0, creates = 0, removes = 0
  const absent = () => Object.assign(new Error("ABSENT"), { code: "ENOENT" })
  const stat = (r: any, big = false) => ({ dev: big ? 0xffffffffn : 0xffffffff, ino: big ? r.ino : Number(r.ino),
    nlink: big ? BigInt(r.links ?? 1) : r.links ?? 1, uid: big ? 1000n : 1000, mode: big ? BigInt(r.dir ? 0o40700 : 0o100600) : r.dir ? 0o40700 : 0o100600,
    size: big ? BigInt(r.bytes.length) : r.bytes.length, mtimeMs: big ? 1n : 1, ctimeMs: big ? 1n : 1,
    isDirectory: () => r.dir === true, isFile: () => !r.dir, isSymbolicLink: () => false })
  const fake: any = { constants: fs.constants, realpathSync: (p: string) => p,
    lstatSync(p: string, o?: any) { if (!table.has(p)) throw absent(); return stat(table.get(p), o?.bigint) },
    fstatSync(fd: number, o?: any) { if (!descriptors.has(fd)) throw absent(); return stat(descriptors.get(fd)!.object, o?.bigint) },
    openSync(p: string, flags: number, mode?: number) { const fd = next++
      if (p !== root) { assert.equal(mode, 0o600); assert.ok(flags & fs.constants.O_EXCL); assert.equal(table.has(p), false); creates++; table.set(p, { owner: platform === "win32" ? "other" : "user", ino: high + 8n, bytes: Buffer.alloc(0) }) }
      descriptors.set(fd, { name: p, object: table.get(p) }); return fd },
    closeSync(fd: number) { assert.ok(descriptors.delete(fd), "retire each owned descriptor once") },
    unlinkSync(p: string) { assert.ok(table.delete(p)); removes++ }, existsSync: (p: string) => table.has(p),
    writeSync(fd: number, b: Buffer, offset: number, length: number) { writes++; const r = descriptors.get(fd)!.object; r.bytes = Buffer.concat([r.bytes, b.subarray(offset, offset + length)]); return length },
    fsyncSync() {}, renameSync(a: string, b: string) { assert.ok(table.has(a)); table.set(b, table.get(a)); table.delete(a) } }
  const privacy = async (paths: string[]) => paths.every(p => table.get(p)?.owner === "user") ? "PRIVATE" : "REFUSED"
  const imports: any = { fs: fake, path: path.posix, crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" }, "./history-privacy": { verifyHistoryPrivacy: privacy },
    "./history-new-empty": { initializeHistoryEmpty: async (r: string, name: string, parent: number, fd: number, current: () => boolean) => {
      initialized++; assert.equal(r, root); assert.match(name, /^acp-history\./); assert.equal(descriptors.get(parent)?.name, root); assert.equal(descriptors.get(fd)?.name, path.posix.join(root, name)); assert.equal(current(), true)
      const file = table.get(path.posix.join(root, name)); file.owner = "user"
      if (variant === "partial") return "REFUSED"
      if (variant === "unknown") return "UNKNOWN"
      if (variant === "disable") enabled = false
      if (variant === "root-replaced") table.set(root, { ...table.get(root), ino: table.get(root).ino + 1n }) // Number(high) == Number(high+1): exact BigInt fence required.
      if (variant === "file-replaced") table.set(path.posix.join(root, name), { ...file, ino: file.ino + 1n })
      if (variant === "linked") file.links = 2
      if (variant === "nonempty") file.bytes = Buffer.from("X")
      return "INITIALIZED"
    } } }
  const module = { exports: {} as any }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(storeFile, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, Buffer, process: { platform, getuid: () => 1000 }, require: (name: string) => { assert.ok(Object.hasOwn(imports, name), name); return imports[name] } })
  const store = new module.exports.AcpHistoryStore({ root: () => root, enabled: () => enabled, privacy })
  return { async run() { store.note({ session_id: "synthetic-session", thread_id: "synthetic-thread", agent_id: "synthetic-agent", mode: "review_readonly", state: "running", created_at: "2026-10-19T12:00:00.000Z" }); await store.settle(); return store.list("synthetic-thread", []) }, stats: () => ({ initialized, writes, creates, removes, descriptors: descriptors.size }) }
}
test("#732 exact new empty initialization lets actual Windows-shaped store write only after owner setup", async () => {
  const f = storeFixture(), reply = await f.run(); assert.equal(reply.status, "ok"); assert.equal(reply.rows.length, 1); assert.equal(f.stats().initialized, 1); assert.ok(f.stats().writes > 0); assert.equal(f.stats().descriptors, 0)
})
for (const variant of ["partial", "unknown", "disable", "root-replaced", "file-replaced", "linked", "nonempty"]) test("#732 actual store new empty boundary refuses " + variant + " before metadata", async () => {
  const f = storeFixture(variant), reply = await f.run(); assert.notEqual(reply.status, "ok"); assert.equal(reply.rows.length, 0); assert.equal(f.stats().initialized, 1); assert.equal(f.stats().writes, 0); assert.equal(f.stats().descriptors, 0)
})
test("#732 unsafe existing root is never repaired or passed to initialization", async () => {
  const f = storeFixture("unsafe-root"), reply = await f.run(); assert.equal(reply.status, "private_refused"); assert.deepEqual(f.stats(), { initialized: 0, writes: 0, creates: 0, removes: 0, descriptors: 0 })
})
test("#732 POSIX writer keeps original exclusive-create path without Windows initialization", async () => {
  const f = storeFixture("success", "darwin"), reply = await f.run(); assert.equal(reply.status, "ok"); assert.equal(reply.rows.length, 1); assert.equal(f.stats().initialized, 0); assert.ok(f.stats().writes > 0); assert.equal(f.stats().descriptors, 0)
})

const emptyFile = path.resolve(__dirname, "../../src/acp/history-new-empty.ts")
function emptyHelper(variant = "good", wire: any = '"INITIALIZED"') {
  const root = "C:\\owned", name = "acp-history.11111111-1111-4111-8111-111111111111.tmp", high = 0xfffffffffffffff0n
  let enabled = variant !== "disabled", calls = 0, reads = 0, afterReads = 0, completed = false
  const directory: any = { dev: 0xffffffffn, ino: high, nlink: 1n, size: 0n, isDirectory: () => true, isSymbolicLink: () => false }
  const file: any = { dev: 0xffffffffn, ino: high + 1n, nlink: 1n, size: 0n, isFile: () => true, isSymbolicLink: () => false }
  if (variant === "nonempty") file.size = 1n
  if (variant === "hardlink") file.nlink = 2n
  if (variant === "nonregular") file.isFile = () => false
  if (variant === "ino-number") file.ino = Number(file.ino)
  if (variant === "ino-overflow") file.ino = 0x10000000000000000n
  if (variant === "dev-overflow") file.dev = 0x100000000n
  const touch = () => { reads++; if (completed) afterReads++ }
  const fake: any = { fstatSync(fd: number, o: any) { touch(); assert.equal(o.bigint, true); if (variant === "closed") throw Error("FD_CLOSED_PRIVATE"); return { ...(fd === 11 ? directory : file) } },
    lstatSync(p: string, o: any) { touch(); assert.equal(o.bigint, true); return { ...(p === root ? directory : file),
      ...(variant === "linked-path" && p !== root ? { isSymbolicLink: () => true } : {}),
      ...(completed && ((variant === "late-root" && p === root) || (variant === "late-file" && p !== root)) ? { ino: high - 1n } : {}) } },
    realpathSync(p: string) { touch(); return variant === "alias" ? "C:\\other" : p }, closeSync() { assert.fail("callee must never close caller fd") } }
  const module = { exports: {} as any }, env: any = { module, exports: module.exports, Buffer, process: { platform: variant === "posix" ? "darwin" : "win32" }, require: (n: string) => {
    if (n === "fs") return fake; if (n === "path") return path.win32
    assert.equal(n, "../host-use/win/powershell"); return { resolveWinScript: (s: string) => { assert.equal(s, "acp-history-new-empty.ps1"); return "FIXED_PRIVATE_HELPER" },
      runPs: async (script: string, args: string[], options: unknown) => {
        calls++; assert.equal(script, "FIXED_PRIVATE_HELPER"); assert.deepEqual(Array.from(args), [root, name, "4294967295", "18446744073709551600", "4294967295", "18446744073709551601"]); assert.equal(options, undefined)
        completed = true; if (variant === "disable-after") enabled = false
        if (variant === "query-throws") throw Error("PRIVATE_SID_ERROR_NEVER_EXPOSE")
        return wire
      } }
  } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(emptyFile, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, env)
  return { run: (overrides: any = {}) => module.exports.initializeHistoryEmpty(overrides.root ?? root, overrides.name ?? name, overrides.parent ?? 11, overrides.fd ?? 12, () => enabled), stats: () => ({ calls, reads, afterReads }) }
}
test("#732 private helper bridge retains full uint64 identity in argv and original PsRunner budget", async () => {
  const f = emptyHelper(); assert.equal(await f.run(), "INITIALIZED"); assert.equal(f.stats().calls, 1)
})
for (const variant of ["nonempty", "hardlink", "nonregular", "ino-number", "ino-overflow", "dev-overflow", "linked-path", "closed", "alias"]) test("#732 private helper refuses " + variant + " before any native call", async () => {
  const f = emptyHelper(variant); assert.notEqual(await f.run(), "INITIALIZED"); assert.equal(f.stats().calls, 0)
})
for (const variant of ["late-root", "late-file", "disable-after", "query-throws"]) test("#732 private helper never publishes initialization after " + variant, async () => {
  const f = emptyHelper(variant); assert.notEqual(await f.run(), "INITIALIZED"); assert.equal(f.stats().calls, 1); if (variant === "disable-after") assert.equal(f.stats().afterReads, 0)
})
test("#732 helper disabled/nonWindows/bad literal inputs cause zero FS and native effects", async () => {
  for (const variant of ["disabled", "posix"]) { const f = emptyHelper(variant); assert.notEqual(await f.run(), "INITIALIZED"); assert.deepEqual(f.stats(), { calls: 0, reads: 0, afterReads: 0 }) }
  for (const input of [{ root: "relative" }, { root: "\\\\server\\share" }, { root: "\\\\?\\C:\\owned" }, { name: "other.tmp" }, { name: "acp-history.11111111-1111-4111-8111-111111111111.tmp/.." }, { name: ["acp-history.11111111-1111-4111-8111-111111111111.tmp"] }, { parent: -1 }, { parent: 12 }, { fd: 1.5 }]) {
    const f = emptyHelper(); assert.notEqual(await f.run(input), "INITIALIZED"); assert.equal(f.stats().reads, 0); assert.equal(f.stats().calls, 0)
  }
})
test("#732 helper accepts only closed JSON strings without reflection or coercion", async () => {
  for (const [wire, expected] of [['"REFUSED"', "REFUSED"], ['"UNKNOWN"', "UNKNOWN"], ['"INITIALIZED"\nPRIVATE_SID', "UNKNOWN"], ["PRIVATE", "UNKNOWN"], ['{"status":"INITIALIZED"}', "UNKNOWN"], ["[]", "UNKNOWN"], ["x".repeat(65), "UNKNOWN"], [{ toString() { assert.fail("no coercion") } }, "UNKNOWN"]] as const) {
    const f = emptyHelper("good", wire); assert.equal(await f.run(), expected)
  }
})
test("#732 native initializer source is bound-handle only; original PRIVATE script remains read-only", () => {
  const scripts = path.resolve(__dirname, "../../src/host-use/win/scripts")
  const native = fs.readFileSync(path.join(scripts, "acp-history-private-native.ps1"), "utf8")
  for (const text of [native, native.replace(/\r?\n/g, "\r\n")]) {
    assert.match(text, /SetSecurityInfo\(child,1,OWNER_INFO\|DACL_INFO\|PROTECTED_DACL/)
    assert.match(text, /DefaultDllImportSearchPaths\(DllImportSearchPath.System32\)/)
    assert.match(text, /Environment.GetEnvironmentVariable\("GITHUB_ACTIONS"\)!="true"/)
    assert.match(text, /NtQueryInformationFile\(h,out io,out id,.*?,6\)/)
    assert.match(text, /NtQueryVolumeInformationFile\(h,out io,out v,.*?,1\)/)
    assert.match(text, /unchecked\(\(ulong\)id.IndexNumber\)==index/)
    const initialize = text.slice(text.indexOf("public static string Initialize("), text.indexOf("public static string Fixture("))
    const set = initialize.indexOf("SetSecurityInfo(child")
    assert.ok(set > initialize.indexOf("!Bound(child,fv,fi,false,true,file)")); assert.ok(set > initialize.indexOf("!Private(parent,user)"))
    assert.ok(initialize.indexOf("!Private(child,user,true)", set) > set)
    assert.doesNotMatch(text.replace(/\/\/[^\r\n]*/g, ""), /SetNamedSecurityInfo|Set-Acl|SetTokenInformation|AdjustTokenPrivileges|GetChildItem|Process\.Start|Directory\.CreateDirectory|FILE_SHARE_DELETE/)
  }
  const fixture = fs.readFileSync(path.join(scripts, "acp-history-native-fixture.ps1"), "utf8")
  assert.match(fixture, /GITHUB_ACTIONS -cne 'true'/); assert.match(fixture, /RUNNER_OS -cne 'Windows'/)
  const readonly = fs.readFileSync(path.join(scripts, "acp-history-privacy.ps1"), "utf8")
  assert.doesNotMatch(readonly, /Set-Acl|SetAccessControl|SetSecurityInfo|SetToken/)
})

function fixtureProjection(variant = "good") {
  const source = fs.readFileSync(path.resolve(__dirname, "../../tests/acp-history-native-732.test.ts"), "utf8")
  const ast = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.ES2022, true)
  const bodies = ["canonicalWindows", "fixtureObject"].map(name => {
    const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
    assert.ok(fn); return fn.getText(ast)
  }).join("\n")
  let calls = 0, reads = 0, closed = 0, complete = false
  const original = { dev: 4294967295n, ino: 18446744073709551600n, isDirectory: () => true, isSymbolicLink: () => false }
  const fake = { constants: fs.constants, openSync() { reads++; return 11 }, fstatSync() { reads++; return original },
    lstatSync() { reads++; return { ...original, ...(complete && variant === "replaced" ? { ino: original.ino + 1n } : {}) } },
    realpathSync(p: string) { reads++; return p }, closeSync() { closed++ } }
  const module = { exports: {} as any }
  vm.runInNewContext(ts.transpileModule(bodies + "\nmodule.exports={fixtureObject}", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { module, assert, fs: fake, process: { platform: variant === "posix" ? "darwin" : "win32", env: { GITHUB_ACTIONS: variant === "manual" ? "false" : "true", RUNNER_OS: "Windows" } },
      resolveWinScript: (name: string) => { assert.equal(name, "acp-history-native-fixture.ps1"); return "FIXED_FIXTURE" },
      runPs: async (script: string, args: string[]) => { calls++; assert.equal(script, "FIXED_FIXTURE"); assert.deepEqual(Array.from(args), ["C:\\owned", "empty", "4294967295", "18446744073709551600", "empty"]); complete = true; return variant === "refused" ? '\"REFUSED\"' : '\"INITIALIZED\"' } })
  return { run: () => module.exports.fixtureObject("C:\\owned", "empty", "empty"), stats: () => ({ calls, reads, closed }) }
}
test("#732 actual fixture caller binds retained parent exact integers and refuses changed/failing creation", async () => {
  const good = fixtureProjection(); await good.run(); assert.equal(good.stats().calls, 1); assert.equal(good.stats().closed, 1)
  for (const variant of ["replaced", "refused"]) { const f = fixtureProjection(variant); await assert.rejects(f.run()); assert.equal(f.stats().calls, 1); assert.equal(f.stats().closed, 1) }
  for (const variant of ["manual", "posix"]) { const f = fixtureProjection(variant); await assert.rejects(f.run()); assert.deepEqual(f.stats(), { calls: 0, reads: 0, closed: 0 }) }
})
test("#732 fixture native source creates only absent final children with explicit protected owner descriptor", () => {
  const native = fs.readFileSync(path.resolve(__dirname, "../../src/host-use/win/scripts/acp-history-private-native.ps1"), "utf8")
  const fixture = native.slice(native.indexOf("public static string Fixture("))
  assert.match(fixture, /Environment.OSVersion.Platform!=PlatformID.Win32NT/)
  assert.match(fixture, /CreateFileW\(target,.*?ref sa,CREATE_NEW/)
  assert.match(fixture, /if\(!CreateDirectoryW\(target,ref sa\)\)return "REFUSED"/)
  assert.match(fixture, /sd=Descriptor\(user,!file\)/)
  assert.match(fixture, /!Private\(created,user,true\)/)
  assert.doesNotMatch(fixture, /SetSecurityInfo|Set-Acl|SetToken|AdjustToken/)
})
