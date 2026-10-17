/** #686 real hosted Windows only; never a local native claim on macOS/Linux. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { createHash, randomUUID } from "node:crypto"
import { spawn, execFile, type ChildProcess } from "node:child_process"
import { promisify } from "node:util"
import AdmZip from "adm-zip"
import { admitGuiTemplate } from "../../src/apps/gui-template-runtime"
import { prepareGuiTemplateFiles, GUI_TEMPLATE_EXE_BYTES, GUI_TEMPLATE_EXE_SHA256 } from "../../src/apps/gui-template-files"
import { getConfig, initDataDir, replaceAppsEntries } from "../../src/config"
import { SecurityConfirmationManager } from "../../src/security-confirmation"
import { runPs } from "../../src/host-use/win/powershell"
import type { AppEntry } from "../../src/apps/types"
const native = { skip: process.platform !== "win32", timeout: 90000 }
const asset = "https://github.com/notepad-plus-plus/notepad-plus-plus/releases/download/v8.9.8.1/npp.8.9.8.1.portable.x64.zip"
const assetBytes = 8250001, assetSHA = "beddf5548e75c97930d1575ba1c7d113e6e2b33d0a200310e734ca08e225f414"
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex")
let archive: Promise<Buffer> | undefined
function publicArchiveOnce(): Promise<Buffer> {
  return archive ??= downloadPublicArchive()
}
async function downloadPublicArchive(): Promise<Buffer> {
  const response = await fetch(asset, { signal: AbortSignal.timeout(30000), credentials: "omit" })
  assert.equal(response.status, 200)
  const reader = response.body!.getReader(), chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) { const r = await reader.read(); if (r.done) break; length += r.value.length; assert.ok(length <= assetBytes); chunks.push(r.value) }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = Buffer.concat(chunks); assert.equal(bytes.length, assetBytes); assert.equal(hash(bytes), assetSHA)
  return bytes
}
async function ownedTarget(directory: string): Promise<string> {
  const bytes = await publicArchiveOnce()
  // The exact authenticated public archive, no installer. Reject every escape before writing any entry.
  const entries = new AdmZip(bytes).getEntries()
  for (const e of entries) assert.ok(e.entryName && !e.entryName.includes("\\") && !e.entryName.startsWith("/")
    && !e.entryName.includes(":") && !e.entryName.split("/").some(part => part === ".."))
  for (const e of entries) {
    const dest = path.join(directory, ...e.entryName.split("/"))
    if (e.isDirectory) fs.mkdirSync(dest, { recursive: true })
    else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, e.getData(), { flag: "wx" }) }
  }
  const exe = fs.realpathSync.native(path.join(directory, "notepad++.exe")), exeData = fs.readFileSync(exe)
  assert.equal(exeData.length, GUI_TEMPLATE_EXE_BYTES); assert.equal(hash(exeData), GUI_TEMPLATE_EXE_SHA256)
  fs.writeFileSync(path.join(directory, "doLocalConf.xml"), "")
  // Existing owned portable profile only. Production never creates or changes it.
  fs.writeFileSync(path.join(directory, "config.xml"), '<NotepadPlus><GUIConfigs><GUIConfig name="noUpdate" autoUpdateMode="0">yes</GUIConfig><GUIConfig name="sessionExt"/><GUIConfig name="workspaceExt"/></GUIConfigs></NotepadPlus>')
  return exe
}
const template: any = { id: "open_text", name: "Owned text file", profile: "npp-8.9.8.1-x64-local-text-v1", risk: "state-changing",
  argv: ["-multiInst", "-nosession", "-noPlugin", "-ro", { file_slot: "file" }] }

test("#686 actual Windows argv and fixed PS metadata accept owned Unicode/spaces and reject aliases", native, async t => {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-template686-")))
  try {
    const exe = await ownedTarget(directory), file = path.join(directory, "中文 with space.txt")
    fs.writeFileSync(file, "OWNED_NON_PRIVATE_TEXT_686")
    const entry: AppEntry = { token: "win.app.owned686", kind: "gui", display_name: "Owned editor", source: "user", enabled: true,
      policy: "manual", added_at: "2026-10-16", exe: { path: exe, user_writable_dir: true }, templates: [template] }
    const receiver = path.join(directory, "owned-argv.cjs")
    fs.writeFileSync(receiver, "process.stdout.write(JSON.stringify(process.argv.slice(2)))")
    const argv = [...template.argv.slice(0, 4), file]
    const actual = await promisify(execFile)(process.execPath, [receiver, ...argv], { shell: false, timeout: 15000, windowsHide: true })
    assert.deepEqual(JSON.parse(actual.stdout), argv)
    const current = await prepareGuiTemplateFiles(entry, file, () => {})
    assert.equal(current.canonicalExe.toLowerCase(), exe.toLowerCase()); assert.equal(current.canonicalFile.toLowerCase(), fs.realpathSync.native(file).toLowerCase()); current.recheck()
    fs.writeFileSync(path.join(directory, "config.xml"), '<NotepadPlus><GUIConfigs><GUIConfig name="sessionExt">TXT</GUIConfig></GUIConfigs></NotepadPlus>')
    await assert.rejects(prepareGuiTemplateFiles(entry, file, () => {}))
    t.diagnostic("NATIVE_TEMPLATE686 actual_argv5=true unicode_space=true native_metadata=true absent_owner_sha_actual_pin=true profile_session_alias_rejected=true")
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test("#686 actual manager and executor private receipt launch exact owned NPP parser once after approval", native, async t => {
  assert.ok(process.env.CMSPARK_TEST_RUN_DIR); await initDataDir()
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-template686-native-")))
  const owner: any = {}, stranger: any = {}, manager = new SecurityConfirmationManager()
  let owned: ChildProcess | undefined, closed: Promise<void> | undefined, launches = 0
  let spawnPhase = "not-entered"
  try {
    const exe = await ownedTarget(directory), name = `中文 with space ${randomUUID()}.txt`, file = path.join(directory, name)
    fs.writeFileSync(file, "OWNED_NON_PRIVATE_TEXT_686")
    const app = "win.app.owned686", entry: AppEntry = { token: app, kind: "gui", display_name: "Owned pinned editor", source: "user", policy: "ai",
      enabled: true, added_at: "2026-10-16", exe: { path: exe, user_writable_dir: true }, templates: [template] }
    replaceAppsEntries({ [app]: entry })
    // Preserve current validated policy semantics: user-writable is capped; template remains L2 regardless.
    assert.equal(getConfig().apps!.entries[app].enabled, true)
    const params = { app, action: "run_template", template: "open_text", params: { file } }
    let show!: () => void, showFailed!: (error: unknown) => void, payload: any
    const shown = new Promise<void>((resolve, reject) => { show = resolve; showFailed = reject })
    const pending = admitGuiTemplate({ params, ownerCurrent: () => true, requestConfirmation: details => manager.request(data => { if (data.type === "security.confirmation.request") { payload = data; show() } }, details, { originWs: owner }) }, {
      spawn: ((target: string, argv: string[], options: any) => {
        spawnPhase = "entered"
        spawnPhase = "target"
        assert.equal(target.toLowerCase(), exe.toLowerCase())
        spawnPhase = "argv-count"
        assert.equal(argv.length, 5)
        spawnPhase = "argv-flags"
        assert.deepEqual(argv.slice(0, 4), ["-multiInst", "-nosession", "-noPlugin", "-ro"])
        spawnPhase = "file-realpath"
        assert.equal(argv[4].toLowerCase(), fs.realpathSync.native(file).toLowerCase())
        spawnPhase = "file-identity"
        assert.equal(fs.statSync(argv[4], { bigint: true }).ino, fs.statSync(file, { bigint: true }).ino)
        spawnPhase = "preview-binding"
        assert.ok(payload.full_preview.includes(`argv[4]: ${JSON.stringify(argv[4])}`))
        spawnPhase = "validated-before-spawn"
        launches++; owned = spawn(target, argv, options); closed = new Promise<void>(resolve => owned!.once("close", () => resolve())); return owned
      }) as typeof spawn,
    })
    // A real preflight failure must report its cause, rather than hiding behind the UI deadline.
    void pending.catch(showFailed)
    await shown; assert.equal(launches, 0); assert.equal(payload.auto_confirm_eligible, false); assert.deepEqual(payload.relevant_apps, [])
    assert.ok(payload.full_preview.includes(name)); assert.equal(manager.respondFrom(payload.confirmation_id, true, stranger).outcome, "origin_mismatch")
    assert.equal(launches, 0); assert.equal(manager.respondFrom(payload.confirmation_id, true, owner).outcome, "resolved")
    const accepted = await pending; const result = await accepted.receipt.execute(accepted.finalParams)
    assert.equal(result.success, true, `receipt-execute success=${result.success} spawn-phase=${spawnPhase} launches=${launches}`); assert.equal(launches, 1); assert.ok(owned?.pid)
    const observation = JSON.parse((await runPs(path.resolve(__dirname, "../../../tests/fixtures/apps-template-native-686.ps1"),
      ["-OwnedPid", String(owned.pid), "-OwnedExe", exe, "-OwnedName", name], { timeoutMs: 20000 })).trim())
    assert.deepEqual(observation, { native_ps51: true, owned_window: true, matching_file_title: true, open_files: 1, actual_target_parser: true })
    assert.equal((await accepted.receipt.execute(accepted.finalParams)).success, false); assert.equal(launches, 1)
    t.diagnostic("NATIVE_TEMPLATE686 actual_target_sha=true software_manager_origin=true owned_parser_single_file=true argv5=true replay_launch0=true synthetic_approval_not_human=true")
  } finally {
    if (owned && owned.exitCode === null && owned.signalCode === null) { owned.ref(); owned.kill() }
    if (closed) await closed
    replaceAppsEntries({})
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
