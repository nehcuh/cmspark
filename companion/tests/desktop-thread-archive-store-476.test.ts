import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ThreadManager } from "../src/threads/thread-manager"
import { desktopRead, desktopTitleSearch } from "../src/desktop/read"

function owned(t: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-store-476-")), previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = dir
  t.after(() => { if (previous === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }) })
  const manager = new ThreadManager(); manager.create("A", "archive-A"); manager.create("B", "archive-B")
  const indexPath = path.join(dir, "threads/index.json")
  const snapshot = (m: ThreadManager = manager) => (m as any).desktopArchiveSnapshot().find((r: any) => r.id === "archive-A")
  const set = (archived: boolean, m: ThreadManager = manager, expected = snapshot(m)) => (m as any).setDesktopArchive("archive-A", expected, archived)
  return { dir, manager, indexPath, snapshot, set }
}

test("archive and restore persist one metadata field without rewriting messages or attachments", t => {
  const x = owned(t); x.manager.addMessage("archive-A", { role: "user", content: "owned transcript", thread_id: "archive-A" })
  const messages = path.join(x.dir, "threads/archive-A.json"), bytes = fs.readFileSync(messages)
  const attachment = path.join(x.dir, "threads/archive-A.files"); fs.mkdirSync(attachment); fs.writeFileSync(path.join(attachment, "owned.txt"), "owned attachment")
  const before = JSON.parse(fs.readFileSync(x.indexPath, "utf8")); x.set(true)
  const archived = x.snapshot(); assert.equal(typeof archived.archived_at, "string"); assert.equal(archived.trashed_at, undefined)
  const after = JSON.parse(fs.readFileSync(x.indexPath, "utf8")); const strip = (r: any) => { const { archived_at, updated_at, ...rest } = r; return rest }
  assert.deepEqual(after.threads.map(strip), before.threads.map(strip)); assert.deepEqual(fs.readFileSync(messages), bytes)
  x.set(false); assert.equal(x.snapshot().archived_at, null); assert.equal(fs.readFileSync(path.join(attachment, "owned.txt"), "utf8"), "owned attachment")
  assert.deepEqual(fs.readFileSync(messages), bytes)
})
test("stale peer ordinary save preserves disk archive and restore-null with the newer clock", t => {
  const x = owned(t), stale = new ThreadManager(); x.set(true); const archived = x.snapshot()
  stale.update("archive-B", { alias: "B changed" }); assert.deepEqual(x.snapshot(), archived)
  const oldArchived = new ThreadManager(); x.set(false); const restored = x.snapshot()
  oldArchived.update("archive-B", { alias: "B again" }); assert.deepEqual(x.snapshot(), restored)
  assert.equal(restored.archived_at, null)
})
test("stale manager automatic empty cleanup preserves disk-archived empty targets", t => {
  const x = owned(t), stale = new ThreadManager(); x.set(true)
  assert.equal((stale as any).emptyCleanupCandidates().some((r: any) => r.id === "archive-A"), false)
  const deleted = stale.cleanupEmpty(); assert.equal(deleted.includes("archive-A"), false)
  assert.equal(fs.existsSync(path.join(x.dir, "threads/archive-A.json")), true)
  assert.equal(x.snapshot().archived_at !== null, true)
})
test("archive is not age-based trash and survives trash restoration", t => {
  const x = owned(t); x.set(true); x.manager.trash("archive-A"); x.manager.restore("archive-A")
  assert.equal(typeof x.snapshot().archived_at, "string"); assert.deepEqual(x.manager.purgeExpiredTrash(30, new Date("2099-01-01T00:00:00.000Z")), [])
  assert.equal(x.manager.list().some(r => r.id === "archive-A"), true)
  x.manager.trash("archive-A"); assert.equal(x.manager.purgeExpiredTrash(30, new Date("2099-01-01T00:00:00.000Z")).includes("archive-A"), true)
})
test("archive commit rejects stale target incarnation or metadata without touching siblings", t => {
  const x = owned(t), expected = x.snapshot(); x.manager.update("archive-A", { alias: "renamed" })
  const before = fs.readFileSync(x.indexPath); assert.throws(() => x.set(true, x.manager, expected), /DESKTOP_ARCHIVE_CONFLICT/)
  assert.deepEqual(fs.readFileSync(x.indexPath), before)
})
test("same-state archive is a real no-write with a valid fresh snapshot", t => {
  const x = owned(t); x.set(true); const before = fs.readFileSync(x.indexPath), snap = x.snapshot()
  t.mock.method(fs, "renameSync", () => { throw Error("unexpected same-state write") })
  x.set(true, x.manager, snap); assert.deepEqual(fs.readFileSync(x.indexPath), before)
})
for (const fault of ["write", "rename"] as const) test(`archive ${fault} failure preserves previous disk and in-memory target`, t => {
  const x = owned(t), before = fs.readFileSync(x.indexPath), memory = structuredClone(x.manager.get("archive-A")), expected = x.snapshot()
  const name = fault === "write" ? "writeFileSync" : "renameSync", original = fs[name] as any
  t.mock.method(fs, name, ((...args: any[]) => { if (String(args[fault === "write" ? 0 : 1]).includes("index.json")) throw Error("owned failure"); return Reflect.apply(original, fs, args) }) as any)
  assert.throws(() => x.set(true, x.manager, expected)); assert.deepEqual(fs.readFileSync(x.indexPath), before); assert.deepEqual(x.manager.get("archive-A"), memory)
})
test("bad canonical index never grants archive or automatic empty deletion", t => {
  const x = owned(t); fs.writeFileSync(x.indexPath, "{invalid")
  assert.throws(() => x.snapshot(), /DESKTOP_ARCHIVE_UNAVAILABLE/)
  assert.deepEqual(x.manager.cleanupEmpty(), []); assert.equal(fs.existsSync(path.join(x.dir, "threads/archive-A.json")), true)
})

