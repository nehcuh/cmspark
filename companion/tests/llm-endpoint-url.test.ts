import test from "node:test"
import assert from "node:assert/strict"
import * as dns from "node:dns"
import {
  LLM_ENDPOINT_DNS_ERROR,
  LLM_ENDPOINT_IMDS_ERROR,
  assertLlmEndpointAllowedAsync,
  assertLlmEndpointUrlAllowed,
  assertOutboundFetchUrlAllowed,
  canonicalizeLlmHostname,
  classifyLlmHostnameDns,
  hostnameResolvesToImds,
  normalizeIpLiteral,
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

test("assertLlmEndpointUrlAllowed blocks IPv6 IMDS / link-local literals", () => {
  // `new URL().hostname` keeps brackets and serializes v4-mapped as hex —
  // the guard must see through both.
  assert.match(
    String(assertLlmEndpointUrlAllowed("http://[fd00:ec2::254]/v1")),
    /metadata|link-local/i,
  )
  assert.match(
    String(assertLlmEndpointUrlAllowed("http://[fe80::1]/v1")),
    /metadata|link-local/i,
  )
  assert.match(
    String(assertLlmEndpointUrlAllowed("http://[::ffff:169.254.169.254]/v1")),
    /metadata|link-local/i,
  )
})

test("assertLlmEndpointUrlAllowed blocks transitional IPv6 embedding IMDS", () => {
  // v4-compatible, NAT64 (RFC 6052 WKP) and 6to4 (RFC 3056) forms carrying
  // 169.254.169.254 must reduce to the dotted quad and hit the v4 tables.
  assert.match(
    String(assertLlmEndpointUrlAllowed("http://[::169.254.169.254]/v1")),
    /metadata|link-local/i,
  )
  assert.match(
    String(assertLlmEndpointUrlAllowed("http://[64:ff9b::169.254.169.254]/v1")),
    /metadata|link-local/i,
  )
  assert.match(
    String(assertLlmEndpointUrlAllowed("http://[2002:a9fe:a9fe::]/v1")),
    /metadata|link-local/i,
  )
  // NAT64 of a PUBLIC address is not blocked by the LLM gate.
  assert.equal(assertLlmEndpointUrlAllowed("http://[64:ff9b::808:808]/v1"), null)
  // S-XLAT: IPv4-translated ::ffff:0:0:0/96 (RFC 2765)
  assert.match(
    String(assertLlmEndpointUrlAllowed("http://[::ffff:0:a9fe:a9fe]/v1")),
    /metadata|link-local/i,
  )
  assert.match(
    String(assertLlmEndpointUrlAllowed("http://[::ffff:0:169.254.169.254]/v1")),
    /metadata|link-local/i,
  )
})

test("assertLlmEndpointUrlAllowed blocks trailing-dot GCP metadata alias", () => {
  assert.match(
    String(assertLlmEndpointUrlAllowed("http://metadata.google.internal./")),
    /metadata|link-local/i,
  )
})

test("assertLlmEndpointUrlAllowed allows loopback / public IPv6 literals", () => {
  // Loopback stays allowed for local servers (same policy as 127.0.0.1).
  assert.equal(assertLlmEndpointUrlAllowed("http://[::1]:11434/v1"), null)
  assert.equal(assertLlmEndpointUrlAllowed("http://[::ffff:127.0.0.1]:11434/v1"), null)
  // Public v6 (documentation range 2001:db8::/32 is not link-local/IMDS).
  assert.equal(assertLlmEndpointUrlAllowed("http://[2001:db8::1]/v1"), null)
})

test("assertOutboundFetchUrlAllowed blocks bracketed / mapped loopback", () => {
  assert.match(
    String(assertOutboundFetchUrlAllowed("http://[::1]:8080/")),
    /Internal|private/i,
  )
  assert.match(
    String(assertOutboundFetchUrlAllowed("http://[::ffff:127.0.0.1]/")),
    /Internal|private/i,
  )
  assert.match(
    String(assertOutboundFetchUrlAllowed("http://[fd12::8]/")),
    /Internal|private/i,
  )
  // v4-compatible / NAT64 / 6to4 forms embedding loopback or RFC1918 too.
  assert.match(
    String(assertOutboundFetchUrlAllowed("http://[::127.0.0.1]/")),
    /Internal|private/i,
  )
  assert.match(
    String(assertOutboundFetchUrlAllowed("http://[64:ff9b::7f00:1]/")),
    /Internal|private/i,
  )
  assert.match(
    String(assertOutboundFetchUrlAllowed("http://[2002:0a00:0001::]/")),
    /Internal|private/i,
  )
  // Public v6 and hostnames still pass.
  assert.equal(assertOutboundFetchUrlAllowed("https://example.com/"), null)
  assert.equal(assertOutboundFetchUrlAllowed("http://[2001:db8::1]/"), null)
})

test("normalizeIpLiteral canonicalizes brackets / compression / v4-mapped", () => {
  assert.equal(normalizeIpLiteral("[::1]"), "0000:0000:0000:0000:0000:0000:0000:0001")
  assert.equal(normalizeIpLiteral("[fe80::1]"), "fe80:0000:0000:0000:0000:0000:0000:0001")
  assert.equal(normalizeIpLiteral("fd00:ec2::254"), "fd00:0ec2:0000:0000:0000:0000:0000:0254")
  assert.equal(normalizeIpLiteral("[::ffff:169.254.169.254]"), "169.254.169.254")
  assert.equal(normalizeIpLiteral("[::ffff:a9fe:a9fe]"), "169.254.169.254")
  assert.equal(normalizeIpLiteral("::ffff:127.0.0.1"), "127.0.0.1")
  // Transitional forms embedding a v4 address reduce to the dotted quad…
  assert.equal(normalizeIpLiteral("[::169.254.169.254]"), "169.254.169.254")
  assert.equal(normalizeIpLiteral("[64:ff9b::a9fe:a9fe]"), "169.254.169.254")
  assert.equal(normalizeIpLiteral("[2002:a9fe:a9fe::]"), "169.254.169.254")
  assert.equal(normalizeIpLiteral("[::ffff:0:a9fe:a9fe]"), "169.254.169.254")
  assert.equal(normalizeIpLiteral("[::ffff:0:169.254.169.254]"), "169.254.169.254")
  // …but `::` / `::1` keep their native IPv6 semantics (no 0.0.0.0/8 reduction).
  assert.equal(normalizeIpLiteral("[::]"), "0000:0000:0000:0000:0000:0000:0000:0000")
  assert.equal(normalizeIpLiteral("10.0.0.1"), "10.0.0.1")
  assert.equal(normalizeIpLiteral("example.com"), null)
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

test("hostnameResolvesToImds: IP literals use the same tables; names DNS-fail-closed", async () => {
  assert.equal(await hostnameResolvesToImds("127.0.0.1"), false)
  assert.equal(await hostnameResolvesToImds("[::ffff:0:a9fe:a9fe]"), true)
  const orig = dns.promises.lookup
  dns.promises.lookup = (async () => [{ address: "169.254.169.254", family: 4 }]) as unknown as typeof orig
  try {
    assert.equal(await hostnameResolvesToImds("imds.example.test"), true)
  } finally {
    dns.promises.lookup = orig
  }
  dns.promises.lookup = (async () => {
    throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })
  }) as unknown as typeof orig
  try {
    assert.equal(await hostnameResolvesToImds("unresolvable.invalid"), true)
  } finally {
    dns.promises.lookup = orig
  }
})

test("canonicalizeLlmHostname strips brackets and trailing FQDN dots", () => {
  assert.equal(canonicalizeLlmHostname("LocalHost."), "localhost")
  assert.equal(canonicalizeLlmHostname("[::1]"), "::1")
  assert.equal(canonicalizeLlmHostname("metadata.google.internal."), "metadata.google.internal")
})

test("classifyLlmHostnameDns distinguishes ok / imds / unresolved", async () => {
  assert.equal(await classifyLlmHostnameDns("127.0.0.1"), "ok")
  assert.equal(await classifyLlmHostnameDns("[::ffff:0:a9fe:a9fe]"), "imds")
  const orig = dns.promises.lookup
  dns.promises.lookup = (async () => [{ address: "169.254.169.254", family: 4 }]) as unknown as typeof orig
  try {
    assert.equal(await classifyLlmHostnameDns("imds.example.test"), "imds")
  } finally {
    dns.promises.lookup = orig
  }
  dns.promises.lookup = (async () => {
    throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })
  }) as unknown as typeof orig
  try {
    assert.equal(await classifyLlmHostnameDns("unresolvable.invalid"), "unresolved")
  } finally {
    dns.promises.lookup = orig
  }
})

test("assertLlmEndpointAllowedAsync: DNS fail copy is not the IMDS copy", async () => {
  assert.equal(
    await assertLlmEndpointAllowedAsync("http://169.254.169.254/v1"),
    LLM_ENDPOINT_IMDS_ERROR,
  )
  const orig = dns.promises.lookup
  dns.promises.lookup = (async () => {
    throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })
  }) as unknown as typeof orig
  try {
    const err = await assertLlmEndpointAllowedAsync("http://unresolvable.invalid/v1")
    assert.equal(err, LLM_ENDPOINT_DNS_ERROR)
    assert.notEqual(err, LLM_ENDPOINT_IMDS_ERROR)
  } finally {
    dns.promises.lookup = orig
  }
  dns.promises.lookup = (async () => [{ address: "169.254.169.254", family: 4 }]) as unknown as typeof orig
  try {
    assert.equal(
      await assertLlmEndpointAllowedAsync("http://imds.example.test/v1"),
      LLM_ENDPOINT_IMDS_ERROR,
    )
  } finally {
    dns.promises.lookup = orig
  }
})
