import "./meeting-test-data-dir"
import test from "node:test"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:http"
import { once } from "node:events"
import { validateWsMessage } from "../src/ws/validate"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"
import { beginMeetingCapture, createMeeting, deleteMeeting, loadMeeting, saveMeeting, setMinutes, meetingSourceFingerprint, transcriptToText } from "../src/meeting/meeting-store"
import type { VisionConfig } from "../src/config"

const rpc = (name: string, meeting_id: string, fields = {}) => ({ type: "meeting.visual." + name, meeting_id, owner_id:"0ebd578c-cdd3-42df-99d3-dfd2cf874945", v: 1, id: randomUUID(), ...fields })

test("wire admission rejects images on prepare and more than twelve frames", () => {
  const msg = rpc("prepare", "mtg_fixture", { frames: [], base64: "test" })
  assert.equal(validateWsMessage(msg).valid, false)
})

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
const facts = { recognizedText: "Q3: 71", description: "图表显示 Q3 的数值为 71", uncertainties: [] }
async function fixture(t: any, protocol: "openai" | "anthropic" = "openai") {
  const dir = mkdtempSync(join(tmpdir(), "cmspark-visual-"))
  const id = createMeeting({ dataDir: dir }).id, recordingId = randomUUID()
  beginMeetingCapture(id, recordingId, 0, dir)
  const meeting = loadMeeting(id, dir)!
  meeting.transcript = [{ source: "stt", segment_id: recordingId + "-1-s0", t0: 0, t1: 2, text: "相邻转写" },
    { source: "stt", segment_id: randomUUID() + "-2-s0", t0: 0, t1: 2, text: "其他录屏" }]
  meeting.status = "ready"
  saveMeeting(meeting, dir)
  const frames = [1000, 2000].map(timeMs => ({ frameId: randomUUID(), meetingId: id, recordingId, timeMs,
    width: 1, height: 1, mime: "image/png", sha256: createHash("sha256").update(png).digest("hex"), byteLength: png.length }))
  const images = frames.map(({frameId}) => ({ frameId, base64: png.toString("base64") }))
  const requests: any[] = []
  let finish = protocol === "anthropic" ? "end_turn" : "stop", body = JSON.stringify(facts), delayed = false, redirect = false
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const part of req) chunks.push(Buffer.from(part))
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    server.emit("received")
    if (redirect && req.url !== "/other") {
      res.writeHead(307, { Location: "/other" })
      res.end()
      return
    }
    if (delayed) await once(server, "release")
    res.writeHead(200, {"Content-Type":"application/json"})
    res.end(JSON.stringify(protocol === "anthropic"
      ? {stop_reason:finish,content:[{type:"text",text:body}]}
      : {choices:[{finish_reason:finish,message:{content:body}}]}))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const endpoint = "http://127.0.0.1:" + (server.address() as {port:number}).port + "/v1"
  const vision = {base_url: endpoint, model_name:"fixture", api_key:"local-fixture", enabled:true, protocol} as VisionConfig
  let revision = "rev1"
  const {createMeetingVisualService} = require("../src/meeting/meeting-visual-handlers")
  const service = createMeetingVisualService({dataDir:dir, target:() => ({revision, vision, profileId:"test", profileName:"Fixture"})})
  t.after(() => {server.emit("release"); server.closeAllConnections(); server.close(); rmSync(dir, {recursive:true,force:true})})
  const call = (name:string, fields = {}, peer="owner") => service.handle(rpc(name,id,fields),peer)
  return {dir,id,frames,images,server,requests,call,service, edit(){revision = "rev2"}, hold(){delayed=true}, redirect(){redirect=true},
    output(text:string, reason="stop"){body=text;finish=reason}}
}

