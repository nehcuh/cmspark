/**
 * L7 header policy unit tests (Anthropic protocol P0 / NODE1).
 * Covers: first-party deny, gateway host allow, default clean UA, no CRLF/Host.
 */

import test from "node:test"
import assert from "node:assert/strict"
import {
  assertHeaderPolicy,
  buildRequestHeaders,
  cleanCompanionUserAgent,
  HeaderPolicyError,
  headerNamesForLog,
  hostnameFromBaseUrl,
  isAnthropicFirstPartyHost,
  DEFAULT_ANTHROPIC_VERSION,
  DEFAULT_CLAUDE_CODE_COMPAT_VERSION,
} from "../src/llm/providers/headers"

// ── isAnthropicFirstPartyHost ──────────────────────────────────────────────

test("isAnthropicFirstPartyHost: exact api.anthropic.com", () => {
  assert.equal(isAnthropicFirstPartyHost("api.anthropic.com"), true)
  assert.equal(isAnthropicFirstPartyHost("API.Anthropic.COM"), true)
})

test("isAnthropicFirstPartyHost: exact anthropic.com and claude.ai", () => {
  assert.equal(isAnthropicFirstPartyHost("anthropic.com"), true)
  assert.equal(isAnthropicFirstPartyHost("claude.ai"), true)
})

test("isAnthropicFirstPartyHost: suffix .anthropic.com / .claude.ai", () => {
  assert.equal(isAnthropicFirstPartyHost("console.anthropic.com"), true)
  assert.equal(isAnthropicFirstPartyHost("foo.bar.anthropic.com"), true)
  assert.equal(isAnthropicFirstPartyHost("www.claude.ai"), true)
})

test("isAnthropicFirstPartyHost: NEVER bare endsWith anthropic.com (evilanthropic.com)", () => {
  assert.equal(isAnthropicFirstPartyHost("evilanthropic.com"), false)
  assert.equal(isAnthropicFirstPartyHost("notanthropic.com"), false)
  assert.equal(isAnthropicFirstPartyHost("myclaude.ai"), false)
  assert.equal(isAnthropicFirstPartyHost("claude.ai.evil.com"), false)
})

test("isAnthropicFirstPartyHost: gateway / third-party hosts are not first-party", () => {
  assert.equal(isAnthropicFirstPartyHost("relay.example.com"), false)
  assert.equal(isAnthropicFirstPartyHost("coding-plan.gateway.io"), false)
  assert.equal(isAnthropicFirstPartyHost("api.deepseek.com"), false)
  assert.equal(isAnthropicFirstPartyHost("localhost"), false)
})

test("isAnthropicFirstPartyHost: trailing FQDN dot still first-party (DNS absolute)", () => {
  // api.anthropic.com. is DNS-identical to api.anthropic.com — must not bypass L7
  assert.equal(isAnthropicFirstPartyHost("api.anthropic.com."), true)
  assert.equal(isAnthropicFirstPartyHost("anthropic.com."), true)
  assert.equal(isAnthropicFirstPartyHost("claude.ai."), true)
  assert.equal(isAnthropicFirstPartyHost("console.anthropic.com."), true)
  // spoof hosts with trailing dot still rejected
  assert.equal(isAnthropicFirstPartyHost("evilanthropic.com."), false)
})

// ── hostnameFromBaseUrl ────────────────────────────────────────────────────

test("hostnameFromBaseUrl extracts host from full URLs", () => {
  assert.equal(hostnameFromBaseUrl("https://api.anthropic.com/v1"), "api.anthropic.com")
  assert.equal(hostnameFromBaseUrl("https://relay.example.com:8443/v1/messages"), "relay.example.com")
})

test("hostnameFromBaseUrl strips trailing FQDN dot", () => {
  assert.equal(hostnameFromBaseUrl("https://api.anthropic.com./v1"), "api.anthropic.com")
  assert.equal(hostnameFromBaseUrl("https://console.anthropic.com."), "console.anthropic.com")
})

// ── L7: first-party deny (profile OR extra_headers) ────────────────────────

test("L7: first-party + client_header_profile=claude_code_compat → HeaderPolicyError", () => {
  assert.throws(
    () =>
      assertHeaderPolicy({
        baseUrl: "https://api.anthropic.com",
        client_header_profile: "claude_code_compat",
      }),
    (err: unknown) => {
      assert.ok(err instanceof HeaderPolicyError)
      assert.equal(err.code, "HEADER_POLICY_DENIED")
      assert.match(err.message, /官方 Anthropic|兼容头|中继/)
      return true
    },
  )
})

