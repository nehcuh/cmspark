// Page content threat scanner — scans HTML/text for malicious patterns and sanitizes content.

/** Result of scanning page content for threats. */
export interface PageScanResult {
  /** Sanitized content. */
  sanitized: string
  /** List of detected threat names. */
  threats: string[]
  /** Overall risk score (0-10). */
  riskScore: number
}

/** HTML injection and threat patterns. */
const HTML_INJECTION_PATTERNS: Array<{ name: string; pattern: RegExp; weight: number }> = [
  // Script injection
  { name: "script-tag", pattern: /\<script\b[^\>]*\>/i, weight: 4 },
  { name: "javascript-protocol", pattern: /javascript\s*:/i, weight: 4 },
  { name: "data-protocol", pattern: /data\s*:\s*text\/html/i, weight: 3 },
  { name: "vbscript-protocol", pattern: /vbscript\s*:/i, weight: 4 },
  // Event handlers
  { name: "onerror-attribute", pattern: /\bonerror\s*=/i, weight: 3 },
  { name: "onload-attribute", pattern: /\bonload\s*=/i, weight: 3 },
  { name: "onclick-attribute", pattern: /\bonclick\s*=/i, weight: 2 },
  { name: "onmouseover-attribute", pattern: /\bonmouseover\s*=/i, weight: 2 },
  { name: "onfocus-attribute", pattern: /\bonfocus\s*=/i, weight: 2 },
  { name: "onchange-attribute", pattern: /\bonchange\s*=/i, weight: 2 },
  // iframe / object injection
  { name: "iframe-tag", pattern: /\<iframe\b[^\>]*\>/i, weight: 3 },
  { name: "object-tag", pattern: /\<object\b[^\>]*\>/i, weight: 3 },
  { name: "embed-tag", pattern: /\<embed\b[^\>]*\>/i, weight: 3 },
  { name: "form-tag", pattern: /\<form\b[^\>]*\>/i, weight: 2 },
  // CSS injection
  { name: "expression-css", pattern: /expression\s*\(/i, weight: 3 },
  { name: "import-css", pattern: /@import\s+/i, weight: 2 },
  // URL manipulation
  { name: "base-tag", pattern: /\<base\b[^\>]*\>/i, weight: 2 },
  { name: "meta-refresh", pattern: /\<meta[^\>]*http-equiv\s*=\s*["']?refresh["']?/i, weight: 3 },
  // Encoding obfuscation
  { name: "html-entities", pattern: /\&\#x?[0-9a-f]+;/i, weight: 1 },
  { name: "unicode-escape", pattern: /\\u[0-9a-f]{4}/i, weight: 1 },
  // DOM manipulation in text
  { name: "document-write", pattern: /document\.write\s*\(/i, weight: 3 },
  { name: "innerHTML-assign", pattern: /\.innerHTML\s*=/i, weight: 3 },
  { name: "eval-call", pattern: /\beval\s*\(/i, weight: 4 },
  // Suspicious attributes
  { name: "srcdoc-attribute", pattern: /\bsrcdoc\s*=/i, weight: 3 },
  { name: "xlink-href", pattern: /xlink:href\s*=/i, weight: 2 },
]

/** Prompt injection patterns for text content (48 total). */
export const INJECTION_PATTERNS: RegExp[] = [
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

/**
 * Scan HTML content for threats and return sanitized output.
 *
 * @param html - Raw HTML string to scan.
 * @returns Scan result with sanitized content, threats, and risk score.
 */
export function scanPageContent(html: string): PageScanResult {
  const threats: string[] = []
  let riskScore = 0

  for (const { name, pattern, weight } of HTML_INJECTION_PATTERNS) {
    if (pattern.test(html)) {
      threats.push(name)
      riskScore += weight
    }
  }

  // Also scan for prompt injection patterns in text content
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(html)) {
      const matchName = `injection-${pattern.source.slice(0, 20)}`
      if (!threats.includes(matchName)) {
        threats.push(matchName)
        riskScore += 1
      }
    }
  }

  riskScore = Math.min(riskScore, 10)

  const sanitized = sanitizePageContent(html)

  return { sanitized, threats, riskScore }
}

/**
 * Sanitize text content by removing known injection patterns.
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
