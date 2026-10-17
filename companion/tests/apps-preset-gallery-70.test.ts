// #70 actual preset producer; inert path/signer seams, never native evidence.
import test from "node:test"
import assert from "node:assert/strict"
import { materializePresets, PRESET_APPS } from "../src/apps/presets"
import type { AppEntry } from "../src/apps/types"
import * as fs from "node:fs"
import * as path from "node:path"
const witness = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../docs/evidence/app-gallery-reference-70/hosted-windows-reference.json"), "utf8"))
const sampleFor = (token: string): any => witness.samples.find((s: any) => s.token === token)

test("#70 actual producer expands the finite gallery with recorded fixed-release certificate references", async () => {
  const result = await materializePresets({}, { exists: () => false, signerProbe: async () => { throw Error("undetected must not probe") } })
  assert.deepEqual(PRESET_APPS.map(p => p.token), ["win.app.cloudmusic", "win.app.notepadpp", "win.app.vscode"])
  assert.deepEqual(result.entries, {}); assert.deepEqual(result.added, [])
  for (const token of ["win.app.notepadpp", "win.app.vscode"]) {
    const status: any = result.presets.find(p => p.token === token)
    assert.equal(status.detected, false); assert.equal(status.persisted, false)
    const sample = sampleFor(token)
    const native = JSON.parse(sample.nativeStdout)
    for (const key of Object.keys(native)) assert.deepEqual(native[key], sample[key], `native witness ${key}`)
    assert.equal(sample.signatureStatus, "Valid"); assert.equal(sample.machine, "x64")
    assert.match(sample.psVersion, /^5\.1\./)
    assert.equal(status.reference.packageSHA256, sample.packageSHA256)
    assert.equal(status.reference.referenceEXESHA256, sample.exeSHA256)
    assert.equal(status.reference.expectedCertificateSHA256DER, sample.certificateSHA256DER)
    assert.equal(status.reference.observedSubject, sample.subject)
    assert.equal(status.reference.observedSignatureStatus, sample.signatureStatus)
    assert.equal(status.reference.collectedAtUTC, sample.collectedAtUTC)
    assert.match(status.reference.artifactURL, /^https:\/\//)
    assert.match(status.reference.packageSHA256, /^[a-f0-9]{64}$/)
    assert.match(status.reference.advice, /手动/)
  }
  assert.equal((result.presets[0] as any).reference, undefined, "legacy preset must not invent certificate evidence")
})

test("#70 real materialization stays manual and never turns captured Subject into reference fingerprint", async () => {
  let probes = 0
  const result = await materializePresets({}, {
    exists: p => p.includes("Notepad++"), realpath: () => "C:\\Program Files\\Notepad++\\notepad++.exe",
    // Synthetic existing probe seam only: not a real publisher/sample or certificate fixture.
    signerProbe: async () => { probes++; return "SYNTHETIC_SUBJECT_SEAM" },
  })
  assert.deepEqual(result.added, ["win.app.notepadpp"]); assert.equal(probes, 1)
  const entry = result.entries["win.app.notepadpp"]
  assert.equal(entry.policy, "manual"); assert.equal(entry.source, "preset"); assert.equal(entry.enabled, true)
  assert.equal(entry.exe?.signer, "SYNTHETIC_SUBJECT_SEAM")
  assert.equal(Object.hasOwn(entry, "reference"), false)
  const reference = (result.presets.find(p => p.token === entry.token) as any).reference
  assert.equal(reference.expectedCertificateSHA256DER, sampleFor(entry.token).certificateSHA256DER)
  assert.equal(reference.observedSubject, sampleFor(entry.token).subject)
  assert.notEqual(reference.observedSubject, entry.exe?.signer)
})

test("#70 persisted owner choices and siblings survive without another signer probe", async () => {
  const app: AppEntry = { token: "win.app.vscode", kind: "gui", source: "preset", display_name: "User name", enabled: false, policy: "ai", added_at: "owned",
    exe: { path: "C:\\Owned\\Code.exe", user_writable_dir: true } }
  const sibling: AppEntry = { ...app, token: "win.app.owned", source: "user" }
  const input = { [app.token]: app, [sibling.token]: sibling }
  const result = await materializePresets(input, { exists: p => p === app.exe!.path, signerProbe: async () => { throw Error("persisted never re-probed") } })
  assert.equal(result.entries, input); assert.equal(result.entries[app.token], app); assert.equal(result.entries[sibling.token], sibling)
  assert.deepEqual(result.added, [])
  const status: any = result.presets.find(p => p.token === app.token)
  assert.equal(status.detected, true); assert.equal(status.persisted, true)
  assert.equal(status.reference.expectedCertificateSHA256DER, sampleFor(app.token).certificateSHA256DER)
})

test("#70 actual apps.list exit transports reference metadata without persisting it", async () => {
  // Canonical Companion runner preload owns CMSPARK_DATA_DIR before imports.
  const { initDataDir, replaceAppsEntries, getConfig } = await import("../src/config")
  await initDataDir()
  replaceAppsEntries({})
  const { handleAppsMessage } = await import("../src/apps/handlers")
  const payload = await handleAppsMessage({ type: "apps.list" }, {}, {
    platform: "win32", exists: () => false,
    signerProbe: async () => { throw Error("undetected must not probe") },
  })
  assert.equal(payload.type, "apps.list"); assert.equal(payload.presets.length, 3)
  assert.equal(payload.presets[1].reference.expectedCertificateSHA256DER, sampleFor("win.app.notepadpp").certificateSHA256DER)
  assert.deepEqual(getConfig().apps?.entries, {})
  assert.equal(Object.hasOwn(payload, "reference"), false)
  // Explicit one-off recorder: the checked-in UI fixture is this exact real exit,
  // not a handwritten protocol. Recording never happens during normal tests.
  if (process.env.CMSPARK_70_RECORD_FIXTURE) {
    const target = process.env.CMSPARK_70_RECORD_FIXTURE
    assert.ok(path.isAbsolute(target))
    fs.writeFileSync(target, JSON.stringify(payload, null, 2) + "\n", { flag: "wx" })
  }
})
