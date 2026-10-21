import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { createHash } from "node:crypto"
import primary from "./fixtures/cockpit-native-launch-155.json"

// Exact bounded source projections, never C#/C++/PS/Win32 execution. The
// immutable primary excerpts record full-source URL/bytes/hash and own hash.
const repo = path.basename(path.dirname(__dirname)) === ".test-dist" ? path.resolve(__dirname, "../../..") : path.resolve(__dirname, "../..")
const source = fs.readFileSync(path.join(repo, "scripts/tests/cockpit-bridge-chrome-job.cs"), "utf8")
const makeEnv = require(path.join(repo, "scripts/tests/cockpit-bridge-child-env.cjs"))
const win = path.win32, root = "C:\\owned\\cmspark-test-run-env"
const comspecEntry = '      fields.Add("ComSpec", Path.Combine(systemRoot, "System32", "cmd.exe"));'
class SortedFields {
  private fields = new Map<string, string>()
  Add(key: string, value: string) { assert.equal(this.fields.has(key), false); this.fields.set(key, value) }
  *[Symbol.iterator]() {
    const keys = [...this.fields.keys()].sort((a, b) => a.toUpperCase() < b.toUpperCase() ? -1 : a.toUpperCase() > b.toUpperCase() ? 1 : 0)
    for (const Key of keys) yield { Key, Value: this.fields.get(Key)! }
  }
}
class StringBuilder {
  private text = ""
  Append(value: string) { this.text += value; return this }
  ToString() { return this.text }
}
function produce(text: string, parent: Record<string, string>) {
  const normalized = text.replaceAll("\r\n", "\n")
  const methods = [...normalized.matchAll(/    internal string EnvironmentBlock\(\) \{\n([\s\S]*?)\n    \}/g)]
  assert.equal(methods.length, 1)
  let body = methods[0][1]
  const rewrites = [
    ["string systemRoot =", "let systemRoot ="],
    ["SortedDictionary<string, string> fields = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);", "const fields = new SortedFields();"],
    ["StringBuilder result = new StringBuilder();", "const result = new StringBuilder();"],
    ["foreach (KeyValuePair<string, string> field in fields)", "for (const field of fields)"],
  ]
  for (const [from, to] of rewrites) { assert.equal(body.split(from).length, 2); body = body.replace(from, to) }
  assert.doesNotMatch(body, /\b(?:internal|string|SortedDictionary|KeyValuePair|foreach)\b/)
  const directories = new Set([parent.SystemRoot, root]), reads: string[] = []
  const block: string = vm.runInNewContext("(function(){" + body + "\n})()", {
    Root: root, SortedFields, StringBuilder,
    Environment: { GetEnvironmentVariable(name: string) { reads.push(name); return parent[name] ?? null } },
    DirectoryPath(value: string) { assert.ok(directories.has(value)); return value },
    Path: { Combine: win.join }, Require(value: boolean) { assert.ok(value) },
    Directory: { Exists: (value: string) => directories.has(value), CreateDirectory(value: string) { assert.equal(value, win.join(root, "chrome-job-temp")); directories.add(value) } },
  })
  assert.ok(block.endsWith("\0\0") && !block.endsWith("\0\0\0"))
  const rows = block.slice(0, -2).split("\0")
  const fields: Record<string, string> = Object.fromEntries(rows.map(row => { const at = row.indexOf("="); assert.ok(at > 0); return [row.slice(0, at), row.slice(at + 1)] }))
  return { block, rows, fields, reads }
}
function contract(text: string, parent: Record<string, string>) {
  const result = produce(text, parent), temporary = win.join(root, "chrome-job-temp")
  assert.deepEqual(result.fields, { ComSpec: win.join(parent.SystemRoot, "System32", "cmd.exe"), PATH: win.join(parent.SystemRoot, "System32"),
    SystemRoot: parent.SystemRoot, TEMP: temporary, TMP: temporary, WINDIR: parent.SystemRoot })
  assert.deepEqual(result.reads, ["SystemRoot"], "no parent ComSpec or arbitrary environment reads")
  assert.deepEqual(result.rows.map(row => row.slice(0, row.indexOf("="))), ["ComSpec", "PATH", "SystemRoot", "TEMP", "TMP", "WINDIR"])
  const utf16 = Buffer.from(result.block, "utf16le")
  assert.equal(utf16.toString("utf16le"), result.block); assert.deepEqual([...utf16.subarray(-4)], [0, 0, 0, 0])
  return result
}
const tainted = { SystemRoot: "C:\\Windows", ComSpec: "C:\\foreign\\bad.exe", COMSPEC: "C:\\foreign\\other.exe", HOME: "INERT_HOME", USERPROFILE: "INERT_PROFILE", NODE_OPTIONS: "INERT_HOOK", HTTPS_PROXY: "INERT_PROXY", PROVIDER_KEY: "INERT_KEY", PATH: "INERT_PATH" }
function excerpt(key: keyof typeof primary.parts): string {
  const part = primary.parts[key]
  assert.equal(createHash("sha256").update(part.text).digest("hex"), part.textSHA256)
  assert.ok(part.sourceURL.includes("155.0.8059.84/")); assert.match(part.sourceSHA256, /^[0-9a-f]{64}$/)
  return part.text
}
function selected(managed: boolean | null, feature: boolean): boolean {
  const body = excerpt("managedSelection").replaceAll("->", ".")
    .replaceAll("prefs::kNativeHostsExecutablesLaunchDirectly", '"fixed-pref"')
    .replace(/base::FeatureList::IsEnabled\(\s*extensions_features::kLaunchWindowsNativeHostsDirectly\)/, "featureEnabled")
  return vm.runInNewContext("(function(){let native_hosts_executables_launch_directly;" + body + "\nreturn native_hosts_executables_launch_directly;})()", {
    featureEnabled: feature, profile: { GetPrefs: () => ({ IsManagedPreference: (key: string) => { assert.equal(key, "fixed-pref"); return managed !== null }, GetBoolean: () => managed }) },
  })
}
function direct(selection: boolean, exe = true): boolean {
  const body = excerpt("routeSelection").replace("const bool use_direct_launch", "const use_direct_launch").replace('L".exe"', '".exe"')
  return vm.runInNewContext("(function(){" + body + "\nreturn use_direct_launch;})()", {
    native_hosts_executables_launch_directly: selection,
    command_line: { GetProgram: () => ({ MatchesFinalExtension: (ext: string) => { assert.equal(ext, ".exe"); return exe } }) },
  })
}
function legacyAccepts(fields: Record<string, string>): boolean {
  const body = excerpt("legacyGuard").replace("DWORD comspec_length", "const comspec_length")
    .replace('::GetEnvironmentVariable(L"COMSPEC", NULL, 0)', 'GetEnvironmentVariable("COMSPEC", null, 0)')
    .replace('LOG(ERROR) << "COMSPEC is not set";', "observe();").replace("return base::Process();", "return false;")
  return vm.runInNewContext("(function(){" + body + "\nreturn true;})()", {
    GetEnvironmentVariable(name: string, buffer: null, size: number) {
      assert.equal(buffer, null); assert.equal(size, 0)
      const key = Object.keys(fields).find(key => key.toUpperCase() === name)
      return key && fields[key] ? fields[key].length + 1 : 0
    }, observe() {},
  })
}
test("actual Chrome Job environment computes exactly six fixed fields with LF/CRLF and tainted parent", () => {
  for (const newline of ["\n", "\r\n"]) for (const SystemRoot of ["C:\\Windows", "D:\\OS space 中文 %"]) {
    contract(source.replaceAll("\r\n", "\n").replaceAll("\n", newline), { ...tainted, SystemRoot })
    const parent = makeEnv({ ...tainted, SystemRoot, GITHUB_ACTIONS: "true", RUNNER_OS: "Windows" }, {
      root, data: win.join(root, "data"), temp: win.join(root, "temp"), compiled: "C:\\public\\compiled",
    })
    assert.equal(contract(source, parent).fields.ComSpec, parent.ComSpec)
  }
})
test("producer controls reject the old missing field, parent override and environment extras", () => {
  assert.equal(source.split(comspecEntry).length, 2)
  for (const changed of [source.replace(comspecEntry, ""), source.replace('Path.Combine(systemRoot, "System32", "cmd.exe")', 'Environment.GetEnvironmentVariable("ComSpec")'),
    source.replace(comspecEntry, comspecEntry + '\n      fields.Add("USERPROFILE", "INERT_PROFILE");')]) {
    assert.throws(() => contract(changed, tainted))
  }
})
test("fixed155 default/policy selection and legacy/direct source controls consume the actual block", () => {
  assert.match(excerpt("featureDefault"), /FEATURE_DISABLED_BY_DEFAULT/)
  assert.match(excerpt("registeredDefault"), /false\);$/)
  assert.equal(excerpt("policyDefault"), "default: null")
  const result = contract(source, tainted), without = { ...result.fields }; delete without.ComSpec
  assert.equal(selected(null, false), false); assert.equal(direct(selected(null, false)), false)
  assert.equal(legacyAccepts(result.fields), true); assert.equal(legacyAccepts(without), false)
  assert.equal(direct(selected(false, true)), false, "managed false retains the supported legacy route")
  assert.equal(direct(selected(true, false)), true); assert.equal(direct(selected(null, true)), true)
  assert.equal(direct(selected(true, false), false), false, "direct feature does not turn a non-EXE into direct launch")
  // Direct selection bypasses this legacy dependency. This is no native launch
  // positive and says nothing about the current Windows feature/policy value.
})
test("actual caller uses its explicit Unicode block and real build controls copy the current C#", () => {
  assert.ok(source.includes("environment = Marshal.StringToHGlobalUni(input.EnvironmentBlock());"))
  assert.ok(source.includes("false, 0x00000004 | 0x00000400, environment, input.Profile"))
  const controls = fs.readFileSync(path.join(repo, "scripts/tests/cockpit-bridge-build-completion.test.ps1"), "utf8")
  assert.ok(controls.includes("$jobControlSourceBytes = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'cockpit-bridge-chrome-job.cs'))"))
  assert.ok(controls.includes("[IO.File]::WriteAllBytes($jobControlSource, $jobControlSourceBytes)"))
  assert.ok(controls.includes("@('actual', 'missing-first', 'missing-second')"))
})

