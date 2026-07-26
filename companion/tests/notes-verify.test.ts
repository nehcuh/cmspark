// Grill G4/G5 pure verify helpers.

import test from "node:test"
import assert from "node:assert/strict"
import {
  evaluateNotesCreateVerify,
  evaluateMailReadVerify,
} from "../src/host-use/darwin/notes-verify"

const ID = "macos:com.apple.Notes:ZGVmYXVsdA:note-abc123"

test("Notes create: verified when re-read body contains needle", () => {
  const r = evaluateNotesCreateVerify({
    body: "Meeting notes: Q3\nbody",
    targetId: ID,
    reReadBody: "Meeting notes: Q3\nbody more",
    listedIds: [ID],
  })
  assert.equal(r.posted, true)
  assert.equal(r.verified, true)
})

test("Notes create: fail-closed without re-read body even if listed", () => {
  const r = evaluateNotesCreateVerify({
    body: "Meeting notes: Q3",
    targetId: ID,
    reReadBody: "",
    listedIds: [ID],
  })
  assert.equal(r.verified, false)
  assert.ok(r.reason?.includes("re-read"))
})

test("Notes create: fail-closed when body mismatch", () => {
  const r = evaluateNotesCreateVerify({
    body: "Secret body A",
    targetId: ID,
    reReadBody: "Totally different note",
    listedIds: [ID],
  })
  assert.equal(r.verified, false)
})

test("Notes create: fail-closed without target_id", () => {
  const r = evaluateNotesCreateVerify({
    body: "hi",
    targetId: null,
    reReadBody: "hi",
    listedIds: [ID],
  })
  assert.equal(r.verified, false)
})

test("Notes create: body ok without list is verified", () => {
  const r = evaluateNotesCreateVerify({
    body: "Title line",
    targetId: ID,
    reReadBody: "Title line",
  })
  assert.equal(r.verified, true)
})

test("Notes create: body ok but list present and id missing → false", () => {
  const r = evaluateNotesCreateVerify({
    body: "Title line",
    targetId: ID,
    reReadBody: "Title line",
    listedIds: ["macos:com.apple.Notes:x:note-other"],
  })
  assert.equal(r.verified, false)
})

test("Mail read: verified when all fields present", () => {
  const r = evaluateMailReadVerify({
    sender: "a@b.com",
    subject: "Hi",
    date_received: "2026-07-26",
    body_preview: "Hello",
  })
  assert.equal(r.verified, true)
})

test("Mail read: fail-closed on empty subject", () => {
  const r = evaluateMailReadVerify({
    sender: "a@b.com",
    subject: "  ",
    date_received: "2026-07-26",
    body_preview: "Hello",
  })
  assert.equal(r.verified, false)
})
