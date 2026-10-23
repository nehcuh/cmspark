/** Merged #705/#476 dispatch uses the real channel and actors; effects remain inert/owned-FS. */
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
import { SecurityConfirmationManager } from "../src/security-confirmation"
import type { LocalWorkRuntime } from "../src/desktop/local-work"

function fixture(t: any) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desktop-composition-705-")))
  const previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = root
  const threads = new ThreadManager(), registry = new DesktopIdentityRegistry(), confirmations = new SecurityConfirmationManager()
  threads.create("Owned", "composition-A"); threads.create("Sibling", "composition-B")
  threads.update("composition-A", { workspace_root: root })
  const effects: string[] = []
  const local: LocalWorkRuntime = {
    modules: () => ({ terminal: true, agent: false }), activity: () => "idle", shell: () => ({ file: "/inert/shell", args: [] }), agents: () => [],
    openTerminal: () => { effects.push("open"); return { ok: true } }, terminalContext: () => true, terminalBusy: () => false,
    input: () => ({ ok: true }), resize: () => ({ ok: true }), ack: () => ({ ok: true }), ping: () => ({ ok: true }),
    close: () => { effects.push("close"); return { ok: true } },
  }
  const channel = createDesktopChannel({ registry, securityConfirmations: confirmations, services: { threads, skills: { list: () => [], listKnowledge: () => [] }, mcp: { listServers: () => [] } }, maxPayload: 10485760, localRuntime: local, workspaceRuntime: { enabled: () => true, activity: () => "idle" }, archiveActivity: () => "idle", browserPeers: () => [] })
  const socket: any = new EventEmitter(), sent: any[] = []
  socket.readyState = 1; socket.send = (s: string) => sent.push(JSON.parse(s))
  socket.close = socket.terminate = () => { if (socket.readyState !== 1) return; socket.readyState = 3; socket.emit("close") }
  const emit = (f: any) => socket.emit("message", Buffer.from(JSON.stringify(f)))
  channel.wss.emit("connection", socket); assert.equal(sent.shift().type, "desktop.challenge.request")
  const cap = registry.issue("composition-owned")
  emit({ type: "desktop.hello", capability_id: cap.capabilityId, protocol_version: 1 })
  const challenge = sent.shift()
  emit({ type: "desktop.authenticate", capability_id: cap.capabilityId, protocol_version: 1, proof: createHmac("sha256", Buffer.from(cap.secret, "hex")).update(JSON.stringify(["cmspark.desktop.auth.v1", cap.capabilityId, challenge.connection_id, 1, challenge.nonce])).digest("hex") })
  assert.equal(sent.shift().type, "desktop.ready")
  const tick = async () => { for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve)) }
  const send = async (f: any) => { emit(f); await tick(); const i = sent.findIndex(reply => reply.id === f.id && reply.type === f.type + ".result"); return i < 0 ? undefined : sent.splice(i, 1)[0] }
  t.after(() => { socket.terminate(); channel.wss.emit("close"); confirmations.rejectAll("disconnect"); if (previous === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = previous; fs.rmSync(root, { recursive: true, force: true }) })
  return { threads, registry, confirmations, channel, socket, effects, sent, send, emit, tick }
}

test("same authenticated owner retains workspace/local and main archive/browser routes", async t => {
  const f = fixture(t), thread_id = "composition-A"
  const workspace = await f.send({ type: "desktop.workspace.state", id: "workspace", thread_id })
  const local = await f.send({ type: "desktop.local.state", id: "local", thread_id })
  const archive = await f.send({ type: "desktop.archive.state", id: "archive", thread_id })
  const browser = await f.send({ type: "desktop.browser.status", id: "browser" })
  assert.equal(workspace.ok, true); assert.equal(workspace.state.bound, true)
  assert.equal(local.ok, true); assert.equal(local.state.bound, true)
  assert.equal(archive.ok, true); assert.equal(archive.state.activity, "idle")
  assert.equal(browser.ok, true); assert.equal(browser.availability, "unavailable")
  assert.deepEqual(f.effects, [], "reading all four families never starts an effect")
  const saved = await f.send({ type: "desktop.archive.set", id: "archive-save", thread_id, revision: archive.state.revision, archived: true })
  assert.equal(saved.saved, true)
  assert(f.threads.desktopArchiveSnapshot().find(v => v.id === thread_id)?.archived_at)
  assert.equal(f.threads.desktopArchiveSnapshot().find(v => v.id === "composition-B")?.archived_at, undefined)
  const read = await f.send({ type: "desktop.archive.state", id: "restore-state", thread_id })
  assert.equal((await f.send({ type: "desktop.archive.set", id: "restore", thread_id, revision: read.state.revision, archived: false })).saved, true)
  assert.deepEqual(f.effects, [])
})

test("revoking the merged owner retires local confirmation and workspace picker without late authorization", async t => {
  const f = fixture(t), thread_id = "composition-A"
  const local = await f.send({ type: "desktop.local.state", id: "local", thread_id })
  f.emit({ type: "desktop.terminal.open", id: "pending-open", thread_id, revision: local.state.revision, cols: 80, rows: 24 }); await f.tick()
  const confirmation = f.sent.find(v => v.type === "desktop.confirmation.request")
  assert.equal(confirmation.purpose, "local-work"); assert.equal(f.confirmations.pendingCount(), 1)
  const workspace = await f.send({ type: "desktop.workspace.state", id: "workspace", thread_id })
  f.emit({ type: "desktop.workspace.pick", id: "pending-pick", thread_id, revision: workspace.state.revision }); await f.tick()
  const picker = f.sent.find(v => v.type === "desktop.workspace.picker.request")
  assert(picker, "actual workspace actor must own a pending selection")
  f.channel.revokeHost("composition-owned"); await f.tick()
  assert.equal(f.socket.readyState, 3); assert.equal(f.confirmations.pendingCount(), 0)
  const before = f.sent.length
  f.emit({ type: "desktop.confirmation.decision", purpose: "local-work", confirmation_id: confirmation.confirmation_id, thread_id, action_digest: confirmation.action_digest, approved: true })
  f.emit({ type: "desktop.workspace.picker.result", request_id: picker.request_id, thread_id, revision: picker.revision, pick_id: picker.pick_id, outcome: "cancelled" }); await f.tick()
  assert.deepEqual(f.effects.filter(v => v === "open"), []); assert.equal(f.sent.length, before)
})
