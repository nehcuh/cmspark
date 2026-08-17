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

export function classifyAlias(
  alias: string | undefined,
  firstUserText?: string,
): AliasClass {
  const a = String(alias || "").trim()
  if (!a) return "empty"
  if (isAcpProvisionalAlias(a)) return "provisional_acp"
  if (WORKER_RE.test(a)) return "create"
  if (firstUserText) {
    const t = String(firstUserText)
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\[文件[^\]]*\]\s*/g, "")
      .trim()
    const prov = !t ? "" : t.length <= 16 ? t : t.slice(0, 15) + "…"
    if (prov && (prov === a || prov.replace(/…$/, "") === a.replace(/…$/, ""))) {
      return "provisional_user"
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
