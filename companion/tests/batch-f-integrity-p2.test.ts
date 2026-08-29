/**
 * Batch F (#253): HMAC unknown throw · tab.navigated Origin · netsec /0 · MCP strip.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { SecurityPolicy } from "../src/security-policy"
import { isChromeExtensionWsOrigin } from "../src/ws/handshake-surface"
import { isValidNetsecAllowlistEntry } from "../src/capability/modules"
import { isTargetAllowed } from "../src/netsec/scope"
import { stripCmsparkInternalMcpArgs } from "../src/mcp/dispatch"

function firstExisting(candidates: string[]): string {
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[candidates.length - 1]
}

function srcFile(...parts: string[]): string {
  return firstExisting([
    path.join(__dirname, "..", "src", ...parts),
    path.join(__dirname, "..", "..", "src", ...parts),
  ])
}

function repoFile(...parts: string[]): string {
  return firstExisting([
    path.resolve(__dirname, "..", "..", ...parts),
    path.resolve(__dirname, "..", "..", "..", ...parts),
  ])
}

test("F1: unknown L2 name throws from bindingPayloadFor", () => {
  assert.throws(
    () => SecurityPolicy.bindingPayloadFor("brand_new_l2", {}),
    /brand_new_l2/,
  )
  const policy = new SecurityPolicy()
  assert.throws(() => policy.issueTokenFor("brand_new_l2", {}), /brand_new_l2/)
})

test("F1: evaluate still binds code", () => {
  assert.equal(SecurityPolicy.bindingPayloadFor("evaluate", { code: "1+1" }), "1+1")
})

test("F2: only chrome-extension Origin applies tab.navigated", () => {
  assert.equal(isChromeExtensionWsOrigin("chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef"), true)
  assert.equal(isChromeExtensionWsOrigin("cmspark-tray://local"), false)
  const life = fs.readFileSync(srcFile("ws", "lifecycle.ts"), "utf8")
  const fn = life.slice(life.indexOf('if (msg.type === "tab.navigated")'), life.indexOf("let response: any"))
  assert.match(fn, /isChromeExtensionWsOrigin/)
  assert.match(fn, /applyTabNavigated/)
})

test("F3: SW knowledge mutators do not invent user_gesture true", () => {
  const src = fs.readFileSync(
    repoFile("chrome-extension", "src", "background", "index.ts"),
    "utf8",
  )
  const update = src.slice(src.indexOf('case "knowledge.update"'), src.indexOf('case "knowledge.export"'))
  const exp = src.slice(src.indexOf('case "knowledge.export"'), src.indexOf('case "knowledge.delete"'))
  const del = src.slice(src.indexOf('case "knowledge.delete"'), src.indexOf('case "thread.distill_preview"'))
  for (const chunk of [update, exp, del]) {
    assert.match(chunk, /user_gesture:\s*message\.user_gesture\s*===\s*true/)
    assert.doesNotMatch(chunk, /user_gesture:\s*true/)
  }
})

test("F4: 0.0.0.0/0 rejected; /8 still allowed", () => {
  assert.equal(isValidNetsecAllowlistEntry("0.0.0.0/0"), false)
  assert.equal(isValidNetsecAllowlistEntry("10.0.0.0/8"), true)
  assert.equal(isTargetAllowed("1.2.3.4", ["0.0.0.0/0"]), false)
  assert.equal(isTargetAllowed("10.1.2.3", ["10.0.0.0/8"]), true)
})

test("F5: strip internal keys, keep MCP __meta, actingTid source intact", () => {
  const original = { __thread_id: "t1", _thread_id: "t2", __cmspark_surface: "tray", q: 1, __meta: { a: 1 } }
  const stripped = stripCmsparkInternalMcpArgs(original)
  assert.equal(stripped.__thread_id, undefined)
  assert.equal(stripped._thread_id, undefined)
  assert.equal(stripped.__cmspark_surface, undefined)
  assert.equal(stripped.q, 1)
  assert.deepEqual(stripped.__meta, { a: 1 })
  assert.equal(original.__thread_id, "t1")
})
