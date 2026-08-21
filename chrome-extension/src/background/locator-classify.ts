/**
 * Web act-loop W1/W3′ — pure tab-url and locator presence helpers (no Chrome).
 * SoT: docs/superpowers/specs/2026-08-21-web-act-loop-design.md
 */

export type TabUrlClass = "privileged" | "web" | "file" | "empty"

export function presentLocator(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

export function classifyTabUrl(url: string | undefined | null): TabUrlClass {
  const u = String(url || "").trim()
  if (!u || u === "about:blank") return "empty"
  const lower = u.toLowerCase()
  if (
    lower.startsWith("chrome-extension:") ||
    lower.startsWith("chrome:") ||
    lower.startsWith("edge:") ||
    lower.startsWith("devtools:")
  ) {
    return "privileged"
  }
  if (lower.startsWith("http:") || lower.startsWith("https:")) return "web"
  if (lower.startsWith("file:")) return "file"
  return "empty"
}

/** Attach/scripting failure: origin from tabs.get URL, never error-string substring. */
export function classifyAttachFailure(url: string | undefined | null): {
  error_code: "WRONG_ORIGIN" | "CDP_ATTACH_FAILED"
  suggested_action: "list_tabs"
} {
  const kind = classifyTabUrl(url)
  if (kind === "privileged") {
    return { error_code: "WRONG_ORIGIN", suggested_action: "list_tabs" }
  }
  return { error_code: "CDP_ATTACH_FAILED", suggested_action: "list_tabs" }
}

export function codedToolError(
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): { success: false; error: string; data: Record<string, unknown> } {
  return {
    success: false,
    error: `${code}: ${message}`,
    data: { error_code: code, suggested_action: extra?.suggested_action, ...extra },
  }
}

export type LocatorPlan =
  | { kind: "text"; text: string }
  | { kind: "css"; selector: string }
  | { kind: "none" }

/** Combination C: non-empty text is exclusive; never selector-then-text. */
export function planLocator(params: { text?: unknown; selector?: unknown }): LocatorPlan {
  const text = presentLocator(params.text)
  if (text) return { kind: "text", text }
  const selector = presentLocator(params.selector)
  if (selector) return { kind: "css", selector }
  return { kind: "none" }
}

/** SYNTAX_ERR-only. Must NOT match Chrome's case-insensitive `i` attribute flag. */
export function isInvalidSelectorMessage(msg: string): boolean {
  return /syntaxerror|is not a valid selector|failed to execute 'queryselector'/i.test(msg)
}

/**
 * Attach/scripting infrastructure vs locator miss.
 * WRONG_ORIGIN vs CDP_ATTACH_FAILED is from URL (never error substring).
 * Broaden attach messages so "Debugger is not attached" is not ELEMENT_NOT_FOUND.
 */
export function isAttachFailureMessage(msg: string): boolean {
  return /debugger|not attached|attach failed|cannot access|script injection|inspected target|target closed|chrome-extension:\/\/|chrome:\/\/|edge:\/\/|devtools:\/\//i.test(
    msg,
  )
}

export function classifyInteractiveFailure(
  url: string | undefined | null,
  msg: string,
  fallbackCode = "CDP_ATTACH_FAILED",
): { error_code: string; suggested_action: string } {
  if (classifyTabUrl(url) === "privileged") {
    return { error_code: "WRONG_ORIGIN", suggested_action: "list_tabs" }
  }
  if (isInvalidSelectorMessage(msg)) {
    return { error_code: "INVALID_SELECTOR", suggested_action: "refine_text_or_selector" }
  }
  if (isAttachFailureMessage(msg)) {
    return { error_code: "CDP_ATTACH_FAILED", suggested_action: "list_tabs" }
  }
  const locatorish = fallbackCode === "ELEMENT_NOT_FOUND" || fallbackCode === "TYPE_UNSUPPORTED_EDITOR"
  return {
    error_code: fallbackCode,
    suggested_action: locatorish ? "refine_text_or_selector" : "list_tabs",
  }
}
