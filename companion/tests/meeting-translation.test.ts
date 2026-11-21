import "./meeting-test-data-dir"
import test from "node:test"
import assert from "node:assert/strict"
import { createTranslationService, validTranslationRequest } from "../src/meeting/meeting-translation"
import { appendTranscript, createMeeting, deleteMeeting, loadMeeting, replaceTranscript } from "../src/meeting/meeting-store"
import { validateWsMessage } from "../src/ws/validate"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"

const model = () => ({ revision: "a", profileId: null, profileName: null,
  llm: { base_url: "https://fixture.invalid", model_name: "fixture-model", api_key: "fixture", temperature: 0, context_window: 10000 },
})
const frame = (action: string, fields: object) => ({ type: "meeting.translation." + action, v: 1, id: "fixture-rpc", ...fields })
const manual = { text: "First words", language: "English" }

test("manual preparation names the receiver, binds source, language, peer and model, admits text only once", async () => {
  let revision = "a"
  const sent: string[] = []
  const service = createTranslationService(() => ({ ...model(), revision }), async req => {
    assert.equal(req.config.rejectRedirects, true)
    sent.push(req.userContent)
    return "Translation"
  })
  const call = (action: string, fields: object, peer = "peer") => service.handle(frame(action, fields), peer) as Promise<any>
  const prepare = () => call("prepare", manual)
  const prepared = await prepare()
  assert.equal(prepared.endpoint, "https://fixture.invalid/")
  assert.equal(prepared.model, "fixture-model")
  assert.ok(!JSON.stringify(prepared).includes("api_key"))
  assert.equal((await call("run", { ...manual, token: prepared.token }, "other")).code, "consent_changed")
  assert.equal((await call("run", { ...manual, token: prepared.token, text: "Edited" })).code, "consent_changed")
  const language = await prepare()
  assert.equal((await call("run", { ...manual, token: language.token, language: "日本語" })).code, "consent_changed")
  const old = await prepare()
  revision = "b"
  assert.equal((await call("run", { ...manual, token: old.token })).code, "consent_changed")
  const denied = await prepare()
  await call("cancel", { token: denied.token })
  assert.equal((await call("run", { ...manual, token: denied.token })).code, "consent_changed")
  const approved = await prepare()
  assert.equal(sent.length, 0)
  assert.equal((await call("run", { ...manual, token: approved.token })).text, "Translation")
  assert.equal((await call("run", { ...manual, token: approved.token })).code, "consent_changed")
  assert.deepEqual(sent, ["First words"])
  for (const field of [{ audio: "private" }, { base_url: "https://another.invalid" }, { text: "x".repeat(16001) }]) {
    const invalid = frame("prepare", { ...manual, ...field })
    assert.equal(validTranslationRequest(invalid), false)
    assert.equal(validateWsMessage(invalid).valid, false)
  }
  assert.equal(validateWsMessage(frame("prepare", manual)).valid, true)
  const refused = await handleMeetingMessage(frame("prepare", manual), { origin: "cmspark-tray://local", surface: "summoner", peerId: "peer" })
  assert.equal(refused.code, "origin_denied")
})

test("only current saved final segment versions are translated, persisted and retried after provider failure", async t => {
  const meeting = createMeeting({ title: "translation fixture" })
  t.after(() => deleteMeeting(meeting.id))
  const scope = { meeting_id: meeting.id, language: "English" }
  appendTranscript(meeting.id, { segment_id: "stable-1", source: "stt", text: "发布" })
  let fail = true
  let finish!: (value: string) => void
  let signal: AbortSignal | undefined
  const sent: string[] = []
  const service = createTranslationService(model, async req => {
    sent.push(req.userContent)
    if (fail) throw new Error("sensitive service error body")
    signal = req.signal
    return new Promise<string>(resolve => { finish = resolve })
  })
  const call = (action: string, fields: object) => service.handle(frame(action, fields), "peer") as Promise<any>
  const list = () => call("list", { meeting_id: meeting.id })
  const { token } = await call("prepare", scope)
  async function run(version: string) {
    return call("run", { ...scope, token, segment_id: "stable-1", version })
  }
  const old = (await list()).segments[0]
  assert.equal((await run(old.version)).code, "failed")
  assert.equal(loadMeeting(meeting.id)?.transcript[0]?.text, "发布")
  fail = false
  const delayed = run(old.version)
  replaceTranscript(meeting.id, [{ segment_id: "stable-1", source: "user_edit", text: "稍后发布" }])
  finish("obsolete")
  assert.equal((await delayed).code, "stale")
  const current = (await list()).segments[0]
  assert.notEqual(old.version, current.version)
  assert.equal((await run(old.version)).code, "stale")
  const retry = run(current.version)
  finish("Release later")
  assert.equal((await retry).entry.text, "Release later")
  const restart = createTranslationService(model)
  const reopened: any = await restart.handle(frame("list", { meeting_id: meeting.id }), "other-peer")
  assert.equal(reopened.translations.length, 1)
  assert.equal(reopened.translations[0].version, current.version)
  assert.equal(reopened.segments[0].text, "稍后发布")
  replaceTranscript(meeting.id, [{ segment_id: "stable-1", source: "user_edit", text: "周五发布" }])
  const cancelled = run((await list()).segments[0].version)
  service.disconnect("peer")
  assert.equal(signal?.aborted, true)
  finish("Discard after cancel")
  assert.equal((await cancelled).code, "cancelled")
  assert.equal((await run(current.version)).code, "consent_changed")
  assert.deepEqual(sent, ["发布", "发布", "稍后发布", "周五发布"])
})
