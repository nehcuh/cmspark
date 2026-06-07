// Risk Engine unit tests

import test from "node:test"
import assert from "node:assert/strict"

import {
  calculateRiskScore,
  getRiskDecision,
  riskScoreCache,
  API_WEIGHTS,
  detectDangerousApis,
} from "../../src/security/risk-engine"

import * as config from "../../src/config"

const originalGetConfig = config.getConfig

function mockConfig(trustedDomains: string[]) {
  (config as any).getConfig = () => ({
    trusted_domains: trustedDomains,
    llm: {},
    port: 23401,
    history_retention_days: 30,
  })
}

function restoreConfig() {
  (config as any).getConfig = originalGetConfig
}

test.beforeEach(() => {
  riskScoreCache.clear()
})

test.afterEach(() => {
  restoreConfig()
})

// ---------------------------------------------------------------------------
// calculateRiskScore
// ---------------------------------------------------------------------------

test("calculateRiskScore: eval should score as high api risk (4)", () => {
  mockConfig([])
  const score = calculateRiskScore("evaluate", 'eval("alert(1)")', {})
  assert.ok(score.total >= 4, `expected total >= 4, got ${score.total}`)
  assert.ok(score.matchedPatterns.includes("eval"))
  assert.equal(score.breakdown.apiRisk, 4)
})

test("calculateRiskScore: new Function should score as high api risk (4)", () => {
  mockConfig([])
  const score = calculateRiskScore("evaluate", 'new Function("return 1")', {})
  assert.ok(score.total >= 4, `expected total >= 4, got ${score.total}`)
  assert.ok(score.matchedPatterns.includes("Function"))
})

test("calculateRiskScore: setTimeout with string should score as high api risk (4)", () => {
  mockConfig([])
  const score = calculateRiskScore("evaluate", 'setTimeout("alert(1)", 1000)', {})
  assert.ok(score.total >= 4, `expected total >= 4, got ${score.total}`)
  assert.ok(score.matchedPatterns.includes("setTimeout(string)"))
})

test("calculateRiskScore: fetch on trusted domain should score lower", () => {
  mockConfig(["*.example.com"])
  const score = calculateRiskScore("evaluate", 'fetch("https://api.example.com")', {})
  assert.ok(score.total < 5, `expected total < 5, got ${score.total}`)
})

test("calculateRiskScore: fetch on untrusted domain should score medium-high", () => {
  mockConfig(["*.example.com"])
  const score = calculateRiskScore("evaluate", 'fetch("https://evil.com")', {})
  assert.ok(score.total >= 3, `expected total >= 3, got ${score.total}`)
  assert.ok(score.matchedPatterns.includes("fetch"))
})

test("calculateRiskScore: screenshot (benign) should score low risk (0-2)", () => {
  mockConfig([])
  const score = calculateRiskScore("screenshot", "", {})
  assert.ok(score.total <= 2, `expected total <= 2, got ${score.total}`)
  assert.equal(score.breakdown.apiRisk, 0)
})

test("calculateRiskScore: get_page_text (benign) should score low risk (0-2)", () => {
  mockConfig([])
  const score = calculateRiskScore("get_page_text", "", {})
  assert.ok(score.total <= 2, `expected total <= 2, got ${score.total}`)
})

test("calculateRiskScore: document.cookie should score medium (3-5)", () => {
  mockConfig([])
  const score = calculateRiskScore("evaluate", "document.cookie", {})
  assert.ok(score.total >= 3 && score.total <= 5,
    `expected total 3-5, got ${score.total}`)
  assert.ok(score.matchedPatterns.includes("document.cookie"))
})

test("calculateRiskScore: bracket bypass fetch should score medium-high (3-5)", () => {
  mockConfig([])
  const score = calculateRiskScore("evaluate", 'window["fetch"]("/api")', {})
  assert.ok(score.total >= 3, `expected total >= 3, got ${score.total}`)
  assert.ok(score.matchedPatterns.includes("bracket-fetch"))
})

test("calculateRiskScore: Reflect.apply with fetch should score medium-high", () => {
  mockConfig([])
  const score = calculateRiskScore("evaluate", "Reflect.apply(fetch, null, ['/api'])", {})
  assert.ok(score.total >= 3, `expected total >= 3, got ${score.total}`)
  assert.ok(score.matchedPatterns.includes("Reflect.apply"))
})

