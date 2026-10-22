// #732 source-driven CPU only: no actual Windows/PowerShell/ACL operations.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

function nativeFixtureSource(): string {
  const files = [path.join(__dirname, "acp-history-native-732.test.ts"), path.resolve(__dirname, "../../tests/acp-history-native-732.test.ts")]
  const file = files.find(f => fs.existsSync(f))
  assert.ok(file)
  return fs.readFileSync(file!, "utf8")
}
function actualFixtureBodies(source: string): string {
  const ast = ts.createSourceFile("acp-history-native-732.test.ts", source, ts.ScriptTarget.Latest, true)
  const names = ["canonicalWindows", "fixtureObject", "owned"]
  const nodes = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text))
  assert.equal(nodes.length, names.length)
  return nodes.map(n => n.getText(ast)).join("\n")
}
function windowsRealpathModel(alias: string, canonical: string) {
  // Execute the exact runtime Node22 builtin, with Windows APIs replaced by a
  // non-symlink directory model. A native long name here is an explicit seam.
  const builtin = (process as unknown as { binding(name: string): Record<string, string> }).binding("natives").fs
  const begin = builtin.indexOf("function realpathSync("), native = builtin.indexOf("realpathSync.native", begin)
  const end = builtin.indexOf("\n/**", native)
  assert.ok(begin >= 0 && native > begin && end > native)
  const context: any = {
    // Model the ordinary runtime with Node permission mode disabled.
    // Node 22.23.4 realpathSync checks this dependency before its path walk.
    permission: { isEnabled: () => false, has: () => { throw new Error("UNEXPECTED_PERMISSION_QUERY") } },
    getOptions: () => ({}), toPathIfFileURL: (p: string) => p,
    validatePath: (p: unknown) => assert.equal(typeof p, "string"), pathModule: path.win32,
    realpathCacheKey: Symbol("cache"), SafeMap: Map, SafeSet: Set,
    splitRoot: (p: string) => path.win32.parse(p).root, nextPart: (p: string, n: number) => p.indexOf("\\", n),
    isWindows: true, binding: { lstat: () => ({ kind: "directory" }), realpath: (p: string) => { assert.ok(p === alias || p === canonical); return canonical } },
    StringPrototypeSlice: (s: string, ...a: number[]) => s.slice(...a), isFileType: () => false,
    statValues: {}, S_IFIFO: 1, S_IFSOCK: 2, S_IFLNK: 3, encodeRealpathResult: (p: string) => p, getValidatedPath: (p: string) => p,
  }
  vm.runInNewContext(builtin.slice(begin, end) + ";this.realpath=realpathSync", context, { timeout: 2000 })
  return context.realpath as typeof fs.realpathSync
}

test("#732 whole native fixture aligns short aliases without weakening retained-parent refusal", async t => {
  const source = nativeFixtureSource(), bodies = actualFixtureBodies(source)
  const alias = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\cmspark-history732-native-owned"
  const canonical = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\cmspark-history732-native-owned"
  type Result = { ok: boolean; error: string | null; ps: number; held: number; removed: number; canonicalArgument: boolean }
  async function run(text: string, short: boolean, replace: "none" | "before" | "after" = "none"): Promise<Result> {
    const root = short ? alias : canonical, realpath = windowsRealpathModel(root, canonical)
    let held = 0, ps = 0, removed = 0, pathReplaced = false, opened = false, canonicalArgument = false
    const stat = (ino: bigint) => ({ dev: 1n, ino, isDirectory: () => true, isSymbolicLink: () => false })
    const io = {
      constants: { O_RDONLY: 0 }, realpathSync: realpath, mkdtempSync: () => root,
      lstatSync: () => stat(pathReplaced || (replace === "before" && opened) ? 9n : 8n),
      openSync: () => { opened = true; held++; return 17 },
      fstatSync: () => stat(8n), closeSync: () => { held-- },
      rmSync: () => { removed++ },
    }
    const ctx: any = {
      assert, fs: io, path: path.win32, os: { tmpdir: () => path.win32.dirname(root) },
      process: { platform: "win32", env: { GITHUB_ACTIONS: "true", RUNNER_OS: "Windows" } },
      randomUUID: () => "01234567-89ab-4def-8abc-0123456789ab", resolveWinScript: (name: string) => name,
      runPs: async (script: string, args: string[]) => {
        ps++; assert.equal(script, "acp-history-native-fixture.ps1"); assert.equal(args.length, 5)
        canonicalArgument = args[0] === canonical
        if (replace === "after") pathReplaced = true
        return canonicalArgument ? '"INITIALIZED"' : '"REFUSED"'
      },
    }
    const code = ts.transpileModule(text + ";this.runOwned=owned", { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(code, ctx, { timeout: 2000 })
    let ok = true, error: string | null = null
    try { await ctx.runOwned(async () => {}) } catch (e: any) { ok = false; error = e.code === "ERR_ASSERTION" ? "ASSERTION" : e.message === "OWNED_HISTORY_NATIVE_CLEANUP_FAILED" ? "CLEANUP_REFUSED" : "REFUSED" }
    return { ok, error, ps, held, removed, canonicalArgument }
  }
  const oldBodies = bodies.replaceAll("fs.realpathSync.native(", "fs.realpathSync(")
  const actualShort = await run(bodies, true), oldShort = await run(oldBodies, true)
  const alreadyCanonical = await run(bodies, false), changedBefore = await run(bodies, true, "before"), changedAfter = await run(bodies, true, "after")
  t.diagnostic(JSON.stringify({ actualShort, oldShort, alreadyCanonical, changedBefore, changedAfter }))
  assert.equal(actualShort.ok, true)
  assert.equal(actualShort.ps, 1); assert.equal(actualShort.canonicalArgument, true); assert.equal(actualShort.removed, 1)
  assert.equal(oldShort.ok, false); assert.equal(oldShort.ps, 1); assert.equal(oldShort.canonicalArgument, false)
  assert.equal(alreadyCanonical.ok, true); assert.equal(alreadyCanonical.ps, 1); assert.equal(alreadyCanonical.removed, 1)
  assert.equal(changedBefore.ok, false); assert.equal(changedBefore.ps, 0)
  assert.equal(changedAfter.ok, false); assert.equal(changedAfter.ps, 1)
  // Both changed namespaces remain unremoved; only our retained fd is closed.
  assert.equal(changedBefore.removed, 0); assert.equal(changedAfter.removed, 0)
  for (const result of [actualShort, oldShort, alreadyCanonical, changedBefore, changedAfter]) assert.equal(result.held, 0)
  assert.equal((source.match(/fs\.realpathSync\.native\(/g) ?? []).length, 2)
})
