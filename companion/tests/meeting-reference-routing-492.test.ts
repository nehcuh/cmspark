import "./meeting-test-data-dir"
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { handleMessage } from "../src/message-router"
import { validateWsMessage } from "../src/ws/validate"

test("reference wire shapes pass the real WS validator; oversized or malformed material fails", () => {
  const imported = { type: "meeting.import_reference", v: 1, file: { name: "notes.md", content: Buffer.from("Python").toString("base64") } }
  const saved = { type: "meeting.set_reference", v: 1, id: "meeting-rpc-test", meeting_id: "mtg_test123", reference_notes: "Python", reference_name: "notes.md" }
  assert.equal(validateWsMessage(imported).valid, true)
  assert.equal(validateWsMessage(saved).valid, true)
  for (const message of [
    { ...imported, v: 2 }, { ...imported, file: [] },
    { ...imported, file: { name: "notes.txt", content: "A".repeat(Math.ceil(7 * 1024 * 1024 / 3) * 4 + 1) } },
    { ...saved, reference_notes: "x".repeat(100_001) }, { ...saved, reference_name: {} },
    { ...saved, type: "meeting.generate_minutes", text: "hello", reference_notes: {} },
  ]) assert.equal(validateWsMessage(message).valid, false)
})

test("reference import and persistence reach the production router without expanding overlay access", async () => {
  const services = { threadManager: {}, skillEngine: {}, historyStore: {} } as any
  const extension = { origin: "chrome-extension://abcdefghijklmnopqrstuvwxyz" } as any
  const route = (message: any, context = extension) => handleMessage(message, services, context)
  const imported = await route({ type: "meeting.import_reference", v: 1, file: {
    name: "notes.md", type: "text/markdown", content: Buffer.from("术语：Python").toString("base64"),
  } })
  assert.equal(imported.type, "meeting.reference_imported")
  assert.equal(imported.reference.text, "术语：Python")
  const created = await route({ type: "meeting.create", v: 1, title: "Synthetic reference routing" })
  const saved = await route({ type: "meeting.set_reference", v: 1, meeting_id: created.meeting.id,
    reference_notes: imported.reference.text, reference_name: imported.reference.name })
  assert.equal(saved.type, "meeting.updated")
  const read = await route({ type: "meeting.get", v: 1, meeting_id: created.meeting.id })
  assert.equal(read.meeting.reference_notes, "术语：Python")
  assert.equal(read.meeting.transcript.length, 0)
  for (const type of ["meeting.import_reference", "meeting.set_reference"]) {
    const denied = await route({ type, v: 1 }, { origin: "http://127.0.0.1:23402", surface: "overlay" } as any)
    assert.notEqual(denied.type, "meeting.reference_imported")
    assert.notEqual(denied.type, "meeting.updated")
    assert.ok(denied.type === "error" || denied.type === "meeting.error")
  }
  // The actual forwarding block must include both routes; a handler-only test
  // would miss an extension SW replying Unknown message type.
  const worker = fs.readFileSync(path.resolve("../chrome-extension/src/background/index.ts"), "utf8")
  const block = worker.slice(worker.indexOf('case "meeting.create":'), worker.indexOf('case "ui.open_sidepanel":'))
  assert.ok(block.includes('case "meeting.import_reference":'))
  assert.ok(block.includes('case "meeting.set_reference":'))
})