test("consent binds ordered actual pixels, recognition destination and capture-specific transcript before any image leaves", async t => {
  const f = await fixture(t)
  const prepare = () => f.call("prepare",{frames:f.frames})
  const run = (consent_token:string, frames = f.images, peer = "owner") => f.call("execute",{consent_token,frames},peer)
  let p = await prepare()
  assert.equal(p.type,"meeting.visual.prepared")
  assert.equal(p.frames[0].nearbyTranscript,"相邻转写")
  assert.equal(f.requests.length,0)
  assert.equal((await run(p.consent_token,f.images,"other")).type,"meeting.error")
  assert.equal((await run(p.consent_token,[...f.images].reverse())).type,"meeting.error")
  p = await prepare()
  assert.equal((await run(p.consent_token,[f.images[0],{...f.images[1],base64:"YWJj"}])).type,"meeting.error")
  p = await prepare()
  f.edit()
  assert.equal((await run(p.consent_token)).type,"meeting.error")
  assert.equal(f.requests.length,0)
  p = await prepare()
  const result = await run(p.consent_token)
  assert.deepEqual(result.completed, f.frames.map(i => i.frameId))
  assert.equal(f.requests.length,2)
  assert.ok(JSON.stringify(f.requests[0]).includes(f.images[0].base64))
  assert.equal((await run(p.consent_token)).type,"meeting.error")
  const saved = (await f.call("list")).evidence
  assert.deepEqual(saved.map((s:any) => s.recognizedText),["Q3: 71","Q3: 71"])
  const files = readdirSync(join(f.dir,"meetings",f.id))
  for (const file of files) assert.ok(!readFileSync(join(f.dir,"meetings",f.id,file),"utf8").includes(f.images[0].base64))
})

test("empty, truncated and over-budget provider output is never evidence", async t => {
  const f = await fixture(t), frames = f.frames.slice(0,1)
  for (const [output,reason] of [[JSON.stringify(facts),"length"],["{}","stop"],
    [JSON.stringify({...facts,recognizedText:"x".repeat(6001)}),"stop"],[JSON.stringify({...facts,description:"",recognizedText:""}),"stop"]]) {
    f.output(output,reason)
    const p = await f.call("prepare",{frames})
    const result = await f.call("execute",{consent_token:p.consent_token,frames:f.images.slice(0,1)})
    assert.deepEqual(result.failed,[frames[0].frameId])
    assert.deepEqual((await f.call("list")).evidence,[])
  }
})

for (const cause of ["cancel","disconnect","remove","delete"]) test(cause + " stops the current request and prevents late writes and subsequent sends", async t => {
  const f = await fixture(t)
  const p = await f.call("prepare",{frames:f.frames})
  f.hold()
  const received = once(f.server,"received")
  const result = f.call("execute",{consent_token:p.consent_token,frames:f.images})
  await received
  if (cause === "cancel") await f.call("cancel",{consent_token:p.consent_token})
  if (cause === "disconnect") f.service.disconnect("owner")
  if (cause === "remove") await f.call("remove",{frameId:f.frames[0].frameId})
  if (cause === "delete") deleteMeeting(f.id,f.dir)
  f.server.emit("release")
  const receipt = await result
  assert.deepEqual(receipt.completed,[])
  assert.equal(f.requests.length,1)
  if (cause !== "delete") assert.deepEqual((await f.call("list")).evidence,[])
  else assert.equal(loadMeeting(f.id,f.dir),null)
})

test("the actual WebSocket envelope budget counts whitespace and all UTF-8 bytes", async t => {
  const f = await fixture(t)
  const prepare = rpc("prepare", f.id, { frames: f.frames })
  assert.equal(validateWsMessage(prepare, 9 * 1024 * 1024).valid, true)
  assert.equal(validateWsMessage(prepare, 9 * 1024 * 1024 + 1).valid, false)
  const crowded = Array.from({ length: 13 }, () => ({ ...f.frames[0], frameId: randomUUID() }))
  assert.equal(validateWsMessage({ ...prepare, frames: crowded }).valid, false)
  for (const patch of [{meetingId:randomUUID()}, {recordingId:randomUUID()}, {width:1601}, {byteLength:524289}]) {
    const result = await f.call("prepare", {frames:[{...f.frames[0],...patch}]})
    assert.equal(result.type,"meeting.error")
  }
  for (const patch of [{width:2}, {mime:"image/jpeg"}, {sha256:"f".repeat(64)}]) {
    const p = await f.call("prepare",{frames:[{...f.frames[0],...patch}]})
    assert.equal((await f.call("execute",{consent_token:p.consent_token,frames:f.images.slice(0,1)})).type,"meeting.error")
  }
  const p = await f.call("prepare",{frames:f.frames})
  const meeting = loadMeeting(f.id,f.dir)!
  meeting.transcript[0].text = "changed"
  saveMeeting(meeting,f.dir)
  assert.equal((await f.call("execute",{consent_token:p.consent_token,frames:f.images})).type,"meeting.error")
  assert.equal(f.requests.length,0)
})

