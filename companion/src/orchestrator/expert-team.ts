// #371 I5: propose_expert_team (read-only match) + spawn_expert_team (one L2 + kick).
// Expert = Pack kind:expert (ADR-014). Collaboration kernel (ADR-015/016) unchanged:
// HITL, WORKER_HARD_DENY, ≤5 workers, no auto-spawn, no worker-to-worker chat.

import { createHash } from "crypto"
import { logger } from "../logger"
import { listInstalledPacks, readInstalledManifest, applyPack } from "../packs/pack-engine"
import { computePackEffectiveTools, getPackSpawnGate } from "../packs/expert-panel"
import type { SkillEngine } from "../skills/skill-engine"
import type { ThreadManager } from "../threads/thread-manager"
import type { PackListItem, PackTools } from "../packs/types"
import {
  ORCHESTRATOR_CAPS,
  type AgentRole,
} from "./constants"
import {
  spawnWorkerThread,
  restoreParentAfterFailedSpawn,
  countWorkersInRun,
  ensureOrchestratorRunId,
  type ParentPromotionSnapshot,
} from "./spawn"
import { appendCapabilityAudit } from "../packs/audit-log"

/** ≤4 experts so one orchestrator slot remains under the ADR-015 cap of 5. */
export const MAX_EXPERT_TEAM_SIZE = 4

export const EMPTY_WORKER_CODE = "EMPTY_WORKER" as const
export const TEAM_SPAWN_ROLLED_BACK = "TEAM_SPAWN_ROLLED_BACK" as const

export type KickWorkerChat = (opts: { threadId: string; message: string }) => void | Promise<void>

export type EligibleExpert = {
  id: string
  name: string
  description: string
  suitable_for: string
  unsuitable_for: string
  tools: PackTools
}

export type ProposedExpert = {
  pack_id: string
  name: string
  rationale: string
}

export type TeamMemberInput = {
  pack_id: string
  brief?: string
  role_label?: string
}

export type NormalizedTeamMember = {
  pack_id: string
  name: string
  brief: string
  role_label: string
  tools: PackTools
}

export type ExpertTeamDigestMember = {
  pack_id: string
  name: string
  role_label: string
  effective_tools: string[]
  brief: string
}

export type ExpertTeamDigest = {
  will_promote_orchestrator: boolean
  will_open_board: boolean
  cap_note: string
  members: ExpertTeamDigestMember[]
}

export function listEligibleExperts(packs: PackListItem[] = listInstalledPacks()): EligibleExpert[] {
  const out: EligibleExpert[] = []
  for (const p of packs) {
    if (p.kind !== "expert") continue
    if (p.disabled === true) continue
    const { result } = readInstalledManifest(p.id)
    if (!result.ok) continue
    if (result.manifest.disabled === true) continue
    out.push({
      id: p.id,
      name: p.name || p.id,
      description: typeof p.description === "string" ? p.description : "",
      suitable_for: typeof p.suitable_for === "string" ? p.suitable_for : "",
      unsuitable_for: typeof p.unsuitable_for === "string" ? p.unsuitable_for : "",
      tools: result.manifest.tools,
    })
  }
  return out
}

