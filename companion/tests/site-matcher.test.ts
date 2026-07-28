import test from "node:test"
import assert from "node:assert/strict"

import { matchSite, normalizeHostname } from "../src/skills/site-matcher"

test("normalizeHostname lowercases and strips trailing dots", () => {
  assert.equal(normalizeHostname("GitHub.com"), "github.com")
  assert.equal(normalizeHostname("example.com."), "example.com")
  assert.equal(normalizeHostname("  "), undefined)
  assert.equal(normalizeHostname(null), undefined)
})

test("exact match: same hostname matches", () => {
  assert.equal(matchSite("github.com", "github.com"), true)
  assert.equal(matchSite("example.com", "example.com"), true)
})

test("case-insensitive: Example.com matches site pattern example.com", () => {
  // Dual-review L1 / N1 — URL bar casing must not break site_knowledge auto-load
  assert.equal(matchSite("example.com", "Example.com"), true)
  assert.equal(matchSite("*.GitHub.com", "API.github.com"), true)
})

test("exact match: different hostname does not match", () => {
  assert.equal(matchSite("github.com", "gitlab.com"), false)
  assert.equal(matchSite("github.com", "api.github.com"), false)
})

test("wildcard match: *.github.com matches api.github.com", () => {
  assert.equal(matchSite("*.github.com", "api.github.com"), true)
  assert.equal(matchSite("*.github.com", "www.github.com"), true)
})

test("wildcard match: *.github.com matches github.com (apex, consistent with matchDomain/ADR-007)", () => {
  assert.equal(matchSite("*.github.com", "github.com"), true)
})

test("wildcard match: *.github.com does NOT match suffix-collision (evilgithub.com)", () => {
  // Domain-boundary fix: bare endsWith(suffix) would wrongly match evilgithub.com.
  assert.equal(matchSite("*.github.com", "evilgithub.com"), false)
})

test("wildcard match: *.github.com does not match unrelated domain", () => {
  assert.equal(matchSite("*.github.com", "github.io"), false)
  assert.equal(matchSite("*.github.com", "api.gitlab.com"), false)
})

test("wildcard match: *.company.com matches subdomains", () => {
  assert.equal(matchSite("*.company.com", "jira.company.com"), true)
  assert.equal(matchSite("*.company.com", "wiki.company.com"), true)
})

test("empty or invalid patterns return false", () => {
  assert.equal(matchSite("", "github.com"), false)
  assert.equal(matchSite("*", "github.com"), false)
})
