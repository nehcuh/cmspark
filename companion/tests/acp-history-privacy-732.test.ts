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
