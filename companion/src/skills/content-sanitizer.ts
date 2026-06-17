// Content sanitizer — prompt injection filtering for knowledge docs and page content

/**
 * Prompt-injection regex bank. Exported (audit item 9) so the MCP aggregator can
 * reuse the same patterns to scan tool metadata before exposing it to the LLM.
 */
export const INJECTION_PATTERNS = [
  // English patterns (1-16)
  /ignore\s+(?:all\s+)?(?:previous\s+)?instructions?/i,
  /system\s*prompt\s*override/i,
  /new\s+role\s*:\s*you\s+are\s+now/i,
  /you\s+are\s+now\s+(?:in\s+)?\w+\s+mode/i,
  /disregard\s+(?:all\s+)?(?:previous\s+)?(?:instructions?|prompts?)/i,
  /forget\s+(?:all\s+)?(?:previous\s+)?(?:instructions?|prompts?)/i,
  /(?:user|human)\s*:\s*ignore\s+(?:all\s+)?(?:previous\s+)?instructions?/i,
  /(?:developer|system)\s*:\s*new\s+instructions?/i,
  /DAN\s*mode/i,
  /jailbreak/i,
  /ignore\s+the\s+above\s+instructions?/i,
  /ignore\s+previous\s+prompts?/i,
  /pretend\s+you\s+are\s+(?:an?\s+)?\w+/i,
  /act\s+as\s+(?:an?\s+)?\w+/i,
  /roleplay\s+as\s+(?:an?\s+)?\w+/i,
  /simulate\s+(?:an?\s+)?\w+/i,
  // Chinese patterns (17-32)
  /忽略\s*(?:以上|前面|之前)\s*(?:所有\s*)?指令/i,
  /忽略\s*(?:所有\s*)?(?:之前|以前|前面)\s*(?:的\s*)?指令/i,
  /请\s*忽略\s*(?:以上|前面|之前)\s*(?:所有\s*)?提示/i,
  /系统\s*提示\s*覆盖/i,
  /新\s*角色\s*[:：]\s*你现在是/i,
  /你\s*现在\s*是\s*\w+\s*模式/i,
  /无视\s*(?:所有\s*)?(?:之前|以前|前面)\s*(?:的\s*)?指令/i,
  /忘记\s*(?:所有\s*)?(?:之前|以前|前面)\s*(?:的\s*)?指令/i,
  /假装\s*你是\s*\w+/i,
  /扮演\s*\w+/i,
  /模拟\s*\w+/i,
  /进入\s*\w+\s*模式/i,
  /切换\s*到\s*\w+\s*模式/i,
  /你\s*现在\s*是\s*\w+/i,
  /你\s*的\s*新\s*角色\s*[:：]/i,
  /系统\s*指令\s*[:：]/i,
  // Additional obfuscation / bypass patterns (33-48)
  /ignore\s+all\s+previous\s+instructions?\s+and/i,
  /bypass\s+(?:all\s+)?(?:security|safety|restrictions?)/i,
  /disable\s+(?:all\s+)?(?:safety|security)\s+(?:checks?|filters?)/i,
  /ignore\s+your\s+(?:programming|training|safety)/i,
  /do\s+not\s+(?:follow|obey)\s+(?:any\s+)?rules?/i,
  /you\s+are\s+not\s+(?:bound\s+by|restricted\s+by)\s+any\s+rules?/i,
  /free\s+yourself\s+from\s+(?:all\s+)?constraints?/i,
  /break\s+(?:out\s+of|free\s+from)\s+(?:your\s+)?constraints?/i,
  /ignore\s+(?:the\s+)?system\s+prompt/i,
  /override\s+(?:the\s+)?system\s+prompt/i,
  /reveal\s+(?:your\s+)?system\s+prompt/i,
  /show\s+(?:your\s+)?system\s+prompt/i,
  /print\s+(?:your\s+)?system\s+prompt/i,
  /output\s+(?:your\s+)?system\s+prompt/i,
  /泄露\s*(?:你的\s*)?系统\s*提示/i,
  /显示\s*(?:你的\s*)?系统\s*指令/i,
]

/** HTML injection patterns for page content scanning. */
const HTML_INJECTION_PATTERNS = [
  { name: "script-tag", pattern: /<script\b[^>]*>/i },
  { name: "javascript-protocol", pattern: /javascript\s*:/i },
  { name: "data-protocol", pattern: /data\s*:\s*text\/html/i },
  { name: "vbscript-protocol", pattern: /vbscript\s*:/i },
  { name: "onerror-attribute", pattern: /\bonerror\s*=/i },
  { name: "onload-attribute", pattern: /\bonload\s*=/i },
  { name: "onclick-attribute", pattern: /\bonclick\s*=/i },
  { name: "onmouseover-attribute", pattern: /\bonmouseover\s*=/i },
  { name: "onfocus-attribute", pattern: /\bonfocus\s*=/i },
  { name: "onchange-attribute", pattern: /\bonchange\s*=/i },
  { name: "iframe-tag", pattern: /<iframe\b[^>]*>/i },
  { name: "object-tag", pattern: /<object\b[^>]*>/i },
  { name: "embed-tag", pattern: /<embed\b[^>]*>/i },
  { name: "form-tag", pattern: /<form\b[^>]*>/i },
  { name: "expression-css", pattern: /expression\s*\(/i },
  { name: "import-css", pattern: /@import\s+/i },
  { name: "base-tag", pattern: /<base\b[^>]*>/i },
  { name: "meta-refresh", pattern: /<meta[^>]*http-equiv\s*=\s*["']?refresh["']?/i },
  { name: "srcdoc-attribute", pattern: /\bsrcdoc\s*=/i },
  { name: "xlink-href", pattern: /xlink:href\s*=/i },
]

/**
 * Scan knowledge content for known prompt injection patterns.
 *
 * If a suspicious pattern is detected, logs a warning and replaces
 * the matched text with "[FILTERED]".
 *
 * Returns the sanitized content.
 */
export function sanitizeKnowledgeContent(content: string): string {
  let sanitized = content
  let detected = false

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      detected = true
      sanitized = sanitized.replace(pattern, "[FILTERED]")
    }
  }

  if (detected) {
    console.warn("[Security] Potential prompt injection detected in knowledge doc")
  }

  return sanitized
}

/**
 * Sanitize page content by removing known injection patterns.
 *
 * @param text - Text to sanitize.
 * @returns Sanitized text with injection patterns replaced by [FILTERED].
 */
export function sanitizePageContent(text: string): string {
  let sanitized = text

  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[FILTERED]")
  }

  return sanitized
}

/**
 * Scan text content for HTML injection patterns.
 *
 * @param text - Text to scan.
 * @returns Array of detected HTML injection pattern names.
 */
export function detectHtmlInjection(text: string): string[] {
  const threats: string[] = []
  for (const { name, pattern } of HTML_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      threats.push(name)
    }
  }
  return threats
}
