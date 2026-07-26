// Grill G1–G3: trust key, explicit opt-in, maxActions.

import test from "node:test"
import assert from "node:assert/strict"
import {
  ComputerSessionTrust,
  resolveComputerTrustKey,
  trustKeyAllowsInitialSkip,
} from "../src/computer/session-trust"

test("resolveComputerTrustKey prefers thread", () => {
  assert.equal(resolveComputerTrustKey("3ffkgl", "ws-uuid"), "thread:3ffkgl")
  assert.equal(resolveComputerTrustKey("", "ws-uuid"), "ws:ws-uuid")
  assert.equal(resolveComputerTrustKey(null, "ws-uuid"), "ws:ws-uuid")
})

test("trustKeyAllowsInitialSkip only for thread keys", () => {
  assert.equal(trustKeyAllowsInitialSkip("thread:abc"), true)
  assert.equal(trustKeyAllowsInitialSkip("ws:abc"), false)
})

test("grant without explicitOptIn does not hasExplicitOptIn", () => {
  const t = new ComputerSessionTrust()
  const key = resolveComputerTrustKey("t1", "ws1")
  t.grant(key, "mac.app.wechat")
  t.recordBudget(key, "mac.app.wechat", 15)
  t.recordActions(key, "mac.app.wechat", 5)
  t.extendCorpus(key, "mac.app.wechat", ["hello"])
  assert.equal(t.isTrusted(key, "mac.app.wechat"), true)
  assert.equal(t.hasExplicitOptIn(key, "mac.app.wechat"), false)
})

test("grant with explicitOptIn enables hasExplicitOptIn", () => {
  const t = new ComputerSessionTrust()
  const key = resolveComputerTrustKey("t1", "ws1")
  t.grant(key, "mac.app.wechat", { explicitOptIn: true })
  t.recordBudget(key, "mac.app.wechat", 15)
  t.recordActions(key, "mac.app.wechat", 3)
  t.extendCorpus(key, "mac.app.wechat", ["hello"])
  assert.equal(t.hasExplicitOptIn(key, "mac.app.wechat"), true)
  assert.equal(t.corpusContains(key, "mac.app.wechat", ["hello"]), true)
  assert.equal(t.maxActionsSeen(key, "mac.app.wechat"), 3)
  assert.equal(t.corpusContains(key, "mac.app.wechat", ["hello world"]), false)
})

test("explicitOptIn is sticky OR across grants", () => {
  const t = new ComputerSessionTrust()
  const key = resolveComputerTrustKey("t1", "ws1")
  t.grant(key, "mac.app.notes")
  assert.equal(t.hasExplicitOptIn(key, "mac.app.notes"), false)
  t.grant(key, "mac.app.notes", { explicitOptIn: true })
  assert.equal(t.hasExplicitOptIn(key, "mac.app.notes"), true)
  t.grant(key, "mac.app.notes") // second approve without box still sticky
  assert.equal(t.hasExplicitOptIn(key, "mac.app.notes"), true)
})

/** Pure G1 skip composition (mirrors server.ts gate). */
function g1InitialSkipEligible(args: {
  trust: ComputerSessionTrust
  trustKey: string
  app: string
  typeCorpus: string[]
  budget: number
  actionCount: number
  experimental: boolean
}): boolean {
  const { trust, trustKey, app, typeCorpus, budget, actionCount, experimental } = args
  if (experimental) return false
  if (!trustKeyAllowsInitialSkip(trustKey)) return false
  if (!trust.hasExplicitOptIn(trustKey, app)) return false
  if (!trust.isTrusted(trustKey, app)) return false
  if (!trust.corpusContains(trustKey, app, typeCorpus)) return false
  const maxBudget = trust.maxBudgetSeen(trustKey, app)
  if (!(maxBudget > 0 && budget <= maxBudget)) return false
  const maxActions = trust.maxActionsSeen(trustKey, app)
  if (!(maxActions > 0 && actionCount <= maxActions)) return false
  return true
}

test("G1 skip: no explicitOptIn → no skip", () => {
  const t = new ComputerSessionTrust()
  const key = resolveComputerTrustKey("th", "ws")
  t.grant(key, "mac.app.wechat")
  t.recordBudget(key, "mac.app.wechat", 15)
  t.recordActions(key, "mac.app.wechat", 5)
  t.extendCorpus(key, "mac.app.wechat", ["hello"])
  assert.equal(
    g1InitialSkipEligible({
      trust: t, trustKey: key, app: "mac.app.wechat",
      typeCorpus: ["hello"], budget: 10, actionCount: 3, experimental: false,
    }),
    false,
  )
})

test("G1 skip: ws key never skips even with opt-in", () => {
  const t = new ComputerSessionTrust()
  const key = resolveComputerTrustKey("", "ws-only")
  t.grant(key, "mac.app.wechat", { explicitOptIn: true })
  t.recordBudget(key, "mac.app.wechat", 15)
  t.recordActions(key, "mac.app.wechat", 5)
  t.extendCorpus(key, "mac.app.wechat", ["hello"])
  assert.equal(trustKeyAllowsInitialSkip(key), false)
  assert.equal(
    g1InitialSkipEligible({
      trust: t, trustKey: key, app: "mac.app.wechat",
      typeCorpus: ["hello"], budget: 10, actionCount: 3, experimental: false,
    }),
    false,
  )
})

test("G1 skip: full gates pass", () => {
  const t = new ComputerSessionTrust()
  const key = resolveComputerTrustKey("3ffkgl", "ws")
  t.grant(key, "mac.app.wechat", { explicitOptIn: true })
  t.recordBudget(key, "mac.app.wechat", 15)
  t.recordActions(key, "mac.app.wechat", 5)
  t.extendCorpus(key, "mac.app.wechat", ["hello"])
  assert.equal(
    g1InitialSkipEligible({
      trust: t, trustKey: key, app: "mac.app.wechat",
      typeCorpus: ["hello"], budget: 10, actionCount: 3, experimental: false,
    }),
    true,
  )
  assert.equal(
    g1InitialSkipEligible({
      trust: t, trustKey: key, app: "mac.app.wechat",
      typeCorpus: ["hello", "new"], budget: 10, actionCount: 3, experimental: false,
    }),
    false,
  )
})