// Project only the actual C# nonce-reader constructor arguments. The IO seam
// models CreateFile's documented *two-way* access/share compatibility, not an
// executed .NET/Windows positive. The real CPU EXE also retains that negative.
function cpuNonce(text: string, ownerAccess = 3, ownerShare = 7) {
  const normalized = text.replaceAll("\r\n", "\n")
  const fragments = [...normalized.matchAll(/        string nonce[\s\S]*?(?=        long now =)/g)]
  assert.equal(fragments.length, 1)
  const fragment = fragments[0][0].trim(), attempts: number[] = [], events: string[] = []
  const value = "a".repeat(64), claimPath = win.join(root, "native-surface-650", "claim")
  const sharingFailure = () => Object.assign(Error("ERROR_SHARING_VIOLATION"), { code: 32 })
  class Input {
    closed = false
    constructor(file: string, mode: number, access: number, share: number) {
      assert.equal(file, claimPath); assert.equal(mode, 3); assert.equal(access, 1)
      attempts.push(share)
      if ((share & ownerAccess) !== ownerAccess || (ownerShare & access) !== access) throw sharingFailure()
      events.push("open")
    }
    Dispose() { if (!this.closed) { this.closed = true; events.push("close") } }
  }
  class Reader {
    constructor(private input: Input, encoding: string, detectBOM: boolean) { assert.equal(encoding, "ASCII"); assert.equal(detectBOM, true) }
    ReadToEnd() { assert.equal(this.input.closed, false); events.push("read"); return value }
    Dispose() { this.input.Dispose() }
  }
  let body: string
  if (fragment.startsWith("string nonce = File.ReadAllText(")) body = fragment.replace("string nonce", "let nonce") + "\nreturn nonce;"
  else {
    const match = /^string nonce;\s+using \(FileStream (\w+) = new FileStream\(([^;]+)\)\)\s+using \(StreamReader (\w+) = new StreamReader\(([^;]+)\)\) nonce = \3.ReadToEnd\(\);$/.exec(fragment)
    assert.ok(match, "keep the actual nonce-reader projection closed")
    body = `let nonce; const ${match[1]} = new FileStream(${match[2]}); try { const ${match[3]} = new StreamReader(${match[4]}); try { nonce = ${match[3]}.ReadToEnd(); } finally { ${match[3]}.Dispose(); } } finally { ${match[1]}.Dispose(); } return nonce;`
  }
  const nonce: string = vm.runInNewContext("(function(){" + body + "})()", {
    root, Path: { Combine: win.join }, Encoding: { ASCII: "ASCII" },
    FileMode: { Open: 3 }, FileAccess: { Read: 1 }, FileShare: { Read: 1, ReadWrite: 3, Delete: 4 },
    FileStream: Input, StreamReader: Reader,
    // Framework File.ReadAllText -> StreamReader(path) uses FileShare.Read.
    File: { ReadAllText(file: string, encoding: string) {
      const input = new Input(file, 3, 1, 1)
      try { return new Reader(input, encoding, true).ReadToEnd() } finally { input.Dispose() }
    } },
  })
  return { nonce, attempts, events }
}
test("actual CPU claim reader coexists with the live writable owner under LF/CRLF", () => {
  const cpu = fs.readFileSync(path.join(repo, "scripts/tests/cockpit-bridge-chrome-job-cpu.cs"), "utf8")
  const owner = fs.readFileSync(path.join(repo, "companion/tests/fixtures/native-surface-650.ts"), "utf8")
  assert.ok(owner.includes('fd = fs.openSync(claim, "wx+", 0o600)'))
  assert.ok(owner.includes('if (fd !== undefined) { fs.closeSync(fd); fd = undefined }'))
  for (const newline of ["\n", "\r\n"]) {
    const text = cpu.replaceAll("\r\n", "\n").replaceAll("\n", newline)
    const result = cpuNonce(text)
    assert.equal(result.nonce, "a".repeat(64)); assert.deepEqual(result.events, ["open", "read", "close"])
    assert.throws(() => cpuNonce(text.replace("FileShare.ReadWrite | FileShare.Delete", "FileShare.Read")), /ERROR_SHARING_VIOLATION/)
    assert.throws(() => cpuNonce(text, 3, 0), /ERROR_SHARING_VIOLATION/, "a truly exclusive foreign holder remains refused")
  }
})
