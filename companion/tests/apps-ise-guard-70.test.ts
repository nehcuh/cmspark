// #70 explicit CLI prerequisite. Real add/prepare/policy producers; inert files,
// no process execution, effective token, persisted app config or native UI.
import test, { after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { buildAppEntry } from "../src/apps/add-flow"
import { prepareCliExecution } from "../src/apps/cli-exec"
import { basenameToVault, checkAddAllowed, isLolbinPath } from "../src/apps/guards"
import { canEverCoordinate } from "../src/computer/policy"
import type { AppEntry } from "../src/apps/types"

const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-ise-70-"))
after(() => fs.rmSync(owned, { recursive: true, force: true }))
const manifest = { schema_version: 1, subcommands: [{ name: "version", risk: "read-only" }] }
function inert(name: string): string {
  const file = path.join(owned, name)
  fs.writeFileSync(file, "inert fixture; never executed", { mode: 0o600 })
  return file
}
function rawEntry(file: string): AppEntry {
  return { token: "win.cli.fixture", kind: "cli", display_name: "Synthetic CLI", source: "user",
    policy: "manual", enabled: true, added_at: "2026-07-18T10:00:00Z",
    exe: { path: file, user_writable_dir: true }, cli_manifest: manifest }
}

test("#70 actual add refuses PowerShell ISE for GUI and CLI before signer probing", async t => {
  for (const kind of ["gui", "cli"] as const) {
    for (const name of ["powershell_ise.exe", "PoWeRsHeLl_IsE.EXE", "powershell_ise.fake.exe", "powershell_ise.exe.exe"]) {
      await t.test(`${kind} ${name}`, async () => {
        const file = inert(name)
        let signerCalls = 0
        await assert.rejects(buildAppEntry({ path: file, kind, policy: "manual", origin: "manual-paste",
          existingEntries: {}, ...(kind === "cli" ? { cli_manifest: manifest } : {}) }, {
          signerProbe: async () => { signerCalls += 1; return undefined },
        }), { code: "lolbin_denied" })
        assert.equal(signerCalls, 0, "structural refusal must precede native signer work")
      })
    }
  }
})

test("#70 hand-edited ISE CLI entries still fail actual execution preparation", () => {
  const file = inert("powershell_ise.exe")
  const prepared = prepareCliExecution(rawEntry(file), { app: "win.cli.fixture", subcommand: "version" })
  assert.equal(prepared.ok, false)
  if (!prepared.ok) assert.match(prepared.error, /lolbin-blocked/)
})

test("#70 ISE exact identity maps to the existing vault and cannot gain coordinate eligibility", () => {
  for (const file of ["C:\\Windows\\System32\\powershell_ise.exe", "D:/Apps/PoWeRsHeLl_IsE.EXE", "powershell_ise.fake.exe"]) {
    assert.equal(isLolbinPath(file), true)
    assert.equal(basenameToVault(file), "win.powershell_ise")
    assert.equal(checkAddAllowed(file, "gui").allowed, false)
    assert.equal(checkAddAllowed(file, "cli").allowed, false)
    assert.equal(canEverCoordinate({ ...rawEntry(file), kind: "gui", coordinateAllowed: true }), false)
  }
})

test("#70 ordinary app and CLI lookalikes retain actual add and preparation paths", async t => {
  for (const name of ["my-powershell_ise-app.exe", "powershell_ise_helper.exe", "powershell_ise2.exe"]) {
    await t.test(name, async () => {
      const file = inert(name)
      for (const kind of ["gui", "cli"] as const) {
        const { entry } = await buildAppEntry({ path: file, kind, policy: "manual", origin: "manual-paste",
          existingEntries: {}, ...(kind === "cli" ? { cli_manifest: manifest } : {}) }, { signerProbe: async () => undefined })
        assert.equal(entry.kind, kind)
        assert.equal(basenameToVault(file), null)
        if (kind === "cli") {
          const prepared = prepareCliExecution(entry, { app: entry.token, subcommand: "version" })
          assert.equal(prepared.ok, true)
          if (prepared.ok) assert.deepEqual(prepared.argv, ["version"])
        }
      }
    })
  }
})

test("#70 canonical target, not an alias name or parent folder, decides add-time eligibility", async () => {
  const ordinary = inert("ordinary.exe"), alias = inert("powershell_ise.exe")
  // Explicit canonicalization seam, not a claim of creating a native Windows symlink.
  const { entry } = await buildAppEntry({ path: alias, kind: "cli", policy: "manual", origin: "manual-paste",
    existingEntries: {}, cli_manifest: manifest }, { realpath: () => ordinary, signerProbe: async () => undefined })
  assert.equal(entry.exe?.path, ordinary)
  assert.equal(prepareCliExecution(entry, { app: entry.token, subcommand: "version" }).ok, true)
  await assert.rejects(buildAppEntry({ path: ordinary, kind: "cli", policy: "manual", origin: "manual-paste",
    existingEntries: {}, cli_manifest: manifest }, { realpath: () => alias, signerProbe: async () => undefined }),
  { code: "lolbin_denied" }, "an ordinary alias cannot hide an excluded canonical target")
})

test("#70 existing cmd hard refusal remains intact at add and preparation", async () => {
  const file = inert("cmd.exe")
  await assert.rejects(buildAppEntry({ path: file, kind: "cli", policy: "manual", origin: "manual-paste",
    existingEntries: {}, cli_manifest: manifest }, { signerProbe: async () => undefined }), { code: "lolbin_denied" })
  assert.equal(prepareCliExecution(rawEntry(file), { app: "win.cli.fixture", subcommand: "version" }).ok, false)
})
