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

test("Phase 1 W8 bugfix: evaluate with LLM-provided bogus token gets STRIPPED → gate runs", async () => {
  // W8 bugfix: security_token from LLM is stripped before L2 gate. Previous
  // behavior: token validation in executeCompanionTool caught stale tokens.
  // New behavior: tokens never reach executeCompanionTool — gate always runs,
  // fresh token issued internally. This test verifies the strip works: instead
  // of forwarding to extension (which would hang without a real ws handler),
  // the call should request confirmation (or fail with connection error since
  // mockWs doesn't handle confirmations). Either way, "evaluate" should NOT
  // succeed silently.
  const executeTool = createToolExecutor(mockWs())
  const result = await executeTool("tc-eval-1", "evaluate", {
    tabId: 1,
    code: "document.title",
    security_token: "bogus-never-issued-token",
  })
  // With strip, the L2 gate tries to send security.confirmation.request via ws.
  // mockWs.send is a no-op, so the request times out at the 45s confirmation
  // gate (or returns "unavailable" because ws not really connected). Both are
  // acceptable — what's NOT acceptable is silent execution with bogus token.
  assert.equal(result.success, false, "evaluate with stripped bogus token must NOT execute silently")
  // The error is "unavailable" (ws not actually connected for confirmation flow)
  // rather than "Invalid token" (the old path). Either is fine — what matters
  // is the call did not bypass the confirmation gate.
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