for (const operation of ["create", "update"] as const) test(`ordinary ${operation} still deduplicates legacy rows without archive metadata`, t => {
  const x = owned(t)
  x.manager.addMessage("archive-A", { role: "user", content: "preserved legacy history", thread_id: "archive-A" })
  const history = path.join(x.dir, "threads/archive-A.json"), bytes = fs.readFileSync(history)
  const current = JSON.parse(fs.readFileSync(x.indexPath, "utf8"))
  current.threads.push(structuredClone(current.threads.find((r: any) => r.id === "archive-A")))
  fs.writeFileSync(x.indexPath, JSON.stringify(current))
  assert.throws(() => x.snapshot(), /DESKTOP_ARCHIVE_UNAVAILABLE/, "native archive still refuses ambiguous rows")
  if (operation === "create") x.manager.create("new legacy-compatible row", "legacy-C")
  else x.manager.update("archive-B", { alias: "ordinary legacy update" })
  const saved = JSON.parse(fs.readFileSync(x.indexPath, "utf8"))
  assert.equal(saved.threads.filter((r: any) => r.id === "archive-A").length, 1)
  assert.equal(saved.threads.find((r: any) => r.id === "archive-A").archived_at, undefined)
  assert.deepEqual(fs.readFileSync(history), bytes)
  assert.equal(saved.threads.some((r: any) => r.id === (operation === "create" ? "legacy-C" : "archive-B")), true)
})
test("ordinary writes refuse duplicate rows carrying even explicit restore-null archive metadata", t => {
  const x = owned(t), disk = JSON.parse(fs.readFileSync(x.indexPath, "utf8"))
  const target = disk.threads.find((r: any) => r.id === "archive-A")
  disk.threads.push({ ...target, archived_at: null }); fs.writeFileSync(x.indexPath, JSON.stringify(disk))
  const before = fs.readFileSync(x.indexPath)
  assert.throws(() => x.manager.update("archive-B", { alias: "must not erase ambiguous restore" }), /DESKTOP_ARCHIVE_UNAVAILABLE/)
  assert.deepEqual(fs.readFileSync(x.indexPath), before)
})

for (const legacy of ["duplicate without archive metadata", "noncanonical legacy timestamp"] as const) test(`normal native list and search preserve ${legacy} without index repair`, t => {
  const x = owned(t), disk = JSON.parse(fs.readFileSync(x.indexPath, "utf8"))
  const target = disk.threads.find((r: any) => r.id === "archive-A")
  if (legacy === "duplicate without archive metadata") disk.threads.push({ ...target })
  else { target.created_at = "2026-01-01T00:00:00Z"; target.updated_at = "2026-01-01T00:00:00Z" }
  fs.writeFileSync(x.indexPath, JSON.stringify(disk))
  const manager = new ThreadManager(), before = fs.readFileSync(x.indexPath)
  const services = { threads: manager, skills: { list: () => [], listKnowledge: () => [] }, mcp: { listServers: () => [] } }
  const listed = desktopRead("thread.list", undefined, services) as any
  const found = desktopTitleSearch("A", 10, services) as any
  assert.deepEqual(listed.threads.map((r: any) => r.id).sort(), ["archive-A", "archive-B"])
  assert.equal(found.threads.some((r: any) => r.id === "archive-A"), true)
  assert.deepEqual(fs.readFileSync(x.indexPath), before, "normal metadata reads must not dedupe or rewrite the index")
  assert.throws(() => manager.desktopArchiveSnapshot(), /DESKTOP_ARCHIVE_UNAVAILABLE/, "archive/OCC snapshots still refuse ambiguous or noncanonical state")
})
