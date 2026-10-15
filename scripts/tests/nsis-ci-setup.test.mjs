import test from "node:test"
import assert from "node:assert/strict"
import { fetchNsisPackage, verifiedNsisSetup, requireWindowsCi, NSIS_PACKAGE_URL, MAX_PACKAGE_BYTES } from "../ensure-ci-nsis.mjs"

test("the failed metadata lookup is replaced by the exact same pinned installer package", async () => {
  let calls = 0
  const bytes = await fetchNsisPackage({ fetchImpl: async (url, options) => {
    calls++
    assert.equal(url, NSIS_PACKAGE_URL)
    assert.ok(options.signal instanceof AbortSignal)
    return new Response("isolated transport bytes")
  } })
  assert.equal(calls, 1)
  assert.equal(bytes.toString(), "isolated transport bytes")
  assert.throws(() => verifiedNsisSetup(bytes), /checksum mismatch/, "unverified bytes cannot reach parsing/execution")
})

test("504 retries are bounded and recover without skipping integrity checks", async () => {
  let calls = 0
  const delays = []
  const bytes = await fetchNsisPackage({ fetchImpl: async () => {
    calls++
    return calls === 3 ? new Response("fixture") : new Response("gateway unavailable", { status: 504 })
  }, sleep: async ms => { delays.push(ms) } })
  assert.equal(calls, 3)
  assert.deepEqual(delays, [500, 1000])
  assert.throws(() => verifiedNsisSetup(bytes), /checksum mismatch/)
  calls = 0
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => { calls++; return new Response("", { status: 504 }) }, sleep: async () => {} }), /HTTP 504/)
  assert.equal(calls, 3)
})

test("wrong version, authentication failures and payload limits are not retried", async () => {
  for (const status of [400, 401, 403, 404]) {
    let calls = 0
    await assert.rejects(fetchNsisPackage({ fetchImpl: async () => { calls++; return new Response("", { status }) } }), new RegExp(`HTTP ${status}`))
    assert.equal(calls, 1)
  }
  let calls = 0
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => {
    calls++; return new Response("tiny", { headers: { "content-length": String(MAX_PACKAGE_BYTES + 1) } })
  } }), /size limit/)
  assert.equal(calls, 1)
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => new Response(new Uint8Array(MAX_PACKAGE_BYTES + 1)) }), /size limit/)
})

test("transient network errors are bounded; certificate failures fail immediately", async () => {
  let calls = 0
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => {
    calls++; throw Object.assign(new Error("reset"), { cause: { code: "ECONNRESET" } })
  }, sleep: async () => {} }), /transport failed/)
  assert.equal(calls, 3)
  calls = 0
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => {
    calls++; throw Object.assign(new Error("certificate"), { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } })
  } }), /transport failed/)
  assert.equal(calls, 1)
})

test("empty or oversized packages fail closed, and local platforms cannot invoke installer", () => {
  assert.throws(() => verifiedNsisSetup(Buffer.alloc(0)), /checksum mismatch/)
  assert.throws(() => verifiedNsisSetup(Buffer.alloc(MAX_PACKAGE_BYTES + 1)), /size limit/)
  assert.throws(() => requireWindowsCi("darwin", { GITHUB_ACTIONS: "true" }), /restricted/)
  assert.throws(() => requireWindowsCi("win32", {}), /restricted/)
  requireWindowsCi("win32", { GITHUB_ACTIONS: "true" })
})

// #650: fixed owned fixture observations; never replace the production stop script.
import fs from "node:fs"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
const workflowYaml = createRequire(new URL("../../companion/package.json", import.meta.url))("js-yaml")
const stopSmoke = fs.readFileSync(new URL("./win-installer-stop-smoke.ps1", import.meta.url), "utf8").replaceAll("\r\n", "\n")

test("NSIS observation brackets the complete original macro without changing its inputs or wait", () => {
  const section = stopSmoke.match(/Section\n([\s\S]*?)SectionEnd/)[1]
  assert.equal(section, '  ReadEnvStr $INSTDIR "CMSPARK_SMOKE_INSTALL_ROOT"\n  FileOpen $9 "$EXEDIR\\stop-phase.txt" w\n  FileWrite $9 "entered"\n  FileClose $9\n  !insertmacro StopInstalledAgentUnshared\n  FileOpen $9 "$EXEDIR\\stop-phase.txt" w\n  FileWrite $9 "returned"\n  FileClose $9\n')
  assert.match(stopSmoke, /\$harness\.Replace\('__MACRO__', \$macro\)/)
  assert.match(stopSmoke, /\/DCMSPARK_STOP_SCRIPT=/)
  assert.match(stopSmoke, /\$stop\.WaitForExit\(30000\)/)
  assert.match(stopSmoke, /Stop-Process -Id \$stop\.Id -Force/)
  assert.match(stopSmoke, /installed fixture was not stopped/)
  assert.match(stopSmoke, /sibling installation was incorrectly stopped/)
  assert.match(stopSmoke, /system Node agent was not stopped/)
  assert.match(stopSmoke, /unrelated system Node process was stopped/)
})

test("receipt reader is bounded, finite and permanently checked in the owned Windows smoke", () => {
  assert.match(stopSmoke, /function Get-OwnedStopReceiptState/)
  assert.match(stopSmoke, /ReparsePoint/)
  assert.match(stopSmoke, /New-Object byte\[\] 17/)
  assert.match(stopSmoke, /while \(\$count -lt 17\)/)
  assert.match(stopSmoke, /if \(\$count -gt 16\) \{ return 'invalid' \}/)
  assert.doesNotMatch(stopSmoke, /ReadAll(?:Text|Bytes)|Get-Content[^\n]*stop-phase/)
  assert.match(stopSmoke, /function Test-OwnedStopReceiptParser/)
  assert.match(stopSmoke, /Test-OwnedStopReceiptParser \$root/)
  assert.equal((stopSmoke.match(/NSIS_STOP_SMOKE_STATE=/g) ?? []).length, 2)
})

test("Registry, full census and sealed upload retain their exact block before NSIS", () => {
  const raw = fs.readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n")
  const start = raw.indexOf('      - name: "Native Windows read-only Registry discovery (#644)"')
  const end = raw.indexOf('      - name: "Windows reliability and confirmation regressions (#592, #595, #598, #599)"', start)
  assert(start >= 0 && end > start)
  assert.equal(createHash("sha256").update(raw.slice(start, end)).digest("hex"), "f0658cfa774f73098f564d9621e696921e709fcf3608463a513b4254e2818f37")
  const steps = workflowYaml.load(raw).jobs['smoke-os'].steps
  const names = steps.map(s => s.name)
  const i = names.indexOf('Native Windows read-only Registry discovery (#644)')
  assert.deepEqual(names.slice(i, i + 4), ['Native Windows read-only Registry discovery (#644)', 'Complete Windows Companion census (#650)', 'Windows census finite public receipts (#650)', 'Windows reliability and confirmation regressions (#592, #595, #598, #599)'])
  assert(names.indexOf('Office compatibility and relocated runtime (#611)') < i)
  assert.match(steps.find(s => s.name === 'Office compatibility and relocated runtime (#611)').run, /npx tsc -p tsconfig\.test\.json/)
})
