/**
 * Overlay B0.5 — Companion-owned thread rename + trash.
 * No Chrome Side Panel; overlay cannot hard-delete or mutate trust keys.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { assertSummonerAllowed, applySummonerPayloadPolicy } from "../src/ws/summoner-acl"
import {
  encodeSummonerThreadRename,
  encodeSummonerThreadTrash,
  decodeSummonerInbound,
} from "../src/summoner/protocol"
import { SUMMONER_WEB_DISPATCH_ALLOW } from "../src/summoner-web"

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

test("summoner ACL allows overlay-safe thread.delete and thread.update", () => {
  assert.equal(assertSummonerAllowed("summoner", "thread.delete").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "thread.update").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "thread.restore").ok, false)
  assert.equal(assertSummonerAllowed("summoner", "thread.batch_delete").ok, false)
  assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("thread.delete"))
  assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("thread.update"))
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("thread.restore"), false)
})

test("overlay thread.delete must be trash; hard and omitted are ACL-denied", () => {
  const trash = applySummonerPayloadPolicy("summoner", {
    type: "thread.delete",
    thread_id: "t1",
    mode: "trash",
  })
  assert.equal(trash.ok, true)

  const hard = applySummonerPayloadPolicy("summoner", {
    type: "thread.delete",
    thread_id: "t1",
    mode: "hard",
  })
  assert.equal(hard.ok, false)
  if (!hard.ok) assert.equal(hard.error_code, "SUMMONER_ACL")

  const omitted = applySummonerPayloadPolicy("summoner", {
    type: "thread.delete",
    thread_id: "t1",
  })
  assert.equal(omitted.ok, false)
  if (!omitted.ok) assert.equal(omitted.error_code, "SUMMONER_ACL")

  const trayHard = applySummonerPayloadPolicy("tray", {
    type: "thread.delete",
    thread_id: "t1",
  })
  assert.equal(trayHard.ok, true)
})

test("overlay thread.update keeps only alias and rejects empty / dangerous keys-only", () => {
  const msg: Record<string, unknown> = {
    type: "thread.update",
    thread_id: "t1",
    updates: { alias: "  发票  ", tool_whitelist: null, active_knowledge_ids: ["k1"] },
  }
  const ok = applySummonerPayloadPolicy("summoner", msg)
  assert.equal(ok.ok, true)
  assert.deepEqual(msg.updates, { alias: "发票" })

  const empty = applySummonerPayloadPolicy("summoner", {
    type: "thread.update",
    thread_id: "t1",
    updates: { alias: "   " },
  })
  assert.equal(empty.ok, false)

  const onlyWl = applySummonerPayloadPolicy("summoner", {
    type: "thread.update",
    thread_id: "t1",
    updates: { tool_whitelist: null },
  })
  assert.equal(onlyWl.ok, false)

  const tray = applySummonerPayloadPolicy("tray", {
    type: "thread.update",
    thread_id: "t1",
    updates: { tool_whitelist: null },
  })
  assert.equal(tray.ok, true)
})

test("summoner.thread.rename / trash round-trip; empty alias is invalid", () => {
  const rename = encodeSummonerThreadRename({ thread_id: "t1", alias: "周报" })
  assert.equal(rename.type, "summoner.thread.rename")
  assert.deepEqual(decodeSummonerInbound(rename), rename)
  assert.equal(decodeSummonerInbound({ type: "summoner.thread.rename", thread_id: "t1", alias: "" }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.thread.rename", thread_id: "", alias: "x" }), null)

  const trash = encodeSummonerThreadTrash({ thread_id: "t1" })
  assert.equal(trash.type, "summoner.thread.trash")
  assert.deepEqual(decodeSummonerInbound(trash), trash)
  assert.equal(decodeSummonerInbound({ type: "summoner.thread.trash" }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.thread.delete", thread_id: "t1" }), null)
})

test("lifecycle applies overlay payload policy after method ACL", () => {
  const life = fs.readFileSync(srcFile("ws", "lifecycle.ts"), "utf8")
  assert.match(life, /applySummonerPayloadPolicy/)
})

test("menu-bar maps rename/trash to overlay-safe thread.update/delete and refreshes rail", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /summoner\.thread\.rename/)
  assert.match(src, /summoner\.thread\.trash/)
  assert.match(src, /handleSummonerThreadRename/)
  assert.match(src, /handleSummonerThreadTrash/)
  const inbound = src.slice(src.indexOf("export function handleSummonerInbound"), src.indexOf("export function handleSummonerInbound") + 3600)
  assert.match(inbound, /handleSummonerThreadRename/)
  assert.match(inbound, /handleSummonerThreadTrash/)
  const rename = src.slice(src.indexOf("handleSummonerThreadRename"), src.indexOf("handleSummonerThreadRename") + 1800)
  assert.match(rename, /thread\.update/)
  assert.match(rename, /alias/)
  assert.doesNotMatch(rename, /tool_whitelist/)
  assert.match(rename, /pushSummonerRail/)
  const trash = src.slice(src.indexOf("handleSummonerThreadTrash"), src.indexOf("handleSummonerThreadTrash") + 2200)
  assert.match(trash, /thread\.delete/)
  assert.match(trash, /mode:\s*"trash"/)
  assert.doesNotMatch(trash, /mode:\s*"hard"/)
  assert.match(trash, /pushSummonerRail/)
})

test("HUD thread rows expose rename + trash without overlay Allow/Deny", () => {
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  assert.match(overlay, /summoner\.thread\.rename/)
  assert.match(overlay, /summoner\.thread\.trash/)
  assert.match(overlay, /重命名/)
  assert.match(overlay, /移到回收站/)
  assert.match(overlay, /NSAlert/)
  assert.doesNotMatch(overlay, /允许|拒绝|Allow|Deny|确认/)
  assert.doesNotMatch(overlay, /mode:\s*"hard"/)
})

test("C-thin HTML can rename and trash without Chrome", () => {
  const web = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(web, /PATCH/)
  assert.match(web, /DELETE/)
  assert.match(web, /thread\.update/)
  assert.match(web, /thread\.delete/)
  assert.match(web, /mode:\s*"trash"/)
  assert.match(web, /重命名/)
  assert.match(web, /移到回收站/)
  assert.doesNotMatch(web, /mode:\s*"hard"/)
})