test("earlier completed frames survive the 150 second batch deadline while the 30 second per-frame deadline is pending", async t => {
  const f = await fixture(t)
  const timers = new Map<number,AbortController[]>()
  const original = AbortSignal.timeout
  t.mock.method(AbortSignal,"timeout",function(ms: number) {
    if (ms !== 150_000 && ms !== 30_000) return original(ms)
    const ctl = new AbortController()
    timers.set(ms,[...(timers.get(ms) ?? []),ctl])
    return ctl.signal
  })
  const p = await f.call("prepare",{frames:f.frames})
  f.server.on("received",() => { if (f.requests.length === 2) {
    f.hold()
    assert.equal(timers.get(30_000)?.length,2)
    timers.get(150_000)![0].abort()
  } })
  const result = await f.call("execute",{consent_token:p.consent_token,frames:f.images})
  assert.deepEqual(result.completed,[f.frames[0].frameId])
  assert.equal(result.cancelled,true)
  assert.equal((await f.call("list")).evidence.length,1)
})

test("the 30 second frame deadline settles even when the provider does not release its promise", {timeout:5000}, async t => {
  const f = await fixture(t)
  const { OpenAIProvider } = require("../src/llm/providers/openai")
  const controller = new AbortController()
  const original = AbortSignal.timeout
  t.mock.method(AbortSignal,"timeout",(ms: number) => ms === 30_000 ? controller.signal : original(ms))
  t.mock.method(OpenAIProvider.prototype,"complete",async () => {
    queueMicrotask(() => controller.abort())
    return new Promise(() => {})
  })
  const p = await f.call("prepare",{frames:f.frames.slice(0,1)})
  const result = await f.call("execute",{consent_token:p.consent_token,frames:f.images.slice(0,1)})
  assert.deepEqual(result.failed,[f.frames[0].frameId])
  assert.equal((await f.call("list")).evidence.length,0)
})

test("two extension documents sharing a websocket cannot consume each other's token", async t => {
  const f = await fixture(t)
  const p = await f.call("prepare",{frames:f.frames})
  const otherDocument = await f.call("execute",{consent_token:p.consent_token,frames:f.images,owner_id:randomUUID()})
  assert.equal(otherDocument.type,"meeting.error")
  assert.equal(f.requests.length,0)
  assert.deepEqual((await f.call("execute",{consent_token:p.consent_token,frames:f.images})).completed,f.frames.map(i=>i.frameId))
})

for (const protocol of ["openai","anthropic"] as const) test(protocol + " sends recognized raster data and refuses a redirect", async t => {
  const f = await fixture(t,protocol)
  const run = async () => {
    const p = await f.call("prepare",{frames:f.frames.slice(0,1)})
    return f.call("execute",{consent_token:p.consent_token,frames:f.images.slice(0,1)})
  }
  assert.deepEqual((await run()).completed,[f.frames[0].frameId])
  const parts = f.requests[0].messages.find((m:any) => m.role === "user").content
  if (protocol === "anthropic") assert.deepEqual(parts[0].source,{type:"base64", media_type:"image/png",data:f.images[0].base64})
  else assert.equal(parts[0].image_url.url,"data:image/png;base64," + f.images[0].base64)
  f.redirect()
  assert.deepEqual((await run()).failed,[f.frames[0].frameId])
  assert.equal(f.requests.length,2)
})

