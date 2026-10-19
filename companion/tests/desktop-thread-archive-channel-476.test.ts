import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { EventEmitter } from "node:events"
import { createHmac } from "node:crypto"
import { ThreadManager } from "../src/threads/thread-manager"
import { DesktopIdentityRegistry } from "../src/desktop/identity"
import { createDesktopChannel } from "../src/desktop/channel"
import { createDesktopArchive } from "../src/desktop/archive"

function owned(t: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-channel-476-")), previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = dir
  t.after(() => { if (previous === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }) })
  const manager = new ThreadManager(); manager.create("same title", "archive-A"); manager.create("same title", "archive-B")
  return { manager, dir }
}
function authenticate(t: any, manager: ThreadManager, activity?: (id: string) => "idle" | "busy" | "unknown") {
  const registry = new DesktopIdentityRegistry(), channel = createDesktopChannel({ registry, services: { threads: manager, skills: { list: () => [], listKnowledge: () => [] }, mcp: { listServers: () => [] } }, maxPayload: 10 * 1024 * 1024, archiveActivity: activity })
  const sent: any[] = [], socket: any = new EventEmitter(); socket.readyState = 1; socket.send = (s: string) => sent.push(JSON.parse(s)); socket.close = socket.terminate = () => { socket.readyState = 3; socket.emit("close") }
  channel.wss.emit("connection", socket); assert.equal(sent.shift().type, "desktop.challenge.request")
  const boot = registry.issue("owned-archive-476"); socket.emit("message", Buffer.from(JSON.stringify({ type: "desktop.hello", capability_id: boot.capabilityId, protocol_version: 1 })))
  const challenge = sent.shift(), input = JSON.stringify(["cmspark.desktop.auth.v1", boot.capabilityId, challenge.connection_id, 1, challenge.nonce])
  socket.emit("message", Buffer.from(JSON.stringify({ type: "desktop.authenticate", capability_id: boot.capabilityId, protocol_version: 1, proof: createHmac("sha256", Buffer.from(boot.secret, "hex")).update(input).digest("hex") })))
  assert.equal(sent.shift().type, "desktop.ready"); t.after(() => { socket.close(); channel.wss.emit("close") })
  return { socket, registry, send(frame: any) { socket.emit("message", Buffer.from(typeof frame === "string" ? frame : JSON.stringify(frame))); return sent.shift() } }
}
const state = (thread_id = "archive-A") => ({ type: "desktop.archive.state", id: "state", thread_id })
const set = (revision: string, archived = true, thread_id = "archive-A") => ({ type: "desktop.archive.set", id: "set", thread_id, revision, archived })

