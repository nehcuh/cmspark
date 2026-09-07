import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { siteTargetFromBrowser, siteTargetKey } from "../src/site-context/target"

const now = Date.parse("2026-09-07T03:00:00Z")

test("browser context removes credentials, query and fragment before storing any target field", () => {
  const target = siteTargetFromBrowser(7, "https://user:password@devops.example.test/releases?token=secret#credential", now)!
  assert.equal(target.url, "https://devops.example.test/releases")
  assert.equal(target.observed_at, "2026-09-07T03:00:00.000Z")
  assert.doesNotMatch(JSON.stringify(target), /password|token|secret|credential|user:/)
  assert.notEqual(target.navigation_key, createHash("sha256").update("https://devops.example.test/releases?token=secret#credential").digest("hex"))
})

test("actual origins retain scheme, port and www boundaries; context also tracks tab and path", () => {
  const target = (url: string, tab = 7) => siteTargetFromBrowser(tab, url, now)!
  const base = target("https://example.test/a")
  assert.equal(base.origin, target("https://example.test:443/a").origin)
  for (const other of ["http://example.test/a", "https://www.example.test/a", "https://example.test:8443/a"]) {
    assert.notEqual(base.origin, target(other).origin)
  }
  assert.notEqual(siteTargetKey(base), siteTargetKey(target("https://example.test/b")))
  assert.notEqual(siteTargetKey(base), siteTargetKey(target("https://example.test/a", 8)))
  assert.notEqual(siteTargetKey(base), siteTargetKey(target("https://example.test/a?issue=2")))
  assert.notEqual(siteTargetKey(base), siteTargetKey(target("https://example.test/a#/requirements/2")))
  assert.equal(siteTargetKey(base), siteTargetKey(siteTargetFromBrowser(7, base.url, now + 1000)))
})

test("unavailable/unsafe targets never become evidence-bearing browser context", () => {
  for (const url of ["chrome://settings", "file:///private/data", "javascript:alert(1)", "not-a-url"]) {
    assert.equal(siteTargetFromBrowser(7, url, now), undefined)
  }
  assert.equal(siteTargetFromBrowser("7", "https://example.test", now), undefined)
  assert.equal(siteTargetFromBrowser(7, "https://example.test", Number.NaN), undefined)
  assert.equal(siteTargetKey(undefined), "unavailable")
})