test("only current extension-panel sessions may reach visual RPCs", async () => {
  const list = rpc("list","mtg_fixture")
  for (const ctx of [
    {origin:"chrome-extension://test",surface:"summoner",isCurrentSession:()=>true},
    {origin:"chrome-extension://test",surface:"panel",isCurrentSession:()=>false},
    {origin:"cmspark-tray://local",surface:"panel",isCurrentSession:()=>true},
  ]) assert.equal((await handleMeetingMessage(list,{...ctx,peerId:"peer"})).code,"origin_denied")
})

test("reanalyzing a saved frame cannot reassign its media time or identity", async t => {
  const f = await fixture(t)
  const frame = f.frames[0]
  const p = await f.call("prepare",{frames:[frame]})
  await f.call("execute",{consent_token:p.consent_token,frames:f.images.slice(0,1)})
  const changed = await f.call("prepare",{frames:[{...frame,timeMs:frame.timeMs+1000}]})
  assert.equal(changed.type,"meeting.error")
  assert.equal((await f.call("list")).evidence[0].timeMs,frame.timeMs)
})

test("committed visual additions and removals retain success when a later minutes rename fails", async t => {
  const f = await fixture(t)
  const minutes = {raw_md:"source",generated_at:new Date().toISOString()}
  setMinutes(f.id,minutes,f.dir)
  const filesystem = require("node:fs")
  const rename = filesystem.renameSync
  let denyMinutesRename = true, failures = 0
  t.mock.method(filesystem,"renameSync",(from:string,to:string) => {
    if (denyMinutesRename && to.endsWith("minutes.json")) { failures++; throw new Error("locked minutes") }
    return rename(from,to)
  })
  const p = await f.call("prepare",{frames:f.frames.slice(0,1)})
  const result = await f.call("execute",{consent_token:p.consent_token,frames:f.images.slice(0,1)})
  assert.equal(failures,1)
  assert.deepEqual(result.completed,[f.frames[0].frameId])
  const evidence = (await f.call("list")).evidence
  assert.equal(evidence.length,1)
  denyMinutesRename = false
  const meeting = loadMeeting(f.id,f.dir)!
  assert.equal(meeting.minutes?.stale,true)
  setMinutes(f.id,{...minutes,source_fingerprint:meetingSourceFingerprint(transcriptToText(meeting.transcript),"","",evidence)},f.dir)
  denyMinutesRename = true
  const removed = await f.call("remove",{frameId:f.frames[0].frameId})
  assert.equal(failures,2)
  assert.equal(removed.type,"meeting.visual.removed")
  assert.deepEqual((await f.call("list")).evidence,[])
  assert.equal(loadMeeting(f.id,f.dir)?.minutes?.stale,true)
})

test("explicit recovery preserves only the exact corrupt sidecar that was disclosed", async t => {
  const f = await fixture(t)
  const dir = join(f.dir,"meetings",f.id), file = join(dir,"visual-evidence.json")
  writeFileSync(file,"bad JSON A")
  const listed = await f.call("list")
  assert.equal(listed.code,"visual_evidence_corrupt")
  assert.equal(listed.corrupt_sha256,createHash("sha256").update("bad JSON A").digest("hex"))
  const recover = (corrupt_sha256:string,acknowledge:boolean) => f.call("recover",{corrupt_sha256,acknowledge})
  assert.equal((await recover(listed.corrupt_sha256,false)).type,"meeting.error")
  writeFileSync(file,"bad JSON B")
  assert.equal((await recover(listed.corrupt_sha256,true)).type,"meeting.error")
  assert.equal(readFileSync(file,"utf8"),"bad JSON B")
  const revision = (await f.call("list")).corrupt_sha256
  assert.equal((await recover(revision,true)).type,"meeting.visual.recovered")
  const archives = readdirSync(dir).filter(name => readFileSync(join(dir,name),"utf8") === "bad JSON B")
  assert.equal(archives.length,1)
  assert.notEqual(archives[0],"visual-evidence.json")
  assert.deepEqual((await f.call("list")).evidence,[])
  writeFileSync(file,"[]")
  assert.equal((await recover(revision,true)).type,"meeting.error")
  assert.equal(readFileSync(file,"utf8"),"[]")
})
