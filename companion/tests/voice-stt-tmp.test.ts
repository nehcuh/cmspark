// Path B M1 Task 3 — stt-tmp sandbox + GC

import test from "node:test"
import assert from "node:assert/strict"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  createSessionDir,
  gcOrphanSessions,
  removeSessionDir,
  sanitizeSessionId,
  voiceSttTmpRoot,
  writeSessionFile,
} from "../src/voice/stt-tmp"

function tempDataDir(): string {
  return mkdtempSync(path.join(tmpdir(), "cmspark-stt-tmp-"))
}

test("voiceSttTmpRoot joins dataDir/tmp/voice-stt", () => {
  const root = voiceSttTmpRoot("/tmp/agent-data")
  assert.equal(root, path.join("/tmp/agent-data", "tmp", "voice-stt"))
})

test("sanitizeSessionId accepts safe ids and rejects traversal", () => {
  assert.equal(sanitizeSessionId("sess_abc-123"), "sess_abc-123")
  assert.throws(() => sanitizeSessionId(".."), /invalid/)
  assert.throws(() => sanitizeSessionId("../etc"), /invalid/)
  assert.throws(() => sanitizeSessionId("a/b"), /invalid/)
  assert.throws(() => sanitizeSessionId("a\\b"), /invalid/)
  assert.throws(() => sanitizeSessionId("has space"), /invalid/)
  assert.throws(() => sanitizeSessionId(""), /invalid/)
})

test("createSessionDir creates 0o700 dir under tmp root", async () => {
  const dataDir = tempDataDir()
  const dir = await createSessionDir("s1", dataDir)
  assert.ok(existsSync(dir))
  assert.equal(path.dirname(dir), voiceSttTmpRoot(dataDir))
  assert.equal(path.basename(dir), "s1")
  // mode check (posix); mask off file type bits
  if (process.platform !== "win32") {
    const mode = statSync(dir).mode & 0o777
    assert.equal(mode, 0o700)
  }
})

test("createSessionDir rejects unsafe sessionId", async () => {
  const dataDir = tempDataDir()
  await assert.rejects(() => createSessionDir("..", dataDir), /invalid/)
  await assert.rejects(() => createSessionDir("a/b", dataDir), /invalid/)
  // root should not have been polluted with traversal names
  const root = voiceSttTmpRoot(dataDir)
  if (existsSync(root)) {
    assert.deepEqual(readdirSync(root), [])
  }
})

test("writeSessionFile writes 0o600 and rejects path names", async () => {
  const dataDir = tempDataDir()
  const dir = await createSessionDir("s2", dataDir)
  const filePath = await writeSessionFile(dir, "audio.pcm", Buffer.from("abc"))
  assert.ok(existsSync(filePath))
  assert.equal(readFileSync(filePath).toString(), "abc")
  if (process.platform !== "win32") {
    const mode = statSync(filePath).mode & 0o777
    assert.equal(mode, 0o600)
  }
  await assert.rejects(() => writeSessionFile(dir, "../x", Buffer.from("x")), /invalid/)
  await assert.rejects(() => writeSessionFile(dir, "a/b", Buffer.from("x")), /invalid/)
})

test("removeSessionDir deletes tree", async () => {
  const dataDir = tempDataDir()
  const dir = await createSessionDir("s3", dataDir)
  await writeSessionFile(dir, "a.bin", Buffer.from("z"))
  await removeSessionDir(dir)
  assert.equal(existsSync(dir), false)
})

test("gcOrphanSessions removes only old session dirs", async () => {
  const dataDir = tempDataDir()
  const oldDir = await createSessionDir("old_sess", dataDir)
  const newDir = await createSessionDir("new_sess", dataDir)
  await writeSessionFile(oldDir, "a.pcm", Buffer.from("1"))
  await writeSessionFile(newDir, "b.pcm", Buffer.from("2"))

  // Age old_sess to 2 hours ago
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
  utimesSync(oldDir, twoHoursAgo, twoHoursAgo)

  const removed = await gcOrphanSessions(dataDir, 60 * 60 * 1000)
  assert.equal(removed, 1)
  assert.equal(existsSync(oldDir), false)
  assert.equal(existsSync(newDir), true)
})

test("gcOrphanSessions returns 0 when root missing", async () => {
  const dataDir = tempDataDir()
  const n = await gcOrphanSessions(dataDir, 1000)
  assert.equal(n, 0)
})

test("gcOrphanSessions ignores non-session-looking entries", async () => {
  const dataDir = tempDataDir()
  const root = voiceSttTmpRoot(dataDir)
  mkdirSync(root, { recursive: true })
  // Create a junk file and a dir with invalid name that sanitize would reject
  writeFileSync(path.join(root, "readme.txt"), "x")
  // still a valid-looking dir name for readdir, but we'll use one with space via mkdir
  // space names fail SESSION_ID_RE and are skipped
  mkdirSync(path.join(root, "bad name"))
  const n = await gcOrphanSessions(dataDir, 0)
  assert.equal(n, 0)
  assert.ok(existsSync(path.join(root, "readme.txt")))
})
