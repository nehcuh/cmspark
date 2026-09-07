import { createHash } from "node:crypto"

/** One representation for digest, code-point offsets and exact citations. */
export function normalizeEvidenceText(value: string): string {
  return value.replace(/\r\n?/g, "\n").normalize("NFC")
}

export function evidenceDigest(value: string): string {
  return createHash("sha256").update(normalizeEvidenceText(value), "utf8").digest("hex")
}

export interface EvidenceExcerpt {
  excerpt: string
  start: number
  end: number
}

export function exactExcerpt(content: string, citation: EvidenceExcerpt): boolean {
  if (!Number.isSafeInteger(citation.start) || !Number.isSafeInteger(citation.end)
    || citation.start < 0 || citation.end <= citation.start) return false
  const points = Array.from(normalizeEvidenceText(content))
  return citation.end <= points.length
    && points.slice(citation.start, citation.end).join("") === normalizeEvidenceText(citation.excerpt)
}

const tokenPart = /[\p{L}\p{N}_.:@-]/u

/** Match inside the cited range, but inspect boundaries in the entire source.
 * Cutting an excerpt out of non-prod must never turn it into proof of prod. */
export function excerptSupportsValue(content: string, citation: EvidenceExcerpt, value: string, token: boolean): boolean {
  const normalized = normalizeEvidenceText(value)
  if (!normalized.trim() || !exactExcerpt(content, citation)) return false
  const text = Array.from(normalizeEvidenceText(content))
  const needle = Array.from(normalized)
  for (let start = citation.start; start + needle.length <= citation.end; start++) {
    if (!needle.every((point, index) => point === text[start + index])) continue
    if (!token || (
      (start === 0 || !tokenPart.test(text[start - 1]))
      && (start + needle.length === text.length || !tokenPart.test(text[start + needle.length]))
    )) return true
  }
  return false
}

/** Scope identifiers are server-owned values, not model tool arguments. */
export type EvidenceScope = { kind: "chat"; threadId: string }
  | { kind: "mcp"; grantId: string; sessionId: string }

export function evidenceScopeHash(scope: EvidenceScope): string {
  const parts = scope.kind === "chat" ? ["chat", scope.threadId] : ["mcp", scope.grantId, scope.sessionId]
  if (parts.some(part => typeof part !== "string" || !part)) throw new Error("INVALID_EVIDENCE_SCOPE")
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex")
}

export function criterionIdentity(requirementId: string, criterion: string): string {
  return `${normalizeEvidenceText(requirementId)}#${evidenceDigest(criterion)}`
}

/** Object order is immaterial; array order and explicit null are meaningful.
 * Callers validate their operation schema before computing this key. */
export function canonicalRequest(value: unknown): string {
  const comparePoints = (a: string, b: string): number => {
    const left = Array.from(a), right = Array.from(b)
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const delta = left[i].codePointAt(0)! - right[i].codePointAt(0)!
      if (delta) return delta
    }
    return left.length - right.length
  }
  const encode = (item: unknown): string => {
    if (item === null) return "null"
    if (typeof item === "string") return JSON.stringify(item.normalize("NFC"))
    if (typeof item === "boolean") return String(item)
    if (typeof item === "number" && Number.isSafeInteger(item)) return String(item)
    if (Array.isArray(item)) return `[${item.map(encode).join(",")}]`
    if (typeof item === "object" && item && Object.getPrototypeOf(item) === Object.prototype) {
      return `{${Object.keys(item).sort(comparePoints).map(key => `${JSON.stringify(key)}:${encode((item as Record<string, unknown>)[key])}`).join(",")}}`
    }
    throw new Error("INVALID_CANONICAL_REQUEST")
  }
  return encode(value)
}
