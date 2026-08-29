/**
 * Slice #241 Task 2–3 — overlay HTML voice.stt + meeting.create/start/end ACL.
 *
 * SUMMONER_ALLOW is not exported; gate via assertSummonerAllowed.
 * meeting-test-data-dir must load before meeting-handlers (DATA_DIR).
 */
import "./meeting-test-data-dir"
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

import { assertSummonerAllowed, applySummonerPayloadPolicy } from "../src/ws/summoner-acl"
import { SUMMONER_WEB_DISPATCH_ALLOW, SUMMONER_WEB_EVENT_ALLOW } from "../src/summoner-web"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"
import { deleteMeeting } from "../src/meeting/meeting-store"

const ROOT = path.resolve(__dirname, "..", "..")

function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

function extFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "..", "chrome-extension", ...parts),
    path.join(ROOT, "chrome-extension", ...parts),
    path.join(__dirname, "..", "..", "..", "chrome-extension", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

test("voice.stt.start is on HTML dispatch and ALLOW", () => {
  assert.equal(assertSummonerAllowed("summoner", "voice.stt.start").ok, true)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("voice.stt.start"), true)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("voice.stt.result"), true)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("ui.open_sidepanel"), false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("list_tabs"), false)
})

test("JSON_BODY_MAX stays 64KiB; STT chunk cap is ~400KiB", () => {
  const src = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(src, /JSON_BODY_MAX = 64 \* 1024/)
  assert.match(src, /STT_CHUNK_BODY_MAX = 400 \* 1024/)
})

test("dispatchSummonerWeb fire-and-forgets voice.stt.chunk and abort", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf("function dispatchSummonerWeb")
  assert.ok(start >= 0, "dispatchSummonerWeb missing")
  const next = src.indexOf("\nfunction ", start + 1)
  const fn = src.slice(start, next > start ? next : start + 2500)
  assert.match(fn, /voice\.stt\.chunk/)
  assert.match(fn, /voice\.stt\.abort/)
  assert.match(fn, /sendAppMessage\(type,\s*params\)/)
  assert.match(fn, /type:\s*["']ok["']/)
  assert.match(fn, /sendAppRequest\(type,\s*params/)
})

test("meeting.start/append/generate_minutes/list/get/diarize allowed on summoner; import is not", () => {
  assert.equal(assertSummonerAllowed("summoner", "meeting.start").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.end").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.create").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.append_transcript").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.generate_minutes").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.list").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.get").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.auto_diarize").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.import_text").ok, false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.start"), true)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.create"), true)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.end"), true)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.append_transcript"), true)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.generate_minutes"), true)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.list"), true)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.get"), true)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.auto_diarize"), true)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("meeting.started"), true)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("meeting.ended"), true)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("meeting.created"), true)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("meeting.error"), true)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("meeting.minutes_result"), true)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("meeting.list_result"), true)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("meeting.get_result"), true)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("meeting.diarized"), true)
})

test("tray origin + summoner surface allows meeting.start", async () => {
  const res = await handleMeetingMessage(
    { type: "meeting.start", v: 1, privacy_ack_v1: true, title: "overlay-acl" },
    { origin: "cmspark-tray://local", surface: "summoner" },
  )
  try {
    assert.notEqual(res.code, "origin_denied")
    assert.equal(res.type, "meeting.started")
  } finally {
    const id = res && res.meeting && res.meeting.id
    if (typeof id === "string") deleteMeeting(id)
  }
})

test("meeting.start ignores tray RPC id and creates a meeting", async () => {
  const res = await handleMeetingMessage(
    {
      type: "meeting.start",
      v: 1,
      id: "tray-12",
      privacy_ack_v1: true,
      title: "overlay-rpc",
    },
    { origin: "cmspark-tray://local", surface: "summoner" },
  )
  try {
    assert.equal(res.type, "meeting.started")
    assert.ok(typeof res.meeting?.id === "string" && res.meeting.id.indexOf("mtg_") === 0)
    assert.notEqual(res.meeting.id, "tray-12")
  } finally {
    const id = res && res.meeting && res.meeting.id
    if (typeof id === "string") deleteMeeting(id)
  }
})

