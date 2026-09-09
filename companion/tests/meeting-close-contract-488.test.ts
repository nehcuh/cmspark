// Capture real route/store responses in an isolated data directory, never user data.
import "./meeting-test-data-dir"
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { handleMessage } from "../src/message-router"

test("meeting existing request-id/owner contract persists writes and repeated end returns a receipt", async () => {
  const services = { threadManager: {}, skillEngine: {}, historyStore: {} } as any
  const session = { origin: "chrome-extension://abcdefghijklmnopqrstuvwxyz" } as any
  let sequence = 0
  const route = async (type: string, fields: Record<string, unknown> = {}, context = session) => {
    const request = { ...fields, type, v: 1, id: `meeting-contract-${++sequence}` }
    const response = await handleMessage(request, services, context)
    // Exact production WS envelope, pinned below to prevent an invented contract.
    return { request, response: JSON.parse(JSON.stringify({ ...response, id: request.id })) }
  }
  const lifecycle = fs.readFileSync(path.resolve("src/ws/lifecycle.ts"), "utf8")
  assert.ok(lifecycle.includes("ws.send(JSON.stringify({ ...response, id: msg?.id }))"))
  const created = await route("meeting.create", { title: "Synthetic receipt fixture", thread_id: "thread-fixture" })
  const owner = created.response.meeting.id
  const started = await route("meeting.start", { meeting_id: owner, privacy_ack_v1: true })
  const appended = await route("meeting.append_transcript", { meeting_id: owner, text: "你好", source: "stt" })
  const oldRead = await route("meeting.get", { meeting_id: owner })
  const suffix = await route("meeting.append_transcript", { meeting_id: owner, text: "好", source: "stt" })
  const repeated = await route("meeting.append_transcript", { meeting_id: owner, text: "好", source: "stt" })
  const replaced = await route("meeting.set_transcript", { meeting_id: owner, text: "你好\n好\n好", source: "user_edit", silence_cut: false })
  const read = await route("meeting.get", { meeting_id: owner })
  const ended = await route("meeting.end", { meeting_id: owner })
  const endedAgain = await route("meeting.end", { meeting_id: owner })
  const denied = await route("meeting.set_transcript", { meeting_id: owner, text: "拒绝", silence_cut: false }, { origin: "https://untrusted.invalid" })
  assert.equal(denied.response.code, "origin_denied")
  assert.deepEqual(read.response.meeting.transcript.map((line: any) => line.text), ["你好", "好", "好"])
  assert.equal(ended.response.type, "meeting.ended")
  assert.equal(endedAgain.response.type, "meeting.ended")
  for (const result of [started, appended, oldRead, suffix, repeated, replaced, read, ended, endedAgain]) {
    assert.equal(result.response.meeting.id, owner)
    assert.equal(result.response.id, result.request.id)
    assert.notEqual(result.response.id, owner)
  }
  assert.equal("revision" in read.response.meeting, false)
  assert.equal("id" in read.response.meeting.transcript[0], false)
  const fixtures = { created, started, appended, oldRead, suffix, repeated, replaced, read, ended, endedAgain, denied }
  if (process.env.CMSPARK_MEETING_FIXTURE_OUT) {
    fs.writeFileSync(process.env.CMSPARK_MEETING_FIXTURE_OUT, `// Captured by companion/tests/meeting-close-contract-488.test.ts through handleMessage + actual WS envelope.\nexport const meetingResponses = ${JSON.stringify(fixtures, null, 2)} as const\n`)
  }
})
