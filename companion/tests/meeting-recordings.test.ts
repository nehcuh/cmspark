import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { createMeeting, deleteMeeting } from "../src/meeting/meeting-store"
import { MeetingWaveFile, listMeetingRecordings, recordingDirectory } from "../src/meeting/meeting-recordings"
import { MeetingPcmQueue } from "../src/voice/meeting-pcm-queue"
import { MeetingVideoUpload } from "../src/summoner/meeting-video-upload"
import { serveMeetingRecordings } from "../src/summoner/meeting-recording-http"

test("meeting history serves the exact ordered WAV prefix and only completed video files", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mini-recording-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const { id } = createMeeting({ dataDir: root })
  const capture = randomUUID(), wav = new MeetingWaveFile(id, capture, root)
  const queue = new MeetingPcmQueue(undefined, undefined, pcm => wav.append(pcm))
  const [a, b] = queue.reserve(), first = Buffer.alloc(a.max_frames * 2, 12), last = Buffer.from([34, 56])
  queue.append(b.credit_id, b.sample_offset, 1, last)
  assert.equal(listMeetingRecordings(id, root).length, 0)
  queue.append(a.credit_id, a.sample_offset, a.max_frames, first)
  queue.append(a.credit_id, a.sample_offset, a.max_frames, first)
  wav.close()
  const dir = recordingDirectory(id, root)
  fs.writeFileSync(path.join(dir, "." + capture + ".mp4"), Buffer.alloc(256))
  assert.deepEqual(listMeetingRecordings(id, root).map(f => f.name), [capture + ".wav"])
  const server = createServer((req, res) => serveMeetingRecordings(req, res, new Map(new URL(req.url!, "http://localhost").searchParams), root))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => server.close())
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/?meeting=" + id
  const url = base + "&file=" + capture + ".wav"
  const file = Buffer.from(await (await fetch(url)).arrayBuffer())
  assert.equal(file.readUInt32LE(40), first.length + last.length)
  assert.deepEqual(file.subarray(44), Buffer.concat([first, last]))
  const seek = await fetch(url, { headers: { Range: "bytes=-2" } })
  assert.equal(seek.status, 206)
  assert.deepEqual(Buffer.from(await seek.arrayBuffer()), last)
  const download = await fetch(url + "&download=1", { method: "HEAD" })
  assert.match(download.headers.get("content-disposition")!, /attachment/)
  assert.equal(download.headers.get("content-type"), "audio/wav")
  assert.equal((await fetch(url, { headers: { Range: "bytes=99999-" } })).status, 416)
  assert.equal((await fetch(base + "&file=../meta.json")).status, 404)
  assert.equal((await fetch(base + "&file=." + capture + ".mp4")).status, 404)
  fs.renameSync(path.join(dir, "." + capture + ".mp4"), path.join(dir, capture + ".mp4"))
  assert.equal((await fetch(base + "&file=" + capture + ".mp4", { method: "HEAD" })).headers.get("content-type"), "video/mp4")
  assert.equal(deleteMeeting(id, root), true)
  assert.equal((await fetch(url)).status, 404)
})

test("video blocks belong to their capture and interrupted files retain the acknowledged prefix", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mini-video-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const { id } = createMeeting({ dataDir: root })
  const capture = randomUUID(), upload = new MeetingVideoUpload(root)
  const server = createServer((req, res) => {
    const params = new URL(req.url!, "http://localhost").searchParams
    void upload.handle(req, res, new Map(params), { meetingId: id, captureId: capture })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => server.close())
  const url = new URL("http://127.0.0.1:" + (server.address() as AddressInfo).port)
  async function post(action: string, offset = 0, body?: string, captureId = capture) {
    url.search = new URLSearchParams({ meeting: id, capture: captureId, action, offset: String(offset) }).toString()
    return (await fetch(url, { method: "POST", body })).status
  }
  assert.equal(await post("open", 0, undefined, randomUUID()), 409)
  assert.equal(await post("open"), 200)
  assert.equal(await post("append", 0, "first"), 200)
  assert.equal(await post("append", 0, "first"), 409)
  assert.equal(await post("finish", 9), 409)
  assert.deepEqual(listMeetingRecordings(id, root), [])
  upload.close()
  assert.equal(await post("append", 5, "late"), 409)
  const name = capture + ".partial.webm"
  assert.equal(listMeetingRecordings(id, root)[0].name, name)
  assert.equal(fs.readFileSync(path.join(recordingDirectory(id, root), name), "utf8"), "first")
})
