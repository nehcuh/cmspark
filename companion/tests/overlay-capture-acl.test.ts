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
