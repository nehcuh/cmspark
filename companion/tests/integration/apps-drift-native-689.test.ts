/** Real Windows filesystem/PS metadata/signature read; never executes the copied binary.
 * Off Windows this is explicitly NOT_RUN, not a mocked native pass. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { measureAppBinary } from "../../src/apps/binary-drift-files"
import { resolveWinScript, runPs } from "../../src/host-use/win/powershell"
import type { AppEntry } from "../../src/apps/types"
test("689 Windows actual fixed metadata/signature helpers and BigInt file identity read owned Unicode/spaces", { skip: process.platform !== "win32", timeout: 60000 }, async t => {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-drift689-")))
  const exe = path.join(directory, "惰性 owned copy.exe")
  try {
    fs.copyFileSync(process.execPath, exe, fs.constants.COPYFILE_EXCL)
    const input = fs.readFileSync(exe), expected = createHash("sha256").update(input).digest("hex")
    const raw = JSON.parse((await runPs(resolveWinScript("apps-signer.ps1"), ["-TargetPath", exe], { timeoutMs: 15000 })).trim())
    assert.ok((raw.status === "Valid" && typeof raw.signer === "string" && raw.signer.length > 0) || (raw.status === "NotSigned" && raw.signer === ""), "owned installed Node signature must be a supported actual state")
    const entry: AppEntry = { token: "win.app.native689", kind: "gui", display_name: "Owned inert binary copy", source: "user", enabled: true,
      policy: "manual", added_at: "2026-10-17", exe: { path: exe, sha256: expected, signer: raw.signer || undefined, user_writable_dir: true } }
    let fences = 0
    const measured = await measureAppBinary(entry, () => { fences++ })
    assert.equal(measured.sha256, expected); assert.equal(measured.signer ?? "", raw.signer); measured.recheck(); assert.ok(fences > 3)
    fs.appendFileSync(exe, Buffer.from("OWNED_CHANGE_NEVER_EXECUTED"))
    assert.throws(measured.recheck, /APP_DRIFT_MEASUREMENT_FAILED/)
    const missing = path.join(directory, "missing.exe")
    await assert.rejects(measureAppBinary({ ...entry, exe: { ...entry.exe!, path: missing } }, () => {}))
    const junction = path.join(directory, "junction"); fs.symlinkSync(directory, junction, "junction")
    try { await assert.rejects(measureAppBinary({ ...entry, exe: { ...entry.exe!, path: path.join(junction, path.basename(exe)) } }, () => {})) }
    finally { fs.rmdirSync(junction) }
    t.diagnostic("DRIFT689_NATIVE fixed_readonly_PS=true actual_signature=true exact_hash=true BigInt_identity=true Unicode_space=true missing_reparse_rejected=true changed_final_identity_rejected=true app_executions0=true")
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
