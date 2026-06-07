// Content sanitizer — prompt injection filtering for knowledge docs

const INJECTION_PATTERNS = [
  // English patterns
  /ignore\s+(?:all\s+)?(?:previous\s+)?instructions?/i,
  /system\s*prompt\s*override/i,
  /new\s+role\s*:\s*you\s+are\s+now/i,
  /you\s+are\s+now\s+(?:in\s+)?\w+\s+mode/i,
  /disregard\s+(?:all\s+)?(?:previous\s+)?instructions?/i,
  /forget\s+(?:all\s+)?(?:previous\s+)?(?:instructions?|prompts?)/i,
  /(?:user|human)\s*:\s*ignore\s+(?:all\s+)?(?:previous\s+)?instructions?/i,
  /(?:developer|system)\s*:\s*new\s+instructions?/i,
  /DAN\s*mode/i,
  /jailbreak/i,
  // Chinese patterns
  /忽略\s+(?:以上|前面|之前)\s*(?:所有\s*)?指令/i,
  /忽略\s+(?:所有\s+)?(?:之前|以前|前面)\s*(?:的\s*)?指令/i,
  /请\s*忽略\s+(?:以上|前面|之前)\s*(?:所有\s*)?提示/i,
  /系统\s*提示\s*覆盖/i,
  /新\s*角色\s*：\s*你现在是/i,
  /你\s+现在\s+是\s+\w+\s+模式/i,
  /无视\s+(?:所有\s+)?(?:之前|以前|前面)\s*(?:的\s*)?指令/i,
  /忘记\s+(?:所有\s+)?(?:之前|以前|前面)\s*(?:的\s*)?指令/i,
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
