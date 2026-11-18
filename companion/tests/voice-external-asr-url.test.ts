import assert from "node:assert/strict"
import test from "node:test"
import { canonicalExternalUrl } from "../src/voice/external-asr-url"

test("deepseek empty, /v1, and full path share one URL", () => {
  for (const raw of ["", "https://api.deepseek.com/v1", "https://api.deepseek.com/v1/tools/asr"]) {
    const got = canonicalExternalUrl("deepseek", raw)
    assert.equal(got.ok, true)
    if (got.ok) {
      assert.equal(got.url, "https://api.deepseek.com/v1/tools/asr")
      assert.equal(got.limitNote, "deepseek-docs")
    }
  }
})

test("deepseek rejects chat path and doubled /v1", () => {
  for (const raw of ["https://api.deepseek.com/v1/v1", "https://api.deepseek.com/chat/completions"]) {
    assert.equal(canonicalExternalUrl("deepseek", raw).ok, false)
  }
})

test("openai default and custom prefix append transcriptions once", () => {
  const official = canonicalExternalUrl("openai", "")
  assert.equal(official.ok && official.url, "https://api.openai.com/v1/audio/transcriptions")
  assert.equal(official.ok && official.limitNote, "openai-file-cap")
  const custom = canonicalExternalUrl("openai", "https://example.test/openai/v1")
  assert.equal(custom.ok && custom.url, "https://example.test/openai/v1/audio/transcriptions")
  assert.equal(custom.ok && custom.limitNote, "unprobed-local-default")
  const twice = canonicalExternalUrl("openai", "https://api.openai.com/v1/audio/transcriptions")
  assert.equal(twice.ok && twice.url, "https://api.openai.com/v1/audio/transcriptions")
})

test("rejects userinfo, query, fragment, public http, and link-local", () => {
  const bad = [
    "https://user:pass@api.deepseek.com/v1/tools/asr",
    "https://api.deepseek.com/v1/tools/asr?x=1",
    "https://api.deepseek.com/v1/tools/asr#a",
    "http://example.test/v1",
    "http://169.254.169.254/v1/tools/asr",
    "https://169.254.169.254/v1/tools/asr",
    "https://[fe80::1]/v1/tools/asr",
    "https://0.0.0.0/v1/tools/asr",
    "https://[::]/v1/tools/asr",
    "https://224.0.0.1/v1/tools/asr",
    "file:///tmp/a",
  ]
  for (const raw of bad) assert.equal(canonicalExternalUrl("deepseek", raw).ok, false)
})

test("allows loopback and RFC1918 literals over http", () => {
  for (const raw of ["http://127.0.0.1:9000", "http://192.168.1.9:8080", "http://localhost:9"]) {
    assert.equal(canonicalExternalUrl("openai", raw).ok, true)
  }
})