/** LLM may only rank/reason; invented or disabled ids are dropped, order preserved. */
export function filterProposedPackIds(proposed: string[], eligibleIds: Set<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of proposed) {
    const id = String(raw || "").trim()
    if (!id || seen.has(id)) continue
    if (!eligibleIds.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function tokenize(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
}

function overlapScore(taskTokens: string[], haystack: string): number {
  if (taskTokens.length === 0) return 0
  const hay = new Set(tokenize(haystack))
  let hits = 0
  for (const t of taskTokens) {
    if (hay.has(t)) hits += 1
  }
  return hits
}

export function rankExperts(task: string, experts: EligibleExpert[], limit = MAX_EXPERT_TEAM_SIZE): ProposedExpert[] {
  const tokens = tokenize(task)
  const scored = experts.map((e) => {
    const blob = [e.id, e.name, e.description, e.suitable_for, e.unsuitable_for].join(" ")
    const score = overlapScore(tokens, blob)
    const rationale =
      score > 0
        ? `与任务简述有 ${score} 个词重叠（${e.name}）`
        : `已安装专家「${e.name}」，作为候选角色`
    return { pack_id: e.id, name: e.name, rationale, score }
  })
  scored.sort((a, b) => b.score - a.score || a.pack_id.localeCompare(b.pack_id))
  const cap = Math.max(0, Math.min(limit, MAX_EXPERT_TEAM_SIZE))
  return scored.slice(0, cap).map(({ pack_id, name, rationale }) => ({ pack_id, name, rationale }))
}

export function proposeExpertTeam(task: string, proposedIds?: string[]): {
  ok: true
  data: { experts: ProposedExpert[]; eligible_count: number; filtered_invented: string[] }
} {
  const brief = String(task || "").trim()
  if (!brief) {
    return {
      ok: true,
      data: { experts: [], eligible_count: 0, filtered_invented: [] },
    }
  }
  const eligible = listEligibleExperts()
  const eligibleIds = new Set(eligible.map((e) => e.id))
  const byId = new Map(eligible.map((e) => [e.id, e]))
  const rawProposed = Array.isArray(proposedIds) ? proposedIds.map(String) : []
  const invented = rawProposed.filter((id) => {
    const t = id.trim()
    return t.length > 0 && !eligibleIds.has(t)
  })
  let picked: ProposedExpert[]
  if (rawProposed.length > 0) {
    const kept = filterProposedPackIds(rawProposed, eligibleIds)
    picked = kept.slice(0, MAX_EXPERT_TEAM_SIZE).map((id) => {
      const e = byId.get(id)!
      return {
        pack_id: e.id,
        name: e.name,
        rationale: `任务「${brief.slice(0, 80)}」需要「${e.name}」视角`,
      }
    })
  } else {
    picked = rankExperts(brief, eligible, MAX_EXPERT_TEAM_SIZE)
  }
  return {
    ok: true,
    data: {
      experts: picked,
      eligible_count: eligible.length,
      filtered_invented: invented,
    },
  }
}

export function fillMemberBrief(opts: {
  goal: string
  brief: string
  name: string
  description: string
}): string {
  const goal = String(opts.goal || "").trim()
  const brief = String(opts.brief || "").trim()
  if (brief) {
    if (goal && !brief.includes(goal)) {
      return `目标：${goal}\n职责：${brief}\n禁止越权：不要调用被 HARD_DENY 的工具，不要与其他 worker 互聊；完成后向编排者提交 handback。`
    }
    return brief
  }
  if (!goal) return ""
  const duties = opts.description.trim() || `你是「${opts.name}」专家。`
  return `目标：${goal}\n职责：你是「${opts.name}」。${duties}\n禁止越权：不要调用被 HARD_DENY 的工具，不要与其他 worker 互聊；完成后向编排者提交 handback。`
}

export function normalizeTeamMembers(
  rawMembers: unknown,
  goal: string,
  eligible: EligibleExpert[],
): { members: NormalizedTeamMember[]; invented: string[]; truncated: boolean } {
  const byId = new Map(eligible.map((e) => [e.id, e]))
  const invented: string[] = []
  const seen = new Set<string>()
  const members: NormalizedTeamMember[] = []
  const list = Array.isArray(rawMembers) ? rawMembers : []
  const pushMember = (packId: string, briefRaw: string, roleRaw: string) => {
    if (!packId || seen.has(packId)) return
    const expert = byId.get(packId)
    if (!expert) {
      invented.push(packId)
      return
    }
    seen.add(packId)
    const brief = fillMemberBrief({
      goal,
      brief: briefRaw,
      name: expert.name,
      description: expert.description,
    })
    const roleLabel = roleRaw.trim() || expert.name
    members.push({
      pack_id: packId,
      name: expert.name,
      brief,
      role_label: roleLabel,
      tools: expert.tools,
    })
  }
  for (const raw of list) {
    if (typeof raw === "string") {
      pushMember(raw.trim(), "", "")
      continue
    }
    if (!raw || typeof raw !== "object") continue
    const packId = String((raw as any).pack_id || (raw as any).id || "").trim()
    pushMember(
      packId,
      String((raw as any).brief || (raw as any).task_slice || ""),
      String((raw as any).role_label || ""),
    )
  }
  const truncated = members.length > MAX_EXPERT_TEAM_SIZE
  return {
    members: members.slice(0, MAX_EXPERT_TEAM_SIZE),
    invented,
    truncated,
  }
}

function parentCapabilityWhitelist(parent: any): string[] | null {
  if (!parent) return null
  if (parent.agent_role === "orchestrator") return null
  if (parent.tool_whitelist === null) return null
  return Array.isArray(parent.tool_whitelist) ? [...parent.tool_whitelist] : null
}

export function remainingWorkerSlots(tm: ThreadManager, parentThreadId: string): number {
  const parent = tm.get(parentThreadId) as any
  if (!parent) return 0
  const runId = parent.orchestrator_run_id || ensureOrchestratorRunId(parent)
  const used = countWorkersInRun(tm, runId)
  return Math.max(0, ORCHESTRATOR_CAPS.max_workers_per_orchestrator_run - used)
}

export function buildExpertTeamConfirmCard(opts: {
  parent: any
  members: NormalizedTeamMember[]
  goal: string
}): { code: string; fullPreview: string; expertTeam: ExpertTeamDigest } {
  const parent = opts.parent
  const willPromote = !parent || parent.agent_role !== "orchestrator"
  const parentWl = parentCapabilityWhitelist(parent)
  const digestMembers: ExpertTeamDigestMember[] = opts.members.map((m) => ({
    pack_id: m.pack_id,
    name: m.name,
    role_label: m.role_label,
    effective_tools: computePackEffectiveTools(m.tools, parentWl),
    brief: m.brief,
  }))
  const capNote = `最多 ${MAX_EXPERT_TEAM_SIZE} 名专家；总 worker ≤ ${ORCHESTRATOR_CAPS.max_workers_per_orchestrator_run}（含已有）。`
  const expertTeam: ExpertTeamDigest = {
    will_promote_orchestrator: willPromote,
    will_open_board: true,
    cap_note: capNote,
    members: digestMembers,
  }
  const lines: string[] = [
    "组队 spawn_expert_team — 一张确认卡批准后创建 worker、套 expert Pack、写入任务切片并 kick。",
    willPromote ? "将把本对话提升为 orchestrator（编排面）。" : "本对话已是 orchestrator。",
    "将打开 Mission Board（parent board_mode=true）。Worker 无板权，只回 handback。",
    capNote,
    `总目标：${opts.goal || "（未提供独立 goal，以各切片为准）"}`,
    "",
  ]
  for (const m of digestMembers) {
    lines.push(`## ${m.name} (${m.pack_id})`)
    lines.push(`角色：${m.role_label}`)
    lines.push(`有效工具面（HARD_DENY 后）：${m.effective_tools.join(", ") || "（空）"}`)
    lines.push("任务切片：")
    lines.push(m.brief)
    lines.push("")
  }
  const fullPreview = lines.join("\n").trim()
  return { code: fullPreview, fullPreview, expertTeam }
}

function sliceFingerprint(brief: string): string {
  return createHash("sha256").update(String(brief || "")).digest("hex").slice(0, 16)
}

/** Token binds pack-id set + slice fingerprints so a post-confirm member/slice swap fails. */
export function expertTeamBindingPayload(params: any): string {
  const members = Array.isArray(params?.members) ? params.members : []
  const ids = [
    ...new Set(
      members
        .map((m: any) => String(m?.pack_id || m?.id || "").trim())
        .filter(Boolean),
    ),
  ].sort()
  const slices = members
    .map((m: any) => {
      const id = String(m?.pack_id || m?.id || "").trim()
      if (!id) return null
      return `${id}:${sliceFingerprint(String(m?.brief || m?.task_slice || ""))}`
    })
    .filter((s: string | null): s is string => !!s)
    .sort()
  const goal = String(params?.goal || "").trim()
  return `spawn_expert_team|ids=${ids.join(",")}|goal=${goal}|slices=${slices.join(",")}`
}

export function mergeEditedSlices(
  members: any[],
  edits: Array<{ pack_id: string; brief: string }> | undefined,
): any[] {
  if (!Array.isArray(members) || !Array.isArray(edits) || edits.length === 0) return members
  const allowed = new Set(
    members.map((m) => String(m?.pack_id || m?.id || "").trim()).filter(Boolean),
  )
  const byId = new Map<string, string>()
  for (const e of edits) {
    const id = String(e?.pack_id || "").trim()
    if (!id || !allowed.has(id)) continue
    byId.set(id, String(e.brief ?? ""))
  }
  return members.map((m) => {
    const id = String(m?.pack_id || m?.id || "").trim()
    if (!byId.has(id)) return m
    return { ...m, brief: byId.get(id) }
  })
}

function persistWorkerBrief(tm: ThreadManager, workerId: string, brief: string): { ok: true } | { ok: false; error: string } {
  const trimmed = String(brief || "").trim()
  if (!trimmed) {
    return { ok: false, error: "worker brief is empty" }
  }
  try {
    tm.addMessage(workerId, { thread_id: workerId, role: "user", content: trimmed })
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
  const msgs = typeof (tm as any).getMessages === "function" ? (tm as any).getMessages(workerId) : []
  const hasBrief = Array.isArray(msgs) && msgs.some((m: any) => m?.role === "user" && String(m?.content || "").trim() === trimmed)
  if (!hasBrief) {
    return { ok: false, error: "worker brief did not persist" }
  }
  try {
    const worker = tm.get(workerId) as any
    const prev = worker?.config_override?.system_prompt_append || ""
    const note = "任务切片见第一条用户消息。禁止与其他 worker 互聊；完成后向编排者提交 handback。"
    tm.update(workerId, {
      config_override: {
        ...(worker?.config_override || {}),
        system_prompt_append: prev.includes(note) ? prev : [prev, note].filter(Boolean).join("\n"),
      },
    } as any)
  } catch {
    /* append is best-effort; brief message is the completeness SoT */
  }
  return { ok: true }
}

function invokeKick(kick: KickWorkerChat | undefined, threadId: string, message: string): { ok: true } | { ok: false; error: string } {
  if (typeof kick !== "function") {
    return { ok: false, error: "kickWorkerChat not bound — refusing empty worker" }
  }
  try {
    const ret = kick({ threadId, message })
    if (ret && typeof (ret as Promise<void>).then === "function") {
      void (ret as Promise<void>).catch((err: any) => {
        logger.warn("expert_team.kick_unhandled", {
          thread_id: threadId,
          error: err?.message || String(err),
        })
      })
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

function rollbackTeam(
  tm: ThreadManager,
  parentId: string,
  workerIds: string[],
  snapshot: ParentPromotionSnapshot | null,
): void {
  for (const id of workerIds) {
    try {
      tm.delete(id)
    } catch {
      /* best-effort */
    }
  }
  restoreParentAfterFailedSpawn(tm, parentId, snapshot)
}

export async function spawnExpertTeam(opts: {
  tm: ThreadManager
  skillEngine: SkillEngine | null
  parentThreadId: string
  goal: string
  rawMembers: unknown
  userConfirmed: boolean
  kickWorkerChat?: KickWorkerChat
}): Promise<
  | {
      ok: true
      data: {
        worker_ids: string[]
        orchestrator_run_id: string
        truncated: boolean
        invented_filtered: string[]
        board_mode: true
      }
    }
  | { ok: false; error: string; data?: { error_code: string; invented_filtered?: string[] } }
> {
  if (!opts.userConfirmed) {
    return {
      ok: false,
      error: "spawn_expert_team requires interactive L2 confirmation (security_token).",
    }
  }
  const parent = opts.tm.get(opts.parentThreadId) as any
  if (!parent) {
    return { ok: false, error: `parent thread not found: ${opts.parentThreadId}` }
  }
  if (parent.agent_role === "worker") {
    return { ok: false, error: "spawn_expert_team denied: worker threads cannot spawn nested workers" }
  }

  const eligible = listEligibleExperts()
  const goal = String(opts.goal || "").trim()
  const { members: normalized, invented, truncated: truncatedOverFour } = normalizeTeamMembers(
    opts.rawMembers,
    goal,
    eligible,
  )
  if (normalized.length === 0) {
    return {
      ok: false,
      error: invented.length
        ? `no eligible experts after filtering invented ids: ${invented.join(", ")}`
        : "spawn_expert_team requires at least one installed kind=expert member",
      data: { error_code: "NO_ELIGIBLE_EXPERTS", invented_filtered: invented },
    }
  }

  const empty = normalized.filter((m) => !m.brief.trim())
  if (empty.length > 0) {
    return {
      ok: false,
      error: `empty worker brief for ${empty.map((m) => m.pack_id).join(", ")} — refusing spawn`,
      data: { error_code: EMPTY_WORKER_CODE, invented_filtered: invented },
    }
  }

  const slots = remainingWorkerSlots(opts.tm, opts.parentThreadId)
  if (slots <= 0) {
    return {
      ok: false,
      error: `max_workers_per_orchestrator_run (${ORCHESTRATOR_CAPS.max_workers_per_orchestrator_run}) reached`,
      data: { error_code: "MAX_WORKERS" },
    }
  }
  const toSpawn = normalized.slice(0, slots)
  const truncated = truncatedOverFour || toSpawn.length < normalized.length

  for (const m of toSpawn) {
    const gate = getPackSpawnGate(m.pack_id)
    if (!gate.ok) {
      return { ok: false, error: gate.error, data: { error_code: gate.code } }
    }
  }

  const created: string[] = []
  let snapshot: ParentPromotionSnapshot | null = null
  let runId = ""

  const fail = (error: string, code: string = TEAM_SPAWN_ROLLED_BACK) => {
    rollbackTeam(opts.tm, opts.parentThreadId, created, snapshot)
    return { ok: false as const, error, data: { error_code: code, invented_filtered: invented } }
  }

  for (const m of toSpawn) {
    const allow = Array.isArray(m.tools.allow) ? [...m.tools.allow] : []
    const deny = Array.isArray(m.tools.deny) ? [...m.tools.deny] : []
    const spawned = spawnWorkerThread(opts.tm, {
      parentThreadId: opts.parentThreadId,
      roleLabel: m.role_label,
      alias: `expert:${m.name}`,
      roleAllow: allow,
      roleDeny: deny,
      packId: m.pack_id,
      userConfirmed: true,
    })
    if (!spawned.ok) {
      return fail(`spawn_expert_team rolled back: ${spawned.error}`)
    }
    if (spawned.parent_before_promotion && !snapshot) {
      snapshot = spawned.parent_before_promotion
    }
    runId = spawned.orchestrator_run_id
    created.push(spawned.worker.id)

    if (!opts.skillEngine) {
      return fail(`spawn_expert_team rolled back: skillEngine not initialized; pack apply required`, "SPAWN_PACK_FAILED")
    }
    let packApply: { ok: boolean; error?: string }
    try {
      const ar = applyPack(m.pack_id, spawned.worker.id, opts.tm, opts.skillEngine, { allowTrust: false })
      packApply = ar.ok ? { ok: true } : { ok: false, error: ar.error }
    } catch (e: any) {
      packApply = { ok: false, error: e?.message || String(e) }
    }
    if (!packApply.ok) {
      return fail(`spawn_expert_team rolled back: pack apply failed — ${packApply.error}`, "SPAWN_PACK_FAILED")
    }

    const persisted = persistWorkerBrief(opts.tm, spawned.worker.id, m.brief)
    if (!persisted.ok) {
      return fail(`spawn_expert_team rolled back: ${persisted.error}`, EMPTY_WORKER_CODE)
    }
    const kicked = invokeKick(opts.kickWorkerChat, spawned.worker.id, m.brief)
    if (!kicked.ok) {
      return fail(`spawn_expert_team rolled back: kick failed — ${kicked.error}`, EMPTY_WORKER_CODE)
    }
  }

  try {
    opts.tm.update(opts.parentThreadId, { board_mode: true } as any)
  } catch (e: any) {
    return fail(`spawn_expert_team rolled back: board_mode failed — ${e?.message || String(e)}`)
  }

  appendCapabilityAudit({
    type: "orchestrator.spawn_expert_team",
    at: new Date().toISOString(),
    parent_thread_id: opts.parentThreadId,
    orchestrator_run_id: runId,
    worker_ids: created,
    pack_ids: toSpawn.map((m) => m.pack_id),
    truncated,
  })

  return {
    ok: true,
    data: {
      worker_ids: created,
      orchestrator_run_id: runId,
      truncated,
      invented_filtered: invented,
      board_mode: true,
    },
  }
}

export function parentRoleSnapshot(tm: ThreadManager, parentId: string): {
  agent_role: AgentRole | string
  worker_count: number
  board_mode: boolean
} {
  const p = tm.get(parentId) as any
  const runId = p?.orchestrator_run_id
  const worker_count = runId ? countWorkersInRun(tm, runId) : tm.list().filter((t: any) => t.parent_thread_id === parentId).length
  return {
    agent_role: (p?.agent_role || "normal") as AgentRole,
    worker_count,
    board_mode: p?.board_mode === true,
  }
}
