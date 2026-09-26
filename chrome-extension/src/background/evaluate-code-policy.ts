// P1-3: evaluate post-approval code integrity.
//
// Companion L2 / security_token binds the *original* `params.code` (see
// companion security-policy bindingPayloadFor("evaluate") + server.ts issueTokenFor).
// Extension must NOT run mutative sanitizeText on that body after approval —
// FILTERED rewrites would execute code the user never confirmed.
//
// Contract (Option A):
// - security_token present (non-empty): execute String(code) byte-identical;
//   detectDangerousApis is advisory only on the original source.
// - security_token missing/empty: refuse; never bare-run.
// - Extension trusts token *presence* (not HMAC); companion is sole issuer
//   and validates binding before forwarding tool.execute.

import { detectDangerousApis } from "./dangerous-apis"

export type EvaluateExecutionDecision =
  | {
      allowed: true
      /** Original code string — must be executed without sanitizeText mutation. */
      code: string
      /** Advisory only (audit H9); does not gate execution. */
      risk_pattern_matches: string[]
    }
  | {
      allowed: false
      error: string
    }

/**
 * Resolve whether evaluate may run and which source body to execute.
 *
 * Pure helper for unit tests and browser-bridge.evaluate(). Does not call CDP.
 */
export function resolveEvaluateExecution(params: {
  code?: unknown
  security_token?: unknown
}): EvaluateExecutionDecision {
  const rawToken = params.security_token
  // Missing, null, or empty/whitespace-only token → refuse (never bare-run).
  // The EVALUATE_AUTH_REQUIRED prefix is machine-readable: companion's site-op
  // memory must NOT count authorization refusals toward the origin CDP fail
  // streak (they are parameter/approval issues, not page-interaction failures).
  if (rawToken === undefined || rawToken === null) {
    return {
      allowed: false,
      error:
        "EVALUATE_AUTH_REQUIRED: evaluate requires security_token (companion L2 / auto-approve). " +
        "Unapproved evaluate is refused. This is an authorization requirement, not an origin/CDP failure — " +
        "prefer get_page_text or selector-based tools (click/type/fill_form with a CSS selector); " +
        "do not count this against the page.",
    }
  }
  const token = String(rawToken).trim()
  if (token === "") {
    return {
      allowed: false,
      error:
        "EVALUATE_AUTH_REQUIRED: evaluate requires security_token (companion L2 / auto-approve). " +
        "Unapproved evaluate is refused. This is an authorization requirement, not an origin/CDP failure — " +
        "prefer get_page_text or selector-based tools (click/type/fill_form with a CSS selector); " +
        "do not count this against the page.",
    }
  }

  // Approved path: identity preserve — no sanitizeText rewrite of source.
  const code = String(params.code ?? "")
  const risk_pattern_matches = detectDangerousApis(code)
  return {
    allowed: true,
    code,
    risk_pattern_matches,
  }
}
