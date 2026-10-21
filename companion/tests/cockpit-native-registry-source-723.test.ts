import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

// Deliberately strict source consumers, not a PowerShell/C# compiler or a
// Windows registry execution. Execute the actual narrow boolean expressions over
// the documented HKCU shared-key alias and hostile value/name/subkey inputs.
function uniqueAfter(source: string, marker: string): string {
  const lexical = source.replace(/\r\n/g, "\n")
  assert.equal(lexical.split(marker).length, 2, "actual registry consumer must remain unique")
  return lexical.slice(lexical.indexOf(marker) + marker.length)
}
function condition(source: string): string {
  const start = source.indexOf("if (")
  assert.ok(start >= 0)
  let depth = 0, quoted = "", escaped = false
  for (let i = start + 3; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === "\\" && quoted === '"') escaped = true
      else if (char === quoted) quoted = ""
      continue
    }
    if (char === '"' || char === "'") { quoted = char; continue }
    if (char === "(") depth++
    if (char === ")" && --depth === 0) return source.slice(start + 4, i)
  }
  throw Error("actual condition has no balanced end")
}
const companionRoot = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../.." : "..")
const hostFile = path.join(companionRoot, "src/computer/native/cockpit-bridge-host.cs")
const installerFile = path.resolve(companionRoot, "../scripts/register-cockpit-native-bridge.ps1")
const host = fs.readFileSync(hostFile, "utf8")
const installer = fs.readFileSync(installerFile, "utf8")
const nativeExpression = condition(uniqueAfter(host, "if (key == null) continue;"))
const powershellExpression = condition(uniqueAfter(installer, "      try {\n        "))
const nativeJs = nativeExpression.replace('(key.GetValue("") as string)', 'key.GetValue("")').replaceAll('RegistryValueKind.String', '"String"')
const powershellJs = powershellExpression
  .replaceAll("@($key.GetSubKeyNames()).Count", "key.GetSubKeyNames().length")
  .replaceAll("@($key.GetValueNames()).Count", "key.GetValueNames().length")
  .replaceAll("$key.GetValueNames()[0]", "key.GetValueNames()[0]")
  .replaceAll("$key.GetValue('')", "key.GetValue('')")
  .replaceAll("$key.GetValueKind('')", "key.GetValueKind('')")
  .replaceAll("[Microsoft.Win32.RegistryValueKind]::String", '"String"')
  .replaceAll("$RegistryView", "ownerView").replaceAll("$manifestPath", "manifest")
  .replaceAll("$record", "record").replaceAll("$view", "view").replaceAll("$null", "null")
  .replaceAll("-cne", "!==").replaceAll("-ne", "!==").replaceAll("-eq", "===").replaceAll("-or", "||")
function predicate(source: string): (input: Record<string, unknown>) => boolean {
  // Reject unknown syntax rather than silently emulate more language features.
  assert.match(source, /^[a-zA-Z0-9_\s().[\]"'|!=]+$/)
  const script = new vm.Script(`Boolean(${source})`)
  return input => script.runInNewContext(input, { timeout: 1000 })
}
const nativeRejects = predicate(nativeJs), installerRejects = predicate(powershellJs)
const manifest = "C:\\owned\\native-messaging\\com.cmspark.cockpit.json"
function key(value: unknown = manifest, names = [""], children: string[] = [], kind = "String") {
  return { ValueCount: names.length, SubKeyCount: children.length,
    GetValue(name: string) { assert.equal(name, ""); return value },
    GetValueKind(name: string) { assert.equal(name, ""); return kind },
    GetValueNames() { return names }, GetSubKeyNames() { return children } }
}
function bothRejects(observed: ReturnType<typeof key>, view = "Registry32", record: object | null = {}): [boolean, boolean] {
  return [nativeRejects({ current: { ToString: () => view }, view: "Registry64", key: observed, manifest }),
    installerRejects({ view, ownerView: "Registry64", key: observed, manifest, record })]
}

test("same physical owned HKCU key is accepted through both WOW64 view aliases", () => {
  const actualSharedKey = key()
  for (const view of ["Registry32", "Registry64"]) assert.deepEqual(bothRejects(actualSharedKey, view), [false, false])
})
test("different default path is rejected through both views", () => {
  for (const view of ["Registry32", "Registry64"]) assert.deepEqual(bothRejects(key("C:\\foreign.json"), view), [true, true])
})
test("extra value cannot masquerade as the one owned default", () => {
  assert.deepEqual(bothRejects(key(manifest, ["", "other"])), [true, true])
})
test("a child key remains a conflict", () => {
  assert.deepEqual(bothRejects(key(manifest, [""], ["child"])), [true, true])
})
test("a missing or non-default-only value remains a conflict", () => {
  assert.deepEqual(bothRejects(key(null, [])), [true, true])
  assert.deepEqual(bothRejects(key(null, ["other"])), [true, true])
})
test("installer still requires an owned record before accepting any existing key", () => {
  assert.equal(bothRejects(key(), "Registry64", null)[1], true)
})

test("a changed registry value kind cannot inherit the REG_SZ ownership receipt", () => {
  assert.deepEqual(bothRejects(key(manifest, [""], [], "ExpandString"), "Registry64"), [true, true])
})


test("whole actual registry consumer keeps all ownership assertions in source/compiled layouts and LF/CRLF", () => {
  const testFile = path.join(companionRoot, "tests/cockpit-native-registry-source-723.test.ts")
  const source = fs.readFileSync(testFile, "utf8")
  const javascript = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  for (const directory of [path.join(companionRoot, "tests"), path.join(companionRoot, ".test-dist/tests")]) {
    for (const eol of ["\n", "\r\n"]) {
      const nativeBytes = host.replace(/\r?\n/g, eol)
      const installerBytes = installer.replace(/\r?\n/g, eol)
      const execute = (ps: string, cs = nativeBytes) => {
        const callbacks: { name: string; run: () => void }[] = []
        const modules: Record<string, unknown> = {
          "node:test": (name: string, run: () => void) => { callbacks.push({ name, run }) },
          "node:assert/strict": assert, "node:path": path, "node:vm": vm, typescript: ts,
          "node:fs": { readFileSync(file: string, encoding: string) {
            assert.equal(encoding, "utf8")
            const selected = path.resolve(file)
            if (selected === hostFile) return cs
            if (selected === installerFile) return ps
            throw Error("unexpected actual registry source read")
          } },
        }
        new vm.Script(javascript, { filename: path.join(directory, "cockpit-native-registry-source-723.test.js") })
          .runInNewContext({ exports: {}, __dirname: directory, require: (id: string) => {
            assert.ok(Object.hasOwn(modules, id)); return modules[id]
          } })
        assert.equal(callbacks.length, 8)
        // The eighth callback is this regression, not a shadow ownership rule.
        for (const callback of callbacks.slice(0, 7)) callback.run()
      }
      execute(installerBytes)
      const psMarker = "      try {" + eol + "        "
      const refused = { code: "ERR_ASSERTION", message: /actual registry consumer must remain unique/ }
      assert.throws(() => execute(installerBytes.replace(psMarker, "      omitted {" + eol + "        ")), refused)
      assert.throws(() => execute(installerBytes + eol + psMarker), refused)
      const csMarker = "if (key == null) continue;"
      assert.throws(() => execute(installerBytes, nativeBytes.replace(csMarker, "/* omitted consumer */")), refused)
      assert.throws(() => execute(installerBytes, nativeBytes + eol + csMarker), refused)
    }
  }
})
