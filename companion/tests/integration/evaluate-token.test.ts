import test from "node:test"
import assert from "node:assert/strict"
import { createToolExecutor } from "../../src/server"

// E2E for the P0-4 (audit H2) change: evaluate is forwarded to the extension, and its
// security_token was previously never validated companion-side. Now, when a security_token is
// already present (the replay/stale path that skips the confirmation block), executeTool must
// validate it. This drives the real createToolExecutor with a mock ws (only the transport is
// mocked — the security-policy validateToken logic is the real production code path).

function mockWs(): any {
  return { readyState: 1 /* WebSocket.OPEN */, send: () => { /* swallow tool.start */ } }
}

test("executeTool rejects evaluate with an invalid/stale pre-existing token (audit H2 / P0-4)", async () => {
  const executeTool = createToolExecutor(mockWs())
  // A pre-existing (replay/stale) token present → the confirmation `if` block is skipped → the
  // P0-4 `else if` must validate the token against the code. A bogus/never-issued token must be
  // rejected before any forwarding to the extension.
  const result = await executeTool("tc-eval-1", "evaluate", {
    tabId: 1,
    code: "document.title",
    security_token: "bogus-never-issued-token",
  })
  assert.equal(result.success, false, "evaluate with an invalid token must be rejected")
  assert.match(result.error || "", /token/i, `error should mention the token, got: ${result.error}`)
})

test("issueToken/validateToken bind the token to the confirmed code (H2 binding contract)", async () => {
  // Positive coverage for the H2 fix: the token is not just "present" — it is cryptographically
  // bound to the exact code confirmed. This is the contract executeTool's else-if relies on.
  const { securityPolicy } = await import("../../src/security-policy")

  const ok = securityPolicy.issueToken("evaluate", "document.title")
  assert.equal(
    securityPolicy.validateToken(ok.token, "evaluate", "document.title"),
    true,
    "token issued for code A must validate for code A",
  )

  const mismatch = securityPolicy.issueToken("evaluate", "document.title")
  assert.equal(
    securityPolicy.validateToken(mismatch.token, "evaluate", "fetch('/x')"),
    false,
    "token issued for code A must NOT validate for code B (confirm/exec binding)",
  )

  const wrongTool = securityPolicy.issueToken("evaluate", "document.title")
  assert.equal(
    securityPolicy.validateToken(wrongTool.token, "osascript_eval", "document.title"),
    false,
    "token issued for evaluate must NOT validate for osascript_eval",
  )
})
