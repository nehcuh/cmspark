// #369: 「场景与专家」面板 companion 侧数据 — HARD_DENY 后有效工具面 + 用量 + spawn gate.
//
// 设计要点：
// - 有效工具面复用 spawn 的 effective 公式：(parent ∩ pack.allow) \ WORKER_HARD_DENY
//   （computeWorkerWhitelist 是唯一实现，面板展示与 spawn 实际计算不会分叉）。
// - 用量读 capability-audit.jsonl 的 orchestrator.spawn_worker 事件，按 role_label 聚合
//   （零新埋点；role_label 与 pack id / name 匹配）。
// - 停用状态存于 pack.yaml `disabled: true`（随包走，无独立注册表 → 不留幽灵 id）。

import * as fs from "fs"
import { listInstalledPacks, readInstalledManifest } from "./pack-engine"
import { getAuditLogPath } from "./audit-log"
import { computeWorkerWhitelist } from "../orchestrator/spawn"
import { logger } from "../logger"
import type { ThreadManager } from "../threads/thread-manager"
import type { PackTools } from "./types"

/** #369 验收：停用后 spawn 的稳定失败码。 */
export const PACK_DISABLED_CODE = "PACK_DISABLED" as const

/**
 * spawn_worker(pack_id) 的停用闸门。只拦截 disabled；manifest 读不到时放行，
 * 由既有 post-spawn applyPack 失败回滚路径处理（不碰 spawn 链路既有行为）。
 */
export function getPackSpawnGate(
  packId: string,
): { ok: true } | { ok: false; error: string; code: string } {
  const { result } = readInstalledManifest(packId)
  if (!result.ok) return { ok: true }
  if (result.manifest.disabled === true) {
    return {
      ok: false,
      error: `spawn_worker denied: pack '${packId}' is disabled（已停用，可在「场景与专家」面板启用）`,
      code: PACK_DISABLED_CODE,
    }
  }
  return { ok: true }
}

/**
 * HARD_DENY 后的有效工具面（展示的是计算结果，不是 pack 的愿望清单）。
 * allowlist/intersect → roleAllow = pack.tools.allow；unchanged → 与 spawn 无
 * tool_allow 时一致（parent 面或安全浏览器默认集）。deny 与 HARD_DENY 一并剔除。
 */
export function computePackEffectiveTools(
  tools: PackTools,
  parentWhitelist: string[] | null,
): string[] {
  const roleAllow =
    tools.mode === "allowlist" || tools.mode === "intersect" ? [...(tools.allow || [])] : null
  return computeWorkerWhitelist({
    parentWhitelist,
    roleAllow,
    roleDeny: Array.isArray(tools.deny) ? [...tools.deny] : undefined,
  })
}

export type RoleUsage = { count: number; last_at: string | null }

/** spawn_worker 用量按 role_label 聚合（零新埋点，只读既有审计日志）。 */
export function aggregateSpawnUsageByRole(filePath?: string): Map<string, RoleUsage> {
  const out = new Map<string, RoleUsage>()
  const p = getAuditLogPath(filePath)
  let raw: string
  try {
    raw = fs.readFileSync(p, "utf-8")
  } catch {
    return out
  }
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (!t) continue
    let ev: any
    try {
      ev = JSON.parse(t)
    } catch {
      continue
    }
    if (ev?.type !== "orchestrator.spawn_worker") continue
    const role = typeof ev.role_label === "string" && ev.role_label.trim() ? ev.role_label.trim() : null
    if (!role) continue
    const at = typeof ev.at === "string" ? ev.at : null
    const cur = out.get(role) || { count: 0, last_at: null }
    cur.count += 1
    if (at && (!cur.last_at || at > cur.last_at)) cur.last_at = at
    out.set(role, cur)
  }
  return out
}

export type ExpertPanelEntry = {
  id: string
  /** HARD_DENY 后、相对给定 parent 对话计算出的有效工具面。 */
  effective_tools: string[]
  spawn_count: number
  last_spawn_at: string | null
}

/**
 * 面板数据：所有 kind=expert 的 pack 的有效工具面 + 用量。
 * parent 白名单镜像 spawnWorkerThread 的取值（orchestrator parent → null）。
 */
export function getExpertPanelData(
  threadManager: ThreadManager | null,
  threadId?: string | null,
): ExpertPanelEntry[] {
  let parentWhitelist: string[] | null = null
  if (threadManager && threadId) {
    const parent = threadManager.get(threadId) as any
    if (parent && parent.agent_role !== "orchestrator" && Array.isArray(parent.tool_whitelist)) {
      parentWhitelist = [...parent.tool_whitelist]
    }
  }
  let usage: Map<string, RoleUsage>
  try {
    usage = aggregateSpawnUsageByRole()
  } catch (e: any) {
    logger.warn("expert_panel_usage_failed", { error: e?.message || String(e) })
    usage = new Map()
  }
  const experts = listInstalledPacks().filter((p) => p.kind === "expert")
  return experts.map((p) => {
    const { result } = readInstalledManifest(p.id)
    const tools: PackTools = result.ok
      ? result.manifest.tools
      : { mode: "unchanged", allow: [], deny: [] }
    const u = usage.get(p.id) || usage.get(p.name) || { count: 0, last_at: null }
    return {
      id: p.id,
      effective_tools: computePackEffectiveTools(tools, parentWhitelist),
      spawn_count: u.count,
      last_spawn_at: u.last_at,
    }
  })
}
