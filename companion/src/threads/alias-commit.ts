// Single write-gate for Thread.alias (2026-08-17 hygiene C′).
// Spec: docs/superpowers/specs/2026-08-17-thread-hygiene-adversarial-design.md

import { logger } from "../logger"
import type { ThreadManager } from "./thread-manager"

export type AliasClass =
  | "empty"
  | "provisional_user"
  | "provisional_acp"
  | "llm"
  | "create"
  | "user"

export type AcpAliasToken = "审查" | "起草" | "失败" | "部分" | "取消"

const ACP_PREFIX = "接力·"
const WORKER_RE = /^worker:[a-zA-Z0-9_-]{1,24}$/
const AGENT_RE = /^[a-z0-9_-]{1,12}$/i
const TOKENS: AcpAliasToken[] = ["审查", "起草", "失败", "部分", "取消"]

export function isAcpProvisionalAlias(alias: string | undefined): boolean {
  const a = String(alias || "")
  if (!a.startsWith(ACP_PREFIX)) return false
  const parts = a.split("·")
  return parts.length === 3 && TOKENS.includes(parts[2] as AcpAliasToken)
}

export function formatAcpProvisionalAlias(agentId: string, token: AcpAliasToken): string {
  const agent = AGENT_RE.test(agentId) ? agentId.toLowerCase().slice(0, 12) : "agent"
  return `${ACP_PREFIX}${agent}·${token}`
}

export function acpTokenFromMode(opts: {
  mode?: string
  failed?: boolean
  cancelled?: boolean
  partial?: boolean
}): AcpAliasToken {
  if (opts.cancelled) return "取消"
  if (opts.failed) return "失败"
  if (opts.partial) return "部分"
  if (opts.mode === "propose_diff") return "起草"
  return "审查"
}

/**
 * Rule-based provisional alias from first user text (P0.5, no LLM) — SINGLE
 * source of truth shared by chatCreate's immediate title (G3.1),
 * thread.batch_auto_title, and classifyAlias's provisional reference, so an
 * alias written by one path is always recognized by the others (F10).
 * Strips [文件 …] upload noise + politeness prefixes; truncates at maxLen
 * (smart cut at the last punctuation boundary) and appends ….
 */
export function aliasFromFirstUserText(text: string, maxLen = 16): string {
  let s = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
  // Drop common file-upload noise prefixes (fall back to the text itself if
  // nothing else remains, so a pure "[文件 x]" first turn still titles).
  s = s.replace(/^\[文件[^\]]*\]\s*/g, "").trim() || s
  s = s.replace(/^(请|帮我|麻烦|请问)[，,\s]*/u, "")
  if (!s) return ""
  if (s.length > maxLen) {
    const cut = s.slice(0, maxLen)
    const m = cut.match(/^(.+?)[\s，。、；;,.!?…]+[^\s，。、；;,.!?…]*$/)
    s = (m?.[1] || cut).trim()
    if (s.length < 8) s = cut.trim()
    if (!s.endsWith("…") && String(text).trim().length > s.length) s += "…"
  }
  return s.slice(0, maxLen + 1)
}

/**
 * Pre-F10 immediate-title formula (old provisionalTitleFromUserText): no
 * politeness strip, [文件 …] strip only, slice(0,15)+"…" (16 chars total).
 * Exists ONLY to recognize aliases already persisted by that path — never
 * use it for new writes (new writes go through aliasFromFirstUserText).
 */
function legacyProvisionalTitleFromUserText(raw: string): string {
  const t = String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
  if (!t) return ""
  const cleaned = t.replace(/^\[文件[^\]]*\]\s*/g, "").trim() || t
  if (cleaned.length <= 16) return cleaned
  return cleaned.slice(0, 15) + "…"
}

export function classifyAlias(
  alias: string | undefined,
  firstUserText?: string,
): AliasClass {
  const a = String(alias || "").trim()
  if (!a) return "empty"
  if (isAcpProvisionalAlias(a)) return "provisional_acp"
  if (WORKER_RE.test(a)) return "create"
  if (firstUserText) {
    // Match either the shared derivation (F10) or the legacy pre-F10 formula —
    // aliases persisted by the old immediate-title path must still classify as
    // provisional_user, or canTransition locks them out of →llm forever.
    const refs = [
      aliasFromFirstUserText(String(firstUserText), 16),
      legacyProvisionalTitleFromUserText(String(firstUserText)),
    ]
    for (const ref of refs) {
      if (ref && (ref === a || ref.replace(/…$/, "") === a.replace(/…$/, ""))) {
        return "provisional_user"
      }
    }
  }
  return "user"
}

function canTransition(from: AliasClass, to: AliasClass, force: boolean): boolean {
  if (from === "empty") return true
  if (from === "provisional_acp" && to === "provisional_acp") return true
  if ((from === "provisional_user" || from === "provisional_acp") && to === "llm") return true
  if (to === "user") return true
  if (force && to === "llm" && from !== "create") return true
  return false
}

export function commitThreadAlias(opts: {
  threadManager: ThreadManager
  threadId: string
  next: string
  class: AliasClass
  force?: boolean
  firstUserText?: string
}): { ok: boolean; alias?: string; reason?: string } {
  const tm = opts.threadManager
  const thread = tm.get(opts.threadId)
  if (!thread) return { ok: false, reason: "not_found" }
  if (thread.agent_role === "worker" && opts.class !== "user" && !opts.force) {
    return { ok: false, reason: "worker" }
  }
  const from = classifyAlias(thread.alias, opts.firstUserText)
  if (!canTransition(from, opts.class, opts.force === true)) {
    logger.info("thread.alias_commit_skip", {
      thread_id: opts.threadId,
      from,
      to: opts.class,
    })
    return { ok: false, reason: "cas" }
  }
  const alias = String(opts.next || "").trim()
  if (!alias && opts.class !== "user") return { ok: false, reason: "empty_next" }
  tm.update(opts.threadId, { alias })
  return { ok: true, alias }
}
