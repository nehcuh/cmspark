// #270/#271 — knowledge import preview request lifecycle helpers.
//
// The preview flow is a request/response pair over the companion WS:
// sidepanel sends knowledge.preview with a unique id, companion echoes that id
// on the reply (success or error frame). These helpers keep the routing
// decisions pure so they can be unit-tested without a WS mock.

/** Prefix for preview request ids — recognizable in logs, unique via UUID. */
export function newKnowledgePreviewRequestId(): string {
  return `kp-${crypto.randomUUID()}`
}

/**
 * Id-less fallback matcher (#270): companion parse failures used to fall into
 * the chat stream because the old regex only matched English-ish texts. Keep
 * the old patterns and add companion's actual error strings so id-less error
 * frames (older companion) still route to the preview modal.
 */
const KNOWLEDGE_PREVIEW_ERROR_RE =
  /knowledge|预览|parseFile|fetch knowledge|文件解析失败|Office 文件|不支持的文件类型|解析超时/i

/**
 * Decide whether an inbound companion error frame may concern a knowledge
 * preview request, and if so return the error text to show.
 *
 * Id-ful frames are returned unconditionally: the store correlates the id
 * against the pending preview request and ignores mismatches, so a false
 * positive here is harmless. Id-less frames (older companion) fall back to
 * text matching.
 */
export function knowledgePreviewErrorText(msg: { id?: unknown; error?: unknown }): string | null {
  const errText = typeof msg?.error === "string" ? msg.error : ""
  if (!errText) return null
  if (typeof msg.id === "string" && msg.id) return errText
  return KNOWLEDGE_PREVIEW_ERROR_RE.test(errText) ? errText : null
}

/**
 * #270: the background answers { ok:false, error } when the WS send itself
 * fails (companion down, SW not ready). Map that response to user-facing
 * failure text, or null when the send was accepted.
 */
export function knowledgePreviewSendFailureText(resp: unknown): string | null {
  if (!resp || typeof resp !== "object") return null
  const r = resp as { ok?: unknown; error?: unknown }
  if (r.ok !== false) return null
  return typeof r.error === "string" && r.error ? r.error : "发送失败"
}

// --- #272: AI draft suggestion (knowledge.preview_suggested / knowledge.suggest) ---

/**
 * Mirror of companion digest.ts SENSITIVE_TAG_RE (no cross-package import).
 * Defense in depth: companion already runs normalizeTags at the trust
 * boundary; this drops secret-shaped tags again before they enter the UI.
 */
const SENSITIVE_TAG_RE = /(sk-|api[_-]?key|password|bearer\s|secret|token)/i

/**
 * Draft suggestion from the companion. `source: "llm"` is the only value that
 * may be presented as an AI suggestion — heuristics must never wear that badge.
 */
export interface KnowledgeDraftSuggestion {
  description?: string
  tags?: string[]
  source: "llm" | "heuristic"
}

/** Validate an inbound suggested payload; anything off-shape is dropped. */
export function sanitizeKnowledgeSuggestion(raw: unknown): KnowledgeDraftSuggestion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const s = raw as { description?: unknown; tags?: unknown; source?: unknown }
  if (s.source !== "llm" && s.source !== "heuristic") return null
  const out: KnowledgeDraftSuggestion = { source: s.source }
  if (typeof s.description === "string" && s.description.trim()) out.description = s.description
  if (Array.isArray(s.tags)) {
    const tags = s.tags.filter(
      (t): t is string => typeof t === "string" && !!t.trim() && !SENSITIVE_TAG_RE.test(t),
    )
    if (tags.length) out.tags = tags
  }
  return out.description || out.tags ? out : null
}

/** Format a tags array for the comma-separated tags input. */
export function formatKnowledgeTagsInput(tags: unknown): string {
  if (!Array.isArray(tags)) return ""
  return tags.filter((t): t is string => typeof t === "string" && !!t.trim()).join(", ")
}

export interface KnowledgeDraftFields {
  description: string
  tags: string
}

/**
 * #272 user-dirty rule (spec §4.3): a suggestion fills only the fields the
 * user has NOT edited; dirty fields keep the user's text.
 */
export function fillKnowledgeDraftFromSuggestion(
  current: KnowledgeDraftFields,
  dirty: { description?: boolean; tags?: boolean },
  suggested: KnowledgeDraftSuggestion | null | undefined,
): KnowledgeDraftFields {
  if (!suggested) return current
  return {
    description:
      !dirty.description && typeof suggested.description === "string" && suggested.description
        ? suggested.description
        : current.description,
    tags:
      !dirty.tags && Array.isArray(suggested.tags) ? suggested.tags.join(", ") : current.tags,
  }
}
