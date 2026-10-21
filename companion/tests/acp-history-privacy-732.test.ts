import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
const filename = path.resolve(__dirname, "../../src/acp/history-privacy.ts")
function privacyModule(value: string, throws = false) {
  const calls: Array<{ script: string; args: string[]; options: unknown }> = []
  const module = { exports: {} as any }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, require: (name: string) => {
    assert.equal(name, "../host-use/win/powershell")
    return { resolveWinScript: (name: string) => { assert.equal(name, "acp-history-privacy.ps1"); return "/inert/fixed-first-party.ps1" },
      runPs: async (script: string, args: string[], options: unknown) => { calls.push({ script, args, options }); if (throws) throw Error("not exposed"); return value } }
  } })
  return { check: module.exports.verifyHistoryPrivacy, calls }
}
for (const [wire, expected] of [["\"PRIVATE\"", "PRIVATE"], ["\"REFUSED\"", "REFUSED"], ["\"UNKNOWN\"", "UNKNOWN"],
  ["PRIVATE", "UNKNOWN"], ["{\"SID\":\"NEVER_EXPOSE\"}", "UNKNOWN"], ["[]", "UNKNOWN"], ["\"PRIVATE\"\nSIDE_TEXT", "UNKNOWN"], ["null", "UNKNOWN"]]) {
  test(`#732 privacy helper accepts only fixed enum JSON (${wire.length}/${expected})`, async () => {
    const f = privacyModule(wire)
    assert.equal(await f.check(["C:\\inert root", "C:\\inert root\\file's ; literal.tmp"]), expected)
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].script, "/inert/fixed-first-party.ps1")
    assert.equal(f.calls[0].args[1], "C:\\inert root\\file's ; literal.tmp")
    assert.equal(f.calls[0].options, undefined, "existing runner budget is not extended")
  })
}
test("#732 privacy helper rejects invalid argv and query failures without fallback", async () => {
  const f = privacyModule('"PRIVATE"', true)
  for (const paths of [[], [""], ["a\0b"], ["a", "b", "c"]]) assert.equal(await f.check(paths), "UNKNOWN")
  assert.equal(f.calls.length, 0)
  assert.equal(await f.check(["C:\\inert"]), "UNKNOWN"); assert.equal(f.calls.length, 1)
})
test("#732 fixed Windows script is read-only and finite; source contract is not native ACL proof", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/host-use/win/scripts/acp-history-privacy.ps1"), "utf8")
  assert.match(source, /Get-Acl -LiteralPath \$literal/)
  assert.match(source, /WindowsIdentity\]::GetCurrent\(\)\.User/)
  assert.match(source, /DiscretionaryAclPresent/); assert.match(source, /\$null -eq \$raw\.DiscretionaryAcl/)
  assert.match(source, /\.CommonAce/); assert.match(source, /\$ace\.IsCallback/)
  assert.match(source, /'S-1-5-18', 'S-1-5-32-544'/)
  assert.match(source, /\$allowed -notcontains \$ace\.SecurityIdentifier\.Value/)
  assert.doesNotMatch(source, /Set-Acl|icacls|SetAccessRuleProtection|Write-Host|Write-Error|Get-Acl -Path/)
})

