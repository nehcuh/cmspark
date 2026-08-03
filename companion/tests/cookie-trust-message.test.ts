// Cookie trust-domain block copy (user-facing path vs autopilot)

import test from "node:test"
import assert from "node:assert/strict"
import { cookieTrustBlockedMessage, cookieTrustBlockedPayload } from "../src/security"

test("cookieTrustBlockedMessage: Chinese path + distinguishes autopilot", () => {
  const m = cookieTrustBlockedMessage("demo.yunchuangshuan.com", "get_cookies")
  assert.match(m, /^Security Block:/)
  assert.match(m, /Cookie 信任域/)
  assert.match(m, /全自动巡航/)
  assert.match(m, /设置/)
  assert.match(m, /管理信任域/)
  assert.match(m, /demo\.yunchuangshuan\.com/)
  assert.match(m, /get_cookies|Cookie/)
})

test("cookieTrustBlockedPayload: structured hint for tool card", () => {
  const p = cookieTrustBlockedPayload("example.com", "get_cookies")
  assert.equal(p.success, false)
  assert.equal(p.data.error_code, "COOKIE_TRUST_DENIED")
  assert.equal(p.data.target_domain, "example.com")
  assert.match(p.data.user_hint_zh, /Cookie 信任域|信任名单/)
  assert.match(p.data.user_hint_zh, /全自动巡航/)
  assert.match(p.error, /Security Block/)
})

test("cookieTrustBlockedMessage: list_all_cookies global wording", () => {
  const m = cookieTrustBlockedMessage("Global / All Domains", "list_all_cookies")
  assert.match(m, /list_all_cookies|\*/)
})
