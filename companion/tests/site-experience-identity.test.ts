import test from "node:test"
import assert from "node:assert/strict"
import { siteExperienceIdentity, isOwnedSiteExperience, readSiteExperienceEntries } from "../src/skills/site-experience-identity"

const doc = (site: string, content = "legacy") => ({
  type: "site_knowledge", site, tags: ["auto", "site-op-memory"], entries: [{ content }],
})

test("punctuation collisions get distinct bounded identities; hostname normalization stays stable", () => {
  const a = siteExperienceIdentity("a.b-c")
  const b = siteExperienceIdentity("a-b.c")
  assert.equal(a.legacyId, b.legacyId)
  assert.notEqual(a.id, b.id)
  assert.equal(siteExperienceIdentity("https://www.Example.COM/path").id, siteExperienceIdentity("example.com").id)
  assert.ok(a.id.length < 100)
})

test("legacy migration reads only its own automatic site document without mutating it", () => {
  const identity = siteExperienceIdentity("a.b-c")
  const legacy = doc("a.b-c")
  const before = JSON.stringify(legacy)
  const get = (id: string) => id === identity.legacyId ? legacy : undefined
  assert.deepEqual(readSiteExperienceEntries("a.b-c", get), [{ content: "legacy" }])
  assert.deepEqual(readSiteExperienceEntries("a-b.c", get), [])
  assert.equal(JSON.stringify(legacy), before)
  assert.equal(isOwnedSiteExperience({ ...legacy, tags: [] }, "a.b-c"), false)
  assert.equal(isOwnedSiteExperience(doc("*.b-c"), "a.b-c"), false)
  assert.equal(isOwnedSiteExperience({ ...legacy, type: "prompt_template" }, "a.b-c"), false)
})

test("new experience takes precedence over a duplicate legacy entry, including staleness", () => {
  const identity = siteExperienceIdentity("example.com")
  const fresh = { ...doc("example.com"), entries: [{ content: "same", stale: true }] }
  const legacy = { ...doc("example.com"), entries: [{ content: "same", stale: false }, { content: "other", stale: false }] }
  assert.deepEqual(readSiteExperienceEntries("example.com", id => id === identity.id ? fresh : legacy), [
    { content: "same", stale: true }, { content: "other", stale: false },
  ])
})

test("original pre-auto-tag producer remains readable only through the legacy id", () => {
  // Actual producer: 63aa4c63 adapter createExperienceSkill(..., ["site-op-memory"], entry).
  const identity = siteExperienceIdentity("example.com")
  const historical = { ...doc("example.com"), tags: ["site-op-memory"] }
  const before = JSON.stringify(historical)
  assert.deepEqual(readSiteExperienceEntries("example.com", id => id === identity.legacyId ? historical : undefined), historical.entries)
  assert.deepEqual(readSiteExperienceEntries("example.com", id => id === identity.id ? historical : undefined), [])
  assert.equal(isOwnedSiteExperience(historical, "example.com"), false)
  assert.deepEqual(readSiteExperienceEntries("example.com", () => ({ ...historical, tags: ["auto"] })), [])
  assert.deepEqual(readSiteExperienceEntries("example.com", () => ({ ...historical, site: "foreign.com" })), [])
  assert.equal(JSON.stringify(historical), before)
})

test("legacy origin keys retain known ports while URL-normalized www uses the historical apex key", () => {
  const historical = { ...doc("example.com:8443"), tags: ["site-op-memory"] }
  assert.equal(siteExperienceIdentity("https://www.Example.COM").legacyId, "example-com")
  assert.equal(siteExperienceIdentity("https://example.com:8443").legacyId, "example-com:8443")
  assert.equal(siteExperienceIdentity("https://www.Example.COM:8443").legacyId, "example-com:8443")
  assert.deepEqual(readSiteExperienceEntries("https://example.com:8443", id => id === "example-com:8443" ? historical : undefined), historical.entries)
  assert.equal(isOwnedSiteExperience(doc("example.com"), "example.com"), true)
})