// #732 explicit diagnostic is supplementary; these are source/CPU projections, not PS/NTFS.
import { createHash } from "node:crypto"
const psFile732 = path.resolve(__dirname, "../../src/host-use/win/scripts/acp-history-privacy.ps1")
const nativeFile732 = path.resolve(__dirname, "../../tests/acp-history-native-732.test.ts")
function nativeDiagnostic732(primary = "REFUSED", wire = '{"status":"REFUSED","reason":"OWNER","pathIndex":0}', shape: any = { platform: "win32", env: { GITHUB_ACTIONS: "true", RUNNER_OS: "Windows" } }, logThrows = false) {
  const sf = ts.createSourceFile("native.ts", fs.readFileSync(nativeFile732, "utf8"), ts.ScriptTarget.Latest, true)
  const declarations = ["privacyDiagnosticDTO", "privatePrerequisite"].map(name => {
    const found = sf.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
    assert.equal(found.length, 1, "real diagnostic function required: " + name)
    return "export " + found[0].getText(sf)
  }).join("\n")
  const exports: any = {}, calls: any[] = [], logs: string[] = []
  vm.runInNewContext(ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, assert, Buffer, process: shape,
    verifyHistoryPrivacy: async () => primary,
    resolveWinScript: (name: string) => { assert.equal(name, "acp-history-privacy.ps1"); return "/inert/fixed.ps1" },
    runPs: async (script: string, args: string[], options: unknown) => { calls.push({ script, args, options }); if (wire === "THROW") throw Error("SYNTHETIC_PRIVATE_ERROR"); return wire },
    console: { log(line: string) { if (logThrows) throw Error("SYNTHETIC_SINK_ERROR"); logs.push(line) } },
  })
  return { parse: exports.privacyDiagnosticDTO, prerequisite: exports.privatePrerequisite, calls, logs }
}
function undoDiagnostic732(source: string) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n"
  let lines = source.split(/\r?\n/)
  const start = lines.indexOf("# Explicit CI-only supplementary observation; never changes the read-only gate."), end = lines.indexOf("$answer = 'UNKNOWN'")
  assert.ok(start > 0 && end > start)
  lines.splice(start, end - start)
  let text = lines.join("\n")
  text = text.replace("if ($paths.Count -lt 1 -or $paths.Count -gt 2) { $reason = 'PATHARGS'; throw 'invalid' }", "if ($args.Count -lt 1 -or $args.Count -gt 2) { throw 'invalid' }")
    .replace("  $answer = 'PRIVATE'\n  $reason = 'NONE'\n  foreach ($literal in $paths) {\n    $pathIndex = $currentPathIndex\n    $currentPathIndex++", "  $answer = 'PRIVATE'\n  foreach ($literal in $args) {")
    .replace(/\$reason = '(?:REPARSE|OWNER|DACL|ACE_TYPE|ACE_PRINCIPAL|ACE_QUALIFIER)'; /g, "")
    .replace("} catch { if ($reason -ne 'PATHARGS') { $reason = 'IO_UNKNOWN' }; $answer = 'UNKNOWN' }", "} catch { $answer = 'UNKNOWN' }")
  const output = text.lastIndexOf("if ($diagnostic) {")
  assert.ok(output > 0)
  text = text.slice(0, output) + "[Console]::Out.Write(('\"' + $answer + '\"'))\n"
  return eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text
}
test("#732 diagnostic default whole inverse preserves every PS guard and literal output in LF/CRLF", () => {
  const source = fs.readFileSync(psFile732, "utf8")
  for (const input of [source, source.replace(/\r?\n/g, "\r\n")]) {
    const reverted = undoDiagnostic732(input)
    assert.equal(createHash("sha256").update(reverted.replace(/\r\n/g, "\n")).digest("hex"), "824ba64001f5a40a72675bd7ce41d65253f90536d642619caf932da324d11fbb")
    assert.match(input, /\$args\[0\] -ceq '--diagnostic-732'/)
    assert.match(input, /\$env:GITHUB_ACTIONS -cne 'true' -or \$env:RUNNER_OS -cne 'Windows'/)
    const mappings = [...input.matchAll(/\$reason = '(REPARSE|OWNER|DACL|ACE_TYPE|ACE_PRINCIPAL|ACE_QUALIFIER)'; \$answer = '(REFUSED|UNKNOWN)'; break/g)].map(m => [m[1], m[2]])
    assert.deepEqual(mappings, [["REPARSE", "REFUSED"], ["OWNER", "REFUSED"], ["DACL", "REFUSED"], ["ACE_TYPE", "UNKNOWN"], ["ACE_PRINCIPAL", "REFUSED"], ["ACE_QUALIFIER", "UNKNOWN"]])
    assert.doesNotMatch(input, /Set-Acl|SetAccessControl|SetToken|AdjustToken|icacls|Write-Host|Write-Error/)
  }
})
test("#732 diagnostic parser accepts only the source-declared closed result triples", () => {
  const f = nativeDiagnostic732()
  const rows = [["PRIVATE", "NONE", null], ["UNKNOWN", "PATHARGS", null], ["UNKNOWN", "IO_UNKNOWN", null], ["UNKNOWN", "IO_UNKNOWN", 1], ["REFUSED", "REPARSE", 0], ["REFUSED", "OWNER", 1], ["REFUSED", "DACL", 0], ["REFUSED", "ACE_PRINCIPAL", 1], ["UNKNOWN", "ACE_TYPE", 0], ["UNKNOWN", "ACE_QUALIFIER", 1]]
  for (const [status, reason, pathIndex] of rows) assert.deepEqual(JSON.parse(JSON.stringify(f.parse(JSON.stringify({ status, reason, pathIndex })))), { status, reason, pathIndex })
})
test("#732 diagnostic parser refuses malformed/coercible/extra/private data without reflecting it", () => {
  const f = nativeDiagnostic732(), expected = { status: "UNKNOWN", reason: "IO_UNKNOWN", pathIndex: null }
  for (const value of ["", "PRIVATE", "null", "[]", "x".repeat(513), '{"status":["REFUSED"],"reason":"OWNER","pathIndex":0}', '{"status":"REFUSED","reason":["OWNER"],"pathIndex":0}', '{"status":"REFUSED","reason":"OWNER","pathIndex":"0"}', '{"status":"REFUSED","reason":"OWNER","pathIndex":2}', '{"status":"PRIVATE","reason":"OWNER","pathIndex":0}', '{"status":"UNKNOWN","reason":"PATHARGS","pathIndex":1}', '{"status":"REFUSED","reason":"PRIVATE_BODY","pathIndex":0}', '{"status":"REFUSED","reason":"OWNER","pathIndex":0,"SID":"PRIVATE_SID"}', { toString() { throw Error("PRIVATE_GETTER") } }]) {
    assert.deepEqual(JSON.parse(JSON.stringify(f.parse(value))), expected)
  }
})
test("#732 initial PRIVATE never launches supplementary diagnostics", async () => {
  const f = nativeDiagnostic732("PRIVATE")
  await f.prerequisite(["C:\\owned\\root", "C:\\owned\\root\\empty"])
  assert.equal(f.calls.length, 0); assert.equal(f.logs.length, 0)
})
test("#732 failed initial admission stays failed even when supplementary read returns PRIVATE", async () => {
  for (const status of ["REFUSED", "UNKNOWN"]) {
    const f = nativeDiagnostic732(status, '{"status":"PRIVATE","reason":"NONE","pathIndex":null}'), paths = ["C:\\owned\\root", "C:\\owned\\root\\literal'; value"]
    await assert.rejects(f.prerequisite(paths), /OWNED_TEMP_PRIVACY_PREREQUISITE_REQUIRED/)
    assert.equal(f.calls.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)), ["--diagnostic-732", ...paths]); assert.equal(f.calls[0].options, undefined)
    assert.equal(f.logs.length, 1); assert.equal(f.logs[0], 'ACP_HISTORY_PRIVACY_732 {"status":"PRIVATE","reason":"NONE","pathIndex":null}')
  }
})
test("#732 diagnostics require exact GHA Windows values and cannot be enabled by truthy/case variants", async () => {
  for (const shape of [{ platform: "linux", env: { GITHUB_ACTIONS: "true", RUNNER_OS: "Windows" } }, { platform: "win32", env: {} }, { platform: "win32", env: { GITHUB_ACTIONS: "TRUE", RUNNER_OS: "Windows" } }, { platform: "win32", env: { GITHUB_ACTIONS: "true", RUNNER_OS: "windows" } }, { platform: "win32", env: { GITHUB_ACTIONS: true, RUNNER_OS: "Windows" } }]) {
    const f = nativeDiagnostic732("REFUSED", "{}", shape)
    await assert.rejects(f.prerequisite(["C:\\owned\\root"]), /OWNED_TEMP_PRIVACY_PREREQUISITE_REQUIRED/)
    assert.equal(f.calls.length, 0); assert.equal(f.logs.length, 0)
  }
})
test("#732 failed diagnostic query/parser/sink never replaces the original privacy assertion", async () => {
  for (const [wire, logThrows] of [["THROW", false], ["PRIVATE_ERROR_BODY", false], ['{"status":"REFUSED","reason":"OWNER","pathIndex":0}', true]] as const) {
    const f = nativeDiagnostic732("REFUSED", wire, undefined, logThrows)
    await assert.rejects(f.prerequisite(["C:\\owned\\root"]), /OWNED_TEMP_PRIVACY_PREREQUISITE_REQUIRED/)
    assert.equal(f.calls.length, 1)
    for (const line of f.logs) { assert.equal(line.includes("PRIVATE_ERROR_BODY"), false); assert.equal(line.includes("SYNTHETIC"), false); assert.equal(line.includes("C:\\owned"), false) }
  }
})