test("L7: trailing-dot FQDN first-party + claude_code_compat → HeaderPolicyError (no bypass)", () => {
  // Regression: URL.hostname keeps "api.anthropic.com." which previously missed
  // exact/suffix first-party match and allowed compat headers to official API.
  assert.throws(
    () =>
      assertHeaderPolicy({
        baseUrl: "https://api.anthropic.com./v1",
        client_header_profile: "claude_code_compat",
      }),
    (err: unknown) => {
      assert.ok(err instanceof HeaderPolicyError)
      assert.equal(err.code, "HEADER_POLICY_DENIED")
      return true
    },
  )
  // buildRequestHeaders must also deny (policy runs before emit)
  assert.throws(
    () =>
      buildRequestHeaders({
        baseUrl: "https://api.anthropic.com./v1",
        protocol: "anthropic",
        apiKey: "sk-test",
        client_header_profile: "claude_code_compat",
      }),
    HeaderPolicyError,
  )
})

test("L7: first-party + extra_headers with user-agent → deny", () => {
  assert.throws(
    () =>
      assertHeaderPolicy({
        baseUrl: "https://api.anthropic.com/v1",
        client_header_profile: "none",
        extra_headers: { "user-agent": "claude-cli/9.9.9 (external, cli)" },
      }),
    HeaderPolicyError,
  )
})

test("L7: first-party + any extra_headers → deny (union, not only spoof keys)", () => {
  assert.throws(
    () =>
      assertHeaderPolicy({
        baseUrl: "https://claude.ai",
        extra_headers: { "x-custom-trace": "1" },
      }),
    HeaderPolicyError,
  )
})

test("L7: first-party + profile=none + no extras → allow", () => {
  assert.doesNotThrow(() =>
    assertHeaderPolicy({
      baseUrl: "https://api.anthropic.com",
      client_header_profile: "none",
    }),
  )
})

test("L7: suffix first-party host also denied", () => {
  assert.throws(
    () =>
      assertHeaderPolicy({
        baseUrl: "https://console.anthropic.com",
        client_header_profile: "claude_code_compat",
      }),
    HeaderPolicyError,
  )
})

// ── Gateway host: allow compat profile ─────────────────────────────────────

test("gateway host: claude_code_compat allowed and injects UA + x-app", () => {
  const headers = buildRequestHeaders({
    baseUrl: "https://coding-plan.relay.example.com/v1",
    protocol: "anthropic",
    apiKey: "sk-test",
    client_header_profile: "claude_code_compat",
    claude_code_compat_version: "2.1.220",
  })
  assert.equal(headers["user-agent"], "claude-cli/2.1.220 (external, cli)")
  assert.equal(headers["x-app"], "cli")
  assert.equal(headers["x-api-key"], "sk-test")
  assert.equal(headers["anthropic-version"], DEFAULT_ANTHROPIC_VERSION)
  assert.equal(headers["content-type"], "application/json")
  // Must not set Host
  assert.equal(headers["host"], undefined)
  assert.equal(headers["Host"], undefined)
})

test("gateway host: default pin version used when config omits version", () => {
  const headers = buildRequestHeaders({
    baseUrl: "https://gw.example.com",
    protocol: "anthropic",
    apiKey: "k",
    client_header_profile: "claude_code_compat",
  })
  assert.equal(
    headers["user-agent"],
    `claude-cli/${DEFAULT_CLAUDE_CODE_COMPAT_VERSION} (external, cli)`,
  )
})

test("gateway host: buildRequestHeaders refuses first-party + profile", () => {
  assert.throws(
    () =>
      buildRequestHeaders({
        baseUrl: "https://api.anthropic.com",
        protocol: "anthropic",
        apiKey: "k",
        client_header_profile: "claude_code_compat",
      }),
    HeaderPolicyError,
  )
})

// ── Default clean identity ─────────────────────────────────────────────────