test("calculateRiskScore: Proxy wrapping dangerous API should score medium-high", () => {
  mockConfig([])
  const score = calculateRiskScore("evaluate", "new Proxy(window, { get: () => fetch })", {})
  assert.ok(score.total >= 3, `expected total >= 3, got ${score.total}`)
  assert.ok(score.matchedPatterns.includes("Proxy"))
})

test("calculateRiskScore: code complexity increases score for long obfuscated code", () => {
  mockConfig([])
  // Code over 1000 chars and 20+ lines triggers complexity
  const obfuscated = Array(25).fill("eval(atob('YWxlcnQoMSk='));fetch('https://x.com');").join("\n")
  const score = calculateRiskScore("evaluate", obfuscated, {})
  assert.ok(score.breakdown.codeComplexity > 0,
    `expected codeComplexity > 0, got ${score.breakdown.codeComplexity}`)
  assert.ok(score.total >= score.breakdown.apiRisk)
})

test("calculateRiskScore: simple code has zero complexity penalty", () => {
  mockConfig([])
  const score = calculateRiskScore("evaluate", "fetch('/api')", {})
  assert.equal(score.breakdown.codeComplexity, 0)
})

test("calculateRiskScore: history pattern increases score for repeated risky operations", () => {
  mockConfig([])
  const score = calculateRiskScore("evaluate", "fetch('/api')", {
    history: [
      { toolName: "evaluate", code: "fetch('/api')", error: "Security Block" },
      { toolName: "evaluate", code: "fetch('/api')", error: "Security Block" },
      { toolName: "evaluate", code: "fetch('/api')", error: "Security Block" },
    ],
  })
  assert.ok(score.breakdown.historyPattern > 0,
    `expected historyPattern > 0, got ${score.breakdown.historyPattern}`)
})

test("calculateRiskScore: no history means zero history penalty", () => {
  mockConfig([])
  const score = calculateRiskScore("evaluate", "fetch('/api')", { history: [] })
  assert.equal(score.breakdown.historyPattern, 0)
})

test("calculateRiskScore: total is capped at 10", () => {
  mockConfig([])
  const score = calculateRiskScore("evaluate",
    'eval("alert(1)");fetch("https://evil.com");document.cookie;new Proxy({},{});Reflect.apply(eval,null,[]);',
    {})
  assert.ok(score.total <= 10, `expected total <= 10, got ${score.total}`)
})

test("calculateRiskScore: total is non-negative", () => {
  mockConfig([])
  const score = calculateRiskScore("screenshot", "", {})
  assert.ok(score.total >= 0, `expected total >= 0, got ${score.total}`)
})

test("calculateRiskScore: returns matchedPatterns array", () => {
  mockConfig([])
  const score = calculateRiskScore("evaluate", "fetch('/api'); localStorage.getItem('k')", {})
  assert.ok(Array.isArray(score.matchedPatterns))
  assert.ok(score.matchedPatterns.length >= 2)
})

test("calculateRiskScore: returns reason string", () => {
  mockConfig([])
  const score = calculateRiskScore("evaluate", "fetch('/api')", {})
  assert.ok(typeof score.reason === "string")
  assert.ok(score.reason.length > 0)
})

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

test("calculateRiskScore: same code returns cached result", () => {
  mockConfig([])
  riskScoreCache.clear()
  const code = "fetch('/api')"
  const score1 = calculateRiskScore("evaluate", code, {})
  const score2 = calculateRiskScore("evaluate", code, {})
  assert.equal(score1.total, score2.total)
  assert.deepEqual(score1.matchedPatterns, score2.matchedPatterns)
})

test("calculateRiskScore: different code produces different scores", () => {
  mockConfig([])
  riskScoreCache.clear()
  const score1 = calculateRiskScore("evaluate", "fetch('/api')", {})
  const score2 = calculateRiskScore("evaluate", "document.cookie", {})
  assert.notEqual(score1.total, score2.total)
})

// ---------------------------------------------------------------------------
// getRiskDecision
// ---------------------------------------------------------------------------

