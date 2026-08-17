/**
 * Thread image sidecar I/O + Message.attachments.
 * Sidecar path is companion-chosen only: `${msgId}-${n}.${ext}` under `threads/<id>.files/`.
 */
import test, { before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-thread-sidecar-"))

let initDataDir: typeof import("../src/config").initDataDir
let getConfigDir: typeof import("../src/config").getConfigDir
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let writeImageSidecar: typeof import("../src/threads/image-sidecar").writeImageSidecar
let readImageSidecar: typeof import("../src/threads/image-sidecar").readImageSidecar
let readImageAttachment: typeof import("../src/threads/image-sidecar").readImageAttachment
let deleteSidecarsForMessages: typeof import("../src/threads/image-sidecar").deleteSidecarsForMessages
let attachmentsDir: typeof import("../src/threads/image-sidecar").attachmentsDir
let removeAttachmentsDir: typeof import("../src/threads/image-sidecar").removeAttachmentsDir

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
  delete process.env.DEEPSEEK_API_KEY
  const config = await import("../src/config")
  const tm = await import("../src/threads/thread-manager")
  const sidecar = await import("../src/threads/image-sidecar")
  initDataDir = config.initDataDir
  getConfigDir = config.getConfigDir
  ThreadManager = tm.ThreadManager
  writeImageSidecar = sidecar.writeImageSidecar
  readImageSidecar = sidecar.readImageSidecar
  readImageAttachment = sidecar.readImageAttachment
  deleteSidecarsForMessages = sidecar.deleteSidecarsForMessages
  attachmentsDir = sidecar.attachmentsDir
  removeAttachmentsDir = sidecar.removeAttachmentsDir
  await initDataDir()
})