test("default clean UA: openai profile=none", () => {
  const headers = buildRequestHeaders({
    baseUrl: "https://api.deepseek.com/v1",
    protocol: "openai",
    apiKey: "sk-ds",
    client_header_profile: "none",
    companionVersion: "0.3.0",
  })
  assert.equal(headers["user-agent"], "cmspark-companion/0.3.0")
  assert.equal(headers["authorization"], "Bearer sk-ds")
  assert.equal(headers["x-app"], undefined)
  assert.equal(headers["x-api-key"], undefined)
})

test("default clean UA: anthropic profile=none on first-party", () => {
  const headers = buildRequestHeaders({
    baseUrl: "https://api.anthropic.com",
    protocol: "anthropic",
    apiKey: "sk-ant",
    client_header_profile: "none",
    companionVersion: "1.2.3",
  })
  assert.equal(headers["user-agent"], "cmspark-companion/1.2.3")
  assert.equal(headers["x-api-key"], "sk-ant")
  assert.equal(headers["anthropic-version"], DEFAULT_ANTHROPIC_VERSION)
  assert.equal(headers["x-app"], undefined)
})

test("cleanCompanionUserAgent format", () => {
  assert.equal(cleanCompanionUserAgent("9.9.9"), "cmspark-companion/9.9.9")
  assert.match(cleanCompanionUserAgent(), /^cmspark-companion\//)
})

test("claude_code_compat + protocol=openai is inert (no spoof UA)", () => {
  const headers = buildRequestHeaders({
    baseUrl: "https://api.deepseek.com/v1",
    protocol: "openai",
    apiKey: "k",
    client_header_profile: "claude_code_compat",
    companionVersion: "0.3.0",
  })
  assert.equal(headers["user-agent"], "cmspark-companion/0.3.0")
  assert.equal(headers["x-app"], undefined)
})

// ── No CRLF / Host in extra_headers ────────────────────────────────────────

test("extra_headers: CRLF in name is rejected", () => {
  assert.throws(
    () =>
      assertHeaderPolicy({
        baseUrl: "https://relay.example.com",
        extra_headers: { "x-evil\r\nHost": "evil.com" },
      }),
    (err: unknown) => {
      assert.ok(err instanceof HeaderPolicyError)
      assert.match(err.message, /CRLF/i)
      return true
    },
  )
})

test("extra_headers: CRLF in value is rejected", () => {
  assert.throws(
    () =>
      buildRequestHeaders({
        baseUrl: "https://relay.example.com",
        protocol: "anthropic",
        apiKey: "k",
        extra_headers: { "x-trace": "a\r\nHost: evil.com" },
      }),
    /CRLF/i,
  )
})

test("extra_headers: Host is rejected", () => {
  assert.throws(
    () =>
      assertHeaderPolicy({
        baseUrl: "https://relay.example.com",
        extra_headers: { Host: "evil.example.com" },
      }),
    /not allowed|Host/i,
  )
})

test("extra_headers: Cookie / Authorization forbidden", () => {
  assert.throws(
    () =>
      assertHeaderPolicy({
        baseUrl: "https://relay.example.com",
        extra_headers: { Cookie: "sid=1" },
      }),
    HeaderPolicyError,
  )
  assert.throws(
    () =>
      assertHeaderPolicy({
        baseUrl: "https://relay.example.com",
        extra_headers: { Authorization: "Bearer x" },
      }),
    HeaderPolicyError,
  )
})

test("buildRequestHeaders never emits Host header", () => {
  const headers = buildRequestHeaders({
    baseUrl: "https://relay.example.com",
    protocol: "openai",
    apiKey: "k",
    companionVersion: "0.1.0",
  })
  for (const k of Object.keys(headers)) {
    assert.notEqual(k.toLowerCase(), "host")
  }
})

test("headerNamesForLog returns sorted names only (no values)", () => {
  const names = headerNamesForLog({
    "user-agent": "cmspark-companion/0.3.0",
    authorization: "Bearer SECRET",
    "content-type": "application/json",
  })
  assert.deepEqual(names, ["authorization", "content-type", "user-agent"])
})

test("auth_style=bearer on anthropic uses Authorization", () => {
  const headers = buildRequestHeaders({
    baseUrl: "https://relay.example.com",
    protocol: "anthropic",
    apiKey: "gw-key",
    auth_style: "bearer",
    client_header_profile: "none",
    companionVersion: "0.3.0",
  })
  assert.equal(headers["authorization"], "Bearer gw-key")
  assert.equal(headers["x-api-key"], undefined)
})
