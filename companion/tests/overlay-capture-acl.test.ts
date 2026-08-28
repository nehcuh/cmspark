/**
 * Slice #241 Task 2 — overlay HTML voice.stt ACL + v2 privacy copy lockstep.
 *
 * SUMMONER_ALLOW is not exported; gate via assertSummonerAllowed.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

import { assertSummonerAllowed } from "../src/ws/summoner-acl"
import { SUMMONER_WEB_DISPATCH_ALLOW, SUMMONER_WEB_EVENT_ALLOW } from "../src/summoner-web"

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
