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
    // S-P0-3: loop until stable so nested/split patterns like
    // `<scr<script>ipt>` collapse to `<script>` after one pass and get
    // stripped on the next. Cap at 5 iterations to bound ReDoS risk.
    let result = html
    for (let i = 0; i < 5; i++) {
      const next = result
        // Remove <script>...</script> (multiline, case-insensitive)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
        // Remove self-closing <script ... />
        .replace(/<script\b[^>]*\/>/gi, "")
        // Remove <noscript>...</noscript> (may contain fallback scripts)
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, "")
        // Remove orphaned unclosed <script ...> (attacker may drop the closer)
        .replace(/<script\b[^>]*>/gi, "")
      if (next === result) break
      result = next
    }
    if (result.length !== before.length) {
      this.threats.push("script-tags")
    }
    return result
  }

  /** Remove event handler attributes (onerror, onload, onclick, etc.). */
  removeEventHandlers(html: string): string {
    const before = html
    // S-P0-3: attributes can be preceded by whitespace OR a slash
    // (`<img/onerror=...>`, `<img/onerror=...>`). Use `[\s/]+` not `\s+`.
    // Also handle quoted (single/double) and unquoted values.
    const result = html.replace(/[\s/]+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "")
    if (result.length !== before.length) {
      this.threats.push("event-handlers")
    }
    return result
  }

  /** Remove javascript: and data: pseudo-protocols from URL-bearing attributes. */
  removeJavaScriptUrls(html: string): string {
    const before = html
    // S-P0-3: broaden attribute list — add formaction, xlink:href, poster,
    // srcset, cite, background, dynsrc, lowsrc, formaction, srcdoc, data
    // (data:image/svg+xml,<svg onload=...> is a known XSS vector).
    // Also catch `data:text/html` and `data:image/svg+xml` carrying scripts.
    // A6 (Grok round 2): allow optional whitespace/tab after the quote
    // before the protocol — `href=" javascript:alert(1)"` was bypassing.
    const attrs = "href|src|action|formaction|data|xlink:href|poster|srcset|cite|background|dynsrc|lowsrc|srcdoc"
    const proto = "(?:javascript|data):"
    const result = html.replace(
      new RegExp(`[\\s/]+(?:${attrs})\\s*=\\s*(?:"\\s*${proto}[^"]*"|'\\s*${proto}[^']*'|\\s*${proto}[^\\s>]*)`, "gi"),
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

    // S-P0-3: use /g flag on every replace — previously only the FIRST
    // match per pattern was stripped, so a page with multiple injection
    // phrases retained all but the first. `test()` then `replace()` also
    // had stateful lastIndex issues with /g; we use one replace pass per
    // pattern with /g + check `match()` to decide whether to push the threat.
    const injectionPatterns: { name: string; pattern: RegExp }[] = [
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
      // Clone the regex so .exec() state on `pattern` doesn't leak across iterations.
      const re = new RegExp(pattern.source, pattern.flags)
      if (re.test(sanitized)) {
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
