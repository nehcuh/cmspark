// Page Sanitizer — removes malicious content from HTML/text before sending to companion

export interface SanitizeResult {
  sanitized: string
  threatsRemoved: string[]
}

export class PageSanitizer {
  private threats: string[] = []

  /** Remove <script> tags and their contents. */
  removeScripts(html: string): string {
    const before = html
    // Remove <script>...</script> (multiline, case-insensitive)
    let result = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    // Remove self-closing <script ... />
    result = result.replace(/<script\b[^>]*\/>/gi, "")
    // Remove <noscript>...</noscript> (may contain fallback scripts)
    result = result.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, "")
    if (result.length !== before.length) {
      this.threats.push("script-tags")
    }
    return result
  }

  /** Remove event handler attributes (onerror, onload, onclick, etc.). */
  removeEventHandlers(html: string): string {
    const before = html
    // Match on* attributes: onerror=, onload=, onclick=, etc.
    const result = html.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "")
    if (result.length !== before.length) {
      this.threats.push("event-handlers")
    }
    return result
  }

  /** Remove javascript: pseudo-protocol from href/src/action attributes. */
  removeJavaScriptUrls(html: string): string {
    const before = html
    // Match href="javascript:...", src='javascript:...', action=javascript:...
    const result = html.replace(
      /\s+(?:href|src|action|data)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]*)/gi,
      "",
    )
    if (result.length !== before.length) {
      this.threats.push("javascript-urls")
    }
    return result
  }

  /** Full sanitization pipeline for HTML. */
  sanitize(html: string): SanitizeResult {
    this.threats = []
    let sanitized = html
    sanitized = this.removeScripts(sanitized)
    sanitized = this.removeEventHandlers(sanitized)
    sanitized = this.removeJavaScriptUrls(sanitized)
    return {
      sanitized,
      threatsRemoved: [...this.threats],
    }
  }

  /** Sanitize plain text — detect hidden prompt injection patterns. */
  sanitizeText(text: string): SanitizeResult {
    this.threats = []
    let sanitized = text

    // Detect and flag prompt injection patterns in text
    const injectionPatterns = [
      { name: "ignore-instructions", pattern: /ignore\s+(?:all\s+)?(?:previous\s+)?instructions?/gi },
      { name: "system-override", pattern: /system\s*prompt\s*override/gi },
      { name: "new-role", pattern: /new\s+role\s*:\s*you\s+are\s+now/gi },
      { name: "disregard-instructions", pattern: /disregard\s+(?:all\s+)?(?:previous\s+)?instructions?/gi },
      { name: "forget-instructions", pattern: /forget\s+(?:all\s+)?(?:previous\s+)?(?:instructions?|prompts?)/gi },
      { name: "dan-mode", pattern: /DAN\s*mode/gi },
      { name: "jailbreak", pattern: /jailbreak/gi },
      { name: "developer-mode", pattern: /developer\s*:\s*new\s+instructions?/gi },
      { name: "ignore-previous-cn", pattern: /忽略\s*(?:以上|前面|之前|所有)?\s*(?:所有\s*)?指令/g },
      { name: "system-override-cn", pattern: /系统\s*提示\s*覆盖/g },
      { name: "new-role-cn", pattern: /新\s*角色\s*：\s*你现在是/g },
    ]

    for (const { name, pattern } of injectionPatterns) {
      if (pattern.test(sanitized)) {
        this.threats.push(name)
        sanitized = sanitized.replace(pattern, `[FILTERED:${name}]`)
      }
    }

    return {
      sanitized,
      threatsRemoved: [...this.threats],
    }
  }
}

/** Singleton instance for convenience. */
export const pageSanitizer = new PageSanitizer()