test("getRiskDecision: score 0 auto-executes in readonly mode", () => {
  const decision = getRiskDecision({ total: 0, breakdown: { apiRisk: 0, codeComplexity: 0, domainTrust: 0, historyPattern: 0 }, matchedPatterns: [], reason: "" }, "readonly", {})
  assert.equal(decision.action, "auto")
})

test("getRiskDecision: score > 0 blocks in readonly mode", () => {
  const decision = getRiskDecision({ total: 1, breakdown: { apiRisk: 1, codeComplexity: 0, domainTrust: 0, historyPattern: 0 }, matchedPatterns: ["fetch"], reason: "" }, "readonly", {})
  assert.equal(decision.action, "block")
})

test("getRiskDecision: score 0-2 auto-executes in standard mode", () => {
  const decision = getRiskDecision({ total: 2, breakdown: { apiRisk: 2, codeComplexity: 0, domainTrust: 0, historyPattern: 0 }, matchedPatterns: [], reason: "" }, "standard", {})
  assert.equal(decision.action, "auto")
})

test("getRiskDecision: score 0 auto-executes in advanced mode", () => {
  const decision = getRiskDecision({ total: 0, breakdown: { apiRisk: 0, codeComplexity: 0, domainTrust: 0, historyPattern: 0 }, matchedPatterns: [], reason: "" }, "advanced", {})
  assert.equal(decision.action, "auto")
})

test("getRiskDecision: score 3-7 requires confirm in standard mode", () => {
  const decision = getRiskDecision({ total: 5, breakdown: { apiRisk: 3, codeComplexity: 1, domainTrust: 1, historyPattern: 0 }, matchedPatterns: [], reason: "" }, "standard", {})
  assert.equal(decision.action, "confirm")
})

test("getRiskDecision: score 3 auto-executes in advanced mode", () => {
  const decision = getRiskDecision({ total: 3, breakdown: { apiRisk: 3, codeComplexity: 0, domainTrust: 0, historyPattern: 0 }, matchedPatterns: [], reason: "" }, "advanced", {})
  assert.equal(decision.action, "auto")
})

test("getRiskDecision: score 8+ blocks in standard mode", () => {
  const decision = getRiskDecision({ total: 8, breakdown: { apiRisk: 4, codeComplexity: 2, domainTrust: 2, historyPattern: 0 }, matchedPatterns: [], reason: "" }, "standard", {})
  assert.equal(decision.action, "block")
})

test("getRiskDecision: score 9+ blocks in advanced mode", () => {
  const decision = getRiskDecision({ total: 9, breakdown: { apiRisk: 4, codeComplexity: 2, domainTrust: 2, historyPattern: 1 }, matchedPatterns: [], reason: "" }, "advanced", {})
  assert.equal(decision.action, "block")
})

test("getRiskDecision: score 4-8 requires confirm in advanced mode", () => {
  const decision = getRiskDecision({ total: 6, breakdown: { apiRisk: 3, codeComplexity: 1, domainTrust: 1, historyPattern: 1 }, matchedPatterns: [], reason: "" }, "advanced", {})
  assert.equal(decision.action, "confirm")
})

// ---------------------------------------------------------------------------
// API_WEIGHTS
// ---------------------------------------------------------------------------

test("API_WEIGHTS contains expected keys", () => {
  assert.equal(API_WEIGHTS["eval"], 4)
  assert.equal(API_WEIGHTS["fetch"], 3)
  assert.equal(API_WEIGHTS["document.cookie"], 2)
})

// ---------------------------------------------------------------------------
// detectDangerousApis
// ---------------------------------------------------------------------------

test("detectDangerousApis detects fetch", () => {
  const apis = detectDangerousApis("fetch('/api')")
  assert.ok(apis.includes("fetch"))
})

test("detectDangerousApis does not false-positive on prefetch", () => {
  const apis = detectDangerousApis("prefetch('/api')")
  assert.ok(!apis.includes("fetch"))
})

test("detectDangerousApis detects eval", () => {
  const apis = detectDangerousApis('eval("alert(1)")')
  assert.ok(apis.includes("eval"))
})

test("detectDangerousApis returns empty for safe code", () => {
  const apis = detectDangerousApis("document.body?.innerText || ''")
  assert.equal(apis.length, 0)
})
