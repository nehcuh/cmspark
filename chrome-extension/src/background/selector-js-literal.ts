/**
 * Safe JS string literal for embedding a CSS selector into Runtime.evaluate
 * expressions. JSON.stringify correctly escapes quotes, backslashes, newlines,
 * and U+2028/U+2029 — unlike naive replace(/'/g, "\\'") which still breaks on
 * backslash and allows quote+backslash breakout.
 *
 * No custom escaping needed: JSON.stringify is complete for JS string literals.
 * Do not re-invent escape tables — that is how the old weak pattern regressed.
 *
 * Pure helper (SEC-1) so unit tests can import without loading BrowserBridge/CDP.
 */
export function selectorJsLiteral(selector: string): string {
  return JSON.stringify(selector)
}