beforeEach(() => {
  const threadsDir = path.join(getConfigDir(), "threads")
  if (fs.existsSync(threadsDir)) {
    for (const f of fs.readdirSync(threadsDir)) {
      try {
        fs.rmSync(path.join(threadsDir, f), { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
})

function filesDir(threadId: string): string {
  return attachmentsDir(getConfigDir(), threadId)
}

test("writeImageSidecar writes threads/<id>.files/<msgId>-<n>.<ext> mode 0o600, dir 0o700", () => {
  const tm = new ThreadManager()
  const thread = tm.create("sidecar-write")
  const msg = tm.addMessage(thread.id, {
    thread_id: thread.id,
    role: "user",
    content: "pic",
    attachments: [{
      kind: "image",
      name: "shot.png",
      mime: "image/png",
      sha256: "aa",
      bytes: PNG.length,
      rel: "../../../evil.png",
    }],
  })
  const persisted = tm.getMessages(thread.id)[0]
  assert.ok(persisted.attachments)
  assert.equal(persisted.attachments!.length, 1)
  assert.equal(persisted.attachments![0]!.rel, `${msg.id}-0.png`)
  assert.equal(persisted.attachments![0]!.msg_id, msg.id)
  assert.equal(persisted.attachments![0]!.index, 0)
  assert.notEqual(persisted.attachments![0]!.rel, "../../../evil.png")

  const written = writeImageSidecar(thread.id, msg.id, 0, "image/png", PNG)
  assert.ok(written)
  assert.equal(written.rel, `${msg.id}-0.png`)

  const dir = filesDir(thread.id)
  const filePath = path.join(dir, `${msg.id}-0.png`)
  assert.ok(fs.existsSync(dir), "attachments dir must exist")
  assert.ok(fs.existsSync(filePath), "sidecar file must exist")
  assert.equal(fs.lstatSync(dir).isSymbolicLink(), false)
  assert.ok(fs.lstatSync(dir).isDirectory())
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600)
  assert.deepEqual(fs.readFileSync(filePath), PNG)
})

test("readImageSidecar / readImageAttachment: companion names work; forged ../ rel returns null", () => {
  const tm = new ThreadManager()
  const thread = tm.create("sidecar-read")
  const msg = tm.addMessage(thread.id, {
    thread_id: thread.id,
    role: "user",
    content: "pic",
  })
  const written = writeImageSidecar(thread.id, msg.id, 0, "image/png", PNG)
  assert.ok(written)

  assert.deepEqual(readImageSidecar(thread.id, msg.id, 0, "image/png"), PNG)
  assert.deepEqual(readImageSidecar(thread.id, written.rel), PNG)

  const viaMeta = readImageAttachment(thread.id, {
    kind: "image",
    name: "shot.png",
    mime: "image/png",
    sha256: "aa",
    bytes: PNG.length,
    msg_id: msg.id,
    index: 0,
    rel: written.rel,
  })
  assert.deepEqual(viaMeta, PNG)

  // Never follow client rel as a load path.
  assert.equal(readImageSidecar(thread.id, "../config.json"), null)
  assert.equal(readImageSidecar(thread.id, `../../${msg.id}-0.png`), null)
  assert.equal(readImageSidecar(thread.id, `${msg.id}-0.png/../../../etc/passwd`), null)
  assert.equal(
    readImageAttachment(thread.id, {
      kind: "image",
      name: "x",
      mime: "image/png",
      sha256: "aa",
      bytes: 1,
      rel: "../../../etc/passwd",
    }),
    null,
  )
  assert.equal(
    readImageAttachment(thread.id, {
      kind: "image",
      name: "x",
      mime: "image/png",
      sha256: "aa",
      bytes: 1,
      msg_id: msg.id,
      index: 0,
      rel: `../${msg.id}-0.png`,
    }),
    null,
  )

  // ThreadManager maps metadata → companion name, not att.rel
  assert.deepEqual(
    tm.readImageAttachment(thread.id, {
      kind: "image",
      name: "shot.png",
      mime: "image/png",
      sha256: "aa",
      bytes: PNG.length,
      msg_id: msg.id,
      index: 0,
      rel: "../../../../tmp/pwn.png",
    }),
    null,
  )
  assert.deepEqual(
    tm.readImageAttachment(thread.id, {
      kind: "image",
      name: "shot.png",
      mime: "image/png",
      sha256: "aa",
      bytes: PNG.length,
      msg_id: msg.id,
      index: 0,
    }),
    PNG,
  )
})

test("delete(threadId) removes .files/; if .files is a symlink, refuse (do not rmSync)", () => {
  const tm = new ThreadManager()
  const thread = tm.create("sidecar-delete")
  const msg = tm.addMessage(thread.id, {
    thread_id: thread.id,
    role: "user",
    content: "pic",
  })
  assert.ok(writeImageSidecar(thread.id, msg.id, 0, "image/png", PNG))
  const dir = filesDir(thread.id)
  assert.ok(fs.existsSync(dir))

  tm.delete(thread.id)
  assert.ok(!fs.existsSync(dir), "hard delete must remove .files/")
  assert.ok(!fs.existsSync(path.join(getConfigDir(), "threads", `${thread.id}.json`)))

  // Symlink refuse: recreate thread, plant .files as a symlink to a victim dir.
  const thread2 = tm.create("sidecar-symlink")
  const msg2 = tm.addMessage(thread2.id, {
    thread_id: thread2.id,
    role: "user",
    content: "x",
  })
  assert.ok(writeImageSidecar(thread2.id, msg2.id, 0, "image/png", PNG))
  const files = filesDir(thread2.id)
  const victim = path.join(tempHome, `victim-${thread2.id}`)
  fs.mkdirSync(victim, { recursive: true })
  const keep = path.join(victim, "keep.txt")
  fs.writeFileSync(keep, "do-not-delete")
  fs.rmSync(files, { recursive: true, force: true })
  fs.symlinkSync(victim, files)

  assert.equal(removeAttachmentsDir(thread2.id), false)
  tm.delete(thread2.id)
  assert.ok(fs.existsSync(keep), "must not rmSync through a .files symlink")
  assert.equal(fs.readFileSync(keep, "utf-8"), "do-not-delete")
  assert.ok(fs.lstatSync(files).isSymbolicLink(), "refuse leaves the symlink in place")
})

test("deleteMessagesFrom deletes sidecars for removed messages", () => {
  const tm = new ThreadManager()
  const thread = tm.create("sidecar-del-from")
  const msg1 = tm.addMessage(thread.id, {
    thread_id: thread.id,
    role: "user",
    content: "one",
    attachments: [{ kind: "image", name: "a.png", mime: "image/png", sha256: "1", bytes: PNG.length }],
  })
  const msg2 = tm.addMessage(thread.id, {
    thread_id: thread.id,
    role: "user",
    content: "two",
    attachments: [{ kind: "image", name: "b.png", mime: "image/png", sha256: "2", bytes: PNG.length }],
  })
  const msg3 = tm.addMessage(thread.id, {
    thread_id: thread.id,
    role: "user",
    content: "three",
    attachments: [{ kind: "image", name: "c.png", mime: "image/png", sha256: "3", bytes: PNG.length }],
  })
  assert.ok(writeImageSidecar(thread.id, msg1.id, 0, "image/png", PNG))
  assert.ok(writeImageSidecar(thread.id, msg2.id, 0, "image/png", PNG))
  assert.ok(writeImageSidecar(thread.id, msg3.id, 0, "image/png", PNG))

  const dir = filesDir(thread.id)
  assert.equal(tm.deleteMessagesFrom(thread.id, msg2.id), true)
  assert.equal(tm.getMessages(thread.id).length, 1)
  assert.ok(fs.existsSync(path.join(dir, `${msg1.id}-0.png`)), "kept message sidecar remains")
  assert.ok(!fs.existsSync(path.join(dir, `${msg2.id}-0.png`)), "removed message sidecar deleted")
  assert.ok(!fs.existsSync(path.join(dir, `${msg3.id}-0.png`)), "suffix message sidecar deleted")
})

test("deleteSidecarsForMessages unlinks dropped rows (cap-trim calls this; do not write 1000 msgs in CI)", () => {
  const tm = new ThreadManager()
  const thread = tm.create("sidecar-cap")
  const oldMsg = tm.addMessage(thread.id, {
    thread_id: thread.id,
    role: "user",
    content: "old",
    attachments: [{ kind: "image", name: "old.png", mime: "image/png", sha256: "o", bytes: PNG.length }],
  })
  const keepMsg = tm.addMessage(thread.id, {
    thread_id: thread.id,
    role: "user",
    content: "keep",
    attachments: [{ kind: "image", name: "keep.png", mime: "image/png", sha256: "k", bytes: PNG.length }],
  })
  assert.ok(writeImageSidecar(thread.id, oldMsg.id, 0, "image/png", PNG))
  assert.ok(writeImageSidecar(thread.id, keepMsg.id, 0, "image/png", PNG))

  const dir = filesDir(thread.id)
  deleteSidecarsForMessages(thread.id, tm.getMessages(thread.id).filter((m) => m.id === oldMsg.id))
  assert.ok(!fs.existsSync(path.join(dir, `${oldMsg.id}-0.png`)))
  assert.ok(fs.existsSync(path.join(dir, `${keepMsg.id}-0.png`)))

  // addMessage cap-trim path must call deleteSidecarsForMessages (see thread-manager.ts).
  const srcCandidates = [
    path.join(__dirname, "..", "..", "src", "threads", "thread-manager.ts"),
    path.join(__dirname, "..", "src", "threads", "thread-manager.js"),
  ]
  const srcPath = srcCandidates.find((p) => fs.existsSync(p))
  assert.ok(srcPath, "thread-manager source not found for cap-trim comment check")
  assert.match(fs.readFileSync(srcPath, "utf-8"), /deleteSidecarsForMessages[\s\S]{0,40}threadId,\s*dropped/)
})

test("soft-trash (trash()) does not delete .files/", () => {
  const tm = new ThreadManager()
  const thread = tm.create("sidecar-trash")
  const msg = tm.addMessage(thread.id, {
    thread_id: thread.id,
    role: "user",
    content: "pic",
    attachments: [{ kind: "image", name: "t.png", mime: "image/png", sha256: "t", bytes: PNG.length }],
  })
  assert.ok(writeImageSidecar(thread.id, msg.id, 0, "image/png", PNG))
  const dir = filesDir(thread.id)
  const filePath = path.join(dir, `${msg.id}-0.png`)

  const trashed = tm.trash(thread.id)
  assert.ok(trashed?.trashed_at)
  assert.ok(fs.existsSync(dir), "trash must keep .files/")
  assert.ok(fs.existsSync(filePath))
  assert.deepEqual(readImageSidecar(thread.id, msg.id, 0, "image/png"), PNG)

  // Hard purge of expired trash does remove .files/
  const cutoff = new Date(Date.now() + 40 * 86400_000)
  const purged = tm.purgeExpiredTrash(30, cutoff)
  assert.ok(purged.includes(thread.id))
  assert.ok(!fs.existsSync(dir), "purgeExpiredTrash must remove .files/")
})