test("real authenticated archive lifecycle persists and both Web and native views remain reachable", t => {
  const { manager } = owned(t), c = authenticate(t, manager, () => "idle")
  const initial = c.send(state()); assert.equal(initial.ok, true); assert.equal(initial.state.activity, "idle")
  const result = c.send(set(initial.state.revision)); assert.deepEqual(Object.keys(result).sort(), ["type", "id", "thread_id", "ok", "saved", "archived"].sort()); assert.equal(result.saved, true)
  assert.equal(c.send({ type: "thread.list", id: "active" }).threads.some((r: any) => r.id === "archive-A"), false)
  assert.equal(manager.list().some(r => r.id === "archive-A"), true)
  assert.equal(c.send({ type: "desktop.archive.list", id: "list" }).threads[0].id, "archive-A")
  const restored = c.send(set(c.send(state()).state.revision, false)); assert.equal(restored.archived, false)
  assert.equal(new ThreadManager().desktopArchiveSnapshot().find(r => r.id === "archive-A")!.archived_at, null)
})
test("a fresh state for missing B retires A revision and set remains single-use", t => {
  const { manager } = owned(t), c = authenticate(t, manager, () => "idle"), revision = c.send(state()).state.revision
  assert.equal(c.send(state("missing")).error_code, "DESKTOP_ARCHIVE_NOT_FOUND")
  assert.equal(c.send(set(revision)).error_code, "DESKTOP_ARCHIVE_STALE")
  const next = c.send(state()).state.revision; assert.equal(c.send(set(next)).saved, true); assert.equal(c.send(set(next)).error_code, "DESKTOP_ARCHIVE_STALE")
})
for (const activity of ["busy", "unknown"] as const) test(`actual archive route refuses ${activity} without commit`, t => {
  const { manager, dir } = owned(t), c = authenticate(t, manager, () => activity), before = fs.readFileSync(path.join(dir, "threads/index.json"))
  const snapshot = c.send(state()); assert.equal(snapshot.state.activity, activity)
  assert.equal(c.send(set(snapshot.state.revision)).error_code, activity === "busy" ? "DESKTOP_ARCHIVE_BUSY" : "DESKTOP_ARCHIVE_ACTIVITY_UNKNOWN")
  assert.deepEqual(fs.readFileSync(path.join(dir, "threads/index.json")), before)
})
test("missing runtime activity injection is unknown rather than implicit idle", t => {
  const { manager } = owned(t), c = authenticate(t, manager), reply = c.send(state())
  assert.equal(reply.state.activity, "unknown"); assert.equal(c.send(set(reply.state.revision)).saved, false)
})
test("state is OCC-bound to fresh canonical target and failed write cannot be replayed", t => {
  const { manager } = owned(t), c = authenticate(t, manager, () => "idle"), revision = c.send(state()).state.revision
  manager.update("archive-A", { alias: "changed after state" }); assert.equal(c.send(set(revision)).error_code, "DESKTOP_ARCHIVE_CONFLICT")
  const fresh = c.send(state()).state.revision, original = fs.renameSync
  t.mock.method(fs, "renameSync", (...args: any[]) => { if (String(args[1]).endsWith("index.json")) throw Error("owned private path canary"); return Reflect.apply(original, fs, args) })
  const reply = c.send(set(fresh)); assert.equal(reply.error_code, "DESKTOP_ARCHIVE_SAVE_UNCONFIRMED"); assert.equal(JSON.stringify(reply).includes("canary"), false)
  assert.equal(c.send(set(fresh)).error_code, "DESKTOP_ARCHIVE_STALE")
})
test("actor rechecks owner after busy probe and never commits for the retired owner", t => {
  const { manager } = owned(t); let current = true, retire = false
  const actor = createDesktopArchive({ threads: manager, current: () => current, activity: () => { if (retire) current = false; return "idle" } })
  const reply: any = actor.handle(state()); retire = true
  assert.equal(actor.handle(set(reply.state.revision)).error_code, "DESKTOP_ARCHIVE_STALE")
  assert.equal(manager.desktopArchiveSnapshot().find(r => r.id === "archive-A")!.archived_at, undefined)
})
test("archive title projection and exact-ID access cover the 65th duplicate-title row", t => {
  const { manager } = owned(t)
  for (let n = 0; n < 65; n++) { const id = "row-" + n; manager.create("duplicate title", id); const snap = manager.desktopArchiveSnapshot().find(r => r.id === id)!; manager.setDesktopArchive(id, snap, true) }
  const c = authenticate(t, manager, () => "idle"), all = c.send({ type: "desktop.archive.list", id: "all" })
  assert.equal(all.threads.length, 64); assert.equal(all.truncated, true)
  const exact = c.send({ type: "desktop.archive.list", id: "find", query: "row-0" }); assert.equal(exact.threads.length, 1); assert.equal(exact.threads[0].id, "row-0")
  assert.equal(c.send({ type: "desktop.archive.list", id: "title", query: "duplicate" }).truncated, true)
})
test("archive exact-ID lookup preserves canonical uppercase identity", t => {
  const { manager } = owned(t); manager.create("unrelated display label", "UpperCase65")
  manager.setDesktopArchive("UpperCase65", manager.desktopArchiveSnapshot().find(r => r.id === "UpperCase65")!, true)
  const c = authenticate(t, manager, () => "idle"), result = c.send({ type: "desktop.archive.list", id: "exact", query: "UpperCase65" })
  assert.equal(result.threads.length, 1); assert.equal(result.threads[0].id, "UpperCase65")
})
test("archive actor rejects coerced, prototype, extra and unsafe keys with fixed-only failures", t => {
  const { manager } = owned(t), c = authenticate(t, manager, () => "idle")
  for (const frame of [{ ...state(), thread_id: "archive-A\n" }, { ...state(), path: "/private" }, { ...set("a".repeat(64)), archived: "true" }, { ...set("a".repeat(64)), revision: "a".repeat(64) + "\n" }, { type: "desktop.archive.list", id: "x", query: 3 }]) assert.equal(c.send(frame).error_code, "DESKTOP_ARCHIVE_INPUT_INVALID")
  const actor = createDesktopArchive({ threads: manager, current: () => true, activity: () => "idle" })
  assert.equal(actor.handle(JSON.parse('{"type":"desktop.archive.state","id":"x","thread_id":"archive-A","__proto__":1}')).error_code, "DESKTOP_ARCHIVE_INPUT_INVALID")
})

test("a renamed archive commit with a lost writer return is unconfirmed and cannot replay", t => {
  const { manager, dir } = owned(t), c = authenticate(t, manager, () => "idle")
  const revision = c.send(state()).state.revision, rename = fs.renameSync
  let commits = 0
  t.mock.method(fs, "renameSync", (...args: any[]) => {
    Reflect.apply(rename, fs, args)
    if (String(args[1]).endsWith("index.json")) { commits++; throw Error("owned post-rename failure") }
  })
  const reply = c.send(set(revision))
  assert.equal(reply.error_code, "DESKTOP_ARCHIVE_SAVE_UNCONFIRMED"); assert.equal(reply.saved, false)
  assert.equal(JSON.stringify(reply).includes("post-rename"), false)
  assert.equal(typeof new ThreadManager().desktopArchiveSnapshot().find(r => r.id === "archive-A")!.archived_at, "string")
  const disk = fs.readFileSync(path.join(dir, "threads/index.json"))
  assert.equal(c.send(set(revision)).error_code, "DESKTOP_ARCHIVE_STALE")
  assert.equal(commits, 1); assert.deepEqual(fs.readFileSync(path.join(dir, "threads/index.json")), disk)
})
