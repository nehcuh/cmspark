import { test } from "node:test"
import * as assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import * as fs from "node:fs"
import * as path from "node:path"
import * as vm from "node:vm"
import * as ts from "typescript"
import { CompanionClient } from "../src/tray/companion-client"
import { meetingPcmPong, checkedMeetingPcmReply, projectCaptureStatus } from "../src/voice/meeting-pcm-contract"
import { createMeeting, deleteMeeting, loadMeeting, startMeetingRecording, endMeetingRecording } from "../src/meeting/meeting-store"
import { handleMeetingMessage, resolveMeetingId } from "../src/meeting/meeting-handlers"
import { handleVoiceSttMessage } from "../src/voice/stt-handlers"
import { SttSessionService } from "../src/voice/stt-session-service"
import { DATA_DIR, setVoiceFields } from "../src/config"

class Socket extends EventEmitter {
  readyState = 1
  readonly wires: any[] = []
  constructor(private backend: (message: any) => Promise<any>) { super() }
  send(wire: string) {
    const m = JSON.parse(wire); this.wires.push(m)
    void this.backend(m).then(reply => { if (reply) this.emit("message", Buffer.from(JSON.stringify({ ...reply, id: m.id }))) })
  }
  close() { this.readyState = 3 }
  terminate() { this.readyState = 3 }
}
function setup(backend: (message: any) => Promise<any>) {
  const sockets: Socket[] = []
  const client = new CompanionClient({ host: "OWNED_NO_NETWORK", port: 1, surface: "summoner", reconnectInterval: 5000, maxReconnectAttempts: 0,
    secretLoader: () => { throw new Error("NO_CREDENTIAL_READ") },
    socketFactory: () => { const socket = new Socket(backend); sockets.push(socket); return socket as any },
  })
  async function connect() {
    const ready = client.connect(), socket = sockets[sockets.length - 1]
    socket.emit("open"); socket.emit("message", Buffer.from(JSON.stringify({ type: "auth.ok", protocol_version: 1 })))
    await ready; return socket
  }
  return { client, sockets, connect }
}
function actualTrayDispatch(): (client: CompanionClient, message: any, observation?: unknown) => Promise<any> {
  const file = path.resolve("src/menu-bar-agent.ts"), source = fs.readFileSync(file, "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "dispatchSummonerWeb")!
  const js = ts.transpileModule(fn.getText(ast) + "\nmodule.exports = dispatchSummonerWeb", { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const context = { module: { exports: {} }, checkedMeetingPcmReply, summonerVoiceRequestTimeout: () => undefined }
  vm.runInNewContext(js, context)
  return context.module.exports as any
}
const captureId = "00000000-0000-4000-8000-000000000494"

test("actual tray client ignores missing/invalid advertisements and fences the observed socket across reconnect", async () => {
  for (const advertised of [undefined, "1", 2]) {
    let startCalls = 0
    const { client, connect } = setup(async msg => {
      if (msg.type === "system.ping") return { ...meetingPcmPong(), meeting_pcm_contract: advertised }
      if (msg.type === "meeting.start") startCalls++
    })
    try {
      await connect()
      assert.equal(await client.observeMeetingPcm(), null)
      assert.equal(client.getMeetingPcmObservation(), null)
      await assert.rejects(client.sendMeetingPcmRequest("meeting.start", { queue_contract: 1 }, null), /contract_unavailable/)
      assert.equal(startCalls, 0)
    } finally { client.disconnect() }
  }
  let starts = 0
  const { client, connect } = setup(async msg => { if (msg.type === "system.ping") return meetingPcmPong(); starts++ })
  try {
    const old = await connect(); assert.equal(await client.observeMeetingPcm(), 1)
    const binding = client.getMeetingPcmObservation()
    client.disconnect(); await connect()
    assert.equal(client.getMeetingPcmObservation(), null)
    assert.equal(await client.observeMeetingPcm(), 1)
    old.emit("message", Buffer.from(JSON.stringify({ type: "auth.ok", protocol_version: 1 })))
    old.emit("close")
    assert.ok(client.getMeetingPcmObservation(), "old socket callbacks cannot invalidate the new observation")
    await assert.rejects(actualTrayDispatch()(client, { type: "meeting.start", queue_contract: 1, capture_id: captureId }, binding), /contract_unavailable/)
    assert.equal(starts, 0, "reconnect-before-send must not mutate either backend")
    ;(client as any).handleMessage(JSON.stringify({ type: "auth.failed" }))
    assert.equal(client.getMeetingPcmObservation(), null)
  } finally { client.disconnect() }
})

test("actual menu dispatch/client pending/backend handlers relay q1 receiving/chunk/abort ACK; legacy noACK remains", async () => {
  setVoiceFields({ sttEngine: "local", localModelId: "medium" })
  const meeting = createMeeting({ title: "owned transport 494" })
  let clears = 0, starts = 0
  const service = new SttSessionService({ dataDir: DATA_DIR, probeModel: () => ({ status: "ready" }) })
  const ctx = { origin: "cmspark-tray://local", surface: "summoner", peerId: "owned-tray", send() {} }
  const { client, connect } = setup(async msg => {
    if (msg.type === "system.ping") return meetingPcmPong()
    if (msg.type.startsWith("meeting.")) { starts++; return handleMeetingMessage(msg, ctx, { sttService: service, clearSttSessions() { clears++ } }) }
    return handleVoiceSttMessage(msg, ctx, { service })
  })
  const dispatch = actualTrayDispatch()
  try {
    await connect(); await client.observeMeetingPcm(); const binding = client.getMeetingPcmObservation()
    const begun = await dispatch(client, { type: "meeting.start", v: 1, id: meeting.id, queue_contract: 1, capture_id: captureId,
      expected_capture_epoch: 0, privacy_ack_v1: true, privacy_ack_v2: true }, binding)
    assert.equal(begun.type, "meeting.started"); assert.equal(starts, 1); assert.equal(clears, 0)
    const beginParams = { meeting_id: meeting.id, capture_id: captureId, expected_capture_epoch: 0 }
    assert.throws(() => checkedMeetingPcmReply("meeting.start", beginParams, { ...begun, meeting_pcm_caps: undefined }), /queue_protocol_error/)
    assert.throws(() => checkedMeetingPcmReply("meeting.start", beginParams, { ...begun, meeting_pcm_caps: { ...begun.meeting_pcm_caps, capacityFrames: 999999999 } }), /queue_protocol_error/)

    const common = { v: 1, queue_contract: 1, sessionId: captureId, capture_epoch: 1 }
    const receiving = await dispatch(client, { ...common, type: "voice.stt.start", modelId: "medium", format: "pcm_s16le", sampleRate: 16000, channels: 1, privacy_ack_v2: true }, binding)
    assert.equal(receiving.type, "voice.stt.partial"); assert.equal(receiving.credits.length, 8)
    const c = receiving.credits[0]
    const ack = await dispatch(client, { ...common, type: "voice.stt.chunk", credit_id: c.credit_id, sample_offset: 0, frame_count: 96, data: Buffer.alloc(192).toString("base64") }, binding)
    assert.equal(ack.type, "meeting.capture.status"); assert.equal(ack.credit_id, c.credit_id)
    assert.equal(ack.accepted_through, 96); assert.equal("data" in ack, false)
    const projected = projectCaptureStatus({ ...ack, raw_pcm: "FORBIDDEN", api_key: "FORBIDDEN" })!
    assert.equal("raw_pcm" in projected, false); assert.equal("api_key" in projected, false)
    assert.equal(projectCaptureStatus({ ...ack, code: "untrusted_secret_code" }), null)
    const cancelled = await dispatch(client, { ...common, type: "voice.stt.abort" }, binding)
    assert.equal(cancelled.completion.outcome, "cancelled"); assert.equal(service.getMeetingCapture() === null, true)
    assert.equal(loadMeeting(meeting.id)!.capture_summary!.sticky_incomplete, true)
    let sent = 0, requests = 0
    const old = await dispatch({ sendAppMessage() { sent++; return true }, sendAppRequest() { requests++; throw Error("legacy must not wait for ACK") } } as any,
      { type: "voice.stt.chunk", v: 1, sessionId: "legacy", seq: 0, data: "AAA=" })
    assert.equal(old.type, "ok"); assert.equal(sent, 1); assert.equal(requests, 0)
  } finally { client.disconnect(); service.forceAbort(); deleteMeeting(meeting.id) }
})

function actualHttpRequests(client: CompanionClient, dispatch: ReturnType<typeof actualTrayDispatch>, now?: () => number) {
  const file = path.resolve("src/summoner-web.ts"), source = fs.readFileSync(file, "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const names = ["handleRequest", "dispatchMeetingPcmHttp", "readBody", "parseQuery"]
  const functions = names.map(name => ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!.getText(ast)).join("\n")
  const js = ts.transpileModule(functions + "\nmodule.exports = handleRequest", { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const context: any = { module: { exports: {} }, Map, Buffer, meetingHttpBegin: new (require("../src/voice/meeting-pcm-http-begin").MeetingPcmHttpBegin)(now), overlayContinuousCapture: null, JSON_BODY_MAX: 1024 * 1024,
    tokenOk: () => true, hostOk: () => true, originOk: () => true,
    forbidden(res: any) { res.value = { type: "error", code: "forbidden" } },
    jsonResponse(res: any, value: any) { res.value = value },
    getConfig: () => ({ voice: { sttEngine: "local", localModelId: "medium" } }),
    activeMeetingPcmConnection: () => client.getMeetingPcmObservation(), activeObserveMeetingPcm: () => client.observeMeetingPcm(),
    dispatchAllowed: (type: string, params: any, observation: any) => dispatch(client, { ...params, type }, observation),
    validMeetingPcmMessage: require("../src/voice/meeting-pcm-schema").validMeetingPcmMessage,
  }
  vm.runInNewContext(js, context)
  const request = async (url: string, body?: any, beforeBody?: () => Promise<void>) => {
    const req: any = new EventEmitter(); req.url = url; req.headers = {}; req.method = body ? "POST" : "GET"
    req.destroy = () => {}; const res: any = {}
    const done = context.module.exports(req, res, 1, "OWNED_AUTH_GATE_SEAM_NO_TOKEN")
    if (body) { if (beforeBody) await beforeBody(); req.emit("data", Buffer.from(JSON.stringify(body))); req.emit("end") }
    await done; return res.value
  }
  return Object.assign(request, { context })
}

test("actual HTTP Begin stays bound to its capability observation across a separate settings refresh/reconnect", async () => {
  setVoiceFields({ sttEngine: "local", localModelId: "medium" })
  const meeting = createMeeting({ title: "owned HTTP pre-send reconnect 494" })
  const service = new SttSessionService({ dataDir: DATA_DIR, probeModel: () => ({ status: "ready" }) })
  let starts = 0, clears = 0
  const ctx = { origin: "cmspark-tray://local", surface: "summoner", peerId: "owned-http", send() {} }
  const { client, connect } = setup(async msg => {
    if (msg.type === "system.ping") return meetingPcmPong()
    if (msg.type === "meeting.start") { starts++; return handleMeetingMessage(msg, ctx, { sttService: service, clearSttSessions() { clears++ } }) }
    return handleVoiceSttMessage(msg, ctx, { service })
  })
  try {
    await connect(); const http = actualHttpRequests(client, actualTrayDispatch())
    assert.equal((await http(`/api/voice-settings?capture_id=${captureId}`)).meeting_pcm_contract, 1)
    client.disconnect(); await connect()
    assert.equal((await http("/api/voice-settings")).meeting_pcm_contract, 1, "unrelated actual refresh observes replacement backend")
    const reply = await http("/api/meeting/start", { v: 1, id: meeting.id, queue_contract: 1, capture_id: captureId,
      expected_capture_epoch: 0, privacy_ack_v1: true, privacy_ack_v2: true })
    assert.equal(starts, 0, "old Begin cannot migrate to a newly observed socket")
    assert.equal(reply.code, "contract_unavailable"); assert.equal(clears, 0)
    assert.equal(service.getMeetingCapture() === null, true); assert.equal(loadMeeting(meeting.id)!.status, "draft")
  } finally { client.disconnect(); service.forceAbort(); deleteMeeting(meeting.id) }
})

test("actual HTTP single Begin expires without renewal; different id conflicts and receiving drops pending only", async () => {
  setVoiceFields({ sttEngine: "local", localModelId: "medium" })
  const meeting = createMeeting({ title: "owned HTTP pin lifecycle 494" })
  const service = new SttSessionService({ dataDir: DATA_DIR, probeModel: () => ({ status: "ready" }) })
  let starts = 0, clears = 0, now = 1000
  const ctx = { origin: "cmspark-tray://local", surface: "summoner", peerId: "owned-http-positive", send() {} }
  const { client, connect } = setup(async msg => {
    if (msg.type === "system.ping") return meetingPcmPong()
    if (msg.type === "meeting.start") { starts++; return handleMeetingMessage(msg, ctx, { sttService: service, clearSttSessions() { clears++ } }) }
    return handleVoiceSttMessage(msg, ctx, { service })
  })
  const secondId = "00000000-0000-4000-8000-000000000495"
  const start = (id = captureId) => ({ v: 1, id: meeting.id, queue_contract: 1, capture_id: id, expected_capture_epoch: 0, privacy_ack_v1: true, privacy_ack_v2: true })
  try {
    await connect(); const http = actualHttpRequests(client, actualTrayDispatch(), () => now)
    assert.equal((await http("/api/voice-settings?capture_id=invalid")).meeting_pcm_contract, undefined)
    assert.equal((await http(`/api/voice-settings?capture_id=${captureId}`)).meeting_pcm_contract, 1)
    assert.equal((await http(`/api/voice-settings?capture_id=${secondId}`)).meeting_pcm_contract, undefined)
    now += 20000
    assert.equal((await http(`/api/voice-settings?capture_id=${captureId}`)).meeting_pcm_contract, 1)
    now += 10000
    assert.equal((await http("/api/meeting/start", start())).code, "contract_unavailable", "same-id query cannot extend original 30s")
    assert.equal(starts, 0); assert.equal(service.getMeetingCapture() === null, true); assert.equal(loadMeeting(meeting.id)!.status, "draft")
    assert.equal((await http(`/api/voice-settings?capture_id=${secondId}`)).meeting_pcm_contract, 1)
    const begun = await http("/api/meeting/start", start(secondId))
    assert.equal(begun.type, "meeting.started"); const lease = service.getMeetingCapture()
    assert.equal((await http("/api/meeting/start", start(secondId))).meeting.capture_epoch, 1, "bounded lost-ACK retrieval is same-operation idempotent")
    assert.equal(service.getMeetingCapture(), lease); assert.equal(starts, 2); assert.equal(clears, 0)
    const common = { v: 1, queue_contract: 1, sessionId: secondId, capture_epoch: 1 }
    assert.equal((await http("/api/stt/start", { ...common, modelId: "medium", format: "pcm_s16le", sampleRate: 16000, channels: 1, privacy_ack_v2: true })).status, "receiving")
    assert.equal((await http("/api/voice-settings")).meeting_pcm_contract, 1)
    assert.equal((await http("/api/meeting/start", start(secondId))).code, "contract_unavailable", "ordinary GET does not revive consumed Begin")
    assert.equal(starts, 2); assert.equal(service.getMeetingCapture(), lease)
    const cancelled = await http("/api/stt/abort", common)
    assert.equal(cancelled.completion.outcome, "cancelled"); assert.equal(service.getMeetingCapture() === null, true)
    const nextId = "00000000-0000-4000-8000-000000000496"
    assert.equal((await http(`/api/voice-settings?capture_id=${nextId}`)).meeting_pcm_contract, 1)
    http.context.meetingHttpBegin.terminal(secondId, client.getMeetingPcmObservation())
    assert.ok(http.context.meetingHttpBegin.binding(nextId, client.getMeetingPcmObservation(), client.getMeetingPcmObservation()), "late old terminal cannot clear next Begin")
    http.context.meetingHttpBegin.reset()
  } finally { client.disconnect(); service.forceAbort(); deleteMeeting(meeting.id) }
})

test("actual HTTP snapshot and tray final fence reject reconnect during body await", async () => {
  let starts = 0
  const { client, connect } = setup(async msg => { if (msg.type === "system.ping") return meetingPcmPong(); starts++ })
  try {
    await connect(); const http = actualHttpRequests(client, actualTrayDispatch())
    await http(`/api/voice-settings?capture_id=${captureId}`)
    const reply = await http("/api/meeting/start", { v: 1, id: "mtg_owned", queue_contract: 1, capture_id: captureId,
      expected_capture_epoch: 0, privacy_ack_v1: true, privacy_ack_v2: true }, async () => {
      client.disconnect(); await connect(); await client.observeMeetingPcm()
    })
    assert.equal(reply.code, "contract_unavailable"); assert.equal(starts, 0)
    http.context.meetingHttpBegin.reset()
  } finally { client.disconnect() }
})

test("new actual HTTP/tray client refuses the immutable d007 old backend producer even when the proxy helper advertises 1", async () => {
  const fixture = JSON.parse(fs.readFileSync(path.resolve("tests/fixtures/meeting-pcm-d007-legacy-producer.json"), "utf8"))
  assert.equal(fixture.base, "d00772eda2d430253845595f11f1c491930685aa")
  const oldSource = `${fixture.error_serializer}\nasync function oldStart(msg,ctx,deps){const type=msg.type;${fixture.meeting_start_statement}}\nfunction oldPong(){${fixture.system_ping_statements}}\nmodule.exports={oldStart,oldPong}`
  const context: any = { module: { exports: {} }, resolveMeetingId, createMeeting, loadMeeting, startMeetingRecording, logger: { info() {} } }
  vm.runInNewContext(ts.transpileModule(oldSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
  const { oldStart, oldPong } = context.module.exports
  const meeting = createMeeting({ title: "owned immutable old backend 494" })
  const service = new SttSessionService({ dataDir: DATA_DIR, probeModel: () => ({ status: "ready" }) })
  let starts = 0, clears = 0
  const oldCtx = { origin: "cmspark-tray://local", surface: "summoner", peerId: "owned-old" }
  const oldDeps = { clearSttSessions() { clears++; service.forceAbort() } }
  const begin = { v: 1, id: meeting.id, queue_contract: 1, capture_id: captureId, expected_capture_epoch: 0, privacy_ack_v1: true, privacy_ack_v2: true }
  try {
    assert.equal(service.start({ sessionId: "old-dictation", modelId: "medium", format: "pcm_s16le", sampleRate: 16000, channels: 1 }, "legacy-peer").ok, true)
    const dangerous = await oldStart({ ...begin, type: "meeting.start" }, oldCtx, oldDeps)
    assert.equal(dangerous.type, "meeting.started"); assert.equal(loadMeeting(meeting.id)!.status, "recording")
    assert.equal(clears, 1); assert.equal(service.getBoundPeerId(), null, "actual old producer can mutate and force-clear, proving the negative oracle")
    endMeetingRecording(meeting.id)
    assert.equal(service.start({ sessionId: "protected-old-dictation", modelId: "medium", format: "pcm_s16le", sampleRate: 16000, channels: 1 }, "legacy-peer").ok, true)
    const before = loadMeeting(meeting.id); clears = 0
    const { client, connect } = setup(async msg => {
      if (msg.type === "system.ping") return oldPong()
      if (msg.type === "meeting.start") { starts++; return oldStart(msg, oldCtx, oldDeps) }
    })
    try {
      await connect(); const http = actualHttpRequests(client, actualTrayDispatch())
      assert.equal(meetingPcmPong().meeting_pcm_contract, 1, "current local helper cannot substitute for the backend producer")
      assert.equal((await http(`/api/voice-settings?capture_id=${captureId}`)).meeting_pcm_contract, undefined)
      assert.equal((await http("/api/meeting/start", begin)).code, "contract_unavailable")
      assert.equal(starts, 0); assert.equal(clears, 0)
      assert.equal(service.getMeetingCapture() === null, true); assert.equal(service.getBoundPeerId(), "legacy-peer")
      assert.deepEqual(loadMeeting(meeting.id), before, "failed q1 operation has zero actual old record mutation")
      http.context.meetingHttpBegin.reset()
    } finally { client.disconnect() }
  } finally { service.forceAbort(); deleteMeeting(meeting.id) }
})
