import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  L2_CONDUCTOR_ELSEWHERE,
  gateChatCreateOnConductor,
} from "../src/ws/l2-conductor"

test("overlay chat.create is denied while a computer task is live", () => {
  const live = new Map<string, boolean>([["task-1", false]])
  const err = gateChatCreateOnConductor("thr", "summoner", live)
  assert.equal(err?.type, "chat.error")
  assert.equal(err?.thread_id, "thr")
  assert.equal(err?.data.error_code, L2_CONDUCTOR_ELSEWHERE)
  assert.equal(/timeout|disconnected|not found/i.test(err?.error || ""), false)
  assert.match(err?.error || "", /L2_CONDUCTOR_ELSEWHERE/)
})

test("panel chat.create is allowed while LIVE (HUD/Cockpit is conductor)", () => {
  const live = new Map<string, boolean>([["task-1", false]])
  assert.equal(gateChatCreateOnConductor("thr", "tray", live), null)
  assert.equal(gateChatCreateOnConductor("thr", undefined, live), null)
})

test("summoner chat.create is allowed when no computer task is live", () => {
  assert.equal(gateChatCreateOnConductor("thr", "summoner", new Map()), null)
})

test("message-router chat.create applies conductor gate", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "src", "message-router.ts"),
    "utf8",
  )
  assert.match(src, /gateChatCreateOnConductor/)
})