test("meeting.start honors meeting_id over tray RPC id", async () => {
  const created = await handleMeetingMessage(
    { type: "meeting.create", v: 1, title: "keep-id" },
    { origin: "cmspark-tray://local", surface: "summoner" },
  )
  const meetingId = created.meeting.id as string
  try {
    const res = await handleMeetingMessage(
      {
        type: "meeting.start",
        v: 1,
        id: "tray-99",
        meeting_id: meetingId,
        privacy_ack_v1: true,
      },
      { origin: "cmspark-tray://local", surface: "summoner" },
    )
    assert.equal(res.type, "meeting.started")
    assert.equal(res.meeting.id, meetingId)
  } finally {
    deleteMeeting(meetingId)
  }
})

test("tray origin without surface is still origin_denied for meeting.start", async () => {
  const res = await handleMeetingMessage(
    { type: "meeting.start", v: 1, privacy_ack_v1: true },
    { origin: "cmspark-tray://local" },
  )
  assert.equal(res.code, "origin_denied")
})

test("generate_minutes + summoner surface is not origin_denied", async () => {
  const res = await handleMeetingMessage(
    { type: "meeting.generate_minutes", v: 1, text: "决定采用方案 A。" },
    { origin: "cmspark-tray://local", surface: "summoner" },
  )
  assert.notEqual(res.code, "origin_denied")
})

test("meeting.list + auto_diarize allowed on tray summoner origin", async () => {
  const listed = await handleMeetingMessage(
    { type: "meeting.list", v: 1 },
    { origin: "cmspark-tray://local", surface: "summoner" },
  )
  assert.equal(listed.type, "meeting.list_result")
  const denied = await handleMeetingMessage(
    { type: "meeting.auto_diarize", v: 1, privacy_ack_v1: true, id: "mtg_nope", mode: "text_gap" },
    { origin: "cmspark-tray://local" },
  )
  assert.equal(denied.code, "origin_denied")
})

test("meeting.start without privacy_ack_v1 is need_privacy_ack", async () => {
  const res = await handleMeetingMessage(
    { type: "meeting.start", v: 1, title: "no ack" },
    { origin: "cmspark-tray://local", surface: "summoner" },
  )
  assert.equal(res.code, "need_privacy_ack")
})

test("message-router passes session surface into meeting handler", () => {
  const src = fs.readFileSync(srcFile("message-router.ts"), "utf8")
  const start = src.indexOf('case "meeting.create"')
  assert.ok(start >= 0, "meeting.create case missing")
  const next = src.indexOf("case \"skill.activate\"", start)
  const slice = src.slice(start, next > start ? next : start + 1800)
  assert.match(slice, /surface:\s*session\?\.surface/)
})

test("tray sendRequest keeps RPC id off meeting domain id", () => {
  const src = fs.readFileSync(srcFile("tray", "companion-client.ts"), "utf8")
  assert.match(src, /const rpcId = `tray-\$\{/)
  assert.match(src, /msg\.meeting_id = params\.id/)
  assert.match(src, /msg\.id = rpcId/)
})

test("applySummonerPayloadPolicy overlay meeting.start forces audio_retained false", () => {
  const msg: Record<string, unknown> = {
    type: "meeting.start",
    audio_retained: true,
    retain_days: 7,
  }
  const r = applySummonerPayloadPolicy("summoner", msg)
  assert.equal(r.ok, true)
  assert.equal(msg.audio_retained, false)
  assert.equal("retain_days" in msg, false)
})

test("VOICE_PRIVACY_ACK_V2_CLAUSES lockstep with chrome-extension", () => {
  const companion = fs.readFileSync(srcFile("summoner", "client.ts"), "utf8")
  const ext = fs.readFileSync(extFile("src", "sidepanel", "voice", "privacy-copy.ts"), "utf8")

  function clauses(src: string, label: string): string[] {
    const start = src.indexOf("export const VOICE_PRIVACY_ACK_V2_CLAUSES")
    assert.ok(start >= 0, `${label} missing VOICE_PRIVACY_ACK_V2_CLAUSES`)
    const assign = src.indexOf("=", start)
    const lb = src.indexOf("[", assign)
    const rb = src.indexOf("]", lb)
    assert.ok(lb >= 0 && rb > lb, `${label} clauses array not found`)
    const block = src.slice(lb, rb + 1)
    return [...block.matchAll(/"([^"]*)"/g)].map((m) => m[1]!)
  }

  const a = clauses(companion, "companion/src/summoner/client.ts")
  const b = clauses(ext, "chrome-extension privacy-copy.ts")
  assert.equal(a.length, 6)
  assert.deepEqual(a, b)
})
