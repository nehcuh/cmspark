import test from "node:test"
import assert from "node:assert/strict"
import {
  assertLlmEndpointUrlAllowed,
  assertOutboundFetchUrlAllowed,
} from "../src/security"

test("assertLlmEndpointUrlAllowed allows intranet OpenAI-compatible URLs", () => {
  assert.equal(assertLlmEndpointUrlAllowed("http://10.251.241.12/v1"), null)
  assert.equal(assertLlmEndpointUrlAllowed("http://192.168.1.20:8000/v1"), null)
  assert.equal(assertLlmEndpointUrlAllowed("http://172.16.0.8/v1"), null)
  assert.equal(assertLlmEndpointUrlAllowed("http://127.0.0.1:11434/v1"), null)
  assert.equal(assertLlmEndpointUrlAllowed("http://localhost:11434/v1"), null)
  assert.equal(assertLlmEndpointUrlAllowed("https://api.deepseek.com/v1"), null)
})

test("assertLlmEndpointUrlAllowed still blocks cloud metadata / link-local", () => {
  assert.match(
    String(assertLlmEndpointUrlAllowed("http://169.254.169.254/latest/meta-data")),
    /metadata|link-local/i,
  )
  assert.match(
    String(assertLlmEndpointUrlAllowed("http://169.254.170.2/v1")),
    /metadata|link-local/i,
  )
  assert.match(
    String(assertLlmEndpointUrlAllowed("http://metadata.google.internal/")),
    /metadata|link-local/i,
  )
})

test("assertOutboundFetchUrlAllowed still blocks RFC1918 (untrusted fetch)", () => {
  assert.match(
    String(assertOutboundFetchUrlAllowed("http://10.251.241.12/v1")),
    /Internal|private/i,
  )
})

test("assertLlmEndpointUrlAllowed rejects non-http schemes", () => {
  assert.match(String(assertLlmEndpointUrlAllowed("file:///etc/passwd")), /protocol/i)
  assert.match(String(assertLlmEndpointUrlAllowed("not a url")), /Invalid URL/)
})
