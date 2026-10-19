// #732 Windows hosted acceptance only; never invoke native checks on a manual desktop.
// No ACL mutation/remediation. A non-private runner temp root is a real prerequisite failure.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { AcpHistoryStore } from "../src/acp/history-store"
import { verifyHistoryPrivacy } from "../src/acp/history-privacy"
function canonicalWindows(): void {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "OWNED_HISTORY_CANONICAL_GHA_REQUIRED")
  assert.equal(process.env.RUNNER_OS, "Windows", "OWNED_HISTORY_CANONICAL_WINDOWS_REQUIRED")
}
async function owned(run: (dir: string) => Promise<void>) {
  let dir = "", identity: fs.Stats | undefined
  try {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-history732-native-")))
    identity = fs.lstatSync(dir)
    await run(dir)
  } catch (error: any) {
    if (error?.code === "ERR_ASSERTION") throw error
    throw new Error("OWNED_HISTORY_NATIVE_IO_FAILED")
  } finally {
    if (identity) {
      try {
        const now = fs.lstatSync(dir)
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
  const fd = fs.openSync(file, "wx", 0o600); fs.closeSync(fd)
  assert.equal(await verifyHistoryPrivacy([dir, file]), "PRIVATE", "OWNED_TEMP_PRIVACY_PREREQUISITE_REQUIRED")
  assert.equal(fs.statSync(file).size, 0)
  })
})
test("#732 actual NTFS metadata round-trip is historical only", { skip: process.platform !== "win32" }, async () => {
  canonicalWindows()
  return owned(async dir => {
  assert.equal(await verifyHistoryPrivacy([dir]), "PRIVATE", "OWNED_TEMP_PRIVACY_PREREQUISITE_REQUIRED")
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
