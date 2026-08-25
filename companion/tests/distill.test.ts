import test from "node:test"
import assert from "node:assert/strict"
import { distillThreadMarkdown, redactSecrets, sanitizeTopicFolder } from "../src/threads/distill"

test("redactSecrets strips github tokens and pem", () => {
  const r = redactSecrets("token ghp_abcdefghijklmnopqrstuvwxyz012345 password=foo")
  assert.ok(r.hits >= 1)
  assert.ok(!r.text.includes("ghp_"))
  assert.ok(!r.text.includes("foo"))
  assert.match(r.text, /\[REDACTED\]/)
  const pem = redactSecrets(
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA" + "A".repeat(24) + "\n-----END RSA PRIVATE KEY-----",
  )
  assert.ok(pem.hits >= 1)
  assert.ok(!pem.text.includes("BEGIN RSA PRIVATE KEY"))
  assert.ok(!pem.text.includes("MIIEow"))
  const slack = redactSecrets("xoxb-1234567890-abcdefgh")
  assert.ok(slack.hits >= 1)
  assert.ok(!slack.text.includes("1234567890"))
})

test("distillThreadMarkdown uses digest and redacts body secrets", () => {
  const out = distillThreadMarkdown({
    alias: "SSO 排障",
    digest: {
      extracted_at: "t",
      content_fingerprint: "1:x",
      tldr: "修好了登录",
      tags: ["sso"],
      bullets: ["查 Okta"],
      source: "manual",
    },
    messages: [
      { role: "user", content: "key sk-abcdefghijklmnopqrstuvwxyz" },
      { role: "assistant", content: "ok" },
    ],
  })
  assert.equal(out.title, "修好了登录")
  assert.ok(out.markdown.includes("查 Okta"))
  assert.ok(!out.markdown.includes("sk-abcdefghijklmnopqrstuvwxyz"))
  assert.ok(out.hits >= 1)
})

test("distillThreadMarkdown redacts secrets in title/tldr", () => {
  const out = distillThreadMarkdown({
    digest: {
      extracted_at: "t",
      content_fingerprint: "1:x",
      tldr: "key sk-abcdefghijklmnopqrstuvwxyz",
      tags: [],
      bullets: [],
      source: "manual",
    },
    messages: [],
  })
  assert.ok(!out.title.includes("sk-abcdefghijklmnopqrstuvwxyz"))
  assert.ok(!out.markdown.includes("sk-abcdefghijklmnopqrstuvwxyz"))
})

test("distillThreadMarkdown redacts before per-message clip", () => {
  const pad = "x".repeat(380)
  const out = distillThreadMarkdown({
    messages: [{ role: "user", content: pad + " ghp_abcdefghijklmnopqrstuvwxyz012345 extra" }],
  })
  assert.ok(!out.markdown.includes("ghp_"))
  assert.ok(out.hits >= 1)
})

test("sanitizeTopicFolder strips paths and caps length", () => {
  assert.equal(sanitizeTopicFolder(null), null)
  assert.equal(sanitizeTopicFolder("  竞品  "), "竞品")
  assert.equal(sanitizeTopicFolder("a/b"), "ab")
  assert.ok((sanitizeTopicFolder("字".repeat(80)) || "").length <= 40)
})
