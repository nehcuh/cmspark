/** CPU-only: execute Node's actual JS realpath and the native test's actual oracle. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

const repo = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../.." : "../..")
const nativeSource = fs.readFileSync(path.join(repo, "companion/tests/workspace-picker-windows-native-726.test.ts"), "utf8")

function oracle(source: string) {
  const sf = ts.createSourceFile("native.ts", source, ts.ScriptTarget.Latest, true)
  const expected: ts.VariableDeclaration[] = [], comparisons: ts.CallExpression[] = []
  function visit(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === "expected") expected.push(n)
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "assert.equal" &&
        n.arguments[0]?.getText(sf) === "fs.realpathSync(picked.path)" && n.arguments[1]?.getText(sf) === "expected") comparisons.push(n)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  assert.equal(expected.length, 1); assert.equal(comparisons.length, 1)
  return `const ${expected[0].getText(sf)}; ${comparisons[0].getText(sf)};`
}

function realpaths() {
  const builtin = (process as any).binding("natives").fs as string
  const begin = builtin.indexOf("function realpathSync("), native = builtin.indexOf("realpathSync.native", begin)
  const end = builtin.indexOf("\n/**", native)
  assert.ok(begin >= 0 && native > begin && end > native)
  const alias = "C:\\Users\\OWNED~1\\Temp\\picker726\\workspace", canonical = "C:\\Users\\owned-test-user\\Temp\\picker726\\workspace"
  let nativeCalls = 0
  const context: any = {
    // Model the ordinary runtime with Node permission mode disabled.
    // Node 22.23.4 realpathSync checks this dependency before its path walk.
    permission: { isEnabled: () => false, has: () => { throw new Error("UNEXPECTED_PERMISSION_QUERY") } },
    getOptions: () => ({}), toPathIfFileURL: (v: string) => v, validatePath: (v: unknown) => assert.equal(typeof v, "string"),
    pathModule: path.win32, realpathCacheKey: Symbol("cache"), SafeMap: Map, SafeSet: Set,
    splitRoot: (v: string) => path.win32.parse(v).root, nextPart: (v: string, from: number) => v.indexOf("\\", from), isWindows: true,
    binding: { lstat: () => ({}), realpath: (v: string) => { nativeCalls++; return v === alias ? canonical : v } },
    StringPrototypeSlice: (v: string, ...args: [number, number?]) => v.slice(...args), isFileType: () => false,
    statValues: {}, S_IFIFO: 1, S_IFSOCK: 2, S_IFLNK: 3, encodeRealpathResult: (v: string) => v, getValidatedPath: (v: string) => v,
  }
  vm.runInNewContext(builtin.slice(begin, end) + "; this.realpathSync = realpathSync", context, { timeout: 2000 })
  return { alias, canonical, fs: { realpathSync: context.realpathSync }, calls: () => nativeCalls }
}

test("#726 actual native oracle aligns its expected root with Windows expanded picker spelling, LF and CRLF", () => {
  for (const newline of ["\n", "\r\n"]) {
    const p = realpaths()
    assert.equal(p.fs.realpathSync(p.alias), p.alias, "actual JS non-symlink walk preserves short spelling")
    assert.equal(p.fs.realpathSync.native(p.alias), p.canonical, "declared native binding expands the owned alias")
    vm.runInNewContext(oracle(nativeSource.replace(/\r?\n/g, newline)), {
      fs: p.fs, root: p.alias, picked: { path: p.canonical }, assert,
    }, { timeout: 2000 })
    assert.ok(p.calls() >= 2)
  }
})

test("#726 old JS-only expected-root oracle actually fails for the same owned short/long pair", () => {
  const p = realpaths(), old = nativeSource.replace("const expected = fs.realpathSync.native(root)", "const expected = fs.realpathSync(root)")
  assert.equal(old !== nativeSource, true)
  assert.throws(() => vm.runInNewContext(oracle(old), { fs: p.fs, root: p.alias, picked: { path: p.canonical }, assert }, { timeout: 2000 }),
    (error: any) => error.code === "ERR_ASSERTION")
})

test("#726 exact oracle still rejects another selected directory and propagates unavailable native identity", () => {
  const p = realpaths(), source = oracle(nativeSource)
  vm.runInNewContext(source, { fs: p.fs, root: p.canonical, picked: { path: p.canonical }, assert }, { timeout: 2000 })
  assert.throws(() => vm.runInNewContext(source, { fs: p.fs, root: p.alias, picked: { path: p.canonical + "-other" }, assert }, { timeout: 2000 }),
    (error: any) => error.code === "ERR_ASSERTION")
  p.fs.realpathSync.native = () => { throw Error("OWNED_NATIVE_IDENTITY_UNAVAILABLE") }
  assert.throws(() => vm.runInNewContext(source, { fs: p.fs, root: p.alias, picked: { path: p.canonical }, assert }, { timeout: 2000 }),
    /OWNED_NATIVE_IDENTITY_UNAVAILABLE/)
})
