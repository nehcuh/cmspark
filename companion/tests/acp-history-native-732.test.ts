// #732 Windows hosted acceptance only; never invoke native checks on a manual desktop.
// Explicit security initializes NEW fixture objects only; no parent/existing-path remediation.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { AcpHistoryStore } from "../src/acp/history-store"
import { verifyHistoryPrivacy } from "../src/acp/history-privacy"
import { runPs, resolveWinScript } from "../src/host-use/win/powershell"
function canonicalWindows(): void {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "OWNED_HISTORY_CANONICAL_GHA_REQUIRED")
  assert.equal(process.env.RUNNER_OS, "Windows", "OWNED_HISTORY_CANONICAL_WINDOWS_REQUIRED")
}
// Supplementary CI-only read: never replaces the original prerequisite result.
function privacyDiagnosticDTO(raw: string): { status: "PRIVATE" | "REFUSED" | "UNKNOWN"; reason: string; pathIndex: 0 | 1 | null } {
  const unknown = { status: "UNKNOWN" as const, reason: "IO_UNKNOWN", pathIndex: null }
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 512) return unknown
  try {
    const value = JSON.parse(raw)
    if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).sort().join(",") !== "pathIndex,reason,status") return unknown
    const { status, reason, pathIndex } = value
    if (typeof status !== "string" || typeof reason !== "string" || !["PRIVATE", "REFUSED", "UNKNOWN"].includes(status) || !(pathIndex === null || pathIndex === 0 || pathIndex === 1)) return unknown
    const refused = ["REPARSE", "OWNER", "DACL", "ACE_PRINCIPAL"]
    const opaque = ["ACE_TYPE", "ACE_QUALIFIER"]
    const valid = status === "PRIVATE" ? reason === "NONE" && pathIndex === null
      : status === "REFUSED" ? refused.includes(reason) && pathIndex !== null
      : reason === "IO_UNKNOWN" || reason === "PATHARGS" && pathIndex === null || opaque.includes(reason) && pathIndex !== null
    return valid ? { status: status as "PRIVATE" | "REFUSED" | "UNKNOWN", reason, pathIndex } : unknown
  } catch { return unknown }
}
async function privatePrerequisite(paths: string[]): Promise<void> {
  const status = await verifyHistoryPrivacy(paths)
  if (status !== "PRIVATE" && process.platform === "win32" && process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_OS === "Windows") {
    let diagnostic = privacyDiagnosticDTO("")
    try { diagnostic = privacyDiagnosticDTO(await runPs(resolveWinScript("acp-history-privacy.ps1"), ["--diagnostic-732", ...paths])) } catch { /* finite unavailable */ }
    try { console.log("ACP_HISTORY_PRIVACY_732 " + JSON.stringify(diagnostic)) } catch { /* original assertion remains primary */ }
  }
  assert.equal(status, "PRIVATE", "OWNED_TEMP_PRIVACY_PREREQUISITE_REQUIRED")
}

async function fixtureObject(parent: string, name: string, kind: "root" | "empty"): Promise<void> {
  canonicalWindows()
  assert.equal(process.platform, "win32", "OWNED_HISTORY_FIXTURE_WINDOWS_REQUIRED")
  assert.match(parent, /^[A-Za-z]:\\/, "OWNED_HISTORY_FIXTURE_LOCAL_DRIVE_REQUIRED")
  const fd = fs.openSync(parent, fs.constants.O_RDONLY)
  let original: fs.BigIntStats | undefined
  try {
    original = fs.fstatSync(fd, { bigint: true })
    const current = () => {
      const p = fs.lstatSync(parent, { bigint: true }), h = fs.fstatSync(fd, { bigint: true })
      return original!.dev === p.dev && original!.ino === p.ino && original!.dev === h.dev && original!.ino === h.ino &&
        p.isDirectory() && h.isDirectory() && !p.isSymbolicLink() && fs.realpathSync(parent) === parent
    }
    assert.equal(current(), true, "OWNED_HISTORY_FIXTURE_PARENT_CHANGED")
    const reply = await runPs(resolveWinScript("acp-history-native-fixture.ps1"), [parent, name, original.dev.toString(), original.ino.toString(), kind])
    assert.equal(current(), true, "OWNED_HISTORY_FIXTURE_PARENT_CHANGED")
    assert.equal(reply.trim(), '\"INITIALIZED\"', "OWNED_HISTORY_FIXTURE_CREATION_REQUIRED")
  } finally {
    if (original) {
      try { const now = fs.fstatSync(fd, { bigint: true }); if (now.dev === original.dev && now.ino === original.ino) fs.closeSync(fd) } catch { /* Never close a replacement descriptor. */ }
    } else { fs.closeSync(fd) }
  }
}
async function owned(run: (dir: string) => Promise<void>) {
  let dir = "", identity: fs.BigIntStats | undefined
  try {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-history732-native-")))
    identity = fs.lstatSync(dir, { bigint: true })
    const child = "history-root-" + randomUUID()
    await fixtureObject(dir, child, "root")
    await run(path.join(dir, child))
  } catch (error: any) {
    if (error?.code === "ERR_ASSERTION") throw error
    throw new Error("OWNED_HISTORY_NATIVE_IO_FAILED")
  } finally {
    if (identity) {
      try {
        const now = fs.lstatSync(dir, { bigint: true })
        if (now.isDirectory() && !now.isSymbolicLink() && now.ino === identity.ino && now.dev === identity.dev) fs.rmSync(dir, { recursive: true, force: true })
        else throw Error("changed")
      } catch { throw new Error("OWNED_HISTORY_NATIVE_CLEANUP_FAILED") }
    }
  }
}
test("#732 actual Windows ACL root+empty file admission", { skip: process.platform !== "win32" }, async () => {
  canonicalWindows()
  return owned(async dir => {
  const file = path.join(dir, "empty")
  await fixtureObject(dir, "empty", "empty")
  await privatePrerequisite([dir, file])
  assert.equal(fs.statSync(file).size, 0)
  })
})
test("#732 actual NTFS metadata round-trip is historical only", { skip: process.platform !== "win32" }, async () => {
  canonicalWindows()
  return owned(async dir => {
  await privatePrerequisite([dir])
  const first = new AcpHistoryStore({ root: () => dir, enabled: () => true })
  first.note({ session_id: "inert-session", thread_id: "inert-thread", agent_id: "inert-agent", mode: "review_readonly",
    state: "running", created_at: "2026-10-19T12:00:00.000Z", goal: "NEVER_PERSIST_NATIVE_GOAL", workspace_root: "NEVER_PERSIST_NATIVE_PATH" })
  await first.settle()
  const fresh = new AcpHistoryStore({ root: () => dir, enabled: () => true })
  const reply = await fresh.list("inert-thread", [])
  assert.equal(reply.status, "ok", "OWNED_HISTORY_NATIVE_DURABILITY_REQUIRED")
  assert.equal(reply.rows.length, 1); assert.equal(reply.rows[0].history_status, "interrupted")
  const file = path.join(dir, "acp-history.json")
  assert.equal(await verifyHistoryPrivacy([dir, file]), "PRIVATE", "OWNED_HISTORY_FINAL_PRIVACY_REQUIRED")
  assert.equal(fs.readFileSync(file, "utf8").includes("NEVER_PERSIST"), false)
  })
})
